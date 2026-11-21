import { type AuthenticatedSessionContext, authorizeWorkspaceAccess } from "@avenor/auth";
import { dbQuery, generateId, withTransaction } from "@avenor/database";
import { AppError, ERROR_CODES } from "@avenor/types";
import { getWorkspaceEffectiveEntitlements } from "./lemon-squeezy";
import type { AvenorPlanCode } from "./plan-catalog";

export type HardCapacityResourceKey =
  | "projects"
  | "mapped_sources"
  | "members"
  | "uptime_monitors"
  | "alert_rules"
  | "digest_schedules"
  | "outgoing_webhooks";

export type MonthlyMeteredResourceKey =
  | "csv_exports"
  | "pdf_exports"
  | "ai_insights"
  | "public_api_requests";

export interface QuotaUsageMetricRow {
  resourceKey: string;
  label: string;
  category: "HARD_CAPACITY" | "MONTHLY_ALLOWANCE";
  used: number;
  limit: number;
  remaining: number;
  utilizationPct: number;
  status: "OK" | "NEAR_LIMIT" | "EXCEEDED" | "UNAVAILABLE_ON_PLAN";
  resetDateIso: string | null;
}

export interface WorkspaceUsageQuotaReport {
  workspaceId: string;
  effectivePlanCode: AvenorPlanCode;
  periodKey: string;
  nextResetIso: string;
  noOverageNotice: string;
  quotas: QuotaUsageMetricRow[];
}

export function getCurrentMonthlyPeriod(now: Date = new Date()): {
  periodKey: string;
  nextResetIso: string;
} {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const periodKey = `${year}-${String(month).padStart(2, "0")}`;
  const nextMonth = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return { periodKey, nextResetIso: nextMonth.toISOString() };
}

function classifyQuotaRow(
  resourceKey: string,
  label: string,
  category: "HARD_CAPACITY" | "MONTHLY_ALLOWANCE",
  used: number,
  limit: number,
  resetDateIso: string | null,
): QuotaUsageMetricRow {
  if (limit === 0) {
    return {
      resourceKey,
      label,
      category,
      used,
      limit,
      remaining: 0,
      utilizationPct: 0,
      status: "UNAVAILABLE_ON_PLAN",
      resetDateIso,
    };
  }
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const status = used >= limit ? "EXCEEDED" : pct >= 80 ? "NEAR_LIMIT" : "OK";
  return {
    resourceKey,
    label,
    category,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    utilizationPct: pct,
    status,
    resetDateIso,
  };
}

/**
 * Enforces hard workspace capacity limits server-side (projects, mapped sources, seats, monitors, etc.).
 */
export async function assertHardWorkspaceCapacity(
  session: AuthenticatedSessionContext | null,
  workspaceId: string,
  resourceKey: HardCapacityResourceKey,
): Promise<{ used: number; limit: number; planCode: AvenorPlanCode }> {
  const ent = await getWorkspaceEffectiveEntitlements(session, workspaceId, { skipAuth: !session });
  const limits = ent.limits;

  let query = "";
  let limit = 0;
  switch (resourceKey) {
    case "projects":
      query = `SELECT COUNT(*)::text AS cnt FROM logical_projects WHERE workspace_id = $1 AND archived_at IS NULL`;
      limit = limits.maxProjects;
      break;
    case "mapped_sources":
      query = `SELECT COUNT(*)::text AS cnt FROM resource_mappings WHERE workspace_id = $1`;
      limit = limits.maxMappedSources;
      break;
    case "members":
      query = `SELECT COUNT(*)::text AS cnt FROM workspace_memberships WHERE workspace_id = $1`;
      limit = limits.maxMembers;
      break;
    case "uptime_monitors":
      query = `SELECT COUNT(*)::text AS cnt FROM uptime_monitors WHERE workspace_id = $1`;
      limit = limits.maxUptimeMonitors;
      break;
    case "alert_rules":
      query = `SELECT COUNT(*)::text AS cnt FROM alert_rules WHERE workspace_id = $1 AND is_enabled = true`;
      limit = limits.maxActiveAlertRules;
      break;
    case "digest_schedules":
      query = `SELECT COUNT(*)::text AS cnt FROM digest_schedules WHERE workspace_id = $1 AND is_enabled = true`;
      limit = limits.maxDigestSchedules;
      break;
    case "outgoing_webhooks":
      query = `SELECT COUNT(*)::text AS cnt FROM outbound_webhook_channels WHERE workspace_id = $1 AND is_enabled = true`;
      limit = limits.maxOutgoingWebhooks;
      break;
  }

  const res = await dbQuery<{ cnt: string }>(query, [workspaceId]);
  const used = Number(res.rows[0]?.cnt ?? 0);

  if (used >= limit) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: `Workspace ${ent.effectivePlanCode} plan limit reached for ${resourceKey} (${used}/${limit}). No automatic overage charges apply; upgrade your plan or remove unused resources to continue.`,
      details: {
        resourceKey,
        used: String(used),
        limit: String(limit),
        planCode: ent.effectivePlanCode,
      },
    });
  }

  return { used, limit, planCode: ent.effectivePlanCode };
}

