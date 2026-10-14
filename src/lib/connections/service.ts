import { createHmac, timingSafeEqual } from "node:crypto";
import { assertServerRuntime } from "@avenor/config";
import { dbQuery, generateId, withTransaction, writeAuditLog } from "@avenor/database";
import {
  type AuthenticatedSessionContext,
  authorizeWorkspaceAccess,
  decryptConnectionCredentialForServer,
  type VaultKeyRing,
} from "@avenor/auth";
import {
  AppError,
  type AuditLogEntry,
  type ConnectionHealthStatus,
  type EnvironmentType,
  ERROR_CODES,
  type EvaluatedProviderCapability,
  evaluateCapabilityMatrix,
  PROVIDER_ERROR_CODES,
  type ProviderConnectionHealthSnapshot,
  type ReadOnlyProviderContext,
  redactSensitiveText,
  roleHasPermission,
} from "@avenor/types";
import { z } from "zod";
import { getProviderAdapter, getProviderCatalogEntry } from "@/lib/providers";

export interface ConnectedResourceRecord {
  id: string;
  providerConnectionId: string;
  workspaceId: string;
  externalResourceId: string;
  resourceType: string;
  displayName: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceMappingRecord {
  id: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  environmentId: string | null;
  environmentName: string | null;
  environmentType: EnvironmentType | null;
  connectedResourceId: string;
  externalResourceId: string;
  resourceDisplayName: string;
  resourceType: string;
  providerConnectionId: string;
  providerKey: string;
  mappingRole: string;
  createdAt: string;
}

export interface SanitizedCredentialSummary {
  keyId: string;
  encryptionVersion: number;
  algorithm: string;
  status: "ACTIVE" | "ROTATED" | "REVOKED";
  refreshTokenPresent: boolean;
  tokenExpiresAtIso: string | null;
  rotatedAtIso: string | null;
  revokedAtIso: string | null;
}

export interface WorkspaceConnectionSummary {
  id: string;
  workspaceId: string;
  providerKey: string;
  providerDisplayName: string;
  displayName: string;
  authMode: string;
  externalAccountId: string | null;
  externalAccountLabel: string | null;
  status: ConnectionHealthStatus;
  requestedScopes: readonly string[];
  grantedScopes: readonly string[];
  missingScopes: readonly string[];
  encryptionKeyVersion: number;
  lastErrorCode: string | null;
  lastErrorSummary: string | null;
  lastVerifiedAtIso: string | null;
  lastSyncAtIso: string | null;
  disconnectedAtIso: string | null;
  createdAtIso: string;
  updatedAtIso: string;
  credentialSummary: SanitizedCredentialSummary | null;
  connectedResources: readonly ConnectedResourceRecord[];
  mappings: readonly ResourceMappingRecord[];
  capabilities: readonly EvaluatedProviderCapability[];
}

export interface WorkspaceConnectionDetail extends WorkspaceConnectionSummary {
  auditLogs: readonly AuditLogEntry[];
}

const mapResourceSchema = z.object({
  connectedResourceId: z.string().trim().min(2, "Select a discovered resource to map."),
  projectId: z.string().trim().min(2, "Select a logical project."),
  environmentId: z.string().trim().min(2).optional().nullable(),
  mappingRole: z.enum(["PRIMARY", "SECONDARY"]).default("PRIMARY"),
});

export async function listWorkspaceConnections(
  session: AuthenticatedSessionContext | null,
  workspaceId: string,
): Promise<{
  connections: WorkspaceConnectionSummary[];
  canManageConnections: boolean;
}> {
  assertServerRuntime("listWorkspaceConnections");

  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "connection:read",
  });

  const connRes = await dbQuery<{
    id: string;
    workspace_id: string;
    provider_key: string;
    display_name: string;
    auth_mode: string;
    external_account_id: string | null;
    external_account_label: string | null;
    status: ConnectionHealthStatus;
    requested_scopes: string[];
    granted_scopes: string[];
    encryption_key_version: number;
    last_error_code: string | null;
    last_error_summary: string | null;
    last_verified_at: Date | null;
    last_sync_at: Date | null;
    disconnected_at: Date | null;
    created_at: Date;
    updated_at: Date;
    cred_key_id: string | null;
    cred_version: number | null;
    cred_algorithm: string | null;
    cred_status: "ACTIVE" | "ROTATED" | "REVOKED" | null;
    cred_refresh_present: boolean | null;
    cred_expires_at: Date | null;
    cred_rotated_at: Date | null;
    cred_revoked_at: Date | null;
  }>(
    `SELECT
       pc.id,
       pc.workspace_id,
       pc.provider_key,
       pc.display_name,
       pc.auth_mode,
       pc.external_account_id,
       pc.external_account_label,
       pc.status,
       pc.requested_scopes,
       pc.granted_scopes,
       pc.encryption_key_version,
       pc.last_error_code,
       pc.last_error_summary,
       pc.last_verified_at,
       pc.last_sync_at,
       pc.disconnected_at,
       pc.created_at,
       pc.updated_at,
       crd.key_id AS cred_key_id,
       crd.encryption_version AS cred_version,
       crd.algorithm AS cred_algorithm,
       crd.status AS cred_status,
       crd.refresh_token_present AS cred_refresh_present,
       crd.token_expires_at AS cred_expires_at,
       crd.rotated_at AS cred_rotated_at,
       crd.revoked_at AS cred_revoked_at
     FROM provider_connections pc
     LEFT JOIN provider_credentials crd ON crd.provider_connection_id = pc.id
     WHERE pc.workspace_id = $1
     ORDER BY pc.created_at DESC`,
    [workspaceId],
  );

  if (connRes.rows.length === 0) {
    return {
      connections: [],
      canManageConnections: roleHasPermission(access.role, "connection:manage"),
    };
  }

  const connectionIds = connRes.rows.map((r) => r.id);

  const [resourcesRes, mappingsRes] = await Promise.all([
    dbQuery<{
      id: string;
      provider_connection_id: string;
      workspace_id: string;
      external_resource_id: string;
      resource_type: string;
      display_name: string;
      metadata: Record<string, unknown>;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT
         id,
         provider_connection_id,
         workspace_id,
         external_resource_id,
         resource_type,
         display_name,
         metadata,
         created_at,
         updated_at
       FROM connected_resources
       WHERE workspace_id = $1 AND provider_connection_id = ANY($2::text[])
       ORDER BY display_name ASC`,
      [workspaceId, connectionIds],
    ),
    dbQuery<{
      id: string;
      workspace_id: string;
      project_id: string;
      project_name: string;
      project_slug: string;
      environment_id: string | null;
      environment_name: string | null;
      environment_type: EnvironmentType | null;
      connected_resource_id: string;
      external_resource_id: string;
      resource_display_name: string;
      resource_type: string;
      provider_connection_id: string;
      provider_key: string;
      mapping_role: string;
      created_at: Date;
    }>(
      `SELECT
         rm.id,
         rm.workspace_id,
         rm.project_id,
         lp.name AS project_name,
         lp.slug AS project_slug,
         rm.environment_id,
         pe.name AS environment_name,
         pe.environment_type,
         rm.connected_resource_id,
         cr.external_resource_id,
         cr.display_name AS resource_display_name,
         cr.resource_type,
         cr.provider_connection_id,
         pc.provider_key,
         rm.mapping_role,
         rm.created_at
       FROM resource_mappings rm
       INNER JOIN connected_resources cr ON cr.id = rm.connected_resource_id
       INNER JOIN provider_connections pc ON pc.id = cr.provider_connection_id
       INNER JOIN logical_projects lp ON lp.id = rm.project_id
       LEFT JOIN project_environments pe ON pe.id = rm.environment_id
       WHERE rm.workspace_id = $1 AND cr.provider_connection_id = ANY($2::text[])
       ORDER BY rm.created_at DESC`,
      [workspaceId, connectionIds],
    ),
  ]);

  const resourcesByConn = new Map<string, ConnectedResourceRecord[]>();
  for (const r of resourcesRes.rows) {
    const list = resourcesByConn.get(r.provider_connection_id) ?? [];
    list.push({
      id: r.id,
      providerConnectionId: r.provider_connection_id,
      workspaceId: r.workspace_id,
      externalResourceId: r.external_resource_id,
      resourceType: r.resource_type,
      displayName: r.display_name,
      metadata: r.metadata ?? {},
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    });
    resourcesByConn.set(r.provider_connection_id, list);
  }

  const mappingsByConn = new Map<string, ResourceMappingRecord[]>();
  for (const m of mappingsRes.rows) {
    const list = mappingsByConn.get(m.provider_connection_id) ?? [];
    list.push({
      id: m.id,
      workspaceId: m.workspace_id,
      projectId: m.project_id,
      projectName: m.project_name,
      projectSlug: m.project_slug,
      environmentId: m.environment_id,
      environmentName: m.environment_name,
      environmentType: m.environment_type,
      connectedResourceId: m.connected_resource_id,
      externalResourceId: m.external_resource_id,
      resourceDisplayName: m.resource_display_name,
      resourceType: m.resource_type,
      providerConnectionId: m.provider_connection_id,
      providerKey: m.provider_key,
      mappingRole: m.mapping_role,
      createdAt: new Date(m.created_at).toISOString(),
    });
    mappingsByConn.set(m.provider_connection_id, list);
  }

  const connections: WorkspaceConnectionSummary[] = connRes.rows.map((row) => {
    const catalogEntry = getProviderCatalogEntry(row.provider_key);
    const requestedScopes =
      row.requested_scopes?.length > 0
        ? row.requested_scopes
        : [...(catalogEntry?.defaultScopes ?? [])];
    const grantedScopes = row.granted_scopes ?? [];
    const missingScopes = requestedScopes.filter((s) => !grantedScopes.includes(s));
    const capabilities = catalogEntry
      ? evaluateCapabilityMatrix(catalogEntry.capabilities, grantedScopes)
      : [];

    const credentialSummary: SanitizedCredentialSummary | null = row.cred_key_id
      ? {
          keyId: row.cred_key_id,
          encryptionVersion: row.cred_version ?? row.encryption_key_version,
          algorithm: row.cred_algorithm ?? "aes-256-gcm",
          status: row.cred_status ?? "ACTIVE",
          refreshTokenPresent: Boolean(row.cred_refresh_present),
          tokenExpiresAtIso: row.cred_expires_at
            ? new Date(row.cred_expires_at).toISOString()
            : null,
          rotatedAtIso: row.cred_rotated_at ? new Date(row.cred_rotated_at).toISOString() : null,
          revokedAtIso: row.cred_revoked_at ? new Date(row.cred_revoked_at).toISOString() : null,
        }
      : null;

    return {
      id: row.id,
      workspaceId: row.workspace_id,
      providerKey: row.provider_key,
      providerDisplayName: catalogEntry?.displayName ?? row.provider_key,
      displayName: row.display_name,
      authMode: row.auth_mode,
      externalAccountId: row.external_account_id,
      externalAccountLabel: row.external_account_label,
      status: row.status,
      requestedScopes,
      grantedScopes,
      missingScopes,
      encryptionKeyVersion: row.encryption_key_version,
      lastErrorCode: row.last_error_code,
      lastErrorSummary: row.last_error_summary,
      lastVerifiedAtIso: row.last_verified_at ? new Date(row.last_verified_at).toISOString() : null,
      lastSyncAtIso: row.last_sync_at ? new Date(row.last_sync_at).toISOString() : null,
      disconnectedAtIso: row.disconnected_at ? new Date(row.disconnected_at).toISOString() : null,
      createdAtIso: new Date(row.created_at).toISOString(),
      updatedAtIso: new Date(row.updated_at).toISOString(),
      credentialSummary,
      connectedResources: resourcesByConn.get(row.id) ?? [],
      mappings: mappingsByConn.get(row.id) ?? [],
      capabilities,
    };
  });

  return {
    connections,
    canManageConnections: roleHasPermission(access.role, "connection:manage"),
  };
}

export async function getWorkspaceConnectionDetail(
  session: AuthenticatedSessionContext | null,
  workspaceId: string,
  connectionId: string,
): Promise<WorkspaceConnectionDetail> {
  assertServerRuntime("getWorkspaceConnectionDetail");

  const { connections } = await listWorkspaceConnections(session, workspaceId);
  const match = connections.find((c) => c.id === connectionId);
  if (!match) {
    throw new AppError({
      code: ERROR_CODES.NOT_FOUND,
      message: "Provider connection not found in this workspace.",
    });
  }

  const auditRes = await dbQuery<{
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
     WHERE a.workspace_id = $1 AND a.entity_id = $2
     ORDER BY a.created_at DESC
     LIMIT 25`,
    [workspaceId, connectionId],
  );

  return {
    ...match,
    auditLogs: auditRes.rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      workspaceId: r.workspace_id,
      actorUserId: r.actor_user_id,
      actorEmail: r.actor_email,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      summary: r.summary,
      metadata: r.metadata ?? {},
      createdAt: new Date(r.created_at).toISOString(),
    })),
  };
}

