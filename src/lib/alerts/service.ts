import { type AuthenticatedSessionContext, authorizeWorkspaceAccess } from "@avenor/auth";
import { assertServerRuntime } from "@avenor/config";
import { dbQuery, generateId } from "@avenor/database";
import { AppError, ERROR_CODES } from "@avenor/types";
import { z } from "zod";
import { createDefaultEmailTransport, type EmailTransportAdapter } from "./email-transport";

export const ALERT_CATEGORIES = [
  "PROVIDER_CONNECTION_FAILURE",
  "STALE_DATA",
  "KPI_THRESHOLD",
  "CLOUD_SPENDING_THRESHOLD",
] as const;

export type AlertCategory = (typeof ALERT_CATEGORIES)[number];
export type AlertOperator = "GT" | "GTE" | "LT" | "LTE" | "STATUS_MATCH";
export type AlertSeverity = "INFO" | "WARNING" | "CRITICAL";
export type QuietHoursPolicy = "DEFER" | "IN_APP_ONLY" | "DISABLED";

export interface AlertRuleRecord {
  id: string;
  organizationId: string;
  workspaceId: string;
  projectId: string | null;
  connectedResourceId: string | null;
  name: string;
  category: AlertCategory;
  metricKey: string | null;
  operator: AlertOperator;
  thresholdValue: number | null;
  unit: string | null;
  currency: string | null;
  evaluationWindowMinutes: number;
  freshnessRequiredMinutes: number;
  severity: AlertSeverity;
  isEnabled: boolean;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface AlertIncidentRecord {
  id: string;
  workspaceId: string;
  projectId: string | null;
  connectedResourceId: string | null;
  alertRuleId: string | null;
  category: AlertCategory;
  severity: AlertSeverity;
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  dedupeKey: string;
  title: string;
  summary: string;
  observedValue: number | null;
  thresholdValue: number | null;
  unit: string | null;
  currency: string | null;
  firstTriggeredAtIso: string;
  lastEvaluatedAtIso: string;
  resolvedAtIso: string | null;
}

export interface InAppNotificationRecord {
  id: string;
  workspaceId: string;
  userId: string;
  incidentId: string | null;
  category: string;
  severity: AlertSeverity;
  title: string;
  body: string;
  actionUrl: string | null;
  isRead: boolean;
  readAtIso: string | null;
  createdAtIso: string;
}

export interface NotificationDeliveryRecord {
  id: string;
  incidentId: string;
  userId: string;
  channel: "IN_APP" | "EMAIL";
  recipientAddress: string | null;
  status:
    | "QUEUED"
    | "ACCEPTED"
    | "DELIVERED"
    | "FAILED"
    | "DEFERRED_QUIET_HOURS"
    | "SUPPRESSED_PREFERENCE";
  attemptCount: number;
  providerName: string;
  providerMessageId: string | null;
  errorSummary: string | null;
  nextRetryAtIso: string | null;
  updatedAtIso: string;
}

export interface NotificationPreferenceRecord {
  id: string;
  workspaceId: string;
  userId: string;
  emailEnabled: boolean;
  inAppEnabled: boolean;
  enabledCategories: readonly AlertCategory[];
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  quietHoursTimezone: string;
  quietHoursPolicy: QuietHoursPolicy;
  updatedAtIso: string;
}

const createAlertRuleSchema = z.object({
  workspaceId: z.string().trim().min(2).optional(),
  projectId: z.string().trim().min(2).optional().nullable(),
  connectedResourceId: z.string().trim().min(2).optional().nullable(),
  name: z.string().trim().min(2, "Rule name must be at least 2 characters.").max(140),
  category: z.enum(ALERT_CATEGORIES),
  metricKey: z.string().trim().max(120).optional().nullable(),
  operator: z.enum(["GT", "GTE", "LT", "LTE", "STATUS_MATCH"]).default("GT"),
  thresholdValue: z.number().finite().optional().nullable(),
  unit: z.string().trim().max(40).optional().nullable(),
  currency: z.string().trim().max(10).optional().nullable(),
  evaluationWindowMinutes: z.number().int().min(5).max(43_200).default(1440),
  freshnessRequiredMinutes: z.number().int().min(5).max(10_080).default(360),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]).default("WARNING"),
  isEnabled: z.boolean().default(true),
});

const updateNotificationPreferencesSchema = z.object({
  workspaceId: z.string().trim().min(2).optional(),
  emailEnabled: z.boolean().optional(),
  inAppEnabled: z.boolean().optional(),
  enabledCategories: z.array(z.enum(ALERT_CATEGORIES)).optional(),
  quietHoursEnabled: z.boolean().optional(),
  quietHoursStart: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Use HH:MM 24-hour format.")
    .optional(),
  quietHoursEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Use HH:MM 24-hour format.")
    .optional(),
  quietHoursTimezone: z.string().trim().min(2).max(64).optional(),
  quietHoursPolicy: z.enum(["DEFER", "IN_APP_ONLY", "DISABLED"]).optional(),
});

function parseHHMMToMinutes(hhmm: string): number {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number.parseInt(hStr ?? "0", 10);
  const m = Number.parseInt(mStr ?? "0", 10);
  return Math.max(0, Math.min(23, h)) * 60 + Math.max(0, Math.min(59, m));
}

