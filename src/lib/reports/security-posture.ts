import {
  type AuthenticatedSessionContext,
  authorizeProjectAccess,
  getLogicalProjectById,
} from "@avenor/auth";
import { assertServerRuntime } from "@avenor/config";
import { dbQuery, generateId } from "@avenor/database";
import { redactSensitiveText } from "@avenor/types";

export const PASSIVE_SECURITY_POSTURE_STATUSES = [
  "CONFIGURED",
  "NOT_CONFIGURED",
  "WARNING",
  "UNKNOWN",
  "NOT_VERIFIED",
  "UNAVAILABLE",
  "INSUFFICIENT_PERMISSION",
] as const;

export type PassiveSecurityPostureStatus = (typeof PASSIVE_SECURITY_POSTURE_STATUSES)[number];

export type SecurityPostureCategory =
  | "ENCRYPTION_AND_TRANSPORT"
  | "ACCESS_AND_NETWORK"
  | "AUTHENTICATION_POSTURE"
  | "DATA_PROTECTION_AND_RLS"
  | "RULES_AND_POLICY_TELEMETRY"
  | "AUDIT_AND_OPERATIONS";

export interface PassiveSecurityPostureIndicator {
  id: string;
  providerKey: "neon" | "supabase" | "firebase-monitoring";
  connectedResourceId: string;
  resourceDisplayName: string;
  indicatorKey: string;
  category: SecurityPostureCategory;
  title: string;
  status: PassiveSecurityPostureStatus;
  summary: string;
  qualificationNote: string;
  sanitizedEvidence: Record<string, string | number | boolean | null>;
  observedAtIso: string;
}

export interface SanitizedAuditSummaryItem {
  id: string;
  action: string;
  resourceType: string;
  summary: string;
  actorRole: string;
  createdAtIso: string;
}

export interface ProjectSecurityPostureReportDto {
  projectId: string;
  projectName: string;
  observedAtIso: string;
  disclaimer: string;
  countsByStatus: Readonly<Record<PassiveSecurityPostureStatus, number>>;
  indicators: readonly PassiveSecurityPostureIndicator[];
  recentAuditSummaries: readonly SanitizedAuditSummaryItem[];
}

export const PASSIVE_POSTURE_DISCLAIMER =
  "Passive, read-only metadata observation only — not a certified penetration test, vulnerability scan, or formal compliance attestation. Avenor never mutates external policies, rules, or access controls.";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g;
const PROVIDER_TOKEN_RE = /\b(?:napi|sbp|sb_secret|ya29|ghp|gho|sk_live)_[A-Za-z0-9._-]{4,}\b/gi;
const POSTGRES_URI_RE = /postgres(?:ql)?:\/\/[^\s"'`]+/gi;

/**
 * Redacts PII (emails, IPs) and secrets (JWTs, provider tokens, Postgres URIs)
 * from passive audit summaries and posture evidence text.
 */
export function sanitizePostureAuditText(raw: string): string {
  const categorized = raw
    .replace(POSTGRES_URI_RE, "[REDACTED_DB_URI]")
    .replace(JWT_RE, "[REDACTED_JWT]")
    .replace(PROVIDER_TOKEN_RE, "[REDACTED_TOKEN]")
    .replace(EMAIL_RE, "[REDACTED_EMAIL]")
    .replace(IPV4_RE, "[REDACTED_IP]");
  return redactSensitiveText(categorized);
}

const SENSITIVE_EVIDENCE_KEY_RE =
  /(email|phone|password|secret|token|key|uri|dsn|ip_address|ipAddress|user_metadata)/i;

export function sanitizePostureEvidenceRecord(
  input: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, val] of Object.entries(input)) {
    if (SENSITIVE_EVIDENCE_KEY_RE.test(key)) {
      continue;
    }
    if (typeof val === "string") {
      out[key] = sanitizePostureAuditText(val);
    } else if (typeof val === "number" || typeof val === "boolean" || val === null) {
      out[key] = val;
    }
  }
  return out;
}

