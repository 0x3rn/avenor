import crypto from "node:crypto";
import { AppError, ERROR_CODES } from "@avenor/types";
import { GSC_REPORTING_TIMEZONE } from "@/lib/providers/google-search-console/types";
import {
  addCalendarDays,
  countInclusiveDays,
  formatDateInTimeZone,
} from "@/lib/reports/date-window";
import type { DateBatchInterval, IngestionRunType } from "./types";

export interface ProviderSyncPolicy {
  providerKey: string;
  scheduledSyncDays: number;
  revisionLookbackDays: number;
  defaultBackfillDays: number;
  maxBackfillDays: number;
  batchChunkDays: number;
  scheduledCadenceMinutes: number;
  defaultReportingTimezone: string;
  persistsRealtimeSnapshots: boolean;
  realtimeRetentionExplanation: string;
}

export const PROVIDER_SYNC_POLICIES: Record<string, ProviderSyncPolicy> = {
  ga4: {
    providerKey: "ga4",
    scheduledSyncDays: 7,
    revisionLookbackDays: 3,
    defaultBackfillDays: 28,
    maxBackfillDays: 90,
    batchChunkDays: 14,
    scheduledCadenceMinutes: 240,
    defaultReportingTimezone: "UTC",
    persistsRealtimeSnapshots: false,
    realtimeRetentionExplanation:
      "GA4 30-minute Realtime snapshots remain in short-lived ScopedTelemetryCache (30s TTL) and are never persisted as completed daily historical observations.",
  },
  gsc: {
    providerKey: "gsc",
    scheduledSyncDays: 10,
    revisionLookbackDays: 5,
    defaultBackfillDays: 28,
    maxBackfillDays: 90,
    batchChunkDays: 14,
    scheduledCadenceMinutes: 720,
    defaultReportingTimezone: GSC_REPORTING_TIMEZONE,
    persistsRealtimeSnapshots: false,
    realtimeRetentionExplanation:
      "Search Console does not expose a realtime API; trailing 48–72h preliminary Pacific Time dates are revisited via REVISION_LOOKBACK.",
  },
};

export function getProviderSyncPolicy(providerKey: string): ProviderSyncPolicy {
  return (
    PROVIDER_SYNC_POLICIES[providerKey] ?? {
      providerKey,
      scheduledSyncDays: 7,
      revisionLookbackDays: 3,
      defaultBackfillDays: 28,
      maxBackfillDays: 90,
      batchChunkDays: 14,
      scheduledCadenceMinutes: 360,
      defaultReportingTimezone: "UTC",
      persistsRealtimeSnapshots: false,
      realtimeRetentionExplanation: "Transient snapshots are not persisted as daily history.",
    }
  );
}

/**
 * Resolves the target `[startDate, endDate]` window for a given `runType` and provider policy,
 * clamping backfills strictly to `maxBackfillDays` so unbounded historical downloads never occur.
 */
export function resolveSyncPeriodWindow(input: {
  providerKey: string;
  runType: IngestionRunType;
  reportingTimezone: string;
  requestedStartDate?: string | null;
  requestedEndDate?: string | null;
  backfillDays?: number | null;
  referenceNow?: Date;
}): { startDate: string; endDate: string; clampedToMaxWindow: boolean } {
  const policy = getProviderSyncPolicy(input.providerKey);
  const now = input.referenceNow ?? new Date();
  const defaultEndDate =
    input.providerKey === "gsc"
      ? formatDateInTimeZone(now, GSC_REPORTING_TIMEZONE, -2)
      : formatDateInTimeZone(now, input.reportingTimezone, 0);

  const endDate = input.requestedEndDate?.trim() || defaultEndDate;

  let desiredDays: number;
  if (input.requestedStartDate?.trim()) {
    desiredDays = countInclusiveDays(input.requestedStartDate.trim(), endDate);
  } else if (input.runType === "INITIAL_BACKFILL") {
    desiredDays = input.backfillDays ?? policy.defaultBackfillDays;
  } else if (input.runType === "REVISION_LOOKBACK") {
    desiredDays = policy.revisionLookbackDays;
  } else {
    desiredDays = policy.scheduledSyncDays;
  }

  const clamped = desiredDays > policy.maxBackfillDays;
  const boundedDays = Math.max(1, Math.min(policy.maxBackfillDays, desiredDays));
  const startDate = addCalendarDays(endDate, -(boundedDays - 1));

  if (endDate < startDate) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Invalid sync window: endDate "${endDate}" precedes startDate "${startDate}".`,
    });
  }

  return {
    startDate,
    endDate,
    clampedToMaxWindow: clamped,
  };
}

/**
 * Splits a `[startDate, endDate]` range into bounded chronological batch intervals of at most
 * `batchChunkDays` days. Supports resuming after `resumeAfterCommittedEndDate` so interrupted
 * backfills only execute remaining uncommitted batches.
 */
export function computeBoundedBackfillBatches(input: {
  providerKey: string;
  startDate: string;
  endDate: string;
  resumeAfterCommittedEndDate?: string | null;
  batchChunkDaysOverride?: number;
}): DateBatchInterval[] {
  const policy = getProviderSyncPolicy(input.providerKey);
  const chunkDays = Math.max(
    1,
    Math.min(31, input.batchChunkDaysOverride ?? policy.batchChunkDays),
  );

  let effectiveStart = input.startDate;
  if (
    input.resumeAfterCommittedEndDate &&
    input.resumeAfterCommittedEndDate >= input.startDate &&
    input.resumeAfterCommittedEndDate < input.endDate
  ) {
    effectiveStart = addCalendarDays(input.resumeAfterCommittedEndDate, 1);
  } else if (
    input.resumeAfterCommittedEndDate &&
    input.resumeAfterCommittedEndDate >= input.endDate
  ) {
    return [];
  }

  const rawIntervals: Array<{ startDate: string; endDate: string; dayCount: number }> = [];
  let cursor = effectiveStart;

  while (cursor <= input.endDate) {
    const candidateEnd = addCalendarDays(cursor, chunkDays - 1);
    const batchEnd = candidateEnd < input.endDate ? candidateEnd : input.endDate;
    rawIntervals.push({
      startDate: cursor,
      endDate: batchEnd,
      dayCount: countInclusiveDays(cursor, batchEnd),
    });
    cursor = addCalendarDays(batchEnd, 1);
  }

  return rawIntervals.map((item, idx) => ({
    ...item,
    batchIndex: idx,
    totalBatches: rawIntervals.length,
  }));
}

/**
 * Generates a deterministic idempotency key for an ingestion job execution.
 */
export function buildDeterministicJobIdempotencyKey(input: {
  workspaceId: string;
  connectedResourceId: string;
  runType: IngestionRunType;
  periodStartDate: string;
  periodEndDate: string;
  queryScopeKey: string;
  idempotencyToken?: string | null;
}): string {
  const payload = [
    input.workspaceId,
    input.connectedResourceId,
    input.runType,
    input.periodStartDate,
    input.periodEndDate,
    input.queryScopeKey,
    input.idempotencyToken ?? "auto",
  ].join("::");
  const hash = crypto.createHash("sha256").update(payload, "utf8").digest("hex");
  return `job_${hash.slice(0, 32)}`;
}