export async function discoverAndPersistConnectionResources(
  session: AuthenticatedSessionContext | null,
  workspaceId: string,
  connectionId: string,
  options?: {
    keyRing?: VaultKeyRing;
    connectionString?: string;
  },
): Promise<readonly ConnectedResourceRecord[]> {
  assertServerRuntime("discoverAndPersistConnectionResources");

  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "connection:manage",
  });

  const connRes = await dbQuery<{
    id: string;
    workspace_id: string;
    provider_key: string;
    status: ConnectionHealthStatus;
    granted_scopes: string[];
  }>(
    `SELECT id, workspace_id, provider_key, status, granted_scopes
     FROM provider_connections
     WHERE id = $1
     LIMIT 1`,
    [connectionId],
  );

  if (connRes.rows.length === 0 || connRes.rows[0].workspace_id !== workspaceId) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "Connection does not belong to the active workspace.",
    });
  }

  const conn = connRes.rows[0];
  if (conn.status === "DISCONNECTED" || conn.status === "REVOKED") {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Cannot discover resources while connection status is ${conn.status}.`,
    });
  }

  const credHandle = await decryptConnectionCredentialForServer({
    organizationId: access.organizationId,
    workspaceId,
    connectionId,
    keyRing: options?.keyRing,
  });
  const secret = credHandle.exposeSecretForServerAdapter();

  const adapter = getProviderAdapter(conn.provider_key);
  const discovered = await adapter.discoverResources({
    organizationId: access.organizationId,
    workspaceId,
    connectionId,
    accessToken: secret.accessToken,
    apiToken: secret.apiToken,
    grantedScopes: conn.granted_scopes,
  });

  return withTransaction(
    async (client) => {
      const saved: ConnectedResourceRecord[] = [];
      for (const item of discovered) {
        const resId = generateId("res");
        const upsertRes = await dbQuery<{
          id: string;
          provider_connection_id: string;
          workspace_id: string;
          external_resource_id: string;
          resource_type: string;
          display_name: string;
          metadata: Record<string, unknown>;
          created_at: Date;
          updated_at: Date;
        }>(
          `INSERT INTO connected_resources (
             id,
             provider_connection_id,
             workspace_id,
             external_resource_id,
             resource_type,
             display_name,
             metadata
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
           ON CONFLICT (provider_connection_id, external_resource_id) DO UPDATE SET
             display_name = EXCLUDED.display_name,
             resource_type = EXCLUDED.resource_type,
             metadata = EXCLUDED.metadata,
             updated_at = now()
           RETURNING
             id,
             provider_connection_id,
             workspace_id,
             external_resource_id,
             resource_type,
             display_name,
             metadata,
             created_at,
             updated_at`,
          [
            resId,
            connectionId,
            workspaceId,
            item.externalResourceId,
            item.resourceType,
            item.externalResourceName,
            JSON.stringify({
              ...item.metadata,
              regionOrLocation: item.regionOrLocation,
              parentAccountOrOrg: item.parentAccountOrOrg,
              availableCapabilities: item.availableCapabilities,
            }),
          ],
          client,
        );

        const row = upsertRes.rows[0];
        saved.push({
          id: row.id,
          providerConnectionId: row.provider_connection_id,
          workspaceId: row.workspace_id,
          externalResourceId: row.external_resource_id,
          resourceType: row.resource_type,
          displayName: row.display_name,
          metadata: row.metadata ?? {},
          createdAt: new Date(row.created_at).toISOString(),
          updatedAt: new Date(row.updated_at).toISOString(),
        });
      }

      await dbQuery(
        `UPDATE provider_connections
         SET last_verified_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [connectionId],
        client,
      );

      await writeAuditLog(
        {
          organizationId: access.organizationId,
          workspaceId,
          actorUserId: access.session.user.id,
          action: "connection.resources_discovered",
          entityType: "ProviderConnection",
          entityId: connectionId,
          summary: `Discovered ${saved.length} read-only resource(s) for ${conn.provider_key}.`,
          metadata: {
            providerKey: conn.provider_key,
            discoveredCount: saved.length,
            externalResourceIds: saved.map((s) => s.externalResourceId),
          },
        },
        client,
      );

      return saved;
    },
    { connectionString: options?.connectionString },
  );
}

