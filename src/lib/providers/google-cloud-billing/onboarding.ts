import {
  type AuthenticatedSessionContext,
  authorizeWorkspaceAccess,
  decryptConnectionCredentialForServer,
  type VaultKeyRing,
} from "@avenor/auth";
import { assertServerRuntime } from "@avenor/config";
import {
  dbQuery,
  generateId,
  getDatabasePool,
  withTransaction,
  writeAuditLog,
} from "@avenor/database";
import { AppError, ERROR_CODES, PROVIDER_ERROR_CODES, ProviderAdapterError } from "@avenor/types";
import {
  executeGoogleReadRequest,
  GOOGLE_BIGQUERY_V2_BASE,
  shouldExecuteLiveGoogleApi,
} from "../google-shared/http";
import {
  hasBigQueryReadOnlyScope,
  normalizeBillingAccountId,
  normalizeGcpProjectId,
} from "./discovery";
import {
  BIGQUERY_BILLING_EXPORT_ONBOARDING_STEPS,
  type GuidedOnboardingStepDescriptor,
} from "./onboarding-steps";
import { GCP_BILLING_PROVIDER_KEY } from "./types";

export { BIGQUERY_BILLING_EXPORT_ONBOARDING_STEPS, type GuidedOnboardingStepDescriptor };

export type BigQueryBillingExportType = "STANDARD_USAGE_COST" | "DETAILED_USAGE_COST";

export type BigQueryExportAvailabilityState =
  | "EXPORT_NOT_ENABLED"
  | "EXPORT_ENABLED_EMPTY"
  | "EXPORT_PARTIALLY_BACKFILLED"
  | "EXPORT_ACTIVE_POPULATED"
  | "EXPORT_PAUSED_STALE"
  | "EXPORT_INACCESSIBLE"
  | "EXPORT_SCHEMA_UNSUPPORTED";

const BQ_DATASET_ID_RE = /^[A-Za-z0-9_]{1,1024}$/;
const BQ_EXPORT_TABLE_RE =
  /^(gcp_billing_export_v1|gcp_billing_export_resource_v1)_([A-Za-z0-9]{6}_[A-Za-z0-9]{6}_[A-Za-z0-9]{6})$/;

export const REQUIRED_STANDARD_EXPORT_COLUMNS = [
  "billing_account_id",
  "service",
  "sku",
  "usage_start_time",
  "usage_end_time",
  "project",
  "cost",
  "currency",
  "credits",
  "invoice",
  "export_time",
] as const;

export const REQUIRED_DETAILED_EXPORT_COLUMNS = [
  ...REQUIRED_STANDARD_EXPORT_COLUMNS,
  "resource",
] as const;

export interface BigQueryBillingExportOnboardingInput {
  billingAccountId: string;
  datasetProjectId: string;
  queryProjectId?: string;
  datasetId: string;
  tableId: string;
  exportType?: BigQueryBillingExportType;
}

export interface ValidatedBigQueryExportSummary {
  valid: boolean;
  billingAccountId: string;
  datasetProjectId: string;
  queryProjectId: string;
  datasetId: string;
  tableId: string;
  fullyQualifiedTableRef: string;
  exportType: BigQueryBillingExportType;
  datasetLocation: string;
  supportsRetroactiveBackfill: boolean;
  retroactiveBackfillExplanation: string;
  availabilityState: BigQueryExportAvailabilityState;
  availabilityExplanation: string;
  detectedColumns: string[];
  missingRequiredColumns: string[];
  estimatedRowsCount: number | null;
  lastModifiedAtIso: string | null;
  dryRunJobPermitted: boolean;
  dryRunEstimatedBytes: number | null;
  costAndLatencyWarnings: string[];
  validatedAtIso: string;
}

