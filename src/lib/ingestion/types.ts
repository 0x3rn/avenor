import type { CanonicalMetricObservationInput } from "@/lib/metrics/types";
import type {
  Ga4QuotaSnapshot,
  Ga4StandardReportBundle,
} from "@/lib/providers/google-analytics/types";
import type { GscSearchAnalyticsBundle } from "@/lib/providers/google-search-console/types";

export const INGESTION_RUN_TYPES = [
  "SCHEDULED_SYNC",
  "INITIAL_BACKFILL",
  "MANUAL_REFRESH",
  "REVISION_LOOKBACK",
  "RECOVERY_SYNC",
] as const;

export type IngestionRunType = (typeof INGESTION_RUN_TYPES)[number];

export const INGESTION_RUN_STATUSES = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "PARTIALLY_COMPLETED",
  "RATE_LIMITED",
  "FAILED",
  "PAUSED",
  "CANCELLED",
  "CONNECTION_REVOKED",
] as const;

export type IngestionRunStatus = (typeof INGESTION_RUN_STATUSES)[number];

export const INGESTION_SYNC_STATES = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "PARTIALLY_COMPLETED",
  "RATE_LIMITED",
  "FAILED",
  "PAUSED",
  "CONNECTION_REVOKED",
] as const;

export type IngestionSyncState = (typeof INGESTION_SYNC_STATES)[number];

export type SourceCompletenessState =
  | "COMPLETE"
  | "PARTIAL"
  | "PROVISIONAL"
  | "STALE"
  | "UNAVAILABLE";

export interface DateBatchInterval {
  startDate: string;
  endDate: string;
  dayCount: number;
  batchIndex: number;
  totalBatches: number;
}

export interface FailedBatchIntervalRecord {
  startDate: string;
  endDate: string;
  errorCode: string;
  errorCategory: string;
  errorSummary: string;
  failedAtIso: string;
}

export interface IngestionWatermarkRecord {
  id: string;
  organizationId: string;
  workspaceId: string;
  projectId: string | null;
  environmentId: string | null;
  providerConnectionId: string;
  connectedResourceId: string;
  providerKey: string;
  externalResourceId: string;
  queryScopeKey: string;
  queryVersion: number;
  reportingTimezone: string;
  lastAttemptedStartDate: string | null;
  lastAttemptedEndDate: string | null;
  lastCommittedStartDate: string | null;
  lastCommittedEndDate: string | null;
  backfillEarliestDate: string | null;
  backfillTargetDate: string | null;
  backfillCompleted: boolean;
  sourceCompleteness: SourceCompletenessState;
  syncState: IngestionSyncState;
  consecutiveFailures: number;
  failedIntervals: FailedBatchIntervalRecord[];
  activeRunId: string | null;
  leaseExpiresAtIso: string | null;
  nextScheduledAtIso: string | null;
  rateLimitResetAtIso: string | null;
  lastAttemptedAtIso: string | null;
  lastSucceededAtIso: string | null;
  lastErrorCode: string | null;
  lastErrorSummary: string | null;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface IngestionRunRecord {
  id: string;
  organizationId: string;
  workspaceId: string;
  projectId: string | null;
  environmentId: string | null;
  providerConnectionId: string;
  connectedResourceId: string;
  providerKey: string;
  externalResourceId: string;
  runType: IngestionRunType;
  jobIdempotencyKey: string;
  queryFingerprint: string;
  periodStartDate: string;
  periodEndDate: string;
  reportingTimezone: string;
  status: IngestionRunStatus;
  attemptNumber: number;
  maxAttempts: number;
  recordsProcessed: number;
  recordsInserted: number;
  recordsUpdated: number;
  recordsUnchanged: number;
  lastSuccessfulInterval: string | null;
  retryEligible: boolean;
  nextRetryAtIso: string | null;
  errorCode: string | null;
  errorCategory: string | null;
  errorSummary: string | null;
  quotaSnapshot: Record<string, unknown>;
  metadata: Record<string, unknown>;
  startedAtIso: string;
  completedAtIso: string | null;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface CustomBatchProviderFetcherResult {
  observations?: CanonicalMetricObservationInput[];
  ga4Bundle?: Ga4StandardReportBundle;
  gscBundle?: GscSearchAnalyticsBundle;
  quotaSnapshot?: Ga4QuotaSnapshot | Record<string, unknown>;
  sourceCompleteness?: SourceCompletenessState;
}

export type CustomBatchProviderFetcher = (params: {
  batch: DateBatchInterval;
  providerKey: string;
  externalResourceId: string;
  reportingTimezone: string;
}) => Promise<CustomBatchProviderFetcherResult>;

export interface ExecuteResourceSyncInput {
  organizationId: string;
  workspaceId: string;
  projectId?: string | null;
  environmentId?: string | null;
  providerConnectionId: string;
  connectedResourceId: string;
  runType: IngestionRunType;
  requestedStartDate?: string | null;
  requestedEndDate?: string | null;
  backfillDays?: number | null;
  queryScopeKey?: string;
  idempotencyToken?: string | null;
  referenceNow?: Date;
  customFetcher?: CustomBatchProviderFetcher;
  simulateDbFailureOnBatchIndex?: number;
}

export interface ExecuteResourceSyncResult {
  outcome:
    | "completed"
    | "partially_completed"
    | "skipped_active_lease"
    | "skipped_rate_limited"
    | "skipped_paused"
    | "connection_revoked"
    | "failed";
  run: IngestionRunRecord | null;
  watermark: IngestionWatermarkRecord;
  batchesTotal: number;
  batchesCompleted: number;
  recordsProcessed: number;
  recordsInserted: number;
  recordsUpdated: number;
  recordsUnchanged: number;
}

export interface ProjectSyncResourceStatusItem {
  connectedResourceId: string;
  externalResourceId: string;
  resourceDisplayName: string;
  providerKey: string;
  connectionId: string;
  connectionStatus: string;
  environmentId: string | null;
  environmentName: string | null;
  watermark: IngestionWatermarkRecord | null;
  recentRuns: IngestionRunRecord[];
  knownBatchProgress: {
    completedBatches: number;
    totalBatches: number;
  } | null;
}

export interface ProjectSyncStatusSummaryDto {
  projectId: string;
  workspaceId: string;
  canTriggerSync: boolean;
  overallState: IngestionSyncState | "UNMAPPED";
  lastSyncedAtIso: string | null;
  nextScheduledAtIso: string | null;
  resources: ProjectSyncResourceStatusItem[];
}