export async function mapResourceToProjectEnvironment(
  session: AuthenticatedSessionContext | null,
  workspaceId: string,
  rawInput: unknown,
  options?: { connectionString?: string },
): Promise<ResourceMappingRecord> {
  assertServerRuntime("mapResourceToProjectEnvironment");

  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "connection:manage",
  });

  const parsed = mapResourceSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: parsed.error.issues.map((i) => i.message).join(" "),
    });
  }
  const input = parsed.data;

  return withTransaction(
    async (client) => {
      // 1. Verify connected_resource belongs to workspaceId and its connection is active
      const resourceRes = await dbQuery<{
        id: string;
        provider_connection_id: string;
        workspace_id: string;
        external_resource_id: string;
        resource_type: string;
        display_name: string;
        provider_key: string;
        conn_status: ConnectionHealthStatus;
      }>(
        `SELECT
           cr.id,
           cr.provider_connection_id,
           cr.workspace_id,
           cr.external_resource_id,
           cr.resource_type,
           cr.display_name,
           pc.provider_key,
           pc.status AS conn_status
         FROM connected_resources cr
         INNER JOIN provider_connections pc ON pc.id = cr.provider_connection_id
         WHERE cr.id = $1
         LIMIT 1`,
        [input.connectedResourceId],
        client,
      );

      if (resourceRes.rows.length === 0) {
        throw new AppError({
          code: ERROR_CODES.NOT_FOUND,
          message: "Connected resource not found.",
        });
      }

      const resource = resourceRes.rows[0];
      if (resource.workspace_id !== workspaceId) {
        throw new AppError({
          code: ERROR_CODES.FORBIDDEN,
          message:
            "Cross-tenant mapping denied: external resource does not belong to this workspace.",
        });
      }

      if (resource.conn_status === "DISCONNECTED" || resource.conn_status === "REVOKED") {
        throw new AppError({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `Cannot map resource from a ${resource.conn_status.toLowerCase()} provider connection.`,
        });
      }

      // 2. Verify logical_project belongs to workspaceId and is ACTIVE
      const projectRes = await dbQuery<{
        id: string;
        workspace_id: string;
        name: string;
        slug: string;
        status: string;
      }>(
        `SELECT id, workspace_id, name, slug, status
         FROM logical_projects
         WHERE id = $1
         LIMIT 1`,
        [input.projectId],
        client,
      );

      if (projectRes.rows.length === 0) {
        throw new AppError({
          code: ERROR_CODES.NOT_FOUND,
          message: "Logical project not found.",
        });
      }

      const project = projectRes.rows[0];
      if (project.workspace_id !== workspaceId) {
        throw new AppError({
          code: ERROR_CODES.FORBIDDEN,
          message:
            "Cross-tenant mapping denied: logical project does not belong to this workspace.",
        });
      }

      if (project.status !== "ACTIVE") {
        throw new AppError({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: "Cannot map external resources to an archived project.",
        });
      }

      // 3. Verify environment (if specified) belongs to the exact projectId
      let environmentName: string | null = null;
      let environmentType: EnvironmentType | null = null;
      if (input.environmentId) {
        const envRes = await dbQuery<{
          id: string;
          project_id: string;
          name: string;
          environment_type: EnvironmentType;
        }>(
          `SELECT id, project_id, name, environment_type
           FROM project_environments
           WHERE id = $1
           LIMIT 1`,
          [input.environmentId],
          client,
        );

        if (envRes.rows.length === 0 || envRes.rows[0].project_id !== input.projectId) {
          throw new AppError({
            code: ERROR_CODES.FORBIDDEN,
            message:
              "Environment ownership mismatch: selected environment does not belong to the target logical project.",
          });
        }
        environmentName = envRes.rows[0].name;
        environmentType = envRes.rows[0].environment_type;
      }

      // 4. Check for duplicate mapping on (projectId, connectedResourceId)
      const dupRes = await dbQuery<{ id: string }>(
        `SELECT id
         FROM resource_mappings
         WHERE project_id = $1 AND connected_resource_id = $2
         LIMIT 1`,
        [input.projectId, input.connectedResourceId],
        client,
      );

      if (dupRes.rows.length > 0) {
        throw new AppError({
          code: ERROR_CODES.CONFLICT,
          message: `Resource "${resource.display_name}" (${resource.external_resource_id}) is already mapped to project "${project.name}".`,
          details: {
            connectedResourceId: [
              `Already mapped to ${project.name}. Unmap the existing entry before re-mapping.`,
            ],
          },
        });
      }

      const mappingId = generateId("map");
      const insertRes = await dbQuery<{ created_at: Date }>(
        `INSERT INTO resource_mappings (
           id,
           workspace_id,
           project_id,
           environment_id,
           connected_resource_id,
           mapping_role,
           created_by_user_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING created_at`,
        [
          mappingId,
          workspaceId,
          input.projectId,
          input.environmentId ?? null,
          input.connectedResourceId,
          input.mappingRole,
          access.session.user.id,
        ],
        client,
      );

      await writeAuditLog(
        {
          organizationId: access.organizationId,
          workspaceId,
          actorUserId: access.session.user.id,
          action: "connection.resource_mapped",
          entityType: "ProviderConnection",
          entityId: resource.provider_connection_id,
          summary: `Mapped ${resource.display_name} (${resource.external_resource_id}) to project "${project.name}"${environmentName ? ` (${environmentName})` : ""}.`,
          metadata: {
            mappingId,
            projectId: project.id,
            projectSlug: project.slug,
            environmentId: input.environmentId ?? null,
            environmentType,
            connectedResourceId: resource.id,
            externalResourceId: resource.external_resource_id,
            providerKey: resource.provider_key,
          },
        },
        client,
      );

      return {
        id: mappingId,
        workspaceId,
        projectId: project.id,
        projectName: project.name,
        projectSlug: project.slug,
        environmentId: input.environmentId ?? null,
        environmentName,
        environmentType,
        connectedResourceId: resource.id,
        externalResourceId: resource.external_resource_id,
        resourceDisplayName: resource.display_name,
        resourceType: resource.resource_type,
        providerConnectionId: resource.provider_connection_id,
        providerKey: resource.provider_key,
        mappingRole: input.mappingRole,
        createdAt: new Date(insertRes.rows[0].created_at).toISOString(),
      };
    },
    { connectionString: options?.connectionString },
  );
}

