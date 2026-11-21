import {
  type AuthenticatedSessionContext,
  authorizeProjectAccess,
  authorizeWorkspaceAccess,
} from "@avenor/auth";
import { assertServerRuntime } from "@avenor/config";
import {
  dbQuery,
  generateId,
  getDatabasePool,
  withTransaction,
  writeAuditLog,
} from "@avenor/database";
import { AppError, ERROR_CODES } from "@avenor/types";
import { addCalendarDays } from "@/lib/reports/date-window";

export type CostThresholdScopeType = "WORKSPACE" | "PROJECT" | "GCP_PROJECT" | "SERVICE";

export type CostThresholdMetricBasis = "NET_COST" | "GROSS_COST";

export type CostThresholdPeriodType = "DAILY" | "WEEKLY_ROLLING" | "MONTHLY";

export type CostThresholdEvaluationFrequency = "EVERY_SYNC" | "DAILY" | "HOURLY";

export type CostThresholdSeverity =
  | "OK"
  | "WARNING"
  | "CRITICAL"
  | "CURRENCY_MISMATCH"
  | "INSUFFICIENT_DATA";

export interface CostSpendingThresholdDto {
  id: string;
  organizationId: string;
  workspaceId: string;
  projectId: string | null;
  name: string;
  scopeType: CostThresholdScopeType;
  gcpProjectId: string | null;
  serviceDescription: string | null;
  metricBasis: CostThresholdMetricBasis;
  periodType: CostThresholdPeriodType;
  currency: string;
  warningAmount: number | null;
  criticalAmount: number;
  evaluationFrequency: CostThresholdEvaluationFrequency;
  notificationChannels: string[];
  isEnabled: boolean;
  lastEvaluatedAtIso: string | null;
  lastStatus: CostThresholdSeverity;
  createdByUserId: string | null;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface CostThresholdEvaluationDto {
  id: string;
  thresholdId: string;
  thresholdName: string;
  organizationId: string;
  workspaceId: string;
  projectId: string | null;
  periodKey: string;
  periodStartDate: string;
  periodEndDate: string;
  severity: CostThresholdSeverity;
  observedAmount: number | null;
  thresholdAmount: number;
  currency: string;
  dedupeKey: string;
  alertTriggered: boolean;
  wasDeduplicatedRepeat: boolean;
  summary: string;
  details: Record<string, unknown>;
  evaluatedAtIso: string;
}

export interface CreateCostSpendingThresholdInput {
  workspaceId?: string;
  projectId?: string | null;
  name: string;
  scopeType?: CostThresholdScopeType;
  gcpProjectId?: string | null;
  serviceDescription?: string | null;
  metricBasis?: CostThresholdMetricBasis;
  periodType?: CostThresholdPeriodType;
  currency: string;
  warningAmount?: number | null;
  criticalAmount: number;
  evaluationFrequency?: CostThresholdEvaluationFrequency;
  notificationChannels?: string[];
}

const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

export function validateCostThresholdInput(input: CreateCostSpendingThresholdInput): {
  name: string;
  scopeType: CostThresholdScopeType;
  gcpProjectId: string | null;
  serviceDescription: string | null;
  metricBasis: CostThresholdMetricBasis;
  periodType: CostThresholdPeriodType;
  currency: string;
  warningAmount: number | null;
  criticalAmount: number;
  evaluationFrequency: CostThresholdEvaluationFrequency;
  notificationChannels: string[];
} {
  const name = input.name?.trim();
  if (!name || name.length < 2 || name.length > 120) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "Threshold rule name must be between 2 and 120 characters.",
      statusCode: 400,
    });
  }

  const currency = input.currency?.trim().toUpperCase();
  if (!currency || !CURRENCY_CODE_RE.test(currency)) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Invalid threshold currency "${input.currency}". Expected 3-letter ISO currency code (e.g. USD, EUR).`,
      statusCode: 400,
    });
  }

  const criticalAmount = Number(input.criticalAmount);
  if (!Number.isFinite(criticalAmount) || criticalAmount <= 0) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "Critical threshold amount must be a positive number greater than 0.",
      statusCode: 400,
    });
  }

  let warningAmount: number | null = null;
  if (input.warningAmount !== undefined && input.warningAmount !== null) {
    const w = Number(input.warningAmount);
    if (!Number.isFinite(w) || w <= 0) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Warning threshold amount must be greater than 0 when specified.",
        statusCode: 400,
      });
    }
    if (w >= criticalAmount) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Warning amount (${w}) must be strictly less than critical amount (${criticalAmount}).`,
        statusCode: 400,
      });
    }
    warningAmount = Number(w.toFixed(6));
  }

  const scopeType: CostThresholdScopeType = input.scopeType ?? "PROJECT";
  const metricBasis: CostThresholdMetricBasis = input.metricBasis ?? "NET_COST";
  const periodType: CostThresholdPeriodType = input.periodType ?? "MONTHLY";
  const evaluationFrequency: CostThresholdEvaluationFrequency =
    input.evaluationFrequency ?? "EVERY_SYNC";
  const notificationChannels =
    input.notificationChannels && input.notificationChannels.length > 0
      ? input.notificationChannels
      : ["IN_APP"];

  return {
    name,
    scopeType,
    gcpProjectId: input.gcpProjectId?.trim() || null,
    serviceDescription: input.serviceDescription?.trim() || null,
    metricBasis,
    periodType,
    currency,
    warningAmount,
    criticalAmount: Number(criticalAmount.toFixed(6)),
    evaluationFrequency,
    notificationChannels,
  };
}