/**
 * Evaluates whether `now` falls inside the user's configured quiet hours window
 * in their IANA timezone, properly handling midnight wrap-around (e.g. 22:00 -> 07:00).
 */
export function isWithinQuietHours(
  now: Date,
  startHHMM: string,
  endHHMM: string,
  timeZone: string,
): boolean {
  let localMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const hourPart = Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const minPart = Number.parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
    localMinutes = (hourPart % 24) * 60 + minPart;
  } catch {
    // Fallback to UTC if an invalid IANA zone is ever provided
  }

  const start = parseHHMMToMinutes(startHHMM);
  const end = parseHHMMToMinutes(endHHMM);

  if (start === end) {
    return false;
  }
  if (start < end) {
    return localMinutes >= start && localMinutes < end;
  }
  // Wraps across midnight (e.g. 22:00 to 07:00)
  return localMinutes >= start || localMinutes < end;
}

export async function getNotificationPreferences(
  session: AuthenticatedSessionContext | null,
  workspaceId?: string,
): Promise<NotificationPreferenceRecord> {
  assertServerRuntime("getNotificationPreferences");
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId: workspaceId ?? session?.activeWorkspace.id ?? "",
    requiredPermission: "workspace:read",
  });
  const actorUserId = session?.user.id ?? "";

  const existing = await dbQuery<{
    id: string;
    workspace_id: string;
    user_id: string;
    email_enabled: boolean;
    in_app_enabled: boolean;
    enabled_categories: AlertCategory[];
    quiet_hours_enabled: boolean;
    quiet_hours_start: string;
    quiet_hours_end: string;
    quiet_hours_timezone: string;
    quiet_hours_policy: QuietHoursPolicy;
    updated_at: Date;
  }>(
    `SELECT *
     FROM notification_preferences
     WHERE workspace_id = $1 AND user_id = $2
     LIMIT 1`,
    [access.workspaceId, actorUserId],
  );

  if (existing.rows[0]) {
    const r = existing.rows[0];
    return {
      id: r.id,
      workspaceId: r.workspace_id,
      userId: r.user_id,
      emailEnabled: r.email_enabled,
      inAppEnabled: r.in_app_enabled,
      enabledCategories: r.enabled_categories,
      quietHoursEnabled: r.quiet_hours_enabled,
      quietHoursStart: r.quiet_hours_start,
      quietHoursEnd: r.quiet_hours_end,
      quietHoursTimezone: r.quiet_hours_timezone,
      quietHoursPolicy: r.quiet_hours_policy,
      updatedAtIso: new Date(r.updated_at).toISOString(),
    };
  }

  const id = generateId("npref");
  const inserted = await dbQuery<{
    id: string;
    workspace_id: string;
    user_id: string;
    email_enabled: boolean;
    in_app_enabled: boolean;
    enabled_categories: AlertCategory[];
    quiet_hours_enabled: boolean;
    quiet_hours_start: string;
    quiet_hours_end: string;
    quiet_hours_timezone: string;
    quiet_hours_policy: QuietHoursPolicy;
    updated_at: Date;
  }>(
    `INSERT INTO notification_preferences (
       id, organization_id, workspace_id, user_id
     ) VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [id, access.organizationId, access.workspaceId, actorUserId],
  );
  const r = inserted.rows[0];
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    userId: r.user_id,
    emailEnabled: r.email_enabled,
    inAppEnabled: r.in_app_enabled,
    enabledCategories: r.enabled_categories,
    quietHoursEnabled: r.quiet_hours_enabled,
    quietHoursStart: r.quiet_hours_start,
    quietHoursEnd: r.quiet_hours_end,
    quietHoursTimezone: r.quiet_hours_timezone,
    quietHoursPolicy: r.quiet_hours_policy,
    updatedAtIso: new Date(r.updated_at).toISOString(),
  };
}

export async function updateNotificationPreferences(
  session: AuthenticatedSessionContext | null,
  input: z.input<typeof updateNotificationPreferencesSchema>,
): Promise<NotificationPreferenceRecord> {
  assertServerRuntime("updateNotificationPreferences");
  const parsed = updateNotificationPreferencesSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: parsed.error.issues[0]?.message ?? "Invalid notification preference settings.",
    });
  }

  const current = await getNotificationPreferences(session, parsed.data.workspaceId);
  const updated = await dbQuery<{
    id: string;
    workspace_id: string;
    user_id: string;
    email_enabled: boolean;
    in_app_enabled: boolean;
    enabled_categories: AlertCategory[];
    quiet_hours_enabled: boolean;
    quiet_hours_start: string;
    quiet_hours_end: string;
    quiet_hours_timezone: string;
    quiet_hours_policy: QuietHoursPolicy;
    updated_at: Date;
  }>(
    `UPDATE notification_preferences
     SET email_enabled = $2,
         in_app_enabled = $3,
         enabled_categories = $4::text[],
         quiet_hours_enabled = $5,
         quiet_hours_start = $6,
         quiet_hours_end = $7,
         quiet_hours_timezone = $8,
         quiet_hours_policy = $9,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      current.id,
      parsed.data.emailEnabled ?? current.emailEnabled,
      parsed.data.inAppEnabled ?? current.inAppEnabled,
      parsed.data.enabledCategories ?? [...current.enabledCategories],
      parsed.data.quietHoursEnabled ?? current.quietHoursEnabled,
      parsed.data.quietHoursStart ?? current.quietHoursStart,
      parsed.data.quietHoursEnd ?? current.quietHoursEnd,
      parsed.data.quietHoursTimezone ?? current.quietHoursTimezone,
      parsed.data.quietHoursPolicy ?? current.quietHoursPolicy,
    ],
  );
  const r = updated.rows[0];
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    userId: r.user_id,
    emailEnabled: r.email_enabled,
    inAppEnabled: r.in_app_enabled,
    enabledCategories: r.enabled_categories,
    quietHoursEnabled: r.quiet_hours_enabled,
    quietHoursStart: r.quiet_hours_start,
    quietHoursEnd: r.quiet_hours_end,
    quietHoursTimezone: r.quiet_hours_timezone,
    quietHoursPolicy: r.quiet_hours_policy,
    updatedAtIso: new Date(r.updated_at).toISOString(),
  };
}