export async function unmapResourceFromProject(
  session: AuthenticatedSessionContext | null,
  workspaceId: string,
  mappingId: string,
  options?: { connectionString?: string },
): Promise<{ unmappedId: string; providerConnectionId: string }> {
  assertServerRuntime("unmapResourceFromProject");

  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "connection:manage",
  });

  return withTransaction(
    async (client) => {
      const existingRes = await dbQuery<{
        id: string;
        workspace_id: string;
        project_id: string;
        connected_resource_id: string;
        external_resource_id: string;
        display_name: string;
        provider_connection_id: string;
      }>(
        `SELECT
           rm.id,
           rm.workspace_id,
           rm.project_id,
           rm.connected_resource_id,
           cr.external_resource_id,
           cr.display_name,
           cr.provider_connection_id
         FROM resource_mappings rm
         INNER JOIN connected_resources cr ON cr.id = rm.connected_resource_id
         WHERE rm.id = $1
         LIMIT 1`,
        [mappingId],
        client,
      );

      if (existingRes.rows.length === 0) {
        throw new AppError({
          code: ERROR_CODES.NOT_FOUND,
          message: "Resource mapping not found.",
        });
      }

      const row = existingRes.rows[0];
      if (row.workspace_id !== workspaceId) {
        throw new AppError({
          code: ERROR_CODES.FORBIDDEN,
          message: "Cross-tenant unmap denied: mapping does not belong to this workspace.",
        });
      }

      await dbQuery(`DELETE FROM resource_mappings WHERE id = $1`, [mappingId], client);

      await writeAuditLog(
        {
          organizationId: access.organizationId,
          workspaceId,
          actorUserId: access.session.user.id,
          action: "connection.resource_unmapped",
          entityType: "ProviderConnection",
          entityId: row.provider_connection_id,
          summary: `Unmapped resource ${row.display_name} (${row.external_resource_id}) while preserving provider connection grant.`,
          metadata: {
            mappingId: row.id,
            projectId: row.project_id,
            connectedResourceId: row.connected_resource_id,
            externalResourceId: row.external_resource_id,
          },
        },
        client,
      );

      return {
        unmappedId: row.id,
        providerConnectionId: row.provider_connection_id,
      };
    },
    { connectionString: options?.connectionString },
  );
}

