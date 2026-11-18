import {
  dbQuery,
  generateId,
  getDatabasePool,
  type Queryable,
  withTransaction,
} from "@avenor/database";
import { AppError, ERROR_CODES } from "@avenor/types";
import { computeDimensionIdentity } from "./dimensions";
import { getCanonicalMetricDefinition, validateMetricDefinitionInput } from "./registry";
import { computeSourcePeriodUtcBounds } from "./time";
import type {
  CanonicalDataQualityFlags,
  CanonicalMetricDefinition,
  CanonicalMetricObservationInput,
  MetricBatchUpsertResult,
  MetricCompletenessState,
  MetricGranularity,
  MetricObservationRevisionRecord,
  MetricUpsertOutcome,
  StoredMetricObservation,
} from "./types";

interface DbMetricObservationRow {
  id: string;
  organization_id: string;
  workspace_id: string;
  project_id: string | null;
  environment_id: string | null;
  provider_connection_id: string;
  connected_resource_id: string;
  provider_key: string;
  external_resource_id: string;
  canonical_metric_key: string;
  provider_metric_name: string;
  metric_definition_version: number;
  granularity: string;
  period_start_date: string;
  period_end_date: string;
  period_start_utc: Date;
  period_end_utc: Date;
  reporting_timezone: string;
  dimension_key_hash: string;
  dimension_canonical_key: string;
  dimensions: Record<string, string>;
  query_fingerprint: string;
  unit: string;
  currency: string | null;
  numeric_value: string | null;
  numerator_value: string | null;
  denominator_value: string | null;
  completeness_state: string;
  data_quality_flags: CanonicalDataQualityFlags;
  source_updated_at: Date | null;
  collected_at: Date;
  ingestion_run_id: string | null;
  revision_number: number;
  previous_numeric_value: string | null;
  revision_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

function parseNumericColumn(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const num = typeof raw === "number" ? raw : Number.parseFloat(raw);
  return Number.isFinite(num) ? num : null;
}

function mapRowToStoredObservation(row: DbMetricObservationRow): StoredMetricObservation {
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
    canonicalMetricKey: row.canonical_metric_key,
    providerMetricName: row.provider_metric_name,
    metricDefinitionVersion: row.metric_definition_version,
    granularity: row.granularity as MetricGranularity,
    periodStartDate: row.period_start_date,
    periodEndDate: row.period_end_date,
    periodStartUtcIso: new Date(row.period_start_utc).toISOString(),
    periodEndUtcIso: new Date(row.period_end_utc).toISOString(),
    reportingTimezone: row.reporting_timezone,
    dimensionKeyHash: row.dimension_key_hash,
    dimensionCanonicalKey: row.dimension_canonical_key,
    dimensions: row.dimensions ?? {},
    queryFingerprint: row.query_fingerprint,
    unit: row.unit,
    currency: row.currency,
    numericValue: parseNumericColumn(row.numeric_value),
    numeratorValue: parseNumericColumn(row.numerator_value),
    denominatorValue: parseNumericColumn(row.denominator_value),
    completenessState: row.completeness_state as MetricCompletenessState,
    dataQualityFlags: row.data_quality_flags ?? {},
    sourceUpdatedAtIso: row.source_updated_at
      ? new Date(row.source_updated_at).toISOString()
      : null,
    collectedAtIso: new Date(row.collected_at).toISOString(),
    ingestionRunId: row.ingestion_run_id,
    revisionNumber: row.revision_number,
    previousNumericValue: parseNumericColumn(row.previous_numeric_value),
    revisionReason: row.revision_reason,
    createdAtIso: new Date(row.created_at).toISOString(),
    updatedAtIso: new Date(row.updated_at).toISOString(),
  };
}