/**
 * Concurrency-safe, idempotent monthly quota reservation using a PostgreSQL transaction-scoped
 * advisory lock (`pg_advisory_xact_lock`) so concurrent requests cannot exceed plan allowances,
 * and retried operations with the same `operationId` never double-charge quota.
 */
export async function reserveMonthlyQuotaAtomically(
  session: AuthenticatedSessionContext | null,
  input: {
    workspaceId?: string;
    resourceKey: MonthlyMeteredResourceKey;
    operationId: string;
    amount?: number;
    now?: Date;
  },
): Promise<{
  reservationId: string;
  resourceKey: MonthlyMeteredResourceKey;
  periodKey: string;
  usedAfterReservation: number;
  limit: number;
  idempotentHit: boolean;
}> {
  const workspaceId = input.workspaceId ?? session?.activeWorkspace.id ?? "";
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "project:read",
  });

  const ent = await getWorkspaceEffectiveEntitlements(session, workspaceId, { skipAuth: true });
  const amount = Math.max(1, Math.floor(input.amount ?? 1));
  const { periodKey, nextResetIso } = getCurrentMonthlyPeriod(input.now);

  let limit = 0;
  switch (input.resourceKey) {
    case "csv_exports":
      limit = ent.limits.csvExportsPerMonth;
      break;
    case "pdf_exports":
      limit = ent.limits.pdfExportsPerMonth;
      break;
    case "ai_insights":
      limit = ent.limits.aiInsightsPerMonth;
      break;
    case "public_api_requests":
      limit = ent.limits.publicApiRequestsPerMonth;
      break;
  }

  return withTransaction(async (client) => {
    // Acquire transaction-scoped advisory lock per (workspaceId, resourceKey)
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `${workspaceId}:${input.resourceKey}:${periodKey}`,
    ]);

    // Check idempotency for repeated operationId
    const existing = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM usage_quota_reservations
       WHERE workspace_id = $1 AND resource_key = $2 AND operation_id = $3`,
      [workspaceId, input.resourceKey, input.operationId],
    );

    const usedRes = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total
       FROM usage_quota_reservations
       WHERE workspace_id = $1 AND resource_key = $2 AND period_key = $3
         AND (status = 'COMMITTED' OR (status = 'RESERVED' AND expires_at > now()))`,
      [workspaceId, input.resourceKey, periodKey],
    );
    const currentUsed = Number(usedRes.rows[0]?.total ?? 0);

    if (existing.rows[0]) {
      return {
        reservationId: existing.rows[0].id,
        resourceKey: input.resourceKey,
        periodKey,
        usedAfterReservation: currentUsed,
        limit,
        idempotentHit: true,
      };
    }

    if (currentUsed + amount > limit) {
      throw new AppError({
        code: ERROR_CODES.RATE_LIMITED,
        message: `Monthly ${ent.effectivePlanCode} allowance exceeded for ${input.resourceKey} (${currentUsed}/${limit}; resets ${nextResetIso}). No automatic overage fees are billed.`,
        details: {
          resourceKey: input.resourceKey,
          used: String(currentUsed),
          limit: String(limit),
          resetDateIso: nextResetIso,
          planCode: ent.effectivePlanCode,
        },
      });
    }

    const reservationId = generateId("qres");
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    await client.query(
      `INSERT INTO usage_quota_reservations (
        id, organization_id, workspace_id, resource_key, period_key, operation_id,
        amount, status, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'RESERVED', $8)`,
      [
        reservationId,
        access.organizationId,
        workspaceId,
        input.resourceKey,
        periodKey,
        input.operationId,
        amount,
        expiresAt,
      ],
    );

    return {
      reservationId,
      resourceKey: input.resourceKey,
      periodKey,
      usedAfterReservation: currentUsed + amount,
      limit,
      idempotentHit: false,
    };
  });
}

export async function commitQuotaReservation(reservationId: string): Promise<void> {
  await dbQuery(
    `UPDATE usage_quota_reservations SET status = 'COMMITTED' WHERE id = $1 AND status = 'RESERVED'`,
    [reservationId],
  );
}

export async function releaseQuotaReservation(reservationId: string): Promise<void> {
  await dbQuery(
    `UPDATE usage_quota_reservations SET status = 'RELEASED' WHERE id = $1 AND status = 'RESERVED'`,
    [reservationId],
  );
}