export interface PassiveResourcePostureInput {
  connectedResourceId: string;
  providerConnectionId: string;
  providerKey: "neon" | "supabase" | "firebase-monitoring";
  displayName: string;
  connectionStatus: string;
  environmentId: string | null;
  metadata: Record<string, unknown>;
  firebaseRulesCounts?: {
    allowCount: number | null;
    denyCount: number | null;
    errorCount: number | null;
  };
}

/**
 * Pure deterministic evaluator turning passive backend resource metadata into
 * transparent security posture indicators with explicit non-fabricated states.
 */
export function evaluateResourcePassiveSecurityPosture(
  resource: PassiveResourcePostureInput,
  observedAtIso: string = new Date().toISOString(),
): Omit<PassiveSecurityPostureIndicator, "id">[] {
  const indicators: Omit<PassiveSecurityPostureIndicator, "id">[] = [];
  const meta = resource.metadata ?? {};

  if (
    resource.connectionStatus === "PERMISSION_MISSING" ||
    resource.connectionStatus === "REVOKED" ||
    resource.connectionStatus === "TOKEN_EXPIRED"
  ) {
    indicators.push({
      providerKey: resource.providerKey,
      connectedResourceId: resource.connectedResourceId,
      resourceDisplayName: resource.displayName,
      indicatorKey: `${resource.providerKey}.connection_authorization`,
      category: "ACCESS_AND_NETWORK",
      title: "Read-Only Telemetry Authorization",
      status: "INSUFFICIENT_PERMISSION",
      summary: `Connection status is ${resource.connectionStatus}; passive security metadata cannot be refreshed until read-only authorization is restored.`,
      qualificationNote: "Avenor never retains stale posture as verified when scopes are revoked.",
      sanitizedEvidence: sanitizePostureEvidenceRecord({
        connectionStatus: resource.connectionStatus,
      }),
      observedAtIso,
    });
    return indicators;
  }

  if (resource.providerKey === "neon") {
    const protectedBranch = meta.protectedBranchConfigured;
    const ipAllowlist = meta.ipAllowlistConfigured;
    const historyRetention =
      typeof meta.historyRetentionSeconds === "number" ? meta.historyRetentionSeconds : null;

    indicators.push({
      providerKey: "neon",
      connectedResourceId: resource.connectedResourceId,
      resourceDisplayName: resource.displayName,
      indicatorKey: "neon.protected_branch",
      category: "DATA_PROTECTION_AND_RLS",
      title: "Protected Default Branch Posture",
      status:
        protectedBranch === true ? "CONFIGURED" : protectedBranch === false ? "WARNING" : "UNKNOWN",
      summary:
        protectedBranch === true
          ? "Primary/default Neon branch is marked protected against accidental deletion or reset."
          : protectedBranch === false
            ? "No protected Neon branch detected in control-plane metadata."
            : "Branch protection flag was not returned by Neon metadata discovery.",
      qualificationNote:
        "Observed passively via GET /api/v2/projects/{project_id}/branches; Avenor never modifies branch protection settings.",
      sanitizedEvidence: sanitizePostureEvidenceRecord({
        protectedBranchConfigured: typeof protectedBranch === "boolean" ? protectedBranch : null,
      }),
      observedAtIso,
    });

    indicators.push({
      providerKey: "neon",
      connectedResourceId: resource.connectedResourceId,
      resourceDisplayName: resource.displayName,
      indicatorKey: "neon.ip_allowlist",
      category: "ACCESS_AND_NETWORK",
      title: "Neon IP Allowlist Restriction",
      status:
        ipAllowlist === true ? "CONFIGURED" : ipAllowlist === false ? "NOT_CONFIGURED" : "UNKNOWN",
      summary:
        ipAllowlist === true
          ? "Project-level IP allowlist restrictions are enabled on the Neon project."
          : ipAllowlist === false
            ? "No IP allowlist restrictions are configured on the Neon project."
            : "IP allowlist metadata was not present in the latest discovery snapshot.",
      qualificationNote:
        "Individual CIDR blocks and IP addresses are never surfaced in Avenor posture cards.",
      sanitizedEvidence: sanitizePostureEvidenceRecord({
        ipAllowlistConfigured: typeof ipAllowlist === "boolean" ? ipAllowlist : null,
      }),
      observedAtIso,
    });

    indicators.push({
      providerKey: "neon",
      connectedResourceId: resource.connectedResourceId,
      resourceDisplayName: resource.displayName,
      indicatorKey: "neon.point_in_time_recovery_window",
      category: "DATA_PROTECTION_AND_RLS",
      title: "Point-in-Time History Retention Window",
      status:
        historyRetention === null
          ? "UNKNOWN"
          : historyRetention >= 86_400
            ? "CONFIGURED"
            : "WARNING",
      summary:
        historyRetention !== null
          ? `Neon history retention is configured for ${Math.round(historyRetention / 3600)} hours.`
          : "Neon history retention window could not be determined.",
      qualificationNote: "Passive project metadata check; does not trigger restore operations.",
      sanitizedEvidence: sanitizePostureEvidenceRecord({
        historyRetentionSeconds: historyRetention,
      }),
      observedAtIso,
    });

    indicators.push({
      providerKey: "neon",
      connectedResourceId: resource.connectedResourceId,
      resourceDisplayName: resource.displayName,
      indicatorKey: "neon.api_key_read_only_boundary",
      category: "ACCESS_AND_NETWORK",
      title: "Control-Plane Read-Only Boundary",
      status: "CONFIGURED",
      summary:
        "Avenor enforces a strict GET-only HTTP verb and endpoint allowlist while blocking /connection_uri and /reveal_password.",
      qualificationNote:
        "Neon API keys are not intrinsically read-only upstream; read-only safety is enforced by Avenor's adapter gateway.",
      sanitizedEvidence: sanitizePostureEvidenceRecord({
        intrinsicProviderReadOnly: false,
        adapterGetOnlyLockActive: true,
      }),
      observedAtIso,
    });
  }

  if (resource.providerKey === "supabase") {
    const sslEnforced = meta.sslEnforced;
    const netRestricted = meta.networkRestrictionsConfigured;
    const mfaTotp = meta.mfaTotpEnabled;
    const rlsStatus =
      typeof meta.rlsVerificationStatus === "string" ? meta.rlsVerificationStatus : "NOT_VERIFIED";

    indicators.push({
      providerKey: "supabase",
      connectedResourceId: resource.connectedResourceId,
      resourceDisplayName: resource.displayName,
      indicatorKey: "supabase.ssl_enforcement",
      category: "ENCRYPTION_AND_TRANSPORT",
      title: "Database TLS/SSL Enforcement",
      status: sslEnforced === true ? "CONFIGURED" : sslEnforced === false ? "WARNING" : "UNKNOWN",
      summary:
        sslEnforced === true
          ? "Supabase Postgres SSL enforcement is enabled for client database connections."
          : sslEnforced === false
            ? "SSL enforcement is not enabled in Supabase Postgres configuration."
            : "SSL enforcement metadata was not returned.",
      qualificationNote: "Observed passively via GET /v1/projects/{ref}/config/database/postgres.",
      sanitizedEvidence: sanitizePostureEvidenceRecord({
        sslEnforced: typeof sslEnforced === "boolean" ? sslEnforced : null,
      }),
      observedAtIso,
    });

    indicators.push({
      providerKey: "supabase",
      connectedResourceId: resource.connectedResourceId,
      resourceDisplayName: resource.displayName,
      indicatorKey: "supabase.network_restrictions",
      category: "ACCESS_AND_NETWORK",
      title: "Database Network CIDR Restrictions",
      status:
        netRestricted === true
          ? "CONFIGURED"
          : netRestricted === false
            ? "NOT_CONFIGURED"
            : "UNKNOWN",
      summary:
        netRestricted === true
          ? "Non-wildcard database network restrictions are active on the Supabase project."
          : netRestricted === false
            ? "Database network restrictions are not configured (open or default)."
            : "Network restriction configuration could not be read.",
      qualificationNote: "Raw CIDR ranges are stripped from evidence payloads.",
      sanitizedEvidence: sanitizePostureEvidenceRecord({
        networkRestrictionsConfigured: typeof netRestricted === "boolean" ? netRestricted : null,
      }),
      observedAtIso,
    });

    indicators.push({
      providerKey: "supabase",
      connectedResourceId: resource.connectedResourceId,
      resourceDisplayName: resource.displayName,
      indicatorKey: "supabase.auth_mfa_totp",
      category: "AUTHENTICATION_POSTURE",
      title: "Auth TOTP MFA Availability",
      status: mfaTotp === true ? "CONFIGURED" : mfaTotp === false ? "NOT_CONFIGURED" : "UNKNOWN",
      summary:
        mfaTotp === true
          ? "Supabase Auth TOTP multi-factor enrollment and verification are enabled."
          : mfaTotp === false
            ? "Supabase Auth TOTP MFA is not enabled in project Auth config."
            : "Auth MFA configuration metadata was unavailable.",
      qualificationNote:
        "Observed passively via GET /v1/projects/{ref}/config/auth with secrets redacted.",
      sanitizedEvidence: sanitizePostureEvidenceRecord({
        mfaTotpEnabled: typeof mfaTotp === "boolean" ? mfaTotp : null,
      }),
      observedAtIso,
    });

    indicators.push({
      providerKey: "supabase",
      connectedResourceId: resource.connectedResourceId,
      resourceDisplayName: resource.displayName,
      indicatorKey: "supabase.rls_table_posture",
      category: "DATA_PROTECTION_AND_RLS",
      title: "Table-Level Row Level Security (RLS) Qualification",
      status:
        rlsStatus === "CONFIGURED" || rlsStatus === "WARNING"
          ? (rlsStatus as PassiveSecurityPostureStatus)
          : "NOT_VERIFIED",
      summary:
        rlsStatus === "CONFIGURED"
          ? "Verified read-only metadata reports RLS enabled across observed tables."
          : "Table-level Row Level Security (pg_class.relrowsecurity) cannot be directly verified without executing SQL against customer Postgres catalogs.",
      qualificationNote:
        "Avenor explicitly marks RLS as NOT_VERIFIED rather than assuming protection or connecting directly to customer SQL tables.",
      sanitizedEvidence: sanitizePostureEvidenceRecord({
        rlsVerificationStatus: rlsStatus,
        zeroSqlBoundaryMaintained: true,
      }),
      observedAtIso,
    });

    indicators.push({
      providerKey: "supabase",
      connectedResourceId: resource.connectedResourceId,
      resourceDisplayName: resource.displayName,
      indicatorKey: "supabase.service_role_rejection",
      category: "ACCESS_AND_NETWORK",
      title: "No Privileged service_role Key Stored",
      status: "CONFIGURED",
      summary:
        "Supabase connection uses scoped read-only Management API access; service_role JWTs and sb_secret_* keys are unconditionally refused.",
      qualificationNote:
        "Enforced before vault encryption and on every outbound Management API call.",
      sanitizedEvidence: sanitizePostureEvidenceRecord({
        serviceRoleRejectedByDefault: true,
      }),
      observedAtIso,
    });
  }

  if (resource.providerKey === "firebase-monitoring") {
    const allow = resource.firebaseRulesCounts?.allowCount ?? null;
    const deny = resource.firebaseRulesCounts?.denyCount ?? null;
    const error = resource.firebaseRulesCounts?.errorCount ?? null;
    const total = (allow ?? 0) + (deny ?? 0) + (error ?? 0);
    const denyRatio = total > 0 && deny !== null ? deny / total : 0;

    let rulesStatus: PassiveSecurityPostureStatus = "UNKNOWN";
    let rulesSummary =
      "No Firestore Security Rules evaluation telemetry was observed in the selected time window.";

    if (total > 0) {
      if ((error ?? 0) > 0 || denyRatio > 0.15) {
        rulesStatus = "WARNING";
        rulesSummary = `Security Rules evaluations observed (${allow ?? 0} allow, ${deny ?? 0} deny, ${error ?? 0} error) with elevated deny/error signals.`;
      } else {
        rulesStatus = "CONFIGURED";
        rulesSummary = `Security Rules are actively evaluating requests (${allow ?? 0} allow, ${deny ?? 0} deny, ${error ?? 0} error).`;
      }
    } else if (meta.securityRulesTelemetryActive === true) {
      rulesStatus = "CONFIGURED";
      rulesSummary =
        "Cloud Monitoring reports active Firestore Security Rules descriptor telemetry.";
    }

    indicators.push({
      providerKey: "firebase-monitoring",
      connectedResourceId: resource.connectedResourceId,
      resourceDisplayName: resource.displayName,
      indicatorKey: "firebase.security_rules_telemetry",
      category: "RULES_AND_POLICY_TELEMETRY",
      title: "Firebase Security Rules Evaluation Telemetry",
      status: rulesStatus,
      summary: rulesSummary,
      qualificationNote:
        "Passive evaluation counters via monitoring.read only; Avenor does not inspect rule source files or claim rule logic is vulnerability-free.",
      sanitizedEvidence: sanitizePostureEvidenceRecord({
        allowCount: allow,
        denyCount: deny,
        errorCount: error,
      }),
      observedAtIso,
    });

    indicators.push({
      providerKey: "firebase-monitoring",
      connectedResourceId: resource.connectedResourceId,
      resourceDisplayName: resource.displayName,
      indicatorKey: "firebase.monitoring_read_isolation",
      category: "ACCESS_AND_NETWORK",
      title: "Cryptographic Read-Only Telemetry Scope (monitoring.read)",
      status: "CONFIGURED",
      summary:
        "Uses Google IAM-enforced `monitoring.read` OAuth scope with zero access to Firestore documents, Storage objects, or Firebase Auth user PII.",
      qualificationNote:
        "Firebase Admin SDK service-account private keys are unconditionally refused.",
      sanitizedEvidence: sanitizePostureEvidenceRecord({
        adminSdkRejectedByDefault: true,
        intrinsicProviderReadOnly: true,
      }),
      observedAtIso,
    });
  }

  return indicators;
}

