import { type AuditLogEntry, redactSensitiveText } from "@avenor/types";
import { dbQuery, generateId, type Queryable } from "./client";

const SENSITIVE_METADATA_KEYS = /password|secret|token|api[_-]?key|authorization|cookie|hash/i;

export function sanitizeAuditMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!metadata) {
    return {};
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_METADATA_KEYS.test(key)) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "string") {
      sanitized[key] = redactSensitiveText(value);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      sanitized[key] = sanitizeAuditMetadata(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export interface CreateAuditLogInput {
  organizationId: string;
  workspaceId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function writeAuditLog(
  input: CreateAuditLogInput,
  executor?: Queryable,
): Promise<AuditLogEntry> {
  const id = generateId("aud");
  const safeMetadata = sanitizeAuditMetadata(input.metadata);
  const safeSummary = redactSensitiveText(input.summary);

  const res = await dbQuery<{
    id: string;
    organization_id: string;
    workspace_id: string | null;
    actor_user_id: string | null;
    action: string;
    entity_type: string;
    entity_id: string;
    summary: string;
    metadata: Record<string, unknown>;
    created_at: Date;
  }>(
    `INSERT INTO audit_logs (
       id,
       organization_id,
       workspace_id,
       actor_user_id,
       action,
       entity_type,
       entity_id,
       summary,
       metadata,
       ip_address,
       user_agent
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
     RETURNING
       id,
       organization_id,
       workspace_id,
       actor_user_id,
       action,
       entity_type,
       entity_id,
       summary,
       metadata,
       created_at`,
    [
      id,
      input.organizationId,
      input.workspaceId ?? null,
      input.actorUserId ?? null,
      input.action,
      input.entityType,
      input.entityId,
      safeSummary,
      JSON.stringify(safeMetadata),
      input.ipAddress ?? null,
      input.userAgent ?? null,
    ],
    executor,
  );

  const row = res.rows[0];
  return {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary,
    metadata: row.metadata ?? {},
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function listAuditLogsForWorkspace(
  workspaceId: string,
  limit = 25,
  executor?: Queryable,
): Promise<AuditLogEntry[]> {
  const res = await dbQuery<{
    id: string;
    organization_id: string;
    workspace_id: string | null;
    actor_user_id: string | null;
    actor_email: string | null;
    action: string;
    entity_type: string;
    entity_id: string;
    summary: string;
    metadata: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT
       a.id,
       a.organization_id,
       a.workspace_id,
       a.actor_user_id,
       u.email AS actor_email,
       a.action,
       a.entity_type,
       a.entity_id,
       a.summary,
       a.metadata,
       a.created_at
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE a.workspace_id = $1
     ORDER BY a.created_at DESC
     LIMIT $2`,
    [workspaceId, limit],
    executor,
  );

  return res.rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary,
    metadata: row.metadata ?? {},
    createdAt: new Date(row.created_at).toISOString(),
  }));
}