export async function validateConnectionHealth(
  session: AuthenticatedSessionContext | null,
  workspaceId: string,
  connectionId: string,
  options?: {
    simulationScenario?: ReadOnlyProviderContext["simulationScenario"];
    keyRing?: VaultKeyRing;
    connectionString?: string;
    now?: Date;
  },
): Promise<ProviderConnectionHealthSnapshot> {
  assertServerRuntime("validateConnectionHealth");

  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "connection:manage",
  });

  return executeConnectionHealthCheck({
    organizationId: access.organizationId,
    workspaceId,
    connectionId,
    actorUserId: access.session.user.id,
    auditAction: "connection.health_validated",
    simulationScenario: options?.simulationScenario,
    keyRing: options?.keyRing,
    connectionString: options?.connectionString,
    now: options?.now,
  });
}

async function executeConnectionHealthCheck(input: {
  organizationId: string;
  workspaceId: string;
  connectionId: string;
  actorUserId: string | null;
  auditAction: "connection.health_validated" | "connection.background_health_checked";
  jobId?: string;
  simulationScenario?: ReadOnlyProviderContext["simulationScenario"];
  keyRing?: VaultKeyRing;
  connectionString?: string;
  now?: Date;
}): Promise<ProviderConnectionHealthSnapshot> {
  const now = input.now ?? new Date();

  const connRes = await dbQuery<{
    id: string;
    workspace_id: string;
    provider_key: string;
    status: ConnectionHealthStatus;
    granted_scopes: string[];
    cred_status: "ACTIVE" | "ROTATED" | "REVOKED" | null;
    cred_expires_at: Date | null;
  }>(
    `SELECT
       pc.id,
       pc.workspace_id,
       pc.provider_key,
       pc.status,
       pc.granted_scopes,
       crd.status AS cred_status,
       crd.token_expires_at AS cred_expires_at
     FROM provider_connections pc
     LEFT JOIN provider_credentials crd ON crd.provider_connection_id = pc.id
     WHERE pc.id = $1
     LIMIT 1`,
    [input.connectionId],
  );

  if (connRes.rows.length === 0 || connRes.rows[0].workspace_id !== input.workspaceId) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "Connection does not belong to the active workspace.",
    });
  }

  const conn = connRes.rows[0];
  if (conn.status === "DISCONNECTED") {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "Cannot run health check on a disconnected provider connection.",
    });
  }

  // Determine effective simulation scenario or credential expiry / revocation state
  let effectiveScenario = input.simulationScenario;
  if (!effectiveScenario) {
    if (conn.status === "REVOKED" || conn.cred_status === "REVOKED") {
      effectiveScenario = "revoked_token";
    } else if (conn.cred_expires_at && new Date(conn.cred_expires_at).getTime() <= now.getTime()) {
      effectiveScenario = "expired_token";
    }
  }

  let accessToken: string | undefined;
  let apiToken: string | undefined;
  if (conn.cred_status !== "REVOKED") {
    try {
      const credHandle = await decryptConnectionCredentialForServer({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        connectionId: input.connectionId,
        keyRing: input.keyRing,
      });
      const secret = credHandle.exposeSecretForServerAdapter();
      accessToken = secret.accessToken;
      apiToken = secret.apiToken;
    } catch {
      effectiveScenario = effectiveScenario ?? "revoked_token";
    }
  }

  const adapter = getProviderAdapter(conn.provider_key);
  const snapshot = await adapter.getConnectionHealth({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    accessToken,
    apiToken,
    grantedScopes: conn.granted_scopes ?? [],
    simulationScenario: effectiveScenario,
  });

  const sanitizedMessage = redactSensitiveText(snapshot.message);
  const errorCode =
    snapshot.status === "HEALTHY"
      ? null
      : (snapshot.errorCode ?? PROVIDER_ERROR_CODES.UNAUTHORIZED);
  const errorSummary = snapshot.status === "HEALTHY" ? null : sanitizedMessage;

  await withTransaction(
    async (client) => {
      await dbQuery(
        `UPDATE provider_connections
         SET status = $2,
             last_error_code = $3,
             last_error_summary = $4,
             last_verified_at = $5,
             last_sync_at = CASE WHEN $2 = 'HEALTHY' THEN $5 ELSE last_sync_at END,
             updated_at = now()
         WHERE id = $1`,
        [input.connectionId, snapshot.status, errorCode, errorSummary, now],
        client,
      );

      await writeAuditLog(
        {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId,
          action: input.auditAction,
          entityType: "ProviderConnection",
          entityId: input.connectionId,
          summary: sanitizedMessage,
          metadata: {
            providerKey: conn.provider_key,
            previousStatus: conn.status,
            nextStatus: snapshot.status,
            uxState: snapshot.uxState,
            latencyMs: snapshot.latencyMs,
            missingScopes: snapshot.missingScopes,
            ...(errorCode ? { errorCode } : {}),
            ...(input.jobId ? { jobId: input.jobId } : {}),
          },
        },
        client,
      );
    },
    { connectionString: input.connectionString },
  );

  return {
    ...snapshot,
    message: sanitizedMessage,
  };
}

