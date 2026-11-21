import crypto from "node:crypto";
import { type AuthenticatedSessionContext, authorizeWorkspaceAccess } from "@avenor/auth";
import { dbQuery, generateId } from "@avenor/database";
import { AppError, ERROR_CODES } from "@avenor/types";
import { z } from "zod";
import { signOutboundWebhookPayload } from "@/lib/alerts/digests";
import { validatePublicTargetUrl } from "@/lib/reliability/ssrf";

export const PUBLIC_API_SCOPES = [
  "projects:read",
  "metrics:read",
  "incidents:read",
  "deployments:read",
  "reports:read",
] as const;

export type PublicApiScope = (typeof PUBLIC_API_SCOPES)[number];

export const OUTGOING_WEBHOOK_EVENTS = [
  "incident.opened",
  "incident.resolved",
  "anomaly.detected",
  "deployment.recorded",
  "digest.completed",
] as const;

export type OutgoingWebhookEvent = (typeof OUTGOING_WEBHOOK_EVENTS)[number];

export interface ApiTokenMetadata {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly tokenPrefix: string;
  readonly scopes: readonly PublicApiScope[];
  readonly allowedProjectIds: readonly string[] | null;
  readonly expiresAtIso: string | null;
  readonly lastUsedAtIso: string | null;
  readonly revokedAtIso: string | null;
  readonly createdAtIso: string;
}

export interface CreatedApiTokenResult {
  readonly token: ApiTokenMetadata;
  /** Plaintext token shown ONCE on creation and never stored or retrievable again. */
  readonly plaintextToken: string;
}

export interface AuthenticatedPublicApiPrincipal {
  readonly tokenId: string;
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly scopes: readonly PublicApiScope[];
  readonly allowedProjectIds: readonly string[] | null;
}

export interface OutgoingWebhookSubscriptionRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly targetUrl: string;
  readonly subscribedEvents: readonly OutgoingWebhookEvent[];
  readonly enabled: boolean;
  readonly lastDeliveredAtIso: string | null;
  readonly lastStatusCode: number | null;
  readonly createdAtIso: string;
}

const createTokenSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  name: z.string().trim().min(2).max(80),
  scopes: z.array(z.enum(PUBLIC_API_SCOPES)).min(1).max(PUBLIC_API_SCOPES.length),
  allowedProjectIds: z.array(z.string().min(1)).max(100).nullable().optional(),
  expiresInDays: z.number().int().min(1).max(365).default(90),
});

const createWebhookSubSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  name: z.string().trim().min(2).max(80),
  targetUrl: z.string().trim().min(8).max(500),
  subscribedEvents: z.array(z.enum(OUTGOING_WEBHOOK_EVENTS)).min(1),
});

export function hashPublicApiToken(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext.trim()).digest("hex");
}

function deriveEncryptionKey(): Buffer {
  const raw = process.env.AVENOR_ENCRYPTION_MASTER_KEY?.trim() ?? "";
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return crypto
    .createHash("sha256")
    .update(raw || "avenor-local-dev-webhook-key")
    .digest();
}

function encryptSigningSecret(secret: string): string {
  const key = deriveEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function mapTokenRow(row: Record<string, unknown>): ApiTokenMetadata {
  const rawProjects = Array.isArray(row.allowed_project_ids)
    ? row.allowed_project_ids.map(String)
    : null;
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    tokenPrefix: String(row.token_prefix),
    scopes: Array.isArray(row.scopes) ? (row.scopes.map(String) as PublicApiScope[]) : [],
    allowedProjectIds: rawProjects && rawProjects.length > 0 ? rawProjects : null,
    expiresAtIso: row.expires_at ? new Date(String(row.expires_at)).toISOString() : null,
    lastUsedAtIso: row.last_used_at ? new Date(String(row.last_used_at)).toISOString() : null,
    revokedAtIso: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null,
    createdAtIso: new Date(String(row.created_at)).toISOString(),
  };
}