export function parseAndValidateExportTableIdentifier(input: {
  billingAccountId: string;
  datasetProjectId: string;
  queryProjectId?: string;
  datasetId: string;
  tableId: string;
}): {
  billingAccountId: string;
  expectedTableAccountSuffix: string;
  datasetProjectId: string;
  queryProjectId: string;
  datasetId: string;
  tableId: string;
  exportType: BigQueryBillingExportType;
} {
  const billingAccountId = normalizeBillingAccountId(input.billingAccountId);
  const datasetProjectId = normalizeGcpProjectId(input.datasetProjectId);
  const queryProjectId = input.queryProjectId
    ? normalizeGcpProjectId(input.queryProjectId)
    : datasetProjectId;

  const datasetId = input.datasetId.trim();
  if (!BQ_DATASET_ID_RE.test(datasetId)) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Invalid BigQuery dataset ID "${input.datasetId}". Only alphanumeric characters and underscores are permitted.`,
      statusCode: 400,
    });
  }

  const tableId = input.tableId.trim();
  const tableMatch = tableId.match(BQ_EXPORT_TABLE_RE);
  if (!tableMatch) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Unsupported or unsafe BigQuery table identifier "${input.tableId}". Only official Cloud Billing export tables (gcp_billing_export_v1_<ACCOUNT_ID> or gcp_billing_export_resource_v1_<ACCOUNT_ID>) are allowed.`,
      statusCode: 400,
    });
  }

  const prefix = tableMatch[1];
  const suffix = (tableMatch[2] ?? "").toUpperCase();
  const expectedTableAccountSuffix = billingAccountId.replace(/-/g, "_").toUpperCase();

  if (suffix !== expectedTableAccountSuffix) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `BigQuery export table "${tableId}" belongs to billing account "${suffix.replace(/_/g, "-")}", which does not match selected billing account "${billingAccountId}".`,
      statusCode: 400,
    });
  }

  const exportType: BigQueryBillingExportType =
    prefix === "gcp_billing_export_resource_v1" ? "DETAILED_USAGE_COST" : "STANDARD_USAGE_COST";

  return {
    billingAccountId,
    expectedTableAccountSuffix,
    datasetProjectId,
    queryProjectId,
    datasetId,
    tableId,
    exportType,
  };
}

export function isMultiRegionRetroactiveLocation(location: string): boolean {
  const upper = location.trim().toUpperCase();
  return upper === "US" || upper === "EU";
}

interface RawBigQueryDatasetResponse {
  id?: string;
  location?: string;
  datasetReference?: {
    projectId?: string;
    datasetId?: string;
  };
}

interface RawBigQueryTableField {
  name?: string;
  type?: string;
  mode?: string;
}

interface RawBigQueryTableResponse {
  id?: string;
  location?: string;
  numRows?: string;
  lastModifiedTime?: string;
  schema?: {
    fields?: RawBigQueryTableField[];
  };
}

interface RawBigQueryDryRunResponse {
  jobComplete?: boolean;
  totalBytesProcessed?: string;
}

/**
 * Validates a customer-configured BigQuery Cloud Billing export dataset and table read-only
 * via BigQuery metadata endpoints and a bounded `dryRun: true` query check.
 */