export async function createAlertRule(
  session: AuthenticatedSessionContext | null,
  input: z.input<typeof createAlertRuleSchema>,
): Promise<AlertRuleRecord> {
  assertServerRuntime("createAlertRule");
  const parsed = createAlertRuleSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: parsed.error.issues[0]?.message ?? "Invalid alert rule payload.",
    });
  }

  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId: parsed.data.workspaceId ?? session?.activeWorkspace.id ?? "",
    requiredPermission: "project:update",
  });

  const id = generateId("alr");
  const res = await dbQuery<{
    id: string;
    organization_id: string;
    workspace_id: string;
    project_id: string | null;
    connected_resource_id: string | null;
    name: string;
    category: AlertCategory;
    metric_key: string | null;
    operator: AlertOperator;
    threshold_value: string | null;
    unit: string | null;
    currency: string | null;
    evaluation_window_minutes: number;
    freshness_required_minutes: number;
    severity: AlertSeverity;
    is_enabled: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    `INSERT INTO alert_rules (
       id, organization_id, workspace_id, project_id, connected_resource_id, name,
       category, metric_key, operator, threshold_value, unit, currency,
       evaluation_window_minutes, freshness_required_minutes, severity, is_enabled, created_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING *`,
    [
      id,
      access.organizationId,
      access.workspaceId,
      parsed.data.projectId ?? null,
      parsed.data.connectedResourceId ?? null,
      parsed.data.name,
      parsed.data.category,
      parsed.data.metricKey ?? null,
      parsed.data.operator,
      parsed.data.thresholdValue ?? null,
      parsed.data.unit ?? null,
      parsed.data.currency ?? null,
      parsed.data.evaluationWindowMinutes,
      parsed.data.freshnessRequiredMinutes,
      parsed.data.severity,
      parsed.data.isEnabled,
      session?.user.id ?? null,
    ],
  );

  const r = res.rows[0];
  return {
    id: r.id,
    organizationId: r.organization_id,
    workspaceId: r.workspace_id,
    projectId: r.project_id,
    connectedResourceId: r.connected_resource_id,
    name: r.name,
    category: r.category,
    metricKey: r.metric_key,
    operator: r.operator,
    thresholdValue: r.threshold_value !== null ? Number(r.threshold_value) : null,
    unit: r.unit,
    currency: r.currency,
    evaluationWindowMinutes: r.evaluation_window_minutes,
    freshnessRequiredMinutes: r.freshness_required_minutes,
    severity: r.severity,
    isEnabled: r.is_enabled,
    createdAtIso: new Date(r.created_at).toISOString(),
    updatedAtIso: new Date(r.updated_at).toISOString(),
  };
}

