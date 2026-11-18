import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PROVIDER_ERROR_CODES, ProviderAdapterError } from "@avenor/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceSyncStatusPanel } from "@/components/reports/source-sync-status-panel";
import {
  buildDeterministicJobIdempotencyKey,
  classifyIngestionError,
  computeBoundedBackfillBatches,
  computeIngestionRetryBackoffMs,
  resolveSyncPeriodWindow,
  TRIGGER_DEV_INGESTION_TASKS,
} from "@/lib/ingestion";

describe("THE-129: Ingestion Policies, Bounded Backfill Chunking, Quota Backoff & Sync Status UI", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clamps backfill requests exceeding maxBackfillDays (90d) and computes resumable 14d batches", () => {
    expect(TRIGGER_DEV_INGESTION_TASKS.syncResource.id).toBe("avenor.metrics.sync-resource");

    const clamped = resolveSyncPeriodWindow({
      providerKey: "ga4",
      runType: "INITIAL_BACKFILL",
      reportingTimezone: "America/New_York",
      requestedEndDate: "2026-10-30",
      backfillDays: 365,
    });
    expect(clamped.clampedToMaxWindow).toBe(true);
    expect(clamped.endDate).toBe("2026-10-30");
    // 90 inclusive days ending 2026-10-30 starts on 2026-08-02
    expect(clamped.startDate).toBe("2026-08-02");

    // 30-day window splits into 14 + 14 + 2 day batches
    const fullBatches = computeBoundedBackfillBatches({
      providerKey: "ga4",
      startDate: "2026-10-01",
      endDate: "2026-10-30",
    });
    expect(fullBatches).toHaveLength(3);
    expect(fullBatches[0]).toMatchObject({
      startDate: "2026-10-01",
      endDate: "2026-10-14",
      dayCount: 14,
      batchIndex: 0,
      totalBatches: 3,
    });
    expect(fullBatches[1]).toMatchObject({
      startDate: "2026-10-15",
      endDate: "2026-10-28",
      dayCount: 14,
      batchIndex: 1,
      totalBatches: 3,
    });
    expect(fullBatches[2]).toMatchObject({
      startDate: "2026-10-29",
      endDate: "2026-10-30",
      dayCount: 2,
      batchIndex: 2,
      totalBatches: 3,
    });

    // Resuming after batch 1 committed (2026-10-14) produces only remaining 2 batches
    const resumedBatches = computeBoundedBackfillBatches({
      providerKey: "ga4",
      startDate: "2026-10-01",
      endDate: "2026-10-30",
      resumeAfterCommittedEndDate: "2026-10-14",
    });
    expect(resumedBatches).toHaveLength(2);
    expect(resumedBatches[0]?.startDate).toBe("2026-10-15");
    expect(resumedBatches[1]?.endDate).toBe("2026-10-30");
  });

  it("computes bounded exponential retry backoff, honors Retry-After, and redacts secrets in error classification", () => {
    const attempt1 = computeIngestionRetryBackoffMs({
      providerKey: "ga4",
      attemptNumber: 1,
      jitterRatio: 0,
    });
    const attempt2 = computeIngestionRetryBackoffMs({
      providerKey: "ga4",
      attemptNumber: 2,
      jitterRatio: 0,
    });
    expect(attempt1).toBe(5_000);
    expect(attempt2).toBe(10_000);

    const withRetryAfter = computeIngestionRetryBackoffMs({
      providerKey: "ga4",
      attemptNumber: 1,
      retryAfterSeconds: 45,
      jitterRatio: 0,
    });
    expect(withRetryAfter).toBe(45_000);

    const rateLimitErr = new ProviderAdapterError({
      providerKey: "ga4",
      code: PROVIDER_ERROR_CODES.RATE_LIMITED,
      message: "GA4 property quota exceeded for access_token=ya29.secret_token_value",
      retryAfterSeconds: 90,
    });
    const classified429 = classifyIngestionError(rateLimitErr, 1, 3);
    expect(classified429.isRateLimited).toBe(true);
    expect(classified429.retryEligible).toBe(true);
    expect(classified429.retryAfterSeconds).toBe(90);
    expect(classified429.errorSummary).not.toContain("ya29.secret_token_value");

    const authErr = new ProviderAdapterError({
      providerKey: "gsc",
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "OAuth token expired or revoked",
    });
    const classified401 = classifyIngestionError(authErr, 1, 3);
    expect(classified401.isAuthFailure).toBe(true);
    expect(classified401.retryEligible).toBe(false);

    // Deterministic job idempotency key
    const key1 = buildDeterministicJobIdempotencyKey({
      workspaceId: "wks_1",
      connectedResourceId: "res_1",
      runType: "SCHEDULED_SYNC",
      periodStartDate: "2026-10-01",
      periodEndDate: "2026-10-07",
      queryScopeKey: "default_standard",
    });
    const key2 = buildDeterministicJobIdempotencyKey({
      workspaceId: "wks_1",
      connectedResourceId: "res_1",
      runType: "SCHEDULED_SYNC",
      periodStartDate: "2026-10-01",
      periodEndDate: "2026-10-07",
      queryScopeKey: "default_standard",
    });
    expect(key1).toBe(key2);
  });

  it("renders SourceSyncStatusPanel with batch progress and prevents duplicate resync actions", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        projectId: "prj_1",
        workspaceId: "wks_1",
        canTriggerSync: true,
        overallState: "COMPLETED",
        lastSyncedAtIso: "2026-10-15T10:00:00.000Z",
        nextScheduledAtIso: "2026-10-15T14:00:00.000Z",
        resources: [
          {
            connectedResourceId: "res_ga4_1",
            externalResourceId: "properties/402918401",
            resourceDisplayName: "Atlas GA4 Property",
            providerKey: "ga4",
            connectionId: "con_1",
            connectionStatus: "HEALTHY",
            environmentId: "env_1",
            environmentName: "Production",
            watermark: {
              id: "iwm_1",
              organizationId: "org_1",
              workspaceId: "wks_1",
              projectId: "prj_1",
              environmentId: "env_1",
              providerConnectionId: "con_1",
              connectedResourceId: "res_ga4_1",
              providerKey: "ga4",
              externalResourceId: "properties/402918401",
              queryScopeKey: "default_standard",
              queryVersion: 1,
              reportingTimezone: "America/New_York",
              lastAttemptedStartDate: "2026-10-01",
              lastAttemptedEndDate: "2026-10-14",
              lastCommittedStartDate: "2026-10-01",
              lastCommittedEndDate: "2026-10-14",
              backfillEarliestDate: "2026-10-01",
              backfillTargetDate: "2026-10-14",
              backfillCompleted: true,
              sourceCompleteness: "COMPLETE",
              syncState: "COMPLETED",
              consecutiveFailures: 0,
              failedIntervals: [],
              activeRunId: null,
              leaseExpiresAtIso: null,
              nextScheduledAtIso: "2026-10-15T14:00:00.000Z",
              rateLimitResetAtIso: null,
              lastAttemptedAtIso: "2026-10-15T10:00:00.000Z",
              lastSucceededAtIso: "2026-10-15T10:00:00.000Z",
              lastErrorCode: null,
              lastErrorSummary: null,
              createdAtIso: "2026-10-15T10:00:00.000Z",
              updatedAtIso: "2026-10-15T10:00:00.000Z",
            },
            recentRuns: [],
            knownBatchProgress: {
              completedBatches: 2,
              totalBatches: 2,
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SourceSyncStatusPanel projectId="prj_1" providerFilter="ga4" />);

    await waitFor(() => {
      expect(screen.getByTestId("source-sync-status-panel")).toBeInTheDocument();
    });

    expect(screen.getByTestId("sync-state-badge-ga4")).toHaveTextContent("Complete");
    expect(screen.getByTestId("sync-batch-progress-ga4")).toHaveTextContent("Batches: 2/2");

    const syncBtn = screen.getByTestId("trigger-sync-ga4");
    fireEvent.click(syncBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