export async function validateBigQueryBillingExportConfig(
  context: {
    organizationId: string;
    workspaceId: string;
    accessToken?: string;
    grantedScopes: readonly string[];
    simulationScenario?: string;
  },
  input: BigQueryBillingExportOnboardingInput,
  options?: {
    fetchFn?: typeof fetch;
    now?: Date;
  },
): Promise<ValidatedBigQueryExportSummary> {
  const parsed = parseAndValidateExportTableIdentifier(input);
  const validatedAtIso = (options?.now ?? new Date()).toISOString();

  if (!hasBigQueryReadOnlyScope(context.grantedScopes)) {
    throw new ProviderAdapterError({
      providerKey: GCP_BILLING_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
      message:
        "Validating a BigQuery Cloud Billing export requires https://www.googleapis.com/auth/bigquery.readonly. Cloud Billing metadata scope alone is insufficient.",
    });
  }

  const requiredColumns =
    parsed.exportType === "DETAILED_USAGE_COST"
      ? REQUIRED_DETAILED_EXPORT_COLUMNS
      : REQUIRED_STANDARD_EXPORT_COLUMNS;

  const fullyQualifiedTableRef = `${parsed.datasetProjectId}.${parsed.datasetId}.${parsed.tableId}`;

  if (!shouldExecuteLiveGoogleApi(context, Boolean(options?.fetchFn), GCP_BILLING_PROVIDER_KEY)) {
    const datasetLocation = "US";
    const supportsRetroactiveBackfill = true;
    return {
      valid: true,
      billingAccountId: parsed.billingAccountId,
      datasetProjectId: parsed.datasetProjectId,
      queryProjectId: parsed.queryProjectId,
      datasetId: parsed.datasetId,
      tableId: parsed.tableId,
      fullyQualifiedTableRef,
      exportType: parsed.exportType,
      datasetLocation,
      supportsRetroactiveBackfill,
      retroactiveBackfillExplanation:
        "Dataset is hosted in multi-region US; Google Cloud populates retroactive usage data for the current and previous calendar month (up to 5 days initial processing).",
      availabilityState: "EXPORT_ACTIVE_POPULATED",
      availabilityExplanation:
        "Export table schema verified and populated with recent billing observations.",
      detectedColumns: [...requiredColumns],
      missingRequiredColumns: [],
      estimatedRowsCount: 14280,
      lastModifiedAtIso: validatedAtIso,
      dryRunJobPermitted: true,
      dryRunEstimatedBytes: 2_457_600,
      costAndLatencyWarnings: [
        "BigQuery SELECT queries incur standard Google Cloud query-processing charges bounded by Avenor's maximumBytesBilled cap.",
        "Cloud Billing export data is subject to multi-hour intraday latency and late credit/invoice adjustments until monthly invoice finalization.",
      ],
      validatedAtIso,
    };
  }

  const accessToken = context.accessToken ?? "";
  if (!accessToken) {
    throw new ProviderAdapterError({
      providerKey: GCP_BILLING_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "Missing Google OAuth access token for BigQuery export validation.",
    });
  }

  // 1. Metadata GET dataset to verify existence, read permission, and actual dataset location
  const datasetUrl = `${GOOGLE_BIGQUERY_V2_BASE}/projects/${encodeURIComponent(
    parsed.datasetProjectId,
  )}/datasets/${encodeURIComponent(parsed.datasetId)}`;

  const datasetMeta = await executeGoogleReadRequest<RawBigQueryDatasetResponse>({
    providerKey: GCP_BILLING_PROVIDER_KEY,
    url: datasetUrl,
    method: "GET",
    accessToken,
    fetchFn: options?.fetchFn,
  });

  const datasetLocation = datasetMeta.location?.trim() || "US";
  const supportsRetroactiveBackfill = isMultiRegionRetroactiveLocation(datasetLocation);
  const retroactiveBackfillExplanation = supportsRetroactiveBackfill
    ? `Dataset is in multi-region ${datasetLocation}; Google Cloud includes retroactive data for the current and prior calendar month (up to 5 days initial processing).`
    : `Dataset is in single-region ${datasetLocation}; Google Cloud only exports billing data from the timestamp the export was enabled forward (no prior-month retroactive backfill).`;

  // 2. Metadata GET table to verify export table existence, schema columns, row count, and freshness
  const tableUrl = `${GOOGLE_BIGQUERY_V2_BASE}/projects/${encodeURIComponent(
    parsed.datasetProjectId,
  )}/datasets/${encodeURIComponent(parsed.datasetId)}/tables/${encodeURIComponent(parsed.tableId)}`;

  let tableMeta: RawBigQueryTableResponse;
  try {
    tableMeta = await executeGoogleReadRequest<RawBigQueryTableResponse>({
      providerKey: GCP_BILLING_PROVIDER_KEY,
      url: tableUrl,
      method: "GET",
      accessToken,
      fetchFn: options?.fetchFn,
    });
  } catch (err) {
    if (
      err instanceof ProviderAdapterError &&
      err.code === PROVIDER_ERROR_CODES.RESOURCE_NOT_FOUND
    ) {
      return {
        valid: false,
        billingAccountId: parsed.billingAccountId,
        datasetProjectId: parsed.datasetProjectId,
        queryProjectId: parsed.queryProjectId,
        datasetId: parsed.datasetId,
        tableId: parsed.tableId,
        fullyQualifiedTableRef,
        exportType: parsed.exportType,
        datasetLocation,
        supportsRetroactiveBackfill,
        retroactiveBackfillExplanation,
        availabilityState: "EXPORT_NOT_ENABLED",
        availabilityExplanation: `Export table "${parsed.tableId}" does not exist yet in dataset "${parsed.datasetId}". If you just enabled Cloud Billing export in Google Cloud Console, Google creates the table automatically when the first batch of usage arrives (typically within a few hours).`,
        detectedColumns: [],
        missingRequiredColumns: [...requiredColumns],
        estimatedRowsCount: 0,
        lastModifiedAtIso: null,
        dryRunJobPermitted: false,
        dryRunEstimatedBytes: null,
        costAndLatencyWarnings: [
          "Do not treat a missing export table as $0 cloud spend; billing data is unavailable until Google Cloud creates and populates the export table.",
        ],
        validatedAtIso,
      };
    }
    throw err;
  }

  const detectedColumns = (tableMeta.schema?.fields ?? [])
    .map((f) => f.name?.trim() ?? "")
    .filter(Boolean);
  const detectedSet = new Set(detectedColumns.map((c) => c.toLowerCase()));
  const missingRequiredColumns = requiredColumns.filter(
    (reqCol) => !detectedSet.has(reqCol.toLowerCase()),
  );

  const estimatedRowsCount = tableMeta.numRows !== undefined ? Number(tableMeta.numRows) : null;
  const lastModifiedMs =
    tableMeta.lastModifiedTime !== undefined ? Number(tableMeta.lastModifiedTime) : null;
  const lastModifiedAtIso =
    lastModifiedMs && Number.isFinite(lastModifiedMs)
      ? new Date(lastModifiedMs).toISOString()
      : null;

  if (missingRequiredColumns.length > 0) {
    return {
      valid: false,
      billingAccountId: parsed.billingAccountId,
      datasetProjectId: parsed.datasetProjectId,
      queryProjectId: parsed.queryProjectId,
      datasetId: parsed.datasetId,
      tableId: parsed.tableId,
      fullyQualifiedTableRef,
      exportType: parsed.exportType,
      datasetLocation,
      supportsRetroactiveBackfill,
      retroactiveBackfillExplanation,
      availabilityState: "EXPORT_SCHEMA_UNSUPPORTED",
      availabilityExplanation: `Table "${parsed.tableId}" is missing required Google Cloud Billing export columns: ${missingRequiredColumns.join(", ")}.`,
      detectedColumns,
      missingRequiredColumns,
      estimatedRowsCount,
      lastModifiedAtIso,
      dryRunJobPermitted: false,
      dryRunEstimatedBytes: null,
      costAndLatencyWarnings: [],
      validatedAtIso,
    };
  }

  // 3. Bounded Dry-Run Query check to verify bigquery.jobs.create permission in datasetLocation
  const dryRunUrl = `${GOOGLE_BIGQUERY_V2_BASE}/projects/${encodeURIComponent(
    parsed.queryProjectId,
  )}/queries`;
  const boundedDryRunSql = `SELECT billing_account_id, currency, SUM(cost) AS gross_cost FROM \`${fullyQualifiedTableRef}\` WHERE usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY) GROUP BY billing_account_id, currency LIMIT 10`;

  let dryRunJobPermitted = false;
  let dryRunEstimatedBytes: number | null = null;

  const dryRunRes = await executeGoogleReadRequest<RawBigQueryDryRunResponse>({
    providerKey: GCP_BILLING_PROVIDER_KEY,
    url: dryRunUrl,
    method: "POST",
    accessToken,
    fetchFn: options?.fetchFn,
    body: {
      query: boundedDryRunSql,
      useLegacySql: false,
      dryRun: true,
      location: datasetLocation,
    },
  });

  dryRunJobPermitted = true;
  dryRunEstimatedBytes =
    dryRunRes.totalBytesProcessed !== undefined ? Number(dryRunRes.totalBytesProcessed) : 0;

  const nowMs = (options?.now ?? new Date()).getTime();
  const ageHours =
    lastModifiedMs && Number.isFinite(lastModifiedMs)
      ? Math.max(0, (nowMs - lastModifiedMs) / 3_600_000)
      : null;

  let availabilityState: BigQueryExportAvailabilityState = "EXPORT_ACTIVE_POPULATED";
  let availabilityExplanation = `Export table (${parsed.exportType}) is active in ${datasetLocation} with ${estimatedRowsCount ?? 0} rows.`;

  if (estimatedRowsCount !== null && estimatedRowsCount === 0) {
    availabilityState = "EXPORT_ENABLED_EMPTY";
    availabilityExplanation =
      "Export table exists with valid schema but currently contains 0 rows. Initial Google Cloud Billing export population is still in progress (not $0 spend).";
  } else if (ageHours !== null && ageHours > 72) {
    availabilityState = "EXPORT_PAUSED_STALE";
    availabilityExplanation = `Export table has not received new rows in ${Math.round(ageHours)} hours. Verify that Cloud Billing export has not been paused or disabled in Google Cloud Console.`;
  } else if (
    supportsRetroactiveBackfill &&
    estimatedRowsCount !== null &&
    estimatedRowsCount < 50
  ) {
    availabilityState = "EXPORT_PARTIALLY_BACKFILLED";
    availabilityExplanation =
      "Export table is receiving initial batches; multi-region retroactive backfill can take up to 5 days to finish.";
  }

  return {
    valid: true,
    billingAccountId: parsed.billingAccountId,
    datasetProjectId: parsed.datasetProjectId,
    queryProjectId: parsed.queryProjectId,
    datasetId: parsed.datasetId,
    tableId: parsed.tableId,
    fullyQualifiedTableRef,
    exportType: parsed.exportType,
    datasetLocation,
    supportsRetroactiveBackfill,
    retroactiveBackfillExplanation,
    availabilityState,
    availabilityExplanation,
    detectedColumns,
    missingRequiredColumns: [],
    estimatedRowsCount,
    lastModifiedAtIso,
    dryRunJobPermitted,
    dryRunEstimatedBytes,
    costAndLatencyWarnings: [
      `Dry-run validated in region ${datasetLocation} (estimated 7-day scan: ${dryRunEstimatedBytes ?? 0} bytes). BigQuery query jobs may incur Google Cloud compute charges.`,
      retroactiveBackfillExplanation,
      "Cloud Billing export rows reflect usage and credits as processed by Google Cloud; final monthly invoice totals may include post-usage taxes or adjustments.",
    ],
    validatedAtIso,
  };
}