export async function listWorkspaceAlertsAndNotifications(
  session: AuthenticatedSessionContext | null,
  workspaceId?: string,
): Promise<{
  rules: AlertRuleRecord[];
  incidents: AlertIncidentRecord[];
  notifications: InAppNotificationRecord[];
  deliveries: NotificationDeliveryRecord[];
  preferences: NotificationPreferenceRecord;
}> {
  assertServerRuntime("listWorkspaceAlertsAndNotifications");
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId: workspaceId ?? session?.activeWorkspace.id ?? "",
    requiredPermission: "workspace:read",
  });
  const actorUserId = session?.user.id ?? "";

  const [rulesRes, incRes, notifRes, delivRes, preferences] = await Promise.all([
    dbQuery<{
      id: string;
      organization_id: string;
      workspace_id: string;
      project_id: string | null;
      connected_resource_id: string | null;
      name: string;
      category: AlertCategory;
      metric_key: string | null;
      operator: AlertOperator;
      threshold_value: string | null;
      unit: string | null;
      currency: string | null;
      evaluation_window_minutes: number;
      freshness_required_minutes: number;
      severity: AlertSeverity;
      is_enabled: boolean;
      created_at: Date;
      updated_at: Date;
    }>(`SELECT * FROM alert_rules WHERE workspace_id = $1 ORDER BY created_at DESC`, [
      access.workspaceId,
    ]),
    dbQuery<{
      id: string;
      workspace_id: string;
      project_id: string | null;
      connected_resource_id: string | null;
      alert_rule_id: string | null;
      category: AlertCategory;
      severity: AlertSeverity;
      status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
      dedupe_key: string;
      title: string;
      summary: string;
      observed_value: string | null;
      threshold_value: string | null;
      unit: string | null;
      currency: string | null;
      first_triggered_at: Date;
      last_evaluated_at: Date;
      resolved_at: Date | null;
    }>(
      `SELECT * FROM alert_incidents WHERE workspace_id = $1 ORDER BY last_evaluated_at DESC LIMIT 50`,
      [access.workspaceId],
    ),
    dbQuery<{
      id: string;
      workspace_id: string;
      user_id: string;
      incident_id: string | null;
      category: string;
      severity: AlertSeverity;
      title: string;
      body: string;
      action_url: string | null;
      is_read: boolean;
      read_at: Date | null;
      created_at: Date;
    }>(
      `SELECT * FROM in_app_notifications WHERE workspace_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 50`,
      [access.workspaceId, actorUserId],
    ),
    dbQuery<{
      id: string;
      incident_id: string;
      user_id: string;
      channel: "IN_APP" | "EMAIL";
      recipient_address: string | null;
      status: NotificationDeliveryRecord["status"];
      attempt_count: number;
      provider_name: string;
      provider_message_id: string | null;
      error_summary: string | null;
      next_retry_at: Date | null;
      updated_at: Date;
    }>(
      `SELECT * FROM notification_deliveries WHERE workspace_id = $1 AND user_id = $2 ORDER BY updated_at DESC LIMIT 50`,
      [access.workspaceId, actorUserId],
    ),
    getNotificationPreferences(session, access.workspaceId),
  ]);

  return {
    rules: rulesRes.rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      workspaceId: r.workspace_id,
      projectId: r.project_id,
      connectedResourceId: r.connected_resource_id,
      name: r.name,
      category: r.category,
      metricKey: r.metric_key,
      operator: r.operator,
      thresholdValue: r.threshold_value !== null ? Number(r.threshold_value) : null,
      unit: r.unit,
      currency: r.currency,
      evaluationWindowMinutes: r.evaluation_window_minutes,
      freshnessRequiredMinutes: r.freshness_required_minutes,
      severity: r.severity,
      isEnabled: r.is_enabled,
      createdAtIso: new Date(r.created_at).toISOString(),
      updatedAtIso: new Date(r.updated_at).toISOString(),
    })),
    incidents: incRes.rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      projectId: r.project_id,
      connectedResourceId: r.connected_resource_id,
      alertRuleId: r.alert_rule_id,
      category: r.category,
      severity: r.severity,
      status: r.status,
      dedupeKey: r.dedupe_key,
      title: r.title,
      summary: r.summary,
      observedValue: r.observed_value !== null ? Number(r.observed_value) : null,
      thresholdValue: r.threshold_value !== null ? Number(r.threshold_value) : null,
      unit: r.unit,
      currency: r.currency,
      firstTriggeredAtIso: new Date(r.first_triggered_at).toISOString(),
      lastEvaluatedAtIso: new Date(r.last_evaluated_at).toISOString(),
      resolvedAtIso: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
    })),
    notifications: notifRes.rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      userId: r.user_id,
      incidentId: r.incident_id,
      category: r.category,
      severity: r.severity,
      title: r.title,
      body: r.body,
      actionUrl: r.action_url,
      isRead: r.is_read,
      readAtIso: r.read_at ? new Date(r.read_at).toISOString() : null,
      createdAtIso: new Date(r.created_at).toISOString(),
    })),
    deliveries: delivRes.rows.map((r) => ({
      id: r.id,
      incidentId: r.incident_id,
      userId: r.user_id,
      channel: r.channel,
      recipientAddress: r.recipient_address,
      status: r.status,
      attemptCount: r.attempt_count,
      providerName: r.provider_name,
      providerMessageId: r.provider_message_id,
      errorSummary: r.error_summary,
      nextRetryAtIso: r.next_retry_at ? new Date(r.next_retry_at).toISOString() : null,
      updatedAtIso: new Date(r.updated_at).toISOString(),
    })),
    preferences,
  };
}

interface CandidateAlertBreach {
  alertRuleId: string | null;
  projectId: string | null;
  connectedResourceId: string | null;
  category: AlertCategory;
  severity: AlertSeverity;
  dedupeKey: string;
  title: string;
  summary: string;
  observedValue: number | null;
  thresholdValue: number | null;
  unit: string | null;
  currency: string | null;
  actionUrl: string;
  projectName: string;
  freshnessNote: string;
}

function compareMetricThreshold(
  observed: number,
  operator: AlertOperator,
  threshold: number,
): boolean {
  switch (operator) {
    case "GT":
      return observed > threshold;
    case "GTE":
      return observed >= threshold;
    case "LT":
      return observed < threshold;
    case "LTE":
      return observed <= threshold;
    default:
      return false;
  }
}

/**
 * Evaluates workspace alert conditions (connection failures, stale data, KPI thresholds,
 * and cloud spending thresholds) idempotently using database-enforced deduplication,
 * then dispatches in-app and email notifications according to each authorized member's
 * persisted notification preferences and quiet-hour policy.
 */