export interface TrustedJobContext {
  readonly jobId: string;
  readonly jobType: "connection.scheduled_health_check";
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly issuedAtIso: string;
  readonly signature: string;
}

function getJobSigningSecret(overrideSecret?: string): string {
  if (overrideSecret && overrideSecret.trim().length >= 16) {
    return overrideSecret.trim();
  }
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.trim().length >= 16) {
    return secret.trim();
  }
  return "avenor_trusted_background_job_secret_v1";
}

function computeJobSignature(
  payload: Omit<TrustedJobContext, "signature">,
  secret: string,
): string {
  const canonical = [
    payload.jobId,
    payload.jobType,
    payload.organizationId,
    payload.workspaceId,
    payload.issuedAtIso,
  ].join("|");
  return createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
}

export function createTrustedJobContext(input: {
  organizationId: string;
  workspaceId: string;
  jobSecret?: string;
  issuedAt?: Date;
}): TrustedJobContext {
  assertServerRuntime("createTrustedJobContext");
  const secret = getJobSigningSecret(input.jobSecret);
  const payload: Omit<TrustedJobContext, "signature"> = {
    jobId: generateId("job"),
    jobType: "connection.scheduled_health_check",
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    issuedAtIso: (input.issuedAt ?? new Date()).toISOString(),
  };
  return {
    ...payload,
    signature: computeJobSignature(payload, secret),
  };
}