export async function createWorkspaceApiToken(
  session: AuthenticatedSessionContext | null,
  rawInput: z.input<typeof createTokenSchema>,
): Promise<CreatedApiTokenResult> {
  const parsed = createTokenSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }
  const input = parsed.data;
  const workspaceId = input.workspaceId ?? session?.activeWorkspace.id ?? "";
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "workspace:update",
  });

  const randomHex = crypto.randomBytes(24).toString("hex");
  const plaintextToken = `avpat_${randomHex}`;
  const tokenPrefix = plaintextToken.slice(0, 14);
  const tokenHash = hashPublicApiToken(plaintextToken);
  const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000);
  const id = generateId("tok");

  const inserted = await dbQuery<Record<string, unknown>>(
    `INSERT INTO api_tokens (
      id, organization_id, workspace_id, created_by_user_id, name,
      token_prefix, token_hash, scopes, allowed_project_ids, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [
      id,
      access.organizationId,
      workspaceId,
      session?.user.id ?? null,
      input.name,
      tokenPrefix,
      tokenHash,
      Array.from(new Set(input.scopes)),
      input.allowedProjectIds && input.allowedProjectIds.length > 0
        ? Array.from(new Set(input.allowedProjectIds))
        : null,
      expiresAt.toISOString(),
    ],
  );

  return {
    token: mapTokenRow(inserted.rows[0] ?? {}),
    plaintextToken,
  };
}

export async function listWorkspaceApiTokens(
  session: AuthenticatedSessionContext | null,
  workspaceId?: string,
): Promise<ApiTokenMetadata[]> {
  const targetWs = workspaceId ?? session?.activeWorkspace.id ?? "";
  await authorizeWorkspaceAccess({
    session,
    workspaceId: targetWs,
    requiredPermission: "workspace:read",
  });
  const res = await dbQuery<Record<string, unknown>>(
    `SELECT * FROM api_tokens WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [targetWs],
  );
  return res.rows.map(mapTokenRow);
}

export async function revokeWorkspaceApiToken(
  session: AuthenticatedSessionContext | null,
  tokenId: string,
  workspaceId?: string,
): Promise<{ revoked: true; tokenId: string }> {
  const targetWs = workspaceId ?? session?.activeWorkspace.id ?? "";
  await authorizeWorkspaceAccess({
    session,
    workspaceId: targetWs,
    requiredPermission: "workspace:update",
  });
  const res = await dbQuery<{ id: string }>(
    `UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND workspace_id = $2 RETURNING id`,
    [tokenId, targetWs],
  );
  if (res.rows.length === 0) {
    throw new AppError({
      code: ERROR_CODES.NOT_FOUND,
      message: "API token not found in this workspace.",
    });
  }
  return { revoked: true, tokenId };
}

/**
 * Authenticates a scoped read-only Bearer API token (`avpat_*`), verifying SHA-256 hash,
 * revocation, expiry, required read scope, and optional project allowlist.
 */