export async function evaluateAndDispatchWorkspaceAlerts(
  session: AuthenticatedSessionContext | null,
  options?: {
    workspaceId?: string;
    now?: Date;
    emailTransport?: EmailTransportAdapter;
  },
): Promise<{
  incidentsTriggered: number;
  incidentsDeduplicated: number;
  inAppNotificationsCreated: number;
  emailDeliveriesAttempted: number;
  emailDeliveriesFailed: number;
  emailDeliveriesSuppressedOrDeferred: number;
}> {
  assertServerRuntime("evaluateAndDispatchWorkspaceAlerts");
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId: options?.workspaceId ?? session?.activeWorkspace.id ?? "",
    requiredPermission: "workspace:read",
  });

  const now = options?.now ?? new Date();
  const emailTransport = options?.emailTransport ?? createDefaultEmailTransport();
  const candidates: CandidateAlertBreach[] = [];

  // 1. Provider Connection Failure checks (expired/revoked/missing permissions)
  const failedConns = await dbQuery<{
    id: string;
    provider_key: string;
    display_name: string;
    status: string;
    last_error_summary: string | null;
  }>(
    `SELECT id, provider_key, display_name, status, last_error_summary
     FROM provider_connections
     WHERE workspace_id = $1
       AND status IN ('REVOKED', 'TOKEN_EXPIRED', 'PERMISSION_MISSING', 'FAILED')`,
    [access.workspaceId],
  );

  for (const conn of failedConns.rows) {
    candidates.push({
      alertRuleId: null,
      projectId: null,
      connectedResourceId: null,
      category: "PROVIDER_CONNECTION_FAILURE",
      severity: conn.status === "REVOKED" ? "CRITICAL" : "WARNING",
      dedupeKey: `conn_fail:${conn.id}:${conn.status}`,
      title: `Connection needs attention: ${conn.display_name}`,
      summary:
        conn.last_error_summary ??
        `Read-only connection (${conn.provider_key}) is in state ${conn.status}. Re-authorization is required to resume telemetry collection.`,
      observedValue: null,
      thresholdValue: null,
      unit: null,
      currency: null,
      actionUrl: "/connections",
      projectName: "Workspace Connections",
      freshnessNote: `Connection status: ${conn.status}`,
    });
  }

  // 2. Enabled custom rules (STALE_DATA, KPI_THRESHOLD, CLOUD_SPENDING_THRESHOLD)
  const rulesRes = await dbQuery<{
    id: string;
    project_id: string | null;
    connected_resource_id: string | null;
    name: string;
    category: AlertCategory;
    metric_key: string | null;
    operator: AlertOperator;
    threshold_value: string | null;
    unit: string | null;
    currency: string | null;
    freshness_required_minutes: number;
    severity: AlertSeverity;
  }>(
    `SELECT id, project_id, connected_resource_id, name, category, metric_key, operator,
            threshold_value, unit, currency, freshness_required_minutes, severity
     FROM alert_rules
     WHERE workspace_id = $1 AND is_enabled = true`,
    [access.workspaceId],
  );

  for (const rule of rulesRes.rows) {
    if (rule.category === "STALE_DATA") {
      const staleConns = await dbQuery<{
        id: string;
        display_name: string;
        provider_key: string;
        last_sync_at: Date | null;
      }>(
        `SELECT id, display_name, provider_key, last_sync_at
         FROM provider_connections
         WHERE workspace_id = $1
           AND status = 'HEALTHY'
           AND (last_sync_at IS NULL OR last_sync_at < $2::timestamptz)`,
        [
          access.workspaceId,
          new Date(now.getTime() - rule.freshness_required_minutes * 60_000).toISOString(),
        ],
      );

      for (const sc of staleConns.rows) {
        const ageMinutes = sc.last_sync_at
          ? Math.round((now.getTime() - new Date(sc.last_sync_at).getTime()) / 60_000)
          : null;
        candidates.push({
          alertRuleId: rule.id,
          projectId: rule.project_id,
          connectedResourceId: rule.connected_resource_id,
          category: "STALE_DATA",
          severity: rule.severity,
          dedupeKey: `stale:${rule.id}:${sc.id}`,
          title: `Source synchronization delayed: ${sc.display_name}`,
          summary:
            ageMinutes !== null
              ? `${sc.display_name} (${sc.provider_key}) last synchronized ${ageMinutes} minutes ago, exceeding the ${rule.freshness_required_minutes}-minute freshness policy.`
              : `${sc.display_name} (${sc.provider_key}) has not completed an initial synchronization yet.`,
          observedValue: ageMinutes,
          thresholdValue: rule.freshness_required_minutes,
          unit: "minutes",
          currency: null,
          actionUrl: rule.project_id ? `/projects/${rule.project_id}` : "/connections",
          projectName: rule.name,
          freshnessNote:
            ageMinutes !== null ? `Last sync ${ageMinutes}m ago` : "Awaiting first sync",
        });
      }
    }

    if (rule.category === "KPI_THRESHOLD" && rule.metric_key && rule.threshold_value !== null) {
      const thresholdNum = Number(rule.threshold_value);
      const obsRes = await dbQuery<{
        numeric_value: string | null;
        period_start_date: string;
        unit: string;
      }>(
        `SELECT numeric_value, period_start_date, unit
         FROM metric_observations
         WHERE workspace_id = $1
           AND ($2::text IS NULL OR project_id = $2)
           AND canonical_metric_key = $3
           AND numeric_value IS NOT NULL
         ORDER BY period_start_date DESC, collected_at DESC
         LIMIT 1`,
        [access.workspaceId, rule.project_id, rule.metric_key],
      );

      const latest = obsRes.rows[0];
      // Evidence principle: never fire a threshold alert on missing data!
      if (latest && latest.numeric_value !== null) {
        const observedNum = Number(latest.numeric_value);
        if (compareMetricThreshold(observedNum, rule.operator, thresholdNum)) {
          candidates.push({
            alertRuleId: rule.id,
            projectId: rule.project_id,
            connectedResourceId: rule.connected_resource_id,
            category: "KPI_THRESHOLD",
            severity: rule.severity,
            dedupeKey: `kpi:${rule.id}:${latest.period_start_date}`,
            title: `KPI threshold crossed: ${rule.name}`,
            summary: `Metric ${rule.metric_key} recorded ${observedNum} ${rule.unit ?? latest.unit} on ${latest.period_start_date} (threshold ${rule.operator} ${thresholdNum}).`,
            observedValue: observedNum,
            thresholdValue: thresholdNum,
            unit: rule.unit ?? latest.unit,
            currency: null,
            actionUrl: rule.project_id ? `/projects/${rule.project_id}` : "/dashboard",
            projectName: rule.name,
            freshnessNote: `Observed period ${latest.period_start_date}`,
          });
        }
      }
    }
  }

  // 3. Reuse Milestone 05 Cloud Spending Threshold breaches
  const costBreaches = await dbQuery<{
    id: string;
    threshold_id: string;
    project_id: string | null;
    period_key: string;
    severity: "WARNING" | "CRITICAL";
    observed_amount: string | null;
    threshold_amount: string;
    currency: string;
    summary: string;
  }>(
    `SELECT id, threshold_id, project_id, period_key, severity, observed_amount, threshold_amount, currency, summary
     FROM cost_threshold_evaluations
     WHERE workspace_id = $1
       AND alert_triggered = true
       AND severity IN ('WARNING', 'CRITICAL')
     ORDER BY evaluated_at DESC
     LIMIT 20`,
    [access.workspaceId],
  );

  for (const cb of costBreaches.rows) {
    candidates.push({
      alertRuleId: null,
      projectId: cb.project_id,
      connectedResourceId: null,
      category: "CLOUD_SPENDING_THRESHOLD",
      severity: cb.severity,
      dedupeKey: `cost_breach:${cb.threshold_id}:${cb.period_key}:${cb.severity}`,
      title: `Cloud spending threshold exceeded (${cb.currency} ${Number(cb.threshold_amount).toFixed(2)})`,
      summary: cb.summary,
      observedValue: cb.observed_amount !== null ? Number(cb.observed_amount) : null,
      thresholdValue: Number(cb.threshold_amount),
      unit: cb.currency,
      currency: cb.currency,
      actionUrl: cb.project_id ? `/projects/${cb.project_id}/cost` : "/costs",
      projectName: "Cloud Cost Intelligence",
      freshnessNote: `Billing period ${cb.period_key}`,
    });
  }

  // Load workspace member recipients (strictly tenant-scoped, bounded to workspace members)
  const recipientsRes = await dbQuery<{ user_id: string; email: string }>(
    `SELECT wm.user_id, u.email
     FROM workspace_memberships wm
     INNER JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = $1
     LIMIT 50`,
    [access.workspaceId],
  );

  let incidentsTriggered = 0;
  let incidentsDeduplicated = 0;
  let inAppNotificationsCreated = 0;
  let emailDeliveriesAttempted = 0;
  let emailDeliveriesFailed = 0;
  let emailDeliveriesSuppressedOrDeferred = 0;

  for (const breach of candidates) {
    // Idempotent incident upsert by (workspace_id, dedupe_key)
    const existingInc = await dbQuery<{ id: string }>(
      `SELECT id FROM alert_incidents WHERE workspace_id = $1 AND dedupe_key = $2 LIMIT 1`,
      [access.workspaceId, breach.dedupeKey],
    );

    let incidentId: string;
    if (existingInc.rows[0]) {
      incidentId = existingInc.rows[0].id;
      incidentsDeduplicated += 1;
      await dbQuery(
        `UPDATE alert_incidents
         SET last_evaluated_at = $2::timestamptz, updated_at = now()
         WHERE id = $1`,
        [incidentId, now.toISOString()],
      );
    } else {
      incidentId = generateId("ainc");
      incidentsTriggered += 1;
      await dbQuery(
        `INSERT INTO alert_incidents (
           id, organization_id, workspace_id, project_id, connected_resource_id, alert_rule_id,
           category, severity, status, dedupe_key, title, summary, observed_value, threshold_value,
           unit, currency, first_triggered_at, last_evaluated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'OPEN', $9, $10, $11, $12, $13, $14, $15, $16::timestamptz, $16::timestamptz)
         ON CONFLICT (workspace_id, dedupe_key) DO UPDATE SET last_evaluated_at = EXCLUDED.last_evaluated_at`,
        [
          incidentId,
          access.organizationId,
          access.workspaceId,
          breach.projectId,
          breach.connectedResourceId,
          breach.alertRuleId,
          breach.category,
          breach.severity,
          breach.dedupeKey,
          breach.title,
          breach.summary,
          breach.observedValue,
          breach.thresholdValue,
          breach.unit,
          breach.currency,
          now.toISOString(),
        ],
      );
    }

    // Fanout strictly to workspace members according to their persisted preferences
    for (const recipient of recipientsRes.rows) {
      const prefRes = await dbQuery<{
        email_enabled: boolean;
        in_app_enabled: boolean;
        enabled_categories: AlertCategory[];
        quiet_hours_enabled: boolean;
        quiet_hours_start: string;
        quiet_hours_end: string;
        quiet_hours_timezone: string;
        quiet_hours_policy: QuietHoursPolicy;
      }>(
        `SELECT email_enabled, in_app_enabled, enabled_categories, quiet_hours_enabled,
                quiet_hours_start, quiet_hours_end, quiet_hours_timezone, quiet_hours_policy
         FROM notification_preferences
         WHERE workspace_id = $1 AND user_id = $2
         LIMIT 1`,
        [access.workspaceId, recipient.user_id],
      );

      const pref = prefRes.rows[0] ?? {
        email_enabled: true,
        in_app_enabled: true,
        enabled_categories: [...ALERT_CATEGORIES],
        quiet_hours_enabled: false,
        quiet_hours_start: "22:00",
        quiet_hours_end: "07:00",
        quiet_hours_timezone: "UTC",
        quiet_hours_policy: "IN_APP_ONLY" as QuietHoursPolicy,
      };

      const categoryEnabled = pref.enabled_categories.includes(breach.category);

      // In-App Notification (idempotent by workspace_id + user_id + incident_id; persists even if email fails)
      if (categoryEnabled && pref.in_app_enabled) {
        const insNotif = await dbQuery<{ id: string }>(
          `INSERT INTO in_app_notifications (
             id, organization_id, workspace_id, user_id, incident_id, category, severity, title, body, action_url
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (workspace_id, user_id, incident_id) DO NOTHING
           RETURNING id`,
          [
            generateId("ntf"),
            access.organizationId,
            access.workspaceId,
            recipient.user_id,
            incidentId,
            breach.category,
            breach.severity,
            breach.title,
            breach.summary,
            breach.actionUrl,
          ],
        );
        if (insNotif.rows.length > 0) {
          inAppNotificationsCreated += 1;
        }
      }

      // Check if an email delivery record already exists for this (workspace, incident, user, EMAIL)
      const existingEmailDeliv = await dbQuery<{ id: string }>(
        `SELECT id
         FROM notification_deliveries
         WHERE workspace_id = $1 AND incident_id = $2 AND user_id = $3 AND channel = 'EMAIL'
         LIMIT 1`,
        [access.workspaceId, incidentId, recipient.user_id],
      );

      if (existingEmailDeliv.rows.length > 0) {
        continue; // Already processed for this unchanged incident — never spam!
      }

      if (!categoryEnabled || !pref.email_enabled) {
        emailDeliveriesSuppressedOrDeferred += 1;
        await dbQuery(
          `INSERT INTO notification_deliveries (
             id, organization_id, workspace_id, user_id, incident_id, channel, recipient_address,
             status, attempt_count, provider_name
           ) VALUES ($1, $2, $3, $4, $5, 'EMAIL', $6, 'SUPPRESSED_PREFERENCE', 0, 'avenor_policy')
           ON CONFLICT (workspace_id, incident_id, user_id, channel) DO NOTHING`,
          [
            generateId("ndel"),
            access.organizationId,
            access.workspaceId,
            recipient.user_id,
            incidentId,
            recipient.email,
          ],
        );
        continue;
      }

      const inQuietHours =
        pref.quiet_hours_enabled &&
        isWithinQuietHours(
          now,
          pref.quiet_hours_start,
          pref.quiet_hours_end,
          pref.quiet_hours_timezone,
        );

      if (inQuietHours && pref.quiet_hours_policy !== "DISABLED") {
        emailDeliveriesSuppressedOrDeferred += 1;
        const quietStatus =
          pref.quiet_hours_policy === "DEFER" ? "DEFERRED_QUIET_HOURS" : "SUPPRESSED_PREFERENCE";
        await dbQuery(
          `INSERT INTO notification_deliveries (
             id, organization_id, workspace_id, user_id, incident_id, channel, recipient_address,
             status, attempt_count, provider_name, error_summary
           ) VALUES ($1, $2, $3, $4, $5, 'EMAIL', $6, $7, 0, 'avenor_quiet_hours', $8)
           ON CONFLICT (workspace_id, incident_id, user_id, channel) DO NOTHING`,
          [
            generateId("ndel"),
            access.organizationId,
            access.workspaceId,
            recipient.user_id,
            incidentId,
            recipient.email,
            quietStatus,
            `Held by quiet-hours policy (${pref.quiet_hours_policy}) in ${pref.quiet_hours_timezone}.`,
          ],
        );
        continue;
      }

      emailDeliveriesAttempted += 1;
      const sendRes = await emailTransport.sendAlertEmail({
        toEmail: recipient.email,
        projectName: breach.projectName,
        categoryLabel: breach.category,
        severity: breach.severity,
        title: breach.title,
        summary: breach.summary,
        observedSummary:
          breach.observedValue !== null
            ? `${breach.observedValue}${breach.unit ? ` ${breach.unit}` : ""}`
            : null,
        freshnessNote: breach.freshnessNote,
        actionPath: breach.actionUrl,
        preferencesPath: "/alerts",
      });

      if (sendRes.status === "FAILED") {
        emailDeliveriesFailed += 1;
      }

      const nextRetryAtIso =
        sendRes.status === "FAILED" ? new Date(now.getTime() + 15 * 60_000).toISOString() : null;

      await dbQuery(
        `INSERT INTO notification_deliveries (
           id, organization_id, workspace_id, user_id, incident_id, channel, recipient_address,
           status, attempt_count, provider_name, provider_message_id, error_summary, next_retry_at
         ) VALUES ($1, $2, $3, $4, $5, 'EMAIL', $6, $7, 1, $8, $9, $10, $11::timestamptz)
         ON CONFLICT (workspace_id, incident_id, user_id, channel) DO NOTHING`,
        [
          generateId("ndel"),
          access.organizationId,
          access.workspaceId,
          recipient.user_id,
          incidentId,
          recipient.email,
          sendRes.status,
          sendRes.providerName,
          sendRes.providerMessageId,
          sendRes.errorSummary,
          nextRetryAtIso,
        ],
      );
    }
  }

  return {
    incidentsTriggered,
    incidentsDeduplicated,
    inAppNotificationsCreated,
    emailDeliveriesAttempted,
    emailDeliveriesFailed,
    emailDeliveriesSuppressedOrDeferred,
  };
}