export async function getAndPersistProjectSecurityPosture(
  session: AuthenticatedSessionContext | null,
  projectId: string,
  options?: { workspaceId?: string },
): Promise<ProjectSecurityPostureReportDto> {
  assertServerRuntime("getAndPersistProjectSecurityPosture");

  const access = await authorizeProjectAccess({
    session,
    projectId,
    expectedWorkspaceId: options?.workspaceId ?? session?.activeWorkspace.id,
    requiredPermission: "project:read",
  });
  const project = await getLogicalProjectById(session, access.projectId, access.workspaceId);
  const observedAtIso = new Date().toISOString();

  const mappedRes = await dbQuery<{
    connected_resource_id: string;
    provider_connection_id: string;
    provider_key: string;
    display_name: string;
    connection_status: string;
    environment_id: string | null;
    metadata: Record<string, unknown> | null;
  }>(
    `SELECT
       cr.id AS connected_resource_id,
       cr.provider_connection_id,
       pc.provider_key,
       cr.display_name,
       pc.status AS connection_status,
       rm.environment_id,
       cr.metadata
     FROM resource_mappings rm
     INNER JOIN connected_resources cr ON cr.id = rm.connected_resource_id
     INNER JOIN provider_connections pc ON pc.id = cr.provider_connection_id
     WHERE rm.workspace_id = $1
       AND rm.project_id = $2
       AND pc.provider_key IN ('neon', 'supabase', 'firebase-monitoring')
       AND pc.status != 'DISCONNECTED'
     ORDER BY pc.provider_key ASC, cr.display_name ASC`,
    [access.workspaceId, project.id],
  );

  const persistedIndicators: PassiveSecurityPostureIndicator[] = [];

  for (const row of mappedRes.rows) {
    const providerKey = row.provider_key as "neon" | "supabase" | "firebase-monitoring";
    const evaluated = evaluateResourcePassiveSecurityPosture(
      {
        connectedResourceId: row.connected_resource_id,
        providerConnectionId: row.provider_connection_id,
        providerKey,
        displayName: row.display_name,
        connectionStatus: row.connection_status,
        environmentId: row.environment_id,
        metadata: row.metadata ?? {},
      },
      observedAtIso,
    );

    for (const item of evaluated) {
      const id = generateId("bsp");
      const upsertRes = await dbQuery<{ id: string; observed_at: Date }>(
        `INSERT INTO backend_security_posture_observations (
           id,
           organization_id,
           workspace_id,
           project_id,
           environment_id,
           provider_connection_id,
           connected_resource_id,
           provider_key,
           indicator_key,
           category,
           title,
           status,
           summary,
           qualification_note,
           sanitized_evidence,
           observed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::timestamptz)
         ON CONFLICT (workspace_id, connected_resource_id, indicator_key)
         DO UPDATE SET
           project_id = EXCLUDED.project_id,
           environment_id = EXCLUDED.environment_id,
           title = EXCLUDED.title,
           status = EXCLUDED.status,
           summary = EXCLUDED.summary,
           qualification_note = EXCLUDED.qualification_note,
           sanitized_evidence = EXCLUDED.sanitized_evidence,
           observed_at = EXCLUDED.observed_at,
           updated_at = now()
         RETURNING id, observed_at`,
        [
          id,
          access.organizationId,
          access.workspaceId,
          project.id,
          row.environment_id,
          row.provider_connection_id,
          row.connected_resource_id,
          providerKey,
          item.indicatorKey,
          item.category,
          item.title,
          item.status,
          item.summary,
          item.qualificationNote,
          JSON.stringify(item.sanitizedEvidence),
          observedAtIso,
        ],
      );

      persistedIndicators.push({
        ...item,
        id: upsertRes.rows[0]?.id ?? id,
        observedAtIso: upsertRes.rows[0]?.observed_at
          ? new Date(upsertRes.rows[0].observed_at).toISOString()
          : observedAtIso,
      });
    }
  }

  // Load recent workspace audit logs and sanitize every summary strictly (zero PII/tokens)
  const auditRes = await dbQuery<{
    id: string;
    action: string;
    entity_type: string;
    summary: string | null;
    metadata: Record<string, unknown> | null;
    created_at: Date;
  }>(
    `SELECT id, action, entity_type, summary, metadata, created_at
     FROM audit_logs
     WHERE organization_id = $1
       AND workspace_id = $2
     ORDER BY created_at DESC
     LIMIT 12`,
    [access.organizationId, access.workspaceId],
  );

  const recentAuditSummaries: SanitizedAuditSummaryItem[] = auditRes.rows.map((row) => {
    const rawDetail =
      row.summary && row.summary.trim().length > 0
        ? row.summary
        : row.metadata && typeof row.metadata.summary === "string"
          ? row.metadata.summary
          : `${row.action} on ${row.entity_type}`;
    return {
      id: row.id,
      action: row.action,
      resourceType: row.entity_type,
      summary: sanitizePostureAuditText(rawDetail),
      actorRole: access.role,
      createdAtIso: new Date(row.created_at).toISOString(),
    };
  });

  const countsByStatus: Record<PassiveSecurityPostureStatus, number> = {
    CONFIGURED: 0,
    NOT_CONFIGURED: 0,
    WARNING: 0,
    UNKNOWN: 0,
    NOT_VERIFIED: 0,
    UNAVAILABLE: 0,
    INSUFFICIENT_PERMISSION: 0,
  };
  for (const ind of persistedIndicators) {
    countsByStatus[ind.status] += 1;
  }

  return {
    projectId: project.id,
    projectName: project.name,
    observedAtIso,
    disclaimer: PASSIVE_POSTURE_DISCLAIMER,
    countsByStatus,
    indicators: persistedIndicators,
    recentAuditSummaries,
  };
}
