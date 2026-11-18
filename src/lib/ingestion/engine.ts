import {
  type AuthenticatedSessionContext,
  authorizeProjectAccess,
  decryptConnectionCredentialForServer,
} from "@avenor/auth";
import { assertServerRuntime } from "@avenor/config";
import {
  dbQuery,
  generateId,
  getDatabasePool,
  type Queryable,
  withTransaction,
} from "@avenor/database";
import {
  AppError,
  ERROR_CODES,
  type ReadOnlyProviderContext,
  roleHasPermission,
} from "@avenor/types";
import {
  type CanonicalMetricObservationInput,
  computeQueryFingerprint,
  normalizeGa4ReportBundleToObservations,
  normalizeGscReportBundleToObservations,
  upsertMetricObservationBatch,
} from "@/lib/metrics";
import { sharedGoogleTelemetryCache } from "@/lib/providers";
import { readGa4StandardReportBundle } from "@/lib/providers/google-analytics";
import {
  GSC_REPORTING_TIMEZONE,
  readSearchAnalyticsReportBundle,
} from "@/lib/providers/google-search-console";
import {
  buildDeterministicJobIdempotencyKey,
  computeBoundedBackfillBatches,
  getProviderSyncPolicy,
  resolveSyncPeriodWindow,
} from "./policies";
import {
  classifyIngestionError,
  computeIngestionRetryBackoffMs,
  getProviderQuotaPolicy,
} from "./quota";
import type {
  ExecuteResourceSyncInput,
  ExecuteResourceSyncResult,
  FailedBatchIntervalRecord,
  IngestionRunRecord,
  IngestionRunStatus,
  IngestionRunType,
  IngestionSyncState,
  IngestionWatermarkRecord,
  ProjectSyncResourceStatusItem,
  ProjectSyncStatusSummaryDto,
  SourceCompletenessState,
} from "./types";

/**
 * Trigger.dev v3-compatible task registry descriptors for Avenor's scheduled and on-demand
 * metrics ingestion pipeline. Executed through the same transactional PostgreSQL watermark/lease
 * engine across Trigger.dev workers, Cloudflare Cron Triggers, and Next.js server routes.
 */
export const TRIGGER_DEV_INGESTION_TASKS = {
  syncResource: {
    id: "avenor.metrics.sync-resource",
    retry: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 5_000,
      maxTimeoutInMs: 300_000,
      randomize: true,
    },
    queue: {
      name: "avenor-provider-ingestion",
      concurrencyLimit: 2,
    },
  },
  scheduledWorkspaceSweep: {
    id: "avenor.metrics.scheduled-workspace-sweep",
    cron: "0 */4 * * *",
  },
} as const;

interface DbWatermarkRow {
  id: string;
  organization_id: string;
  workspace_id: string;
  project_id: string | null;
  environment_id: string | null;
  provider_connection_id: string;
  connected_resource_id: string;
  provider_key: string;
  external_resource_id: string;
  query_scope_key: string;
  query_version: number;
  reporting_timezone: string;
  last_attempted_start_date: string | null;
  last_attempted_end_date: string | null;
  last_committed_start_date: string | null;
  last_committed_end_date: string | null;
  backfill_earliest_date: string | null;
  backfill_target_date: string | null;
  backfill_completed: boolean;
  source_completeness: string;
  sync_state: string;
  consecutive_failures: number;
  failed_intervals: FailedBatchIntervalRecord[];
  active_run_id: string | null;
  lease_expires_at: Date | null;
  next_scheduled_at: Date | null;
  rate_limit_reset_at: Date | null;
  last_attempted_at: Date | null;
  last_succeeded_at: Date | null;
  last_error_code: string | null;
  last_error_summary: string | null;
  created_at: Date;
  updated_at: Date;
}

interface DbRunRow {
  id: string;
  organization_id: string;
  workspace_id: string;
  project_id: string | null;
  environment_id: string | null;
  provider_connection_id: string;
  connected_resource_id: string;
  provider_key: string;
  external_resource_id: string;
  run_type: string;
  job_idempotency_key: string;
  query_fingerprint: string;
  period_start_date: string;
  period_end_date: string;
  reporting_timezone: string;
  status: string;
  attempt_number: number;
  max_attempts: number;
  records_processed: number;
  records_inserted: number;
  records_updated: number;
  records_unchanged: number;
  last_successful_interval: string | null;
  retry_eligible: boolean;
  next_retry_at: Date | null;
  error_code: string | null;
  error_category: string | null;
  error_summary: string | null;
  quota_snapshot: Record<string, unknown>;
  metadata: Record<string, unknown>;
  started_at: Date;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapWatermarkRow(row: DbWatermarkRow): IngestionWatermarkRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    providerConnectionId: row.provider_connection_id,
    connectedResourceId: row.connected_resource_id,
    providerKey: row.provider_key,
    externalResourceId: row.external_resource_id,
    queryScopeKey: row.query_scope_key,
    queryVersion: row.query_version,
    reportingTimezone: row.reporting_timezone,
    lastAttemptedStartDate: row.last_attempted_start_date,
    lastAttemptedEndDate: row.last_attempted_end_date,
    lastCommittedStartDate: row.last_committed_start_date,
    lastCommittedEndDate: row.last_committed_end_date,
    backfillEarliestDate: row.backfill_earliest_date,
    backfillTargetDate: row.backfill_target_date,
    backfillCompleted: row.backfill_completed,
    sourceCompleteness: row.source_completeness as SourceCompletenessState,
    syncState: row.sync_state as IngestionSyncState,
    consecutiveFailures: row.consecutive_failures,
    failedIntervals: Array.isArray(row.failed_intervals) ? row.failed_intervals : [],
    activeRunId: row.active_run_id,
    leaseExpiresAtIso: row.lease_expires_at ? new Date(row.lease_expires_at).toISOString() : null,
    nextScheduledAtIso: row.next_scheduled_at
      ? new Date(row.next_scheduled_at).toISOString()
      : null,
    rateLimitResetAtIso: row.rate_limit_reset_at
      ? new Date(row.rate_limit_reset_at).toISOString()
      : null,
    lastAttemptedAtIso: row.last_attempted_at
      ? new Date(row.last_attempted_at).toISOString()
      : null,
    lastSucceededAtIso: row.last_succeeded_at
      ? new Date(row.last_succeeded_at).toISOString()
      : null,
    lastErrorCode: row.last_error_code,
    lastErrorSummary: row.last_error_summary,
    createdAtIso: new Date(row.created_at).toISOString(),
    updatedAtIso: new Date(row.updated_at).toISOString(),
  };
}

