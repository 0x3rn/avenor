import {
  type AuthenticatedSessionContext,
  authorizeProjectAccess,
  decryptConnectionCredentialForServer,
  type VaultKeyRing,
} from "@avenor/auth";
import { assertServerRuntime } from "@avenor/config";
import { dbQuery } from "@avenor/database";
import {
  type AvenorUxState,
  type ConnectionHealthStatus,
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import { listWorkspaceConnections } from "./service";

export interface ResolvedProjectBindingOption {
  mappingId: string;
  connectionId: string;
  connectionDisplayName: string;
  connectionStatus: ConnectionHealthStatus;
  connectedResourceId: string;
  externalResourceId: string;
  resourceDisplayName: string;
  resourceType: string;
  environmentId: string | null;
  environmentName: string | null;
  environmentType: string | null;
  mappingRole: string;
  metadata: Record<string, string | number | boolean | null>;
  grantedScopes: string[];
  missingScopes: string[];
  lastErrorCode: string | null;
  lastErrorSummary: string | null;
}

export interface ProjectTelemetryBindingResolution {
  projectId: string;
  projectName: string;
  projectSlug: string;
  primaryDomain: string | null;
  organizationId: string;
  workspaceId: string;
  providerKey: string;
  state:
    | {
        kind: "ready";
        binding: ResolvedProjectBindingOption;
        allBindings: ResolvedProjectBindingOption[];
        providerContext: ReadOnlyProviderContext;
      }
    | {
        kind: "blocked";
        uxState: AvenorUxState;
        connectionStatus: ConnectionHealthStatus | null;
        message: string;
        actionLabel: string;
        actionHref: string;
        availableBindings: ResolvedProjectBindingOption[];
        workspaceUnmappedCount: number;
      };
}

function getRequiredReadOnlyScope(providerKey: "ga4" | "gsc"): string {
  return providerKey === "ga4"
    ? "https://www.googleapis.com/auth/analytics.readonly"
    : "https://www.googleapis.com/auth/webmasters.readonly";
}

function sanitizePrimitiveMetadata(
  raw: Record<string, unknown> | undefined | null,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (!raw) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out[key] = value;
    }
  }
  return out;
}

function mapConnectionStatusToBlockedUxState(status: ConnectionHealthStatus): AvenorUxState {
  switch (status) {
    case "PERMISSION_MISSING":
      return "permission_insufficient";
    case "RATE_LIMITED":
      return "rate_limited";
    case "STALE":
      return "stale_cached";
    case "PROVIDER_UNAVAILABLE":
    case "DEGRADED":
      return "provider_error";
    case "TOKEN_EXPIRED":
    case "REVOKED":
    case "DISCONNECTED":
      return "unconnected";
    default:
      return "provider_error";
  }
}

/**
 * Resolves a project's mapped read-only provider connection + decrypted credential strictly
 * within the authorized organization/workspace/project tenant boundary.
 * Never returns raw secrets in client-serializable state and returns honest UX state blocks
 * when unconnected, unmapped, revoked, expired, or missing read-only scopes.
 */