export async function retryFailedEmailDeliveries(
  session: AuthenticatedSessionContext | null,
  options?: {
    workspaceId?: string;
    emailTransport?: EmailTransportAdapter;
    maxAttempts?: number;
  },
): Promise<{ retried: number; succeeded: number; stillFailed: number }> {
  assertServerRuntime("retryFailedEmailDeliveries");
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId: options?.workspaceId ?? session?.activeWorkspace.id ?? "",
    requiredPermission: "workspace:read",
  });
  const maxAttempts = options?.maxAttempts ?? 3;
  const emailTransport = options?.emailTransport ?? createDefaultEmailTransport();

  const failedRows = await dbQuery<{
    id: string;
    incident_id: string;
    recipient_address: string | null;
    attempt_count: number;
    title: string;
    summary: string;
    category: AlertCategory;
    severity: AlertSeverity;
  }>(
    `SELECT nd.id, nd.incident_id, nd.recipient_address, nd.attempt_count,
            ai.title, ai.summary, ai.category, ai.severity
     FROM notification_deliveries nd
     INNER JOIN alert_incidents ai ON ai.id = nd.incident_id
     WHERE nd.workspace_id = $1
       AND nd.channel = 'EMAIL'
       AND nd.status = 'FAILED'
       AND nd.attempt_count < $2`,
    [access.workspaceId, maxAttempts],
  );

  let retried = 0;
  let succeeded = 0;
  let stillFailed = 0;

  for (const row of failedRows.rows) {
    if (!row.recipient_address) continue;
    retried += 1;
    const res = await emailTransport.sendAlertEmail({
      toEmail: row.recipient_address,
      projectName: "Avenor Workspace",
      categoryLabel: row.category,
      severity: row.severity,
      title: row.title,
      summary: row.summary,
      observedSummary: null,
      freshnessNote: `Bounded retry attempt #${row.attempt_count + 1}`,
      actionPath: "/alerts",
      preferencesPath: "/alerts",
    });

    if (res.status === "ACCEPTED") {
      succeeded += 1;
    } else {
      stillFailed += 1;
    }

    await dbQuery(
      `UPDATE notification_deliveries
       SET status = $2,
           attempt_count = attempt_count + 1,
           provider_name = $3,
           provider_message_id = COALESCE($4, provider_message_id),
           error_summary = $5,
           next_retry_at = CASE WHEN $2 = 'FAILED' THEN now() + interval '30 minutes' ELSE NULL END,
           updated_at = now()
       WHERE id = $1`,
      [row.id, res.status, res.providerName, res.providerMessageId, res.errorSummary],
    );
  }

  return { retried, succeeded, stillFailed };
}

export async function markInAppNotificationRead(
  session: AuthenticatedSessionContext | null,
  notificationId: string,
  workspaceId?: string,
): Promise<{ id: string; isRead: boolean }> {
  assertServerRuntime("markInAppNotificationRead");
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId: workspaceId ?? session?.activeWorkspace.id ?? "",
    requiredPermission: "workspace:read",
  });
  const actorUserId = session?.user.id ?? "";

  const res = await dbQuery<{ id: string }>(
    `UPDATE in_app_notifications
     SET is_read = true, read_at = COALESCE(read_at, now())
     WHERE id = $1 AND workspace_id = $2 AND user_id = $3
     RETURNING id`,
    [notificationId, access.workspaceId, actorUserId],
  );
  if (res.rows.length === 0) {
    throw new AppError({
      code: ERROR_CODES.NOT_FOUND,
      message: "Notification was not found in this workspace.",
    });
  }
  return { id: notificationId, isRead: true };
}