async function assertTenantResourceOwnership(
  input: {
    organizationId: string;
    workspaceId: string;
    providerConnectionId: string;
    connectedResourceId: string;
    projectId?: string | null;
  },
  executor?: Queryable,
): Promise<void> {
  const res = await dbQuery<{
    workspace_id: string;
    organization_id: string;
    provider_connection_id: string;
  }>(
    `SELECT cr.workspace_id, w.organization_id, cr.provider_connection_id
     FROM connected_resources cr
     INNER JOIN workspaces w ON w.id = cr.workspace_id
     WHERE cr.id = $1
     LIMIT 1`,
    [input.connectedResourceId],
    executor,
  );

  const row = res.rows[0];
  if (
    !row ||
    row.workspace_id !== input.workspaceId ||
    row.organization_id !== input.organizationId ||
    row.provider_connection_id !== input.providerConnectionId
  ) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message:
        "Connected resource does not belong to the authorized organization/workspace/connection.",
      statusCode: 403,
    });
  }

  if (input.projectId) {
    const projRes = await dbQuery<{ id: string }>(
      `SELECT id FROM logical_projects WHERE id = $1 AND workspace_id = $2 LIMIT 1`,
      [input.projectId, input.workspaceId],
      executor,
    );
    if (projRes.rows.length === 0) {
      throw new AppError({
        code: ERROR_CODES.FORBIDDEN,
        message: "Logical project does not belong to the authorized workspace.",
        statusCode: 403,
      });
    }
  }
}

function numericEquals(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Math.abs(a - b) < 1e-6;
}

/**
 * Registers or updates a canonical metric definition in PostgreSQL.
 */
export async function registerMetricDefinitionInDb(
  rawInput: Parameters<typeof validateMetricDefinitionInput>[0],
  options?: { connectionString?: string; executor?: Queryable },
): Promise<CanonicalMetricDefinition> {
  const validated = validateMetricDefinitionInput(rawInput);
  const target = options?.executor ?? getDatabasePool(options?.connectionString);
  await dbQuery(
    `INSERT INTO metric_definitions (
       id, canonical_key, provider_key, provider_metric_name, display_name, description,
       category, unit, value_type, aggregation_rule, numerator_metric_key, denominator_metric_key,
       weight_metric_key, is_additive_across_dates, is_additive_across_resources,
       supported_dimensions, supported_granularities, timezone_behavior,
       freshness_window_minutes, capability_key, schema_version, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, $11, $12,
       $13, $14, $15, $16, $17, $18,
       $19, $20, $21, now()
     )
     ON CONFLICT (canonical_key) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       description = EXCLUDED.description,
       category = EXCLUDED.category,
       unit = EXCLUDED.unit,
       value_type = EXCLUDED.value_type,
       aggregation_rule = EXCLUDED.aggregation_rule,
       numerator_metric_key = EXCLUDED.numerator_metric_key,
       denominator_metric_key = EXCLUDED.denominator_metric_key,
       weight_metric_key = EXCLUDED.weight_metric_key,
       is_additive_across_dates = EXCLUDED.is_additive_across_dates,
       is_additive_across_resources = EXCLUDED.is_additive_across_resources,
       supported_dimensions = EXCLUDED.supported_dimensions,
       supported_granularities = EXCLUDED.supported_granularities,
       timezone_behavior = EXCLUDED.timezone_behavior,
       freshness_window_minutes = EXCLUDED.freshness_window_minutes,
       capability_key = EXCLUDED.capability_key,
       schema_version = EXCLUDED.schema_version,
       updated_at = now()`,
    [
      validated.id,
      validated.canonicalKey,
      validated.providerKey,
      validated.providerMetricName,
      validated.displayName,
      validated.description,
      validated.category,
      validated.unit,
      validated.valueType,
      validated.aggregationRule,
      validated.numeratorMetricKey,
      validated.denominatorMetricKey,
      validated.weightMetricKey,
      validated.isAdditiveAcrossDates,
      validated.isAdditiveAcrossResources,
      validated.supportedDimensions,
      validated.supportedGranularities,
      validated.timezoneBehavior,
      validated.freshnessWindowMinutes,
      validated.capabilityKey,
      validated.schemaVersion,
    ],
    target,
  );
  return validated;
}

/**
 * Lists registered canonical metric definitions from PostgreSQL.
 */