export function verifyTrustedJobContext(
  jobContext: unknown,
  expectedWorkspaceId: string,
  options?: { jobSecret?: string; maxAgeMs?: number; now?: Date },
): TrustedJobContext {
  assertServerRuntime("verifyTrustedJobContext");

  if (!jobContext || typeof jobContext !== "object") {
    throw new AppError({
      code: ERROR_CODES.UNAUTHENTICATED,
      message: "Untrusted background job rejected: missing job context.",
    });
  }

  const candidate = jobContext as Partial<TrustedJobContext>;
  if (
    typeof candidate.jobId !== "string" ||
    candidate.jobType !== "connection.scheduled_health_check" ||
    typeof candidate.organizationId !== "string" ||
    typeof candidate.workspaceId !== "string" ||
    typeof candidate.issuedAtIso !== "string" ||
    typeof candidate.signature !== "string"
  ) {
    throw new AppError({
      code: ERROR_CODES.UNAUTHENTICATED,
      message: "Untrusted background job rejected: malformed job token.",
    });
  }

  if (candidate.workspaceId !== expectedWorkspaceId) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "Background job workspace scope mismatch: cross-tenant execution denied.",
    });
  }

  const secret = getJobSigningSecret(options?.jobSecret);
  const expectedSig = computeJobSignature(
    {
      jobId: candidate.jobId,
      jobType: candidate.jobType,
      organizationId: candidate.organizationId,
      workspaceId: candidate.workspaceId,
      issuedAtIso: candidate.issuedAtIso,
    },
    secret,
  );

  const actualBuf = Buffer.from(candidate.signature, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    throw new AppError({
      code: ERROR_CODES.UNAUTHENTICATED,
      message: "Untrusted background job rejected: cryptographic signature verification failed.",
    });
  }

  const now = options?.now ?? new Date();
  const maxAgeMs = options?.maxAgeMs ?? 5 * 60 * 1000;
  const issuedMs = Date.parse(candidate.issuedAtIso);
  if (Number.isNaN(issuedMs) || Math.abs(now.getTime() - issuedMs) > maxAgeMs) {
    throw new AppError({
      code: ERROR_CODES.UNAUTHENTICATED,
      message: "Untrusted background job rejected: job token has expired.",
    });
  }

  return candidate as TrustedJobContext;
}