function mapRunRow(row: DbRunRow): IngestionRunRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    providerConnectionId: row.provider_connection_id,
    connectedResourceId: row.connected_resource_id,
    providerKey: row.provider_key,
    externalResourceId: row.external_resource_id,
    runType: row.run_type as IngestionRunType,
    jobIdempotencyKey: row.job_idempotency_key,
    queryFingerprint: row.query_fingerprint,
    periodStartDate: row.period_start_date,
    periodEndDate: row.period_end_date,
    reportingTimezone: row.reporting_timezone,
    status: row.status as IngestionRunStatus,
    attemptNumber: row.attempt_number,
    maxAttempts: row.max_attempts,
    recordsProcessed: row.records_processed,
    recordsInserted: row.records_inserted,
    recordsUpdated: row.records_updated,
    recordsUnchanged: row.records_unchanged,
    lastSuccessfulInterval: row.last_successful_interval,
    retryEligible: row.retry_eligible,
    nextRetryAtIso: row.next_retry_at ? new Date(row.next_retry_at).toISOString() : null,
    errorCode: row.error_code,
    errorCategory: row.error_category,
    errorSummary: row.error_summary,
    quotaSnapshot: row.quota_snapshot ?? {},
    metadata: row.metadata ?? {},
    startedAtIso: new Date(row.started_at).toISOString(),
    completedAtIso: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    createdAtIso: new Date(row.created_at).toISOString(),
    updatedAtIso: new Date(row.updated_at).toISOString(),
  };
}

/**
 * Executes an idempotent, lease-protected, quota-aware metric ingestion sync or backfill
 * for an authorized workspace resource.
 */