/**
 * Validates and persists a customer's BigQuery Cloud Billing export dataset resource on their
 * authorized `gcp-billing` provider connection so cost ingestion can query it safely.
 */
export async function completeBigQueryBillingExportOnboarding(
  session: AuthenticatedSessionContext | null,
  input: BigQueryBillingExportOnboardingInput & {
    workspaceId?: string;
    connectionId: string;
    projectId?: string | null;
    environmentId?: string | null;
  },
  options?: {
    connectionString?: string;
    fetchFn?: typeof fetch;
    keyRing?: VaultKeyRing;
    now?: Date;
  },
): Promise<{
  validation: ValidatedBigQueryExportSummary;
  connectedResourceId: string;
  externalResourceId: string;
}> {
  assertServerRuntime("completeBigQueryBillingExportOnboarding");

  const workspaceId = input.workspaceId ?? session?.activeWorkspace.id ?? "";
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "connection:manage",
  });

  const pool = getDatabasePool(options?.connectionString);
  const connRes = await dbQuery<{
    id: string;
    workspace_id: string;
    provider_key: string;
    status: string;
    granted_scopes: string[];
  }>(
    `SELECT id, workspace_id, provider_key, status, granted_scopes
     FROM provider_connections
     WHERE id = $1 AND workspace_id = $2
     LIMIT 1`,
    [input.connectionId, access.workspaceId],
    pool,
  );

  const conn = connRes.rows[0];
  if (!conn || conn.provider_key !== GCP_BILLING_PROVIDER_KEY) {
    throw new AppError({
      code: ERROR_CODES.NOT_FOUND,
      message: "Authorized Google Cloud Billing connection not found in this workspace.",
      statusCode: 404,
    });
  }

  const credHandle = await decryptConnectionCredentialForServer({
    organizationId: access.organizationId,
    workspaceId: access.workspaceId,
    connectionId: conn.id,
    keyRing: options?.keyRing,
  });
  const secret = credHandle.exposeSecretForServerAdapter();

  const validation = await validateBigQueryBillingExportConfig(
    {
      organizationId: access.organizationId,
      workspaceId: access.workspaceId,
      accessToken: secret.accessToken ?? secret.apiToken,
      grantedScopes: conn.granted_scopes,
    },
    input,
    {
      fetchFn: options?.fetchFn,
      now: options?.now,
    },
  );

  if (!validation.valid) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: validation.availabilityExplanation,
      statusCode: 400,
    });
  }

  const externalResourceId = `bq-export:${validation.fullyQualifiedTableRef}`;
  const displayName = `BigQuery Export (${validation.datasetId}.${validation.tableId})`;

  const savedResource = await withTransaction(
    async (client) => {
      const candidateId = generateId("res");
      const upsertRes = await dbQuery<{ id: string }>(
        `INSERT INTO connected_resources (
           id,
           provider_connection_id,
           workspace_id,
           external_resource_id,
           resource_type,
           display_name,
           metadata
         )
         VALUES ($1, $2, $3, $4, 'gcp_billing_dataset', $5, $6::jsonb)
         ON CONFLICT (provider_connection_id, external_resource_id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           metadata = EXCLUDED.metadata,
           updated_at = now()
         RETURNING id`,
        [
          candidateId,
          conn.id,
          access.workspaceId,
          externalResourceId,
          displayName,
          JSON.stringify({
            billingAccountId: validation.billingAccountId,
            datasetProjectId: validation.datasetProjectId,
            queryProjectId: validation.queryProjectId,
            datasetId: validation.datasetId,
            tableId: validation.tableId,
            fullyQualifiedTableRef: validation.fullyQualifiedTableRef,
            exportType: validation.exportType,
            datasetLocation: validation.datasetLocation,
            supportsRetroactiveBackfill: validation.supportsRetroactiveBackfill,
            availabilityState: validation.availabilityState,
            estimatedRowsCount: validation.estimatedRowsCount,
            dryRunEstimatedBytes: validation.dryRunEstimatedBytes,
            hasHistoricalCostAccess: true,
            validatedAtIso: validation.validatedAtIso,
          }),
        ],
        client,
      );

      const connectedResourceId = upsertRes.rows[0]?.id ?? candidateId;

      if (input.projectId) {
        await dbQuery(
          `INSERT INTO resource_mappings (
             id,
             workspace_id,
             project_id,
             environment_id,
             connected_resource_id,
             mapping_role,
             created_by_user_id
           )
           VALUES ($1, $2, $3, $4, $5, 'PRIMARY', $6)
           ON CONFLICT (project_id, connected_resource_id) DO NOTHING`,
          [
            generateId("map"),
            access.workspaceId,
            input.projectId,
            input.environmentId ?? null,
            connectedResourceId,
            access.session.user.id,
          ],
          client,
        );
      }

      await writeAuditLog(
        {
          organizationId: access.organizationId,
          workspaceId: access.workspaceId,
          actorUserId: access.session.user.id,
          action: "connection.bigquery_billing_export_onboarded",
          entityType: "ProviderConnection",
          entityId: conn.id,
          summary: `Validated and linked BigQuery Cloud Billing export ${validation.fullyQualifiedTableRef} (${validation.datasetLocation}).`,
          metadata: {
            billingAccountId: validation.billingAccountId,
            fullyQualifiedTableRef: validation.fullyQualifiedTableRef,
            exportType: validation.exportType,
            datasetLocation: validation.datasetLocation,
            availabilityState: validation.availabilityState,
          },
        },
        client,
      );

      return { connectedResourceId };
    },
    { connectionString: options?.connectionString },
  );

  return {
    validation,
    connectedResourceId: savedResource.connectedResourceId,
    externalResourceId,
  };
}