export async function getWorkspaceUsageAndQuotaReport(
  session: AuthenticatedSessionContext | null,
  workspaceId?: string,
): Promise<WorkspaceUsageQuotaReport> {
  const targetWs = workspaceId ?? session?.activeWorkspace.id ?? "";
  await authorizeWorkspaceAccess({
    session,
    workspaceId: targetWs,
    requiredPermission: "workspace:read",
  });

  const ent = await getWorkspaceEffectiveEntitlements(session, targetWs, { skipAuth: true });
  const { periodKey, nextResetIso } = getCurrentMonthlyPeriod();

  const [projects, sources, members, monitors, rules, digests, monthlyRes] = await Promise.all([
    dbQuery<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM logical_projects WHERE workspace_id = $1 AND archived_at IS NULL`,
      [targetWs],
    ),
    dbQuery<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM resource_mappings WHERE workspace_id = $1`,
      [targetWs],
    ),
    dbQuery<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM workspace_memberships WHERE workspace_id = $1`,
      [targetWs],
    ),
    dbQuery<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM uptime_monitors WHERE workspace_id = $1`,
      [targetWs],
    ),
    dbQuery<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM alert_rules WHERE workspace_id = $1 AND is_enabled = true`,
      [targetWs],
    ),
    dbQuery<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM digest_schedules WHERE workspace_id = $1 AND is_enabled = true`,
      [targetWs],
    ),
    dbQuery<{ resource_key: string; total: string }>(
      `SELECT resource_key, COALESCE(SUM(amount), 0)::text AS total
       FROM usage_quota_reservations
       WHERE workspace_id = $1 AND period_key = $2
         AND (status = 'COMMITTED' OR (status = 'RESERVED' AND expires_at > now()))
       GROUP BY resource_key`,
      [targetWs, periodKey],
    ),
  ]);

  const monthlyMap = new Map(monthlyRes.rows.map((r) => [r.resource_key, Number(r.total)]));
  const L = ent.limits;

  return {
    workspaceId: targetWs,
    effectivePlanCode: ent.effectivePlanCode,
    periodKey,
    nextResetIso,
    noOverageNotice:
      "Avenor enforces flat-rate fair-use allowances with zero automatic overage billing. Monthly counters reset on the 1st of each UTC month.",
    quotas: [
      classifyQuotaRow(
        "projects",
        "Logical Products",
        "HARD_CAPACITY",
        Number(projects.rows[0]?.cnt ?? 0),
        L.maxProjects,
        null,
      ),
      classifyQuotaRow(
        "mapped_sources",
        "Mapped Provider Sources",
        "HARD_CAPACITY",
        Number(sources.rows[0]?.cnt ?? 0),
        L.maxMappedSources,
        null,
      ),
      classifyQuotaRow(
        "members",
        "Workspace Members",
        "HARD_CAPACITY",
        Number(members.rows[0]?.cnt ?? 0),
        L.maxMembers,
        null,
      ),
      classifyQuotaRow(
        "uptime_monitors",
        "Uptime Monitors",
        "HARD_CAPACITY",
        Number(monitors.rows[0]?.cnt ?? 0),
        L.maxUptimeMonitors,
        null,
      ),
      classifyQuotaRow(
        "alert_rules",
        "Active Alert Rules",
        "HARD_CAPACITY",
        Number(rules.rows[0]?.cnt ?? 0),
        L.maxActiveAlertRules,
        null,
      ),
      classifyQuotaRow(
        "digest_schedules",
        "Scheduled Digests",
        "HARD_CAPACITY",
        Number(digests.rows[0]?.cnt ?? 0),
        L.maxDigestSchedules,
        null,
      ),
      classifyQuotaRow(
        "csv_exports",
        "CSV Exports / Month",
        "MONTHLY_ALLOWANCE",
        monthlyMap.get("csv_exports") ?? 0,
        L.csvExportsPerMonth,
        nextResetIso,
      ),
      classifyQuotaRow(
        "pdf_exports",
        "PDF Exports / Month",
        "MONTHLY_ALLOWANCE",
        monthlyMap.get("pdf_exports") ?? 0,
        L.pdfExportsPerMonth,
        nextResetIso,
      ),
      classifyQuotaRow(
        "ai_insights",
        "AI Insights / Month",
        "MONTHLY_ALLOWANCE",
        monthlyMap.get("ai_insights") ?? 0,
        L.aiInsightsPerMonth,
        nextResetIso,
      ),
      classifyQuotaRow(
        "public_api_requests",
        "Public API Calls / Month",
        "MONTHLY_ALLOWANCE",
        monthlyMap.get("public_api_requests") ?? 0,
        L.publicApiRequestsPerMonth,
        nextResetIso,
      ),
    ],
  };
}