export async function authenticatePublicApiToken(options: {
  authorizationHeader: string | null | undefined;
  requiredScope: PublicApiScope;
  targetProjectId?: string;
}): Promise<AuthenticatedPublicApiPrincipal> {
  const raw = (options.authorizationHeader ?? "").trim();
  if (!raw.toLowerCase().startsWith("bearer ")) {
    throw new AppError({
      code: ERROR_CODES.UNAUTHENTICATED,
      message: "Missing Authorization: Bearer avpat_... token.",
    });
  }
  const plaintext = raw.slice("bearer ".length).trim();
  if (!plaintext.startsWith("avpat_") || plaintext.length < 24) {
    throw new AppError({
      code: ERROR_CODES.UNAUTHENTICATED,
      message: "Malformed Avenor public API token.",
    });
  }

  const tokenHash = hashPublicApiToken(plaintext);
  const res = await dbQuery<Record<string, unknown>>(
    `SELECT id, organization_id, workspace_id, scopes, allowed_project_ids, expires_at, revoked_at
     FROM api_tokens
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash],
  );
  const row = res.rows[0];
  if (!row) {
    throw new AppError({
      code: ERROR_CODES.UNAUTHENTICATED,
      message: "Invalid Avenor public API token.",
    });
  }

  if (row.revoked_at) {
    throw new AppError({
      code: ERROR_CODES.UNAUTHENTICATED,
      message: "This API token has been revoked.",
    });
  }
  if (row.expires_at && new Date(String(row.expires_at)).getTime() <= Date.now()) {
    throw new AppError({
      code: ERROR_CODES.UNAUTHENTICATED,
      message: "This API token has expired.",
    });
  }

  const scopes = Array.isArray(row.scopes) ? (row.scopes.map(String) as PublicApiScope[]) : [];
  if (!scopes.includes(options.requiredScope)) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: `API token lacks required read-only scope "${options.requiredScope}".`,
    });
  }

  const allowedProjects =
    Array.isArray(row.allowed_project_ids) && row.allowed_project_ids.length > 0
      ? row.allowed_project_ids.map(String)
      : null;

  if (
    options.targetProjectId &&
    allowedProjects &&
    !allowedProjects.includes(options.targetProjectId)
  ) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "This API token is not authorized to access the requested project.",
    });
  }

  await dbQuery(`UPDATE api_tokens SET last_used_at = now() WHERE id = $1`, [String(row.id)]);

  return {
    tokenId: String(row.id),
    organizationId: String(row.organization_id),
    workspaceId: String(row.workspace_id),
    scopes,
    allowedProjectIds: allowedProjects,
  };
}

export async function queryPublicProjects(
  principal: AuthenticatedPublicApiPrincipal,
  options?: { limit?: number; cursor?: string | null },
): Promise<{
  data: Array<{
    id: string;
    name: string;
    slug: string;
    primaryDomain: string | null;
    status: string;
    createdAtIso: string;
  }>;
  nextCursor: string | null;
}> {
  const limit = Math.max(1, Math.min(50, options?.limit ?? 20));
  const cursor = options?.cursor?.trim() || null;

  const params: unknown[] = [principal.workspaceId];
  let where = `WHERE workspace_id = $1 AND archived_at IS NULL`;

  if (principal.allowedProjectIds && principal.allowedProjectIds.length > 0) {
    params.push(principal.allowedProjectIds);
    where += ` AND id = ANY($${params.length}::text[])`;
  }
  if (cursor) {
    params.push(cursor);
    where += ` AND id > $${params.length}`;
  }

  params.push(limit + 1);
  const res = await dbQuery<Record<string, unknown>>(
    `SELECT id, name, slug, primary_domain, status, created_at
     FROM logical_projects
     ${where}
     ORDER BY id ASC
     LIMIT $${params.length}`,
    params,
  );

  const hasMore = res.rows.length > limit;
  const slice = hasMore ? res.rows.slice(0, limit) : res.rows;
  const lastItem = slice[slice.length - 1];

  return {
    data: slice.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      slug: String(r.slug),
      primaryDomain: r.primary_domain ? String(r.primary_domain) : null,
      status: String(r.status ?? "ACTIVE"),
      createdAtIso: new Date(String(r.created_at)).toISOString(),
    })),
    nextCursor: hasMore && lastItem ? String(lastItem.id) : null,
  };
}

async function assertProjectInWorkspace(workspaceId: string, projectId: string): Promise<void> {
  const res = await dbQuery<{ id: string }>(
    `SELECT id FROM logical_projects WHERE id = $1 AND workspace_id = $2 LIMIT 1`,
    [projectId, workspaceId],
  );
  if (res.rows.length === 0) {
    throw new AppError({
      code: ERROR_CODES.NOT_FOUND,
      message: "Project not found in token workspace.",
    });
  }
}

export async function queryPublicProjectMetrics(
  principal: AuthenticatedPublicApiPrincipal,
  projectId: string,
  options?: {
    metricKey?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    cursor?: string | null;
  },
): Promise<{
  data: Array<{
    id: string;
    metricKey: string;
    providerKey: string;
    periodStartDate: string;
    periodEndDate: string;
    numericValue: number | null;
    unit: string;
    currency: string | null;
    completenessState: string;
  }>;
  nextCursor: string | null;
}> {
  await assertProjectInWorkspace(principal.workspaceId, projectId);
  const limit = Math.max(1, Math.min(100, options?.limit ?? 50));
  const params: unknown[] = [principal.workspaceId, projectId];
  let where = `WHERE workspace_id = $1 AND project_id = $2`;

  if (options?.metricKey) {
    params.push(options.metricKey);
    where += ` AND canonical_metric_key = $${params.length}`;
  }
  if (options?.startDate) {
    params.push(options.startDate);
    where += ` AND period_start_date >= $${params.length}`;
  }
  if (options?.endDate) {
    params.push(options.endDate);
    where += ` AND period_start_date <= $${params.length}`;
  }
  if (options?.cursor) {
    params.push(options.cursor);
    where += ` AND id > $${params.length}`;
  }

  params.push(limit + 1);
  const res = await dbQuery<Record<string, unknown>>(
    `SELECT id, canonical_metric_key, provider_key, period_start_date, period_end_date,
            numeric_value, unit, currency, completeness_state
     FROM metric_observations
     ${where}
     ORDER BY period_start_date DESC, id ASC
     LIMIT $${params.length}`,
    params,
  );

  const hasMore = res.rows.length > limit;
  const slice = hasMore ? res.rows.slice(0, limit) : res.rows;
  const lastItem = slice[slice.length - 1];

  return {
    data: slice.map((r) => ({
      id: String(r.id),
      metricKey: String(r.canonical_metric_key),
      providerKey: String(r.provider_key),
      periodStartDate: String(r.period_start_date),
      periodEndDate: String(r.period_end_date),
      numericValue: r.numeric_value === null ? null : Number(r.numeric_value),
      unit: String(r.unit),
      currency: r.currency ? String(r.currency) : null,
      completenessState: String(r.completeness_state),
    })),
    nextCursor: hasMore && lastItem ? String(lastItem.id) : null,
  };
}

export async function queryPublicProjectIncidents(
  principal: AuthenticatedPublicApiPrincipal,
  projectId: string,
  options?: { limit?: number },
): Promise<{
  data: Array<{
    id: string;
    source: "UPTIME" | "ALERT";
    status: string;
    severity: string;
    summary: string;
    startedAtIso: string;
    resolvedAtIso: string | null;
  }>;
}> {
  await assertProjectInWorkspace(principal.workspaceId, projectId);
  const limit = Math.max(1, Math.min(50, options?.limit ?? 25));

  const uptimeRes = await dbQuery<Record<string, unknown>>(
    `SELECT id, status, failure_summary, started_at, resolved_at
     FROM uptime_incidents
     WHERE workspace_id = $1 AND project_id = $2
     ORDER BY started_at DESC
     LIMIT $3`,
    [principal.workspaceId, projectId, limit],
  );

  return {
    data: uptimeRes.rows.map((r) => ({
      id: String(r.id),
      source: "UPTIME",
      status: String(r.status),
      severity: "HIGH",
      summary: String(r.failure_summary ?? "Uptime probe failure"),
      startedAtIso: new Date(String(r.started_at)).toISOString(),
      resolvedAtIso: r.resolved_at ? new Date(String(r.resolved_at)).toISOString() : null,
    })),
  };
}

export async function createOutgoingWebhookSubscription(
  session: AuthenticatedSessionContext | null,
  rawInput: z.input<typeof createWebhookSubSchema>,
): Promise<{ subscription: OutgoingWebhookSubscriptionRecord; signingSecretPlaintext: string }> {
  const parsed = createWebhookSubSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }
  const input = parsed.data;
  const workspaceId = input.workspaceId ?? session?.activeWorkspace.id ?? "";
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "workspace:update",
  });

  // Strict HTTPS + SSRF guard
  const validated = validatePublicTargetUrl(input.targetUrl, { allowHttp: false });
  const signingSecretPlaintext = `whsec_av_${crypto.randomBytes(24).toString("hex")}`;
  const encryptedSecret = encryptSigningSecret(signingSecretPlaintext);
  const id = generateId("whsub");

  const inserted = await dbQuery<Record<string, unknown>>(
    `INSERT INTO outgoing_webhook_subscriptions (
      id, organization_id, workspace_id, created_by_user_id, name, target_url,
      encrypted_signing_secret, subscribed_events, enabled
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true) RETURNING *`,
    [
      id,
      access.organizationId,
      workspaceId,
      session?.user.id ?? null,
      input.name,
      validated.normalizedUrl,
      encryptedSecret,
      Array.from(new Set(input.subscribedEvents)),
    ],
  );

  const row = inserted.rows[0] ?? {};
  return {
    subscription: {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      name: String(row.name),
      targetUrl: String(row.target_url),
      subscribedEvents: Array.isArray(row.subscribed_events)
        ? (row.subscribed_events.map(String) as OutgoingWebhookEvent[])
        : [],
      enabled: Boolean(row.enabled),
      lastDeliveredAtIso: null,
      lastStatusCode: null,
      createdAtIso: new Date(String(row.created_at)).toISOString(),
    },
    signingSecretPlaintext,
  };
}

export function buildSignedPublicWebhookHeaders(options: {
  rawBody: string;
  deliveryId: string;
  eventType: OutgoingWebhookEvent;
  signingSecret: string;
  timestampSec?: number;
}): Record<string, string> {
  const ts = options.timestampSec ?? Math.floor(Date.now() / 1000);
  const sig = signOutboundWebhookPayload({
    rawBody: options.rawBody,
    timestampSec: ts,
    deliveryId: options.deliveryId,
    signingSecret: options.signingSecret,
  });
  return {
    "Content-Type": "application/json",
    "X-Avenor-Event": options.eventType,
    "X-Avenor-Delivery": options.deliveryId,
    "X-Avenor-Signature": sig,
  };
}

export function buildPublicApiOpenApiSpec(baseUrl: string): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Avenor Read-Only Public API",
      version: "1.0.0",
      description:
        "Strictly read-only, workspace-scoped digital intelligence API. Zero external provider mutation endpoints exist.",
    },
    servers: [{ url: baseUrl.replace(/\/$/, "") }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "avpat_*",
          description: "Scoped read-only Avenor workspace API token.",
        },
      },
    },
    security: [{ BearerAuth: [] }],
    paths: {
      "/api/v1/projects": {
        get: {
          summary: "List authorized logical projects (cursor-paginated)",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50 } },
            { name: "cursor", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Paginated list of workspace projects." },
            "401": { description: "Missing, invalid, expired, or revoked token." },
            "403": { description: "Missing projects:read scope." },
          },
        },
      },
      "/api/v1/projects/{projectId}/metrics": {
        get: {
          summary: "Read verified canonical metric observations for a project",
          parameters: [
            { name: "projectId", in: "path", required: true, schema: { type: "string" } },
            { name: "metricKey", in: "query", schema: { type: "string" } },
            { name: "startDate", in: "query", schema: { type: "string", format: "date" } },
            { name: "endDate", in: "query", schema: { type: "string", format: "date" } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
            { name: "cursor", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Paginated metric observations with provenance metadata." },
            "403": { description: "Missing metrics:read scope or project not in token allowlist." },
          },
        },
      },
      "/api/v1/projects/{projectId}/incidents": {
        get: {
          summary: "Read uptime and alert incidents for a project",
          parameters: [
            { name: "projectId", in: "path", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50 } },
          ],
          responses: {
            "200": { description: "List of project reliability incidents." },
            "403": {
              description: "Missing incidents:read scope or project not in token allowlist.",
            },
          },
        },
      },
    },
  };
}