export function resolveThresholdPeriodBounds(
  periodType: CostThresholdPeriodType,
  referenceDate: string,
): {
  periodKey: string;
  periodStartDate: string;
  periodEndDate: string;
} {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Invalid threshold evaluation reference date "${referenceDate}".`,
      statusCode: 400,
    });
  }

  if (periodType === "DAILY") {
    return {
      periodKey: `DAILY:${referenceDate}`,
      periodStartDate: referenceDate,
      periodEndDate: referenceDate,
    };
  }

  if (periodType === "WEEKLY_ROLLING") {
    const startDate = addCalendarDays(referenceDate, -6);
    return {
      periodKey: `WEEKLY:${startDate}..${referenceDate}`,
      periodStartDate: startDate,
      periodEndDate: referenceDate,
    };
  }

  const yearMonth = referenceDate.slice(0, 7);
  const startDate = `${yearMonth}-01`;
  return {
    periodKey: `MONTHLY:${yearMonth}`,
    periodStartDate: startDate,
    periodEndDate: referenceDate,
  };
}

/**
 * Pure deterministic evaluator comparing observed ledger rows against a user-owned threshold rule.
 * Enforces currency alignment and distinguishes missing export data from genuine $0 spend.
 */
export function evaluateSingleThresholdAgainstRows(input: {
  threshold: Pick<
    CostSpendingThresholdDto,
    "id" | "name" | "metricBasis" | "periodType" | "currency" | "warningAmount" | "criticalAmount"
  >;
  referenceDate: string;
  rows: ReadonlyArray<{
    currency: string;
    grossCost: number;
    netCost: number;
  }>;
}): {
  periodKey: string;
  periodStartDate: string;
  periodEndDate: string;
  severity: CostThresholdSeverity;
  observedAmount: number | null;
  thresholdAmount: number;
  dedupeKey: string;
  shouldTriggerAlert: boolean;
  summary: string;
} {
  const bounds = resolveThresholdPeriodBounds(input.threshold.periodType, input.referenceDate);
  const ruleCurrency = input.threshold.currency.toUpperCase();

  if (input.rows.length === 0) {
    const severity: CostThresholdSeverity = "INSUFFICIENT_DATA";
    return {
      ...bounds,
      severity,
      observedAmount: null,
      thresholdAmount: input.threshold.criticalAmount,
      dedupeKey: `${input.threshold.id}::${bounds.periodKey}::${severity}`,
      shouldTriggerAlert: false,
      summary: `No billing export rows found for ${bounds.periodStartDate}..${bounds.periodEndDate}. Threshold "${input.threshold.name}" cannot be evaluated until export data arrives.`,
    };
  }

  const distinctCurrencies = Array.from(new Set(input.rows.map((r) => r.currency.toUpperCase())));
  if (distinctCurrencies.length > 1 || distinctCurrencies[0] !== ruleCurrency) {
    const severity: CostThresholdSeverity = "CURRENCY_MISMATCH";
    return {
      ...bounds,
      severity,
      observedAmount: null,
      thresholdAmount: input.threshold.criticalAmount,
      dedupeKey: `${input.threshold.id}::${bounds.periodKey}::${severity}`,
      shouldTriggerAlert: false,
      summary: `Currency mismatch: threshold "${input.threshold.name}" is configured in ${ruleCurrency}, but billing export rows use ${distinctCurrencies.join(", ")}.`,
    };
  }

  let observed = 0;
  for (const r of input.rows) {
    observed += input.threshold.metricBasis === "GROSS_COST" ? r.grossCost : r.netCost;
  }
  const observedAmount = Number(observed.toFixed(6));

  if (observedAmount >= input.threshold.criticalAmount) {
    const severity: CostThresholdSeverity = "CRITICAL";
    return {
      ...bounds,
      severity,
      observedAmount,
      thresholdAmount: input.threshold.criticalAmount,
      dedupeKey: `${input.threshold.id}::${bounds.periodKey}::${severity}`,
      shouldTriggerAlert: true,
      summary: `CRITICAL: ${input.threshold.name} reached ${ruleCurrency} ${observedAmount.toFixed(2)} (critical limit: ${ruleCurrency} ${input.threshold.criticalAmount.toFixed(2)}) for ${bounds.periodKey}.`,
    };
  }

  if (input.threshold.warningAmount !== null && observedAmount >= input.threshold.warningAmount) {
    const severity: CostThresholdSeverity = "WARNING";
    return {
      ...bounds,
      severity,
      observedAmount,
      thresholdAmount: input.threshold.warningAmount,
      dedupeKey: `${input.threshold.id}::${bounds.periodKey}::${severity}`,
      shouldTriggerAlert: true,
      summary: `WARNING: ${input.threshold.name} reached ${ruleCurrency} ${observedAmount.toFixed(2)} (warning limit: ${ruleCurrency} ${input.threshold.warningAmount.toFixed(2)}) for ${bounds.periodKey}.`,
    };
  }

  const severity: CostThresholdSeverity = "OK";
  return {
    ...bounds,
    severity,
    observedAmount,
    thresholdAmount: input.threshold.criticalAmount,
    dedupeKey: `${input.threshold.id}::${bounds.periodKey}::${severity}`,
    shouldTriggerAlert: false,
    summary: `OK: ${input.threshold.name} is at ${ruleCurrency} ${observedAmount.toFixed(2)} (under ${ruleCurrency} ${(input.threshold.warningAmount ?? input.threshold.criticalAmount).toFixed(2)} limit) for ${bounds.periodKey}.`,
  };
}

interface DbThresholdRow {
  id: string;
  organization_id: string;
  workspace_id: string;
  project_id: string | null;
  name: string;
  scope_type: string;
  gcp_project_id: string | null;
  service_description: string | null;
  metric_basis: string;
  period_type: string;
  currency: string;
  warning_amount: string | null;
  critical_amount: string;
  evaluation_frequency: string;
  notification_channels: string[];
  is_enabled: boolean;
  last_evaluated_at: Date | null;
  last_status: string;
  created_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function mapThresholdRow(r: DbThresholdRow): CostSpendingThresholdDto {
  return {
    id: r.id,
    organizationId: r.organization_id,
    workspaceId: r.workspace_id,
    projectId: r.project_id,
    name: r.name,
    scopeType: r.scope_type as CostThresholdScopeType,
    gcpProjectId: r.gcp_project_id,
    serviceDescription: r.service_description,
    metricBasis: r.metric_basis as CostThresholdMetricBasis,
    periodType: r.period_type as CostThresholdPeriodType,
    currency: r.currency,
    warningAmount: r.warning_amount !== null ? Number(r.warning_amount) : null,
    criticalAmount: Number(r.critical_amount),
    evaluationFrequency: r.evaluation_frequency as CostThresholdEvaluationFrequency,
    notificationChannels: r.notification_channels ?? ["IN_APP"],
    isEnabled: r.is_enabled,
    lastEvaluatedAtIso: r.last_evaluated_at ? new Date(r.last_evaluated_at).toISOString() : null,
    lastStatus: r.last_status as CostThresholdSeverity,
    createdByUserId: r.created_by_user_id,
    createdAtIso: new Date(r.created_at).toISOString(),
    updatedAtIso: new Date(r.updated_at).toISOString(),
  };
}

/**
 * Creates an Avenor-owned spending threshold rule in PostgreSQL.
 * Never mutates external Google Cloud Budgets.
 */
export async function createCostSpendingThreshold(
  session: AuthenticatedSessionContext | null,
  input: CreateCostSpendingThresholdInput,
  options?: { connectionString?: string },
): Promise<CostSpendingThresholdDto> {
  assertServerRuntime("createCostSpendingThreshold");

  const workspaceId = input.workspaceId ?? session?.activeWorkspace.id ?? "";
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "project:update",
  });

  const validated = validateCostThresholdInput(input);
  const thresholdId = generateId("cthr");

  const saved = await withTransaction(
    async (client) => {
      const res = await dbQuery<DbThresholdRow>(
        `INSERT INTO cost_spending_thresholds (
           id,
           organization_id,
           workspace_id,
           project_id,
           name,
           scope_type,
           gcp_project_id,
           service_description,
           metric_basis,
           period_type,
           currency,
           warning_amount,
           critical_amount,
           evaluation_frequency,
           notification_channels,
           is_enabled,
           created_by_user_id
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           $11, $12, $13, $14, $15, true, $16
         )
         RETURNING *`,
        [
          thresholdId,
          access.organizationId,
          access.workspaceId,
          input.projectId ?? null,
          validated.name,
          validated.scopeType,
          validated.gcpProjectId,
          validated.serviceDescription,
          validated.metricBasis,
          validated.periodType,
          validated.currency,
          validated.warningAmount,
          validated.criticalAmount,
          validated.evaluationFrequency,
          validated.notificationChannels,
          access.session.user.id,
        ],
        client,
      );

      await writeAuditLog(
        {
          organizationId: access.organizationId,
          workspaceId: access.workspaceId,
          actorUserId: access.session.user.id,
          action: "cost.threshold_created",
          entityType: "CostSpendingThreshold",
          entityId: thresholdId,
          summary: `Created Avenor spending threshold "${validated.name}" (${validated.currency} ${validated.criticalAmount.toFixed(2)} ${validated.periodType}).`,
          metadata: {
            projectId: input.projectId ?? null,
            scopeType: validated.scopeType,
            metricBasis: validated.metricBasis,
            periodType: validated.periodType,
            currency: validated.currency,
            warningAmount: validated.warningAmount,
            criticalAmount: validated.criticalAmount,
          },
        },
        client,
      );

      const createdRow = res.rows[0];
      if (!createdRow) {
        throw new AppError({
          code: ERROR_CODES.INTERNAL_ERROR,
          message: "Failed to persist spending threshold rule.",
        });
      }
      return mapThresholdRow(createdRow);
    },
    { connectionString: options?.connectionString },
  );

  return saved;
}

/**
 * Lists Avenor-owned spending thresholds and recent evaluation history for a project or workspace.
 */
export async function listCostSpendingThresholds(
  session: AuthenticatedSessionContext | null,
  query: {
    workspaceId?: string;
    projectId?: string | null;
  },
  options?: { connectionString?: string },
): Promise<{
  thresholds: CostSpendingThresholdDto[];
  evaluations: CostThresholdEvaluationDto[];
}> {
  assertServerRuntime("listCostSpendingThresholds");

  const access = query.projectId
    ? await authorizeProjectAccess({
        session,
        projectId: query.projectId,
        expectedWorkspaceId: query.workspaceId ?? session?.activeWorkspace.id,
        requiredPermission: "project:read",
      })
    : await authorizeWorkspaceAccess({
        session,
        workspaceId: query.workspaceId ?? session?.activeWorkspace.id ?? "",
        requiredPermission: "workspace:read",
      });

  const pool = getDatabasePool(options?.connectionString);

  const params: unknown[] = [access.organizationId, access.workspaceId];
  let projectClause = "";
  if (query.projectId) {
    params.push(query.projectId);
    projectClause = "AND (project_id = $3 OR project_id IS NULL)";
  }

  const thrRes = await dbQuery<DbThresholdRow>(
    `SELECT *
     FROM cost_spending_thresholds
     WHERE organization_id = $1
       AND workspace_id = $2
       ${projectClause}
     ORDER BY created_at DESC`,
    params,
    pool,
  );

  const evalRes = await dbQuery<{
    id: string;
    threshold_id: string;
    threshold_name: string;
    organization_id: string;
    workspace_id: string;
    project_id: string | null;
    period_key: string;
    period_start_date: string;
    period_end_date: string;
    severity: string;
    observed_amount: string | null;
    threshold_amount: string;
    currency: string;
    dedupe_key: string;
    alert_triggered: boolean;
    summary: string;
    details: Record<string, unknown>;
    evaluated_at: Date;
  }>(
    `SELECT
       e.*,
       t.name AS threshold_name
     FROM cost_threshold_evaluations e
     INNER JOIN cost_spending_thresholds t ON t.id = e.threshold_id
     WHERE e.organization_id = $1
       AND e.workspace_id = $2
       ${query.projectId ? "AND (e.project_id = $3 OR e.project_id IS NULL)" : ""}
     ORDER BY e.evaluated_at DESC
     LIMIT 25`,
    params,
    pool,
  );

  return {
    thresholds: thrRes.rows.map(mapThresholdRow),
    evaluations: evalRes.rows.map((e) => ({
      id: e.id,
      thresholdId: e.threshold_id,
      thresholdName: e.threshold_name,
      organizationId: e.organization_id,
      workspaceId: e.workspace_id,
      projectId: e.project_id,
      periodKey: e.period_key,
      periodStartDate: e.period_start_date,
      periodEndDate: e.period_end_date,
      severity: e.severity as CostThresholdSeverity,
      observedAmount: e.observed_amount !== null ? Number(e.observed_amount) : null,
      thresholdAmount: Number(e.threshold_amount),
      currency: e.currency,
      dedupeKey: e.dedupe_key,
      alertTriggered: e.alert_triggered,
      wasDeduplicatedRepeat: Boolean(e.details?.wasDeduplicatedRepeat),
      summary: e.summary,
      details: e.details ?? {},
      evaluatedAtIso: new Date(e.evaluated_at).toISOString(),
    })),
  };
}

/**
 * Evaluates all enabled Avenor spending thresholds for a workspace/project against stored
 * `billing_cost_ledger_entries` with deterministic alert deduplication per (thresholdId, periodKey, severity).
 */
export async function evaluateCostSpendingThresholds(
  session: AuthenticatedSessionContext | null,
  input: {
    workspaceId?: string;
    projectId?: string | null;
    referenceDate?: string;
  },
  options?: { connectionString?: string },
): Promise<CostThresholdEvaluationDto[]> {
  assertServerRuntime("evaluateCostSpendingThresholds");

  const workspaceId = input.workspaceId ?? session?.activeWorkspace.id ?? "";
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "workspace:read",
  });

  const pool = getDatabasePool(options?.connectionString);
  const referenceDate = input.referenceDate?.trim() || new Date().toISOString().slice(0, 10);

  const params: unknown[] = [access.organizationId, access.workspaceId];
  let projectClause = "";
  if (input.projectId) {
    params.push(input.projectId);
    projectClause = "AND (project_id = $3 OR project_id IS NULL)";
  }

  const thrRes = await dbQuery<DbThresholdRow>(
    `SELECT *
     FROM cost_spending_thresholds
     WHERE organization_id = $1
       AND workspace_id = $2
       AND is_enabled = true
       ${projectClause}
     ORDER BY created_at ASC`,
    params,
    pool,
  );

  const evaluations: CostThresholdEvaluationDto[] = [];

  for (const rawThr of thrRes.rows) {
    const threshold = mapThresholdRow(rawThr);
    const bounds = resolveThresholdPeriodBounds(threshold.periodType, referenceDate);

    const rowParams: unknown[] = [
      access.organizationId,
      access.workspaceId,
      bounds.periodStartDate,
      bounds.periodEndDate,
    ];
    const rowClauses: string[] = [
      "organization_id = $1",
      "workspace_id = $2",
      "usage_date >= $3",
      "usage_date <= $4",
    ];

    if (threshold.projectId) {
      rowParams.push(threshold.projectId);
      rowClauses.push(`(project_id = $${rowParams.length} OR project_id IS NULL)`);
    }
    if (threshold.gcpProjectId) {
      rowParams.push(threshold.gcpProjectId);
      rowClauses.push(`gcp_project_id = $${rowParams.length}`);
    }
    if (threshold.serviceDescription) {
      rowParams.push(threshold.serviceDescription);
      rowClauses.push(`service_description = $${rowParams.length}`);
    }

    const ledgerRes = await dbQuery<{
      currency: string;
      gross_cost: string;
      net_cost: string;
    }>(
      `SELECT currency, gross_cost, net_cost
       FROM billing_cost_ledger_entries
       WHERE ${rowClauses.join(" AND ")}`,
      rowParams,
      pool,
    );

    const evaluated = evaluateSingleThresholdAgainstRows({
      threshold,
      referenceDate,
      rows: ledgerRes.rows.map((r) => ({
        currency: r.currency,
        grossCost: Number(r.gross_cost),
        netCost: Number(r.net_cost),
      })),
    });

    const recorded = await withTransaction(
      async (client) => {
        const existingEval = await dbQuery<{
          id: string;
          alert_triggered: boolean;
        }>(
          `SELECT id, alert_triggered
           FROM cost_threshold_evaluations
           WHERE workspace_id = $1 AND dedupe_key = $2
           LIMIT 1`,
          [access.workspaceId, evaluated.dedupeKey],
          client,
        );

        const alreadyTriggeredBefore = existingEval.rows.length > 0;
        const alertTriggeredNow = evaluated.shouldTriggerAlert && !alreadyTriggeredBefore;
        const evalId = existingEval.rows[0]?.id ?? generateId("cevl");

        const upsertRes = await dbQuery<{ evaluated_at: Date }>(
          `INSERT INTO cost_threshold_evaluations (
             id,
             threshold_id,
             organization_id,
             workspace_id,
             project_id,
             period_key,
             period_start_date,
             period_end_date,
             severity,
             observed_amount,
             threshold_amount,
             currency,
             dedupe_key,
             alert_triggered,
             summary,
             details
           )
           VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             $11, $12, $13, $14, $15, $16::jsonb
           )
           ON CONFLICT ON CONSTRAINT uq_cost_threshold_eval_dedupe DO UPDATE SET
             observed_amount = EXCLUDED.observed_amount,
             summary = EXCLUDED.summary,
             details = EXCLUDED.details,
             evaluated_at = now()
           RETURNING evaluated_at`,
          [
            evalId,
            threshold.id,
            access.organizationId,
            access.workspaceId,
            threshold.projectId,
            evaluated.periodKey,
            evaluated.periodStartDate,
            evaluated.periodEndDate,
            evaluated.severity,
            evaluated.observedAmount,
            evaluated.thresholdAmount,
            threshold.currency,
            evaluated.dedupeKey,
            alertTriggeredNow,
            evaluated.summary,
            JSON.stringify({
              wasDeduplicatedRepeat: alreadyTriggeredBefore,
              metricBasis: threshold.metricBasis,
              periodType: threshold.periodType,
            }),
          ],
          client,
        );

        await dbQuery(
          `UPDATE cost_spending_thresholds
           SET last_evaluated_at = now(),
               last_status = $2,
               updated_at = now()
           WHERE id = $1`,
          [threshold.id, evaluated.severity],
          client,
        );

        return {
          id: evalId,
          thresholdId: threshold.id,
          thresholdName: threshold.name,
          organizationId: access.organizationId,
          workspaceId: access.workspaceId,
          projectId: threshold.projectId,
          periodKey: evaluated.periodKey,
          periodStartDate: evaluated.periodStartDate,
          periodEndDate: evaluated.periodEndDate,
          severity: evaluated.severity,
          observedAmount: evaluated.observedAmount,
          thresholdAmount: evaluated.thresholdAmount,
          currency: threshold.currency,
          dedupeKey: evaluated.dedupeKey,
          alertTriggered: alertTriggeredNow,
          wasDeduplicatedRepeat: alreadyTriggeredBefore,
          summary: evaluated.summary,
          details: {
            wasDeduplicatedRepeat: alreadyTriggeredBefore,
            metricBasis: threshold.metricBasis,
            periodType: threshold.periodType,
          },
          evaluatedAtIso: new Date(upsertRes.rows[0]?.evaluated_at ?? new Date()).toISOString(),
        };
      },
      { connectionString: options?.connectionString },
    );

    evaluations.push(recorded);
  }

  return evaluations;
}