export async function executeResourceIngestionSync(
  input: ExecuteResourceSyncInput,
  options?: { connectionString?: string },
): Promise<ExecuteResourceSyncResult> {
  assertServerRuntime("executeResourceIngestionSync");

  const pool = getDatabasePool(options?.connectionString);
  const now = input.referenceNow ?? new Date();
  const queryScopeKey = input.queryScopeKey?.trim() || "default_standard";

  // 1. Verify tenant, connection, and resource ownership
  const resourceCheck = await dbQuery<{
    resource_id: string;
    external_resource_id: string;
    resource_metadata: Record<string, unknown>;
    connection_id: string;
    provider_key: string;
    connection_status: string;
    granted_scopes: string[];
    workspace_id: string;
    organization_id: string;
    default_timezone: string;
    mapped_project_id: string | null;
    mapped_environment_id: string | null;
  }>(
    `SELECT
       cr.id AS resource_id,
       cr.external_resource_id,
       cr.metadata AS resource_metadata,
       pc.id AS connection_id,
       pc.provider_key,
       pc.status AS connection_status,
       pc.granted_scopes,
       w.id AS workspace_id,
       w.organization_id,
       w.default_timezone,
       rm.project_id AS mapped_project_id,
       rm.environment_id AS mapped_environment_id
     FROM connected_resources cr
     INNER JOIN provider_connections pc ON pc.id = cr.provider_connection_id
     INNER JOIN workspaces w ON w.id = cr.workspace_id
     LEFT JOIN resource_mappings rm ON rm.connected_resource_id = cr.id
     WHERE cr.id = $1 AND pc.id = $2
     LIMIT 1`,
    [input.connectedResourceId, input.providerConnectionId],
    pool,
  );

  const resMeta = resourceCheck.rows[0];
  if (
    !resMeta ||
    resMeta.workspace_id !== input.workspaceId ||
    resMeta.organization_id !== input.organizationId
  ) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message:
        "Unauthorized ingestion target: resource does not belong to the specified workspace.",
      statusCode: 403,
    });
  }

  const providerKey = resMeta.provider_key;
  const externalResourceId = resMeta.external_resource_id;
  const projectId = input.projectId ?? resMeta.mapped_project_id ?? null;
  const environmentId = input.environmentId ?? resMeta.mapped_environment_id ?? null;

  const reportingTimezone =
    providerKey === "gsc"
      ? GSC_REPORTING_TIMEZONE
      : typeof resMeta.resource_metadata?.timeZone === "string" &&
          resMeta.resource_metadata.timeZone.trim()
        ? resMeta.resource_metadata.timeZone.trim()
        : resMeta.default_timezone || "UTC";

  const syncPolicy = getProviderSyncPolicy(providerKey);
  const quotaPolicy = getProviderQuotaPolicy(providerKey);

  // Ensure watermark row exists before locking
  await dbQuery(
    `INSERT INTO ingestion_watermarks (
       id, organization_id, workspace_id, project_id, environment_id,
       provider_connection_id, connected_resource_id, provider_key,
       external_resource_id, query_scope_key, query_version, reporting_timezone,
       sync_state
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11, 'PENDING')
     ON CONFLICT ON CONSTRAINT uq_ingestion_watermarks_scope DO NOTHING`,
    [
      generateId("iwm"),
      input.organizationId,
      input.workspaceId,
      projectId,
      environmentId,
      input.providerConnectionId,
      input.connectedResourceId,
      providerKey,
      externalResourceId,
      queryScopeKey,
      reportingTimezone,
    ],
    pool,
  );

  // 2. Check revoked / disconnected connection state before acquiring lease
  if (resMeta.connection_status === "REVOKED" || resMeta.connection_status === "DISCONNECTED") {
    const revokedRes = await dbQuery<DbWatermarkRow>(
      `UPDATE ingestion_watermarks
       SET sync_state = 'CONNECTION_REVOKED',
           active_run_id = NULL,
           lease_expires_at = NULL,
           last_error_code = 'CONNECTION_REVOKED',
           last_error_summary = 'Provider connection has been disconnected or consent revoked; scheduled sync halted.',
           updated_at = now()
       WHERE workspace_id = $1 AND connected_resource_id = $2 AND query_scope_key = $3 AND query_version = 1
       RETURNING *`,
      [input.workspaceId, input.connectedResourceId, queryScopeKey],
      pool,
    );
    const wm = revokedRes.rows[0];
    if (!wm) {
      throw new AppError({
        code: ERROR_CODES.INTERNAL_ERROR,
        message: "Watermark missing after revoked update.",
      });
    }
    return {
      outcome: "connection_revoked",
      run: null,
      watermark: mapWatermarkRow(wm),
      batchesTotal: 0,
      batchesCompleted: 0,
      recordsProcessed: 0,
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsUnchanged: 0,
    };
  }

  // Resolve target window
  const periodWindow = resolveSyncPeriodWindow({
    providerKey,
    runType: input.runType,
    reportingTimezone,
    requestedStartDate: input.requestedStartDate,
    requestedEndDate: input.requestedEndDate,
    backfillDays: input.backfillDays,
    referenceNow: now,
  });

  const jobIdempotencyKey = buildDeterministicJobIdempotencyKey({
    workspaceId: input.workspaceId,
    connectedResourceId: input.connectedResourceId,
    runType: input.runType,
    periodStartDate: periodWindow.startDate,
    periodEndDate: periodWindow.endDate,
    queryScopeKey,
    idempotencyToken: input.idempotencyToken,
  });

  const queryFingerprint = computeQueryFingerprint({
    providerKey,
    externalResourceId,
    queryScope: queryScopeKey,
  });

  // 3. Transactionally claim the watermark lease (SELECT ... FOR UPDATE prevents concurrent worker corruption)
  const claimResult = await withTransaction(
    async (tx) => {
      const wmRes = await dbQuery<DbWatermarkRow>(
        `SELECT * FROM ingestion_watermarks
         WHERE workspace_id = $1
           AND connected_resource_id = $2
           AND query_scope_key = $3
           AND query_version = 1
         FOR UPDATE`,
        [input.workspaceId, input.connectedResourceId, queryScopeKey],
        tx,
      );
      const wm = wmRes.rows[0];
      if (!wm) {
        throw new AppError({
          code: ERROR_CODES.INTERNAL_ERROR,
          message: "Unable to lock ingestion watermark.",
        });
      }

      if (wm.sync_state === "PAUSED") {
        return { kind: "paused" as const, watermark: mapWatermarkRow(wm), run: null };
      }

      if (wm.rate_limit_reset_at && new Date(wm.rate_limit_reset_at).getTime() > now.getTime()) {
        return { kind: "rate_limited" as const, watermark: mapWatermarkRow(wm), run: null };
      }

      if (
        wm.sync_state === "RUNNING" &&
        wm.lease_expires_at &&
        new Date(wm.lease_expires_at).getTime() > now.getTime()
      ) {
        return { kind: "active_lease" as const, watermark: mapWatermarkRow(wm), run: null };
      }

      // Create or reuse idempotent ingestion_runs row
      const newRunId = generateId("irun");
      await dbQuery(
        `INSERT INTO ingestion_runs (
           id, organization_id, workspace_id, project_id, environment_id,
           provider_connection_id, connected_resource_id, provider_key, external_resource_id,
           run_type, job_idempotency_key, query_fingerprint,
           period_start_date, period_end_date, reporting_timezone,
           status, attempt_number, max_attempts, started_at
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8, $9,
           $10, $11, $12,
           $13, $14, $15,
           'RUNNING', 1, $16, $17
         )
         ON CONFLICT ON CONSTRAINT uq_ingestion_runs_idempotency DO UPDATE SET
           status = 'RUNNING',
           attempt_number = CASE
             WHEN ingestion_runs.status IN ('FAILED', 'RATE_LIMITED', 'PARTIALLY_COMPLETED')
             THEN ingestion_runs.attempt_number + 1
             ELSE ingestion_runs.attempt_number
           END,
           started_at = $17,
           updated_at = now()`,
        [
          newRunId,
          input.organizationId,
          input.workspaceId,
          projectId,
          environmentId,
          input.providerConnectionId,
          input.connectedResourceId,
          providerKey,
          externalResourceId,
          input.runType,
          jobIdempotencyKey,
          queryFingerprint,
          periodWindow.startDate,
          periodWindow.endDate,
          reportingTimezone,
          quotaPolicy.maxAttempts,
          now,
        ],
        tx,
      );

      const runRes = await dbQuery<DbRunRow>(
        `SELECT * FROM ingestion_runs
         WHERE workspace_id = $1 AND job_idempotency_key = $2
         LIMIT 1`,
        [input.workspaceId, jobIdempotencyKey],
        tx,
      );
      const runRow = runRes.rows[0];
      if (!runRow) {
        throw new AppError({
          code: ERROR_CODES.INTERNAL_ERROR,
          message: "Failed to load claimed ingestion run.",
        });
      }

      const leaseExpiresAt = new Date(now.getTime() + quotaPolicy.leaseDurationSeconds * 1000);
      const updatedWmRes = await dbQuery<DbWatermarkRow>(
        `UPDATE ingestion_watermarks
         SET sync_state = 'RUNNING',
             active_run_id = $2,
             lease_expires_at = $3,
             last_attempted_start_date = $4,
             last_attempted_end_date = $5,
             last_attempted_at = $6,
             backfill_earliest_date = CASE
               WHEN $7 = 'INITIAL_BACKFILL' AND backfill_earliest_date IS NULL THEN $4
               ELSE backfill_earliest_date
             END,
             backfill_target_date = CASE
               WHEN $7 = 'INITIAL_BACKFILL' THEN $5
               ELSE backfill_target_date
             END,
             project_id = COALESCE($8, project_id),
             environment_id = COALESCE($9, environment_id),
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [
          wm.id,
          runRow.id,
          leaseExpiresAt,
          periodWindow.startDate,
          periodWindow.endDate,
          now,
          input.runType,
          projectId,
          environmentId,
        ],
        tx,
      );

      return {
        kind: "claimed" as const,
        watermark: mapWatermarkRow(updatedWmRes.rows[0] ?? wm),
        run: mapRunRow(runRow),
      };
    },
    { connectionString: options?.connectionString },
  );

  if (claimResult.kind === "paused") {
    return {
      outcome: "skipped_paused",
      run: null,
      watermark: claimResult.watermark,
      batchesTotal: 0,
      batchesCompleted: 0,
      recordsProcessed: 0,
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsUnchanged: 0,
    };
  }

  if (claimResult.kind === "rate_limited") {
    return {
      outcome: "skipped_rate_limited",
      run: null,
      watermark: claimResult.watermark,
      batchesTotal: 0,
      batchesCompleted: 0,
      recordsProcessed: 0,
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsUnchanged: 0,
    };
  }

  if (claimResult.kind === "active_lease") {
    return {
      outcome: "skipped_active_lease",
      run: null,
      watermark: claimResult.watermark,
      batchesTotal: 0,
      batchesCompleted: 0,
      recordsProcessed: 0,
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsUnchanged: 0,
    };
  }

  const activeRun = claimResult.run;
  const initialWatermark = claimResult.watermark;

  // 4. Compute batch intervals (resuming after last_committed_end_date for INITIAL_BACKFILL if interrupted)
  const resumeCursor =
    input.runType === "INITIAL_BACKFILL" &&
    !initialWatermark.backfillCompleted &&
    initialWatermark.lastCommittedEndDate &&
    initialWatermark.lastCommittedEndDate >= periodWindow.startDate &&
    initialWatermark.lastCommittedEndDate < periodWindow.endDate
      ? initialWatermark.lastCommittedEndDate
      : null;

  const batches = computeBoundedBackfillBatches({
    providerKey,
    startDate: periodWindow.startDate,
    endDate: periodWindow.endDate,
    resumeAfterCommittedEndDate: resumeCursor,
  });

  let batchesCompleted = 0;
  let totalProcessed = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalUnchanged = 0;
  let lastSuccessfulInterval: string | null = activeRun.lastSuccessfulInterval;
  let latestQuotaSnapshot: Record<string, unknown> = {};
  let latestCompleteness: SourceCompletenessState = "COMPLETE";
  const failedIntervals: FailedBatchIntervalRecord[] = [];
  let fatalClassifiedError: ReturnType<typeof classifyIngestionError> | null = null;

  // Resolve provider context once if no customFetcher is injected
  let providerContext: ReadOnlyProviderContext | null = null;
  if (!input.customFetcher) {
    const credHandle = await decryptConnectionCredentialForServer({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      connectionId: input.providerConnectionId,
    });
    const secrets = credHandle.exposeSecretForServerAdapter();
    providerContext = {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      connectionId: input.providerConnectionId,
      accessToken: secrets.accessToken,
      grantedScopes: resMeta.granted_scopes ?? [],
    };
  }

  for (const batch of batches) {
    try {
      let batchObservations: CanonicalMetricObservationInput[] = [];
      if (input.customFetcher) {
        const fetched = await input.customFetcher({
          batch,
          providerKey,
          externalResourceId,
          reportingTimezone,
        });
        if (fetched.quotaSnapshot) {
          latestQuotaSnapshot = { ...fetched.quotaSnapshot };
        }
        if (fetched.sourceCompleteness) {
          latestCompleteness = fetched.sourceCompleteness;
        }
        if (fetched.observations) {
          batchObservations = fetched.observations;
        } else if (fetched.ga4Bundle) {
          batchObservations = normalizeGa4ReportBundleToObservations(fetched.ga4Bundle, {
            organizationId: input.organizationId,
            workspaceId: input.workspaceId,
            projectId,
            environmentId,
            providerConnectionId: input.providerConnectionId,
            connectedResourceId: input.connectedResourceId,
            ingestionRunId: activeRun.id,
            collectedAt: now,
            referenceNow: now,
          });
        } else if (fetched.gscBundle) {
          batchObservations = normalizeGscReportBundleToObservations(fetched.gscBundle, {
            organizationId: input.organizationId,
            workspaceId: input.workspaceId,
            projectId,
            environmentId,
            providerConnectionId: input.providerConnectionId,
            connectedResourceId: input.connectedResourceId,
            ingestionRunId: activeRun.id,
            collectedAt: now,
            referenceNow: now,
          });
        }
      } else if (providerKey === "ga4" && providerContext) {
        const ga4Bundle = await readGa4StandardReportBundle(providerContext, {
          propertyId: externalResourceId,
          startDate: batch.startDate,
          endDate: batch.endDate,
          projectId,
          propertyTimeZone: reportingTimezone,
        });
        latestQuotaSnapshot = { ...ga4Bundle.quota };
        latestCompleteness = ga4Bundle.dataQuality.isSampled ? "PARTIAL" : "COMPLETE";
        batchObservations = normalizeGa4ReportBundleToObservations(ga4Bundle, {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          projectId,
          environmentId,
          providerConnectionId: input.providerConnectionId,
          connectedResourceId: input.connectedResourceId,
          ingestionRunId: activeRun.id,
          collectedAt: now,
          referenceNow: now,
        });
      } else if (providerKey === "gsc" && providerContext) {
        const gscBundle = await readSearchAnalyticsReportBundle(providerContext, {
          siteUrl: externalResourceId,
          startDate: batch.startDate,
          endDate: batch.endDate,
          projectId,
        });
        latestCompleteness = gscBundle.coverage.hasPreliminaryDatesInWindow
          ? "PROVISIONAL"
          : "COMPLETE";
        batchObservations = normalizeGscReportBundleToObservations(gscBundle, {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          projectId,
          environmentId,
          providerConnectionId: input.providerConnectionId,
          connectedResourceId: input.connectedResourceId,
          ingestionRunId: activeRun.id,
          collectedAt: now,
          referenceNow: now,
        });
      }

      // Persist batch observations AND advance watermark atomically inside one transaction
      await withTransaction(
        async (tx) => {
          const upsertStats = await upsertMetricObservationBatch(batchObservations, {
            client: tx,
          });

          if (
            input.simulateDbFailureOnBatchIndex !== undefined &&
            input.simulateDbFailureOnBatchIndex === batch.batchIndex
          ) {
            throw new AppError({
              code: ERROR_CODES.INTERNAL_ERROR,
              message: `Simulated database failure during batch ${batch.batchIndex} commit.`,
            });
          }

          totalProcessed += upsertStats.processedCount;
          totalInserted += upsertStats.insertedCount;
          totalUpdated += upsertStats.updatedCount;
          totalUnchanged += upsertStats.unchangedCount;
          batchesCompleted += 1;
          lastSuccessfulInterval = `${batch.startDate}..${batch.endDate}`;

          // Advance committed watermark only after observations are durably written in this tx
          await dbQuery(
            `UPDATE ingestion_watermarks
             SET last_committed_start_date = CASE
                   WHEN last_committed_start_date IS NULL OR $2 < last_committed_start_date THEN $2
                   ELSE last_committed_start_date
                 END,
                 last_committed_end_date = CASE
                   WHEN last_committed_end_date IS NULL OR $3 > last_committed_end_date THEN $3
                   ELSE last_committed_end_date
                 END,
                 source_completeness = $4,
                 updated_at = now()
             WHERE id = $1`,
            [initialWatermark.id, batch.startDate, batch.endDate, latestCompleteness],
            tx,
          );
        },
        { connectionString: options?.connectionString },
      );

      // Check GA4 remaining token quota floor before continuing to next batch
      const hourlyRemaining =
        typeof latestQuotaSnapshot.tokensRemainingHour === "number"
          ? latestQuotaSnapshot.tokensRemainingHour
          : null;
      if (
        hourlyRemaining !== null &&
        hourlyRemaining < quotaPolicy.minRemainingHourlyTokensFloor &&
        batch.batchIndex < batches.length - 1
      ) {
        fatalClassifiedError = {
          errorCode: "RATE_LIMITED",
          errorCategory: "RATE_LIMITED",
          errorSummary: `GA4 hourly quota token floor reached (${hourlyRemaining} remaining < ${quotaPolicy.minRemainingHourlyTokensFloor}); pausing remaining backfill batches.`,
          retryEligible: true,
          isRateLimited: true,
          isAuthFailure: false,
          retryAfterSeconds: 120,
        };
        failedIntervals.push({
          startDate: batches[batch.batchIndex + 1]?.startDate ?? batch.endDate,
          endDate: periodWindow.endDate,
          errorCode: "RATE_LIMITED",
          errorCategory: "RATE_LIMITED",
          errorSummary: fatalClassifiedError.errorSummary,
          failedAtIso: new Date().toISOString(),
        });
        break;
      }
    } catch (err) {
      fatalClassifiedError = classifyIngestionError(
        err,
        activeRun.attemptNumber,
        activeRun.maxAttempts,
      );
      failedIntervals.push({
        startDate: batch.startDate,
        endDate: batch.endDate,
        errorCode: fatalClassifiedError.errorCode,
        errorCategory: fatalClassifiedError.errorCategory,
        errorSummary: fatalClassifiedError.errorSummary,
        failedAtIso: new Date().toISOString(),
      });
      break;
    }
  }

  // 5. Finalize run status and release watermark lease
  const finalStatus: IngestionRunStatus = !fatalClassifiedError
    ? "COMPLETED"
    : fatalClassifiedError.isRateLimited
      ? "RATE_LIMITED"
      : batchesCompleted > 0
        ? "PARTIALLY_COMPLETED"
        : "FAILED";

  const finalSyncState: IngestionSyncState = !fatalClassifiedError
    ? "COMPLETED"
    : fatalClassifiedError.isAuthFailure
      ? "CONNECTION_REVOKED"
      : fatalClassifiedError.isRateLimited
        ? "RATE_LIMITED"
        : batchesCompleted > 0
          ? "PARTIALLY_COMPLETED"
          : "FAILED";

  const backoffMs = fatalClassifiedError
    ? computeIngestionRetryBackoffMs({
        providerKey,
        attemptNumber: activeRun.attemptNumber,
        retryAfterSeconds: fatalClassifiedError.retryAfterSeconds,
      })
    : null;

  const nextRetryAt =
    fatalClassifiedError?.retryEligible && backoffMs ? new Date(now.getTime() + backoffMs) : null;

  const rateLimitResetAt =
    fatalClassifiedError?.isRateLimited && backoffMs ? new Date(now.getTime() + backoffMs) : null;

  const nextScheduledAt = !fatalClassifiedError
    ? new Date(now.getTime() + syncPolicy.scheduledCadenceMinutes * 60_000)
    : nextRetryAt;

  const backfillNowComplete =
    input.runType === "INITIAL_BACKFILL" &&
    !fatalClassifiedError &&
    batchesCompleted === batches.length;

  const finalized = await withTransaction(
    async (tx) => {
      const updatedRunRes = await dbQuery<DbRunRow>(
        `UPDATE ingestion_runs
         SET status = $2,
             records_processed = $3,
             records_inserted = $4,
             records_updated = $5,
             records_unchanged = $6,
             last_successful_interval = $7,
             retry_eligible = $8,
             next_retry_at = $9,
             error_code = $10,
             error_category = $11,
             error_summary = $12,
             quota_snapshot = $13::jsonb,
             metadata = $14::jsonb,
             completed_at = $15,
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [
          activeRun.id,
          finalStatus,
          totalProcessed,
          totalInserted,
          totalUpdated,
          totalUnchanged,
          lastSuccessfulInterval,
          fatalClassifiedError?.retryEligible ?? false,
          nextRetryAt,
          fatalClassifiedError?.errorCode ?? null,
          fatalClassifiedError?.errorCategory ?? null,
          fatalClassifiedError?.errorSummary ?? null,
          JSON.stringify(latestQuotaSnapshot),
          JSON.stringify({
            batchesTotal: batches.length,
            batchesCompleted,
            clampedToMaxWindow: periodWindow.clampedToMaxWindow,
          }),
          new Date(),
        ],
        tx,
      );

      const updatedWmRes = await dbQuery<DbWatermarkRow>(
        `UPDATE ingestion_watermarks
         SET sync_state = $2,
             active_run_id = NULL,
             lease_expires_at = NULL,
             backfill_completed = CASE WHEN $3 THEN true ELSE backfill_completed END,
             consecutive_failures = CASE WHEN $4 THEN 0 ELSE consecutive_failures + 1 END,
             failed_intervals = $5::jsonb,
             next_scheduled_at = $6,
             rate_limit_reset_at = $7,
             last_succeeded_at = CASE WHEN $4 THEN $8 ELSE last_succeeded_at END,
             last_error_code = $9,
             last_error_summary = $10,
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [
          initialWatermark.id,
          finalSyncState,
          backfillNowComplete,
          !fatalClassifiedError,
          JSON.stringify(failedIntervals),
          nextScheduledAt,
          rateLimitResetAt,
          now,
          fatalClassifiedError?.errorCode ?? null,
          fatalClassifiedError?.errorSummary ?? null,
        ],
        tx,
      );

      if (!fatalClassifiedError) {
        await dbQuery(
          `UPDATE provider_connections SET last_sync_at = $2, updated_at = now() WHERE id = $1`,
          [input.providerConnectionId, now],
          tx,
        );
      }

      return {
        run: mapRunRow(updatedRunRes.rows[0] ?? activeRun),
        watermark: mapWatermarkRow(updatedWmRes.rows[0] ?? initialWatermark),
      };
    },
    { connectionString: options?.connectionString },
  );

  // Invalidate cached provider/telemetry snapshots when observations are committed
  if (totalInserted > 0 || totalUpdated > 0) {
    sharedGoogleTelemetryCache.invalidateConnection(
      input.organizationId,
      input.workspaceId,
      input.providerConnectionId,
    );
  }

  return {
    outcome:
      finalStatus === "COMPLETED"
        ? "completed"
        : finalStatus === "PARTIALLY_COMPLETED"
          ? "partially_completed"
          : finalStatus === "RATE_LIMITED"
            ? "skipped_rate_limited"
            : "failed",
    run: finalized.run,
    watermark: finalized.watermark,
    batchesTotal: batches.length,
    batchesCompleted,
    recordsProcessed: totalProcessed,
    recordsInserted: totalInserted,
    recordsUpdated: totalUpdated,
    recordsUnchanged: totalUnchanged,
  };
}

/**
 * Pauses or resumes scheduled ingestion on a specific resource watermark.
 */
export async function setResourceIngestionPausedState(
  input: {
    organizationId: string;
    workspaceId: string;
    connectedResourceId: string;
    paused: boolean;
    queryScopeKey?: string;
  },
  options?: { connectionString?: string; executor?: Queryable },
): Promise<IngestionWatermarkRecord | null> {
  const target = options?.executor ?? getDatabasePool(options?.connectionString);
  const scopeKey = input.queryScopeKey ?? "default_standard";
  const nextState: IngestionSyncState = input.paused ? "PAUSED" : "PENDING";

  const res = await dbQuery<DbWatermarkRow>(
    `UPDATE ingestion_watermarks
     SET sync_state = $4,
         active_run_id = NULL,
         lease_expires_at = NULL,
         updated_at = now()
     WHERE organization_id = $1
       AND workspace_id = $2
       AND connected_resource_id = $3
       AND query_scope_key = $5
     RETURNING *`,
    [input.organizationId, input.workspaceId, input.connectedResourceId, nextState, scopeKey],
    target,
  );

  return res.rows[0] ? mapWatermarkRow(res.rows[0]) : null;
}

/**
 * Retrieves the complete sync health, watermark state, and recent run history for a project's mapped resources.
 */
export async function getProjectSyncStatusSummary(
  session: AuthenticatedSessionContext | null,
  projectId: string,
  options?: { connectionString?: string },
): Promise<ProjectSyncStatusSummaryDto> {
  assertServerRuntime("getProjectSyncStatusSummary");

  const access = await authorizeProjectAccess({
    session,
    projectId,
    expectedWorkspaceId: session?.activeWorkspace.id,
    requiredPermission: "project:read",
  });

  const canTriggerSync = roleHasPermission(access.role, "connection:manage");
  const pool = getDatabasePool(options?.connectionString);

  const mappingsRes = await dbQuery<{
    connected_resource_id: string;
    external_resource_id: string;
    resource_display_name: string;
    provider_key: string;
    connection_id: string;
    connection_status: string;
    environment_id: string | null;
    environment_name: string | null;
  }>(
    `SELECT
       cr.id AS connected_resource_id,
       cr.external_resource_id,
       cr.display_name AS resource_display_name,
       pc.provider_key,
       pc.id AS connection_id,
       pc.status AS connection_status,
       rm.environment_id,
       pe.name AS environment_name
     FROM resource_mappings rm
     INNER JOIN connected_resources cr ON cr.id = rm.connected_resource_id
     INNER JOIN provider_connections pc ON pc.id = cr.provider_connection_id
     LEFT JOIN project_environments pe ON pe.id = rm.environment_id
     WHERE rm.project_id = $1 AND rm.workspace_id = $2
     ORDER BY pc.provider_key ASC, cr.display_name ASC`,
    [access.projectId, access.workspaceId],
    pool,
  );

  if (mappingsRes.rows.length === 0) {
    return {
      projectId: access.projectId,
      workspaceId: access.workspaceId,
      canTriggerSync,
      overallState: "UNMAPPED",
      lastSyncedAtIso: null,
      nextScheduledAtIso: null,
      resources: [],
    };
  }

  const resourceIds = mappingsRes.rows.map((r) => r.connected_resource_id);
  const wmRes = await dbQuery<DbWatermarkRow>(
    `SELECT * FROM ingestion_watermarks
     WHERE workspace_id = $1 AND connected_resource_id = ANY($2::text[])
     ORDER BY updated_at DESC`,
    [access.workspaceId, resourceIds],
    pool,
  );
  const runsRes = await dbQuery<DbRunRow>(
    `SELECT * FROM ingestion_runs
     WHERE workspace_id = $1 AND connected_resource_id = ANY($2::text[])
     ORDER BY created_at DESC
     LIMIT 30`,
    [access.workspaceId, resourceIds],
    pool,
  );

  const resources: ProjectSyncResourceStatusItem[] = mappingsRes.rows.map((m) => {
    const wmRow = wmRes.rows.find((w) => w.connected_resource_id === m.connected_resource_id);
    const watermark = wmRow ? mapWatermarkRow(wmRow) : null;
    const recentRuns = runsRes.rows
      .filter((r) => r.connected_resource_id === m.connected_resource_id)
      .slice(0, 5)
      .map(mapRunRow);

    const latestRunMeta = recentRuns[0]?.metadata;
    const knownBatchProgress =
      latestRunMeta &&
      typeof latestRunMeta.batchesTotal === "number" &&
      typeof latestRunMeta.batchesCompleted === "number" &&
      latestRunMeta.batchesTotal > 0
        ? {
            completedBatches: latestRunMeta.batchesCompleted,
            totalBatches: latestRunMeta.batchesTotal,
          }
        : null;

    return {
      connectedResourceId: m.connected_resource_id,
      externalResourceId: m.external_resource_id,
      resourceDisplayName: m.resource_display_name,
      providerKey: m.provider_key,
      connectionId: m.connection_id,
      connectionStatus: m.connection_status,
      environmentId: m.environment_id,
      environmentName: m.environment_name,
      watermark,
      recentRuns,
      knownBatchProgress,
    };
  });

  const states = resources.map((r) => r.watermark?.syncState ?? "PENDING");
  const overallState: IngestionSyncState = states.includes("RUNNING")
    ? "RUNNING"
    : states.includes("FAILED")
      ? "FAILED"
      : states.includes("RATE_LIMITED")
        ? "RATE_LIMITED"
        : states.includes("PARTIALLY_COMPLETED")
          ? "PARTIALLY_COMPLETED"
          : states.includes("CONNECTION_REVOKED")
            ? "CONNECTION_REVOKED"
            : states.every((s) => s === "COMPLETED")
              ? "COMPLETED"
              : "PENDING";

  const syncedTimestamps = resources
    .map((r) => r.watermark?.lastSucceededAtIso)
    .filter((v): v is string => Boolean(v))
    .sort();
  const nextTimestamps = resources
    .map((r) => r.watermark?.nextScheduledAtIso)
    .filter((v): v is string => Boolean(v))
    .sort();

  return {
    projectId: access.projectId,
    workspaceId: access.workspaceId,
    canTriggerSync,
    overallState,
    lastSyncedAtIso: syncedTimestamps[syncedTimestamps.length - 1] ?? null,
    nextScheduledAtIso: nextTimestamps[0] ?? null,
    resources,
  };
}

/**
 * Triggers an authorized manual sync, bounded historical backfill, revision lookback,
 * or pause/resume action for a project's mapped resource(s). Requires `connection:manage` RBAC permission.
 */
export async function triggerProjectIngestionAction(
  session: AuthenticatedSessionContext | null,
  projectId: string,
  body: {
    action?: "sync" | "backfill" | "revision_lookback" | "pause" | "resume";
    connectedResourceId?: string | null;
    backfillDays?: number | null;
    idempotencyToken?: string | null;
  },
  options?: { connectionString?: string },
): Promise<{
  summary: ProjectSyncStatusSummaryDto;
  results: ExecuteResourceSyncResult[];
}> {
  assertServerRuntime("triggerProjectIngestionAction");

  const access = await authorizeProjectAccess({
    session,
    projectId,
    expectedWorkspaceId: session?.activeWorkspace.id,
    requiredPermission: "connection:manage",
  });

  const pool = getDatabasePool(options?.connectionString);
  const mappingsRes = await dbQuery<{
    connected_resource_id: string;
    provider_connection_id: string;
    environment_id: string | null;
  }>(
    `SELECT connected_resource_id, provider_connection_id, environment_id
     FROM resource_mappings rm
     INNER JOIN connected_resources cr ON cr.id = rm.connected_resource_id
     WHERE rm.project_id = $1 AND rm.workspace_id = $2`,
    [access.projectId, access.workspaceId],
    pool,
  );

  const targetMappings = body.connectedResourceId
    ? mappingsRes.rows.filter((r) => r.connected_resource_id === body.connectedResourceId)
    : mappingsRes.rows;

  if (targetMappings.length === 0) {
    throw new AppError({
      code: ERROR_CODES.NOT_FOUND,
      message: "No mapped provider resource found for this project.",
      statusCode: 404,
    });
  }

  const action = body.action ?? "sync";
  const results: ExecuteResourceSyncResult[] = [];

  if (action === "pause" || action === "resume") {
    for (const m of targetMappings) {
      await setResourceIngestionPausedState(
        {
          organizationId: access.organizationId,
          workspaceId: access.workspaceId,
          connectedResourceId: m.connected_resource_id,
          paused: action === "pause",
        },
        options,
      );
    }
    const summary = await getProjectSyncStatusSummary(session, projectId, options);
    return { summary, results: [] };
  }

  const runType: IngestionRunType =
    action === "backfill"
      ? "INITIAL_BACKFILL"
      : action === "revision_lookback"
        ? "REVISION_LOOKBACK"
        : "MANUAL_REFRESH";

  for (const m of targetMappings) {
    const syncOutcome = await executeResourceIngestionSync(
      {
        organizationId: access.organizationId,
        workspaceId: access.workspaceId,
        projectId: access.projectId,
        environmentId: m.environment_id,
        providerConnectionId: m.provider_connection_id,
        connectedResourceId: m.connected_resource_id,
        runType,
        backfillDays: body.backfillDays,
        idempotencyToken: body.idempotencyToken ?? `${action}_${Date.now()}`,
      },
      options,
    );
    results.push(syncOutcome);
  }

  const summary = await getProjectSyncStatusSummary(session, projectId, options);
  return { summary, results };
}

/**
 * Executes a bounded scheduled ingestion sweep across eligible mapped resources in a workspace,
 * respecting `maxConcurrentRunsPerWorkspace` and skipping revoked, paused, or rate-limited resources.
 */
export async function runScheduledWorkspaceIngestionSweep(
  input: {
    organizationId: string;
    workspaceId: string;
    runType?: "SCHEDULED_SYNC" | "REVISION_LOOKBACK";
    referenceNow?: Date;
  },
  options?: { connectionString?: string },
): Promise<ExecuteResourceSyncResult[]> {
  assertServerRuntime("runScheduledWorkspaceIngestionSweep");

  const pool = getDatabasePool(options?.connectionString);
  const mappingsRes = await dbQuery<{
    project_id: string;
    environment_id: string | null;
    connected_resource_id: string;
    provider_connection_id: string;
  }>(
    `SELECT
       rm.project_id,
       rm.environment_id,
       rm.connected_resource_id,
       cr.provider_connection_id
     FROM resource_mappings rm
     INNER JOIN connected_resources cr ON cr.id = rm.connected_resource_id
     INNER JOIN workspaces w ON w.id = rm.workspace_id
     WHERE rm.workspace_id = $1 AND w.organization_id = $2
     ORDER BY rm.created_at ASC`,
    [input.workspaceId, input.organizationId],
    pool,
  );

  const results: ExecuteResourceSyncResult[] = [];
  for (const m of mappingsRes.rows) {
    const outcome = await executeResourceIngestionSync(
      {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        projectId: m.project_id,
        environmentId: m.environment_id,
        providerConnectionId: m.provider_connection_id,
        connectedResourceId: m.connected_resource_id,
        runType: input.runType ?? "SCHEDULED_SYNC",
        referenceNow: input.referenceNow,
      },
      options,
    );
    results.push(outcome);
  }
  return results;
}