export async function runTrustedBackgroundHealthChecks(
  jobContext: unknown,
  workspaceId: string,
  options?: {
    jobSecret?: string;
    keyRing?: VaultKeyRing;
    connectionString?: string;
    simulationScenario?: ReadOnlyProviderContext["simulationScenario"];
    now?: Date;
  },
): Promise<{
  jobId: string;
  workspaceId: string;
  checkedCount: number;
  results: ProviderConnectionHealthSnapshot[];
}> {
  assertServerRuntime("runTrustedBackgroundHealthChecks");

  const verifiedJob = verifyTrustedJobContext(jobContext, workspaceId, {
    jobSecret: options?.jobSecret,
    now: options?.now,
  });

  const wsRes = await dbQuery<{ id: string; organization_id: string }>(
    `SELECT id, organization_id
     FROM workspaces
     WHERE id = $1
     LIMIT 1`,
    [workspaceId],
  );

  if (wsRes.rows.length === 0 || wsRes.rows[0].organization_id !== verifiedJob.organizationId) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "Background job organization scope mismatch.",
    });
  }

  const activeConns = await dbQuery<{ id: string }>(
    `SELECT id
     FROM provider_connections
     WHERE workspace_id = $1
       AND status != 'DISCONNECTED'
     ORDER BY created_at ASC`,
    [workspaceId],
  );

  const results: ProviderConnectionHealthSnapshot[] = [];
  for (const row of activeConns.rows) {
    const res = await executeConnectionHealthCheck({
      organizationId: verifiedJob.organizationId,
      workspaceId,
      connectionId: row.id,
      actorUserId: null,
      auditAction: "connection.background_health_checked",
      jobId: verifiedJob.jobId,
      simulationScenario: options?.simulationScenario,
      keyRing: options?.keyRing,
      connectionString: options?.connectionString,
      now: options?.now,
    });
    results.push(res);
  }

  return {
    jobId: verifiedJob.jobId,
    workspaceId,
    checkedCount: results.length,
    results,
  };
}