export async function listMetricDefinitionsFromDb(options?: {
  providerKey?: string;
  connectionString?: string;
  executor?: Queryable;
}): Promise<CanonicalMetricDefinition[]> {
  const params: unknown[] = [];
  let whereSql = "";
  if (options?.providerKey) {
    params.push(options.providerKey);
    whereSql = "WHERE provider_key = $1";
  }

  const target = options?.executor ?? getDatabasePool(options?.connectionString);
  const res = await dbQuery<{
    id: string;
    canonical_key: string;
    provider_key: string;
    provider_metric_name: string;
    display_name: string;
    description: string;
    category: string;
    unit: string;
    value_type: string;
    aggregation_rule: string;
    numerator_metric_key: string | null;
    denominator_metric_key: string | null;
    weight_metric_key: string | null;
    is_additive_across_dates: boolean;
    is_additive_across_resources: boolean;
    supported_dimensions: string[];
    supported_granularities: string[];
    timezone_behavior: string;
    freshness_window_minutes: number;
    capability_key: string;
    schema_version: number;
  }>(`SELECT * FROM metric_definitions ${whereSql} ORDER BY canonical_key ASC`, params, target);

  return res.rows.map((r) =>
    validateMetricDefinitionInput({
      id: r.id,
      canonicalKey: r.canonical_key,
      providerKey: r.provider_key,
      providerMetricName: r.provider_metric_name,
      displayName: r.display_name,
      description: r.description,
      category: r.category,
      unit: r.unit,
      valueType: r.value_type,
      aggregationRule: r.aggregation_rule,
      numeratorMetricKey: r.numerator_metric_key,
      denominatorMetricKey: r.denominator_metric_key,
      weightMetricKey: r.weight_metric_key,
      isAdditiveAcrossDates: r.is_additive_across_dates,
      isAdditiveAcrossResources: r.is_additive_across_resources,
      supportedDimensions: r.supported_dimensions ?? [],
      supportedGranularities: r.supported_granularities ?? ["DAILY"],
      timezoneBehavior: r.timezone_behavior,
      freshnessWindowMinutes: r.freshness_window_minutes,
      capabilityKey: r.capability_key,
      schemaVersion: r.schema_version,
    }),
  );
}