export async function resolveProjectProviderTelemetryContext(
  session: AuthenticatedSessionContext | null,
  projectId: string,
  providerKey: "ga4" | "gsc",
  options?: {
    environmentId?: string | null;
    resourceId?: string | null;
    keyRing?: VaultKeyRing;
    simulationScenario?: ReadOnlyProviderContext["simulationScenario"];
  },
): Promise<ProjectTelemetryBindingResolution> {
  assertServerRuntime("resolveProjectProviderTelemetryContext");

  const access = await authorizeProjectAccess({
    session,
    projectId,
    expectedWorkspaceId: session?.activeWorkspace.id,
    requiredPermission: "project:read",
  });

  const projectRes = await dbQuery<{
    id: string;
    name: string;
    slug: string;
    primary_domain: string | null;
  }>(
    `SELECT id, name, slug, primary_domain
     FROM logical_projects
     WHERE id = $1 AND workspace_id = $2
     LIMIT 1`,
    [access.projectId, access.workspaceId],
  );

  const projectRow = projectRes.rows[0];
  if (!projectRow) {
    throw new ProviderAdapterError({
      providerKey,
      code: PROVIDER_ERROR_CODES.RESOURCE_NOT_FOUND,
      message: "Project could not be loaded inside the active workspace.",
    });
  }

  const { connections } = await listWorkspaceConnections(session, access.workspaceId);
  const matchingConns = connections.filter(
    (conn) => conn.providerKey === providerKey && conn.status !== "DISCONNECTED",
  );

  const allBindings: ResolvedProjectBindingOption[] = [];
  for (const conn of matchingConns) {
    for (const mapping of conn.mappings) {
      if (mapping.projectId !== access.projectId) continue;
      const resource = conn.connectedResources.find((r) => r.id === mapping.connectedResourceId);
      if (!resource) continue;

      allBindings.push({
        mappingId: mapping.id,
        connectionId: conn.id,
        connectionDisplayName: conn.displayName,
        connectionStatus: conn.status,
        connectedResourceId: resource.id,
        externalResourceId: resource.externalResourceId,
        resourceDisplayName: resource.displayName,
        resourceType: resource.resourceType,
        environmentId: mapping.environmentId,
        environmentName: mapping.environmentName,
        environmentType: mapping.environmentType,
        mappingRole: mapping.mappingRole,
        metadata: sanitizePrimitiveMetadata(resource.metadata),
        grantedScopes: [...conn.grantedScopes],
        missingScopes: [...conn.missingScopes],
        lastErrorCode: conn.lastErrorCode,
        lastErrorSummary: conn.lastErrorSummary,
      });
    }
  }

  const providerLabel = providerKey === "ga4" ? "Google Analytics 4" : "Google Search Console";
  const baseReturn = {
    projectId: projectRow.id,
    projectName: projectRow.name,
    projectSlug: projectRow.slug,
    primaryDomain: projectRow.primary_domain,
    organizationId: access.organizationId,
    workspaceId: access.workspaceId,
    providerKey,
  };

  if (allBindings.length === 0) {
    const workspaceUnmappedCount = matchingConns.reduce(
      (sum, conn) => sum + conn.connectedResources.length,
      0,
    );
    return {
      ...baseReturn,
      state: {
        kind: "blocked",
        uxState: matchingConns.length > 0 ? "partial_coverage" : "unconnected",
        connectionStatus: null,
        message:
          matchingConns.length > 0
            ? `${providerLabel} is connected to your workspace (${workspaceUnmappedCount} discovered resource${workspaceUnmappedCount === 1 ? "" : "s"}), but no property is mapped to "${projectRow.name}" yet.`
            : `${providerLabel} is not connected in this workspace yet. Connect it read-only and map a property to view telemetry.`,
        actionLabel:
          matchingConns.length > 0 ? `Map ${providerLabel} property` : `Connect ${providerLabel}`,
        actionHref: `/connections?provider=${providerKey}`,
        availableBindings: [],
        workspaceUnmappedCount,
      },
    };
  }

  // Sort preferred binding: explicit resourceId match -> explicit environmentId -> PRIMARY production -> PRIMARY -> first
  const sorted = [...allBindings].sort((a, b) => {
    const score = (item: ResolvedProjectBindingOption): number => {
      let val = 0;
      if (options?.resourceId && item.externalResourceId === options.resourceId) val += 100;
      if (options?.environmentId && item.environmentId === options.environmentId) val += 50;
      if (item.environmentType === "PRODUCTION") val += 20;
      if (item.mappingRole === "PRIMARY") val += 10;
      if (item.connectionStatus === "HEALTHY") val += 5;
      return val;
    };
    return score(b) - score(a);
  });

  const selected = sorted[0];
  if (!selected) {
    throw new ProviderAdapterError({
      providerKey,
      code: PROVIDER_ERROR_CODES.RESOURCE_NOT_FOUND,
      message: `No mapped ${providerLabel} binding found.`,
    });
  }

  const requiredScope = getRequiredReadOnlyScope(providerKey);
  if (selected.grantedScopes.length > 0 && !selected.grantedScopes.includes(requiredScope)) {
    return {
      ...baseReturn,
      state: {
        kind: "blocked",
        uxState: "permission_insufficient",
        connectionStatus: "PERMISSION_MISSING",
        message: `${providerLabel} grant for "${selected.resourceDisplayName}" is missing required read-only scope (${requiredScope}).`,
        actionLabel: "Re-authorize read-only scope",
        actionHref: `/connections?provider=${providerKey}`,
        availableBindings: sorted,
        workspaceUnmappedCount: 0,
      },
    };
  }

  if (
    selected.connectionStatus === "TOKEN_EXPIRED" ||
    selected.connectionStatus === "REVOKED" ||
    selected.connectionStatus === "PERMISSION_MISSING" ||
    selected.connectionStatus === "PROVIDER_UNAVAILABLE" ||
    selected.connectionStatus === "DEGRADED"
  ) {
    return {
      ...baseReturn,
      state: {
        kind: "blocked",
        uxState: mapConnectionStatusToBlockedUxState(selected.connectionStatus),
        connectionStatus: selected.connectionStatus,
        message:
          selected.lastErrorSummary ??
          `${providerLabel} connection "${selected.connectionDisplayName}" requires attention (${selected.connectionStatus.toLowerCase().replaceAll("_", " ")}).`,
        actionLabel:
          selected.connectionStatus === "TOKEN_EXPIRED" || selected.connectionStatus === "REVOKED"
            ? "Reconnect read-only access"
            : "Inspect connection health",
        actionHref: `/connections?provider=${providerKey}`,
        availableBindings: sorted,
        workspaceUnmappedCount: 0,
      },
    };
  }

  const credHandle = await decryptConnectionCredentialForServer({
    organizationId: access.organizationId,
    workspaceId: access.workspaceId,
    connectionId: selected.connectionId,
    keyRing: options?.keyRing,
  });
  const secrets = credHandle.exposeSecretForServerAdapter();

  return {
    ...baseReturn,
    state: {
      kind: "ready",
      binding: selected,
      allBindings: sorted,
      providerContext: {
        organizationId: access.organizationId,
        workspaceId: access.workspaceId,
        connectionId: selected.connectionId,
        accessToken: secrets.accessToken,
        grantedScopes: selected.grantedScopes.length > 0 ? selected.grantedScopes : [requiredScope],
        simulationScenario: options?.simulationScenario,
      },
    },
  };
}