async function upsertSingleObservationInTx(
  input: CanonicalMetricObservationInput,
  client: Queryable,
): Promise<MetricUpsertOutcome> {
  await assertTenantResourceOwnership(
    {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      providerConnectionId: input.providerConnectionId,
      connectedResourceId: input.connectedResourceId,
      projectId: input.projectId,
    },
    client,
  );

  const builtInDef = (() => {
    try {
      return getCanonicalMetricDefinition(input.canonicalMetricKey);
    } catch {
      return null;
    }
  })();

  const version = input.metricDefinitionVersion ?? builtInDef?.schemaVersion ?? 1;
  const providerMetricName =
    input.providerMetricName ?? builtInDef?.providerMetricName ?? input.canonicalMetricKey;
  const unit = input.unit ?? builtInDef?.unit ?? "count";

  const dimIdentity = computeDimensionIdentity(input.dimensions, {
    allowedDimensions: builtInDef?.supportedDimensions,
  });

  const periodBounds = computeSourcePeriodUtcBounds({
    periodStartDate: input.periodStartDate,
    periodEndDate: input.periodEndDate,
    reportingTimezone: input.reportingTimezone,
  });

  const queryFingerprint = input.queryFingerprint?.trim() || "qfp_default";
  const completenessState: MetricCompletenessState = input.completenessState ?? "COMPLETE";
  const collectedAt = input.collectedAt ? new Date(input.collectedAt) : new Date();
  const sourceUpdatedAt = input.sourceUpdatedAt ? new Date(input.sourceUpdatedAt) : null;
  const newObsId = generateId("mobs");

  // Atomic INSERT ... ON CONFLICT DO NOTHING first to handle concurrent writers safely
  const insertAttempt = await dbQuery<DbMetricObservationRow>(
    `INSERT INTO metric_observations (
       id, organization_id, workspace_id, project_id, environment_id,
       provider_connection_id, connected_resource_id, provider_key, external_resource_id,
       canonical_metric_key, provider_metric_name, metric_definition_version,
       granularity, period_start_date, period_end_date, period_start_utc, period_end_utc,
       reporting_timezone, dimension_key_hash, dimension_canonical_key, dimensions,
       query_fingerprint, unit, currency, numeric_value, numerator_value, denominator_value,
       completeness_state, data_quality_flags, source_updated_at, collected_at,
       ingestion_run_id, revision_number, previous_numeric_value, revision_reason
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9,
       $10, $11, $12,
       $13, $14, $15, $16, $17,
       $18, $19, $20, $21::jsonb,
       $22, $23, $24, $25, $26, $27,
       $28, $29::jsonb, $30, $31,
       $32, 1, NULL, NULL
     )
     ON CONFLICT ON CONSTRAINT uq_metric_observations_identity DO NOTHING
     RETURNING *`,
    [
      newObsId,
      input.organizationId,
      input.workspaceId,
      input.projectId,
      input.environmentId,
      input.providerConnectionId,
      input.connectedResourceId,
      input.providerKey,
      input.externalResourceId,
      input.canonicalMetricKey,
      providerMetricName,
      version,
      input.granularity,
      periodBounds.periodStartDate,
      periodBounds.periodEndDate,
      periodBounds.periodStartUtc,
      periodBounds.periodEndUtc,
      periodBounds.reportingTimezone,
      dimIdentity.hash,
      dimIdentity.canonicalKey,
      JSON.stringify(dimIdentity.dimensions),
      queryFingerprint,
      unit,
      input.currency ?? null,
      input.numericValue,
      input.numeratorValue ?? null,
      input.denominatorValue ?? null,
      completenessState,
      JSON.stringify(input.dataQualityFlags ?? {}),
      sourceUpdatedAt,
      collectedAt,
      input.ingestionRunId ?? null,
    ],
    client,
  );

  if (insertAttempt.rows[0]) {
    return {
      action: "inserted",
      observation: mapRowToStoredObservation(insertAttempt.rows[0]),
      revisionRecorded: false,
    };
  }

  // Row already exists — lock it FOR UPDATE inside the transaction and inspect whether value/completeness changed
  const existingRes = await dbQuery<DbMetricObservationRow>(
    `SELECT * FROM metric_observations
     WHERE workspace_id = $1
       AND connected_resource_id = $2
       AND canonical_metric_key = $3
       AND metric_definition_version = $4
       AND granularity = $5
       AND period_start_date = $6
       AND period_end_date = $7
       AND dimension_key_hash = $8
       AND query_fingerprint = $9
     FOR UPDATE`,
    [
      input.workspaceId,
      input.connectedResourceId,
      input.canonicalMetricKey,
      version,
      input.granularity,
      periodBounds.periodStartDate,
      periodBounds.periodEndDate,
      dimIdentity.hash,
      queryFingerprint,
    ],
    client,
  );

  const existing = existingRes.rows[0];
  if (!existing) {
    throw new AppError({
      code: ERROR_CODES.INTERNAL_ERROR,
      message: "Failed to lock existing metric observation during upsert.",
    });
  }

  const prevVal = parseNumericColumn(existing.numeric_value);
  const nextVal = input.numericValue;
  const prevNum = parseNumericColumn(existing.numerator_value);
  const nextNum = input.numeratorValue ?? null;
  const prevDen = parseNumericColumn(existing.denominator_value);
  const nextDen = input.denominatorValue ?? null;
  const prevComp = existing.completeness_state as MetricCompletenessState;

  const isChanged =
    !numericEquals(prevVal, nextVal) ||
    !numericEquals(prevNum, nextNum) ||
    !numericEquals(prevDen, nextDen) ||
    prevComp !== completenessState;

  if (!isChanged) {
    const touchRes = await dbQuery<DbMetricObservationRow>(
      `UPDATE metric_observations
       SET collected_at = $2,
           ingestion_run_id = COALESCE($3, ingestion_run_id),
           project_id = COALESCE($4, project_id),
           environment_id = COALESCE($5, environment_id),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        existing.id,
        collectedAt,
        input.ingestionRunId ?? null,
        input.projectId,
        input.environmentId,
      ],
      client,
    );
    const updatedRow = touchRes.rows[0] ?? existing;
    return {
      action: "unchanged",
      observation: mapRowToStoredObservation(updatedRow),
      revisionRecorded: false,
    };
  }

  const nextRevisionNumber = existing.revision_number + 1;
  const revisionReason =
    input.revisionReason ??
    (prevComp !== completenessState
      ? `Completeness updated from ${prevComp} to ${completenessState}`
      : "Provider revised historical metric value");

  const updateRes = await dbQuery<DbMetricObservationRow>(
    `UPDATE metric_observations
     SET numeric_value = $2,
         numerator_value = $3,
         denominator_value = $4,
         completeness_state = $5,
         data_quality_flags = $6::jsonb,
         source_updated_at = COALESCE($7, source_updated_at),
         collected_at = $8,
         ingestion_run_id = COALESCE($9, ingestion_run_id),
         project_id = COALESCE($10, project_id),
         environment_id = COALESCE($11, environment_id),
         revision_number = $12,
         previous_numeric_value = $13,
         revision_reason = $14,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      existing.id,
      nextVal,
      nextNum,
      nextDen,
      completenessState,
      JSON.stringify(input.dataQualityFlags ?? {}),
      sourceUpdatedAt,
      collectedAt,
      input.ingestionRunId ?? null,
      input.projectId,
      input.environmentId,
      nextRevisionNumber,
      prevVal,
      revisionReason,
    ],
    client,
  );

  await dbQuery(
    `INSERT INTO metric_observation_revisions (
       id, observation_id, organization_id, workspace_id, canonical_metric_key,
       revision_number, previous_value, new_value, previous_completeness,
       new_completeness, revision_reason, ingestion_run_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      generateId("mrev"),
      existing.id,
      input.organizationId,
      input.workspaceId,
      input.canonicalMetricKey,
      nextRevisionNumber,
      prevVal,
      nextVal,
      prevComp,
      completenessState,
      revisionReason,
      input.ingestionRunId ?? null,
    ],
    client,
  );

  const revisedRow = updateRes.rows[0] ?? existing;
  return {
    action: "updated",
    observation: mapRowToStoredObservation(revisedRow),
    revisionRecorded: true,
  };
}

/**
 * Idempotently upserts a single canonical metric observation inside a PostgreSQL transaction.
 */
export async function upsertMetricObservation(
  input: CanonicalMetricObservationInput,
  options?: { connectionString?: string; client?: Queryable },
): Promise<MetricUpsertOutcome> {
  if (options?.client) {
    return upsertSingleObservationInTx(input, options.client);
  }
  return withTransaction(async (tx) => upsertSingleObservationInTx(input, tx), {
    connectionString: options?.connectionString,
  });
}

/**
 * Atomically upserts a batch of canonical metric observations inside a single PostgreSQL transaction.
 */
export async function upsertMetricObservationBatch(
  inputs: readonly CanonicalMetricObservationInput[],
  options?: { connectionString?: string; client?: Queryable },
): Promise<MetricBatchUpsertResult> {
  const runBatch = async (tx: Queryable): Promise<MetricBatchUpsertResult> => {
    let insertedCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    const observations: StoredMetricObservation[] = [];

    for (const item of inputs) {
      const outcome = await upsertSingleObservationInTx(item, tx);
      if (outcome.action === "inserted") insertedCount += 1;
      else if (outcome.action === "updated") updatedCount += 1;
      else unchangedCount += 1;
      observations.push(outcome.observation);
    }

    return {
      processedCount: inputs.length,
      insertedCount,
      updatedCount,
      unchangedCount,
      observations,
    };
  };

  if (options?.client) {
    return runBatch(options.client);
  }
  return withTransaction(runBatch, { connectionString: options?.connectionString });
}

/**
 * Queries stored metric observations strictly scoped to an authorized organization and workspace.
 */
export async function queryMetricObservations(
  filter: {
    organizationId: string;
    workspaceId: string;
    projectId?: string | null;
    environmentId?: string | null;
    connectedResourceId?: string | null;
    providerKey?: string | null;
    canonicalMetricKeys?: readonly string[];
    granularity?: MetricGranularity | null;
    periodStartDate?: string | null;
    periodEndDate?: string | null;
    dimensionKeyHash?: string | null;
  },
  options?: { connectionString?: string; executor?: Queryable },
): Promise<StoredMetricObservation[]> {
  const clauses: string[] = ["organization_id = $1", "workspace_id = $2"];
  const params: unknown[] = [filter.organizationId, filter.workspaceId];

  if (filter.projectId) {
    params.push(filter.projectId);
    clauses.push(`project_id = $${params.length}`);
  }
  if (filter.environmentId) {
    params.push(filter.environmentId);
    clauses.push(`environment_id = $${params.length}`);
  }
  if (filter.connectedResourceId) {
    params.push(filter.connectedResourceId);
    clauses.push(`connected_resource_id = $${params.length}`);
  }
  if (filter.providerKey) {
    params.push(filter.providerKey);
    clauses.push(`provider_key = $${params.length}`);
  }
  if (filter.canonicalMetricKeys && filter.canonicalMetricKeys.length > 0) {
    params.push(filter.canonicalMetricKeys);
    clauses.push(`canonical_metric_key = ANY($${params.length}::text[])`);
  }
  if (filter.granularity) {
    params.push(filter.granularity);
    clauses.push(`granularity = $${params.length}`);
  }
  if (filter.periodStartDate) {
    params.push(filter.periodStartDate);
    clauses.push(`period_start_date >= $${params.length}`);
  }
  if (filter.periodEndDate) {
    params.push(filter.periodEndDate);
    clauses.push(`period_end_date <= $${params.length}`);
  }
  if (filter.dimensionKeyHash) {
    params.push(filter.dimensionKeyHash);
    clauses.push(`dimension_key_hash = $${params.length}`);
  }

  const target = options?.executor ?? getDatabasePool(options?.connectionString);
  const res = await dbQuery<DbMetricObservationRow>(
    `SELECT * FROM metric_observations
     WHERE ${clauses.join(" AND ")}
     ORDER BY period_start_date ASC, canonical_metric_key ASC`,
    params,
    target,
  );

  return res.rows.map(mapRowToStoredObservation);
}

/**
 * Lists the historical revision trail for a specific observation, scoped by organization and workspace.
 */
export async function getMetricObservationRevisions(
  filter: {
    organizationId: string;
    workspaceId: string;
    observationId: string;
  },
  options?: { connectionString?: string; executor?: Queryable },
): Promise<MetricObservationRevisionRecord[]> {
  const target = options?.executor ?? getDatabasePool(options?.connectionString);
  const res = await dbQuery<{
    id: string;
    observation_id: string;
    organization_id: string;
    workspace_id: string;
    canonical_metric_key: string;
    revision_number: number;
    previous_value: string | null;
    new_value: string | null;
    previous_completeness: string;
    new_completeness: string;
    revision_reason: string;
    ingestion_run_id: string | null;
    recorded_at: Date;
  }>(
    `SELECT * FROM metric_observation_revisions
     WHERE organization_id = $1 AND workspace_id = $2 AND observation_id = $3
     ORDER BY revision_number ASC`,
    [filter.organizationId, filter.workspaceId, filter.observationId],
    target,
  );

  return res.rows.map((r) => ({
    id: r.id,
    observationId: r.observation_id,
    organizationId: r.organization_id,
    workspaceId: r.workspace_id,
    canonicalMetricKey: r.canonical_metric_key,
    revisionNumber: r.revision_number,
    previousValue: parseNumericColumn(r.previous_value),
    newValue: parseNumericColumn(r.new_value),
    previousCompleteness: r.previous_completeness as MetricCompletenessState,
    newCompleteness: r.new_completeness as MetricCompletenessState,
    revisionReason: r.revision_reason,
    ingestionRunId: r.ingestion_run_id,
    recordedAtIso: new Date(r.recorded_at).toISOString(),
  }));
}
