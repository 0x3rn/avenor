import {
  type DiscoveredExternalResource,
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import { evaluateBackendCredentialSafety } from "../backend-feasibility";
import {
  assertNeonCredentialAndSimulation,
  executeNeonReadOnlyGetJson,
  shouldExecuteLiveNeonApi,
} from "./http";
import {
  NEON_API_BASE_URL,
  NEON_PROVIDER_KEY,
  type NeonBranchEnvironmentClass,
  type NeonBranchRecord,
  type NeonDatabaseMetadataRecord,
  type NeonEndpointRecord,
  type NeonProjectDiscoveryBundle,
  type NeonProjectRecord,
} from "./types";

interface NeonApiProjectsResponse {
  projects?: Array<{
    id?: string;
    name?: string;
    region_id?: string;
    pg_version?: number;
    org_id?: string | null;
    created_at?: string;
    updated_at?: string;
    synthetic_storage_size?: number | null;
    branch_logical_size_limit_bytes?: number | null;
    compute_last_active_at?: string | null;
    history_retention_seconds?: number;
    settings?: {
      allowed_ips?: {
        ips?: string[];
        protected_branches_only?: boolean;
      };
    };
  }>;
  pagination?: {
    cursor?: string | null;
  };
}

interface NeonApiBranchesResponse {
  branches?: Array<{
    id?: string;
    project_id?: string;
    name?: string;
    primary?: boolean;
    default?: boolean;
    protected?: boolean;
    current_state?: string;
    logical_size?: number | null;
    created_at?: string;
    updated_at?: string;
  }>;
}

interface NeonApiDatabasesResponse {
  databases?: Array<{
    id?: number;
    branch_id?: string;
    name?: string;
    owner_name?: string;
    created_at?: string;
  }>;
}

interface NeonApiEndpointsResponse {
  endpoints?: Array<{
    id?: string;
    project_id?: string;
    branch_id?: string;
    type?: "read_write" | "read_only";
    current_state?: string;
    autoscaling_limit_min_cu?: number;
    autoscaling_limit_max_cu?: number;
    suspend_timeout_seconds?: number;
  }>;
}

export function classifyNeonBranchEnvironment(branch: {
  name: string;
  isPrimary?: boolean;
  isDefault?: boolean;
  isProtected?: boolean;
}): NeonBranchEnvironmentClass {
  if (
    branch.isPrimary ||
    branch.isDefault ||
    branch.isProtected ||
    /^(main|master|prod|production)$/i.test(branch.name.trim())
  ) {
    return "PRODUCTION";
  }

  if (/^(stg|stage|staging|preview|qa|uat|release)([-_/].*)?$/i.test(branch.name.trim())) {
    return "STAGING";
  }

  return "DEVELOPMENT";
}

const DETERMINISTIC_NEON_PROJECTS: readonly NeonProjectRecord[] = [
  {
    id: "neon-proj-core-prod",
    name: "Core Web App — Neon Serverless Postgres",
    regionId: "aws-us-east-2",
    pgVersion: 17,
    orgId: "org-corstack-01",
    createdAtIso: "2026-01-15T10:00:00.000Z",
    updatedAtIso: "2026-11-20T08:00:00.000Z",
    syntheticStorageSizeBytes: 1_480_000_000,
    branchLogicalSizeLimitBytes: 50_000_000_000,
    computeLastActiveAtIso: "2026-11-21T11:45:00.000Z",
    settings: {
      ipAllowlistEnabled: true,
      ipAllowlistCount: 3,
      protectedBranchesOnly: true,
      historyRetentionSeconds: 604_800,
    },
  },
];

const DETERMINISTIC_NEON_BRANCHES: Readonly<Record<string, readonly NeonBranchRecord[]>> = {
  "neon-proj-core-prod": [
    {
      id: "br-main-prod-01",
      projectId: "neon-proj-core-prod",
      name: "main",
      isPrimary: true,
      isDefault: true,
      isProtected: true,
      currentState: "ready",
      logicalSizeBytes: 1_288_490_188,
      environmentHint: "PRODUCTION",
      createdAtIso: "2026-01-15T10:00:00.000Z",
      updatedAtIso: "2026-11-21T11:45:00.000Z",
    },
    {
      id: "br-staging-preview-02",
      projectId: "neon-proj-core-prod",
      name: "staging",
      isPrimary: false,
      isDefault: false,
      isProtected: false,
      currentState: "ready",
      logicalSizeBytes: 644_245_094,
      environmentHint: "STAGING",
      createdAtIso: "2026-03-01T10:00:00.000Z",
      updatedAtIso: "2026-11-20T18:00:00.000Z",
    },
    {
      id: "br-dev-feature-03",
      projectId: "neon-proj-core-prod",
      name: "dev/feature-metrics",
      isPrimary: false,
      isDefault: false,
      isProtected: false,
      currentState: "idle",
      logicalSizeBytes: 322_122_547,
      environmentHint: "DEVELOPMENT",
      createdAtIso: "2026-11-10T10:00:00.000Z",
      updatedAtIso: "2026-11-19T16:30:00.000Z",
    },
  ],
};

const DETERMINISTIC_NEON_DATABASES: Readonly<
  Record<string, readonly NeonDatabaseMetadataRecord[]>
> = {
  "neon-proj-core-prod": [
    {
      id: 101,
      projectId: "neon-proj-core-prod",
      branchId: "br-main-prod-01",
      name: "neondb",
      ownerName: "neondb_owner",
      createdAtIso: "2026-01-15T10:00:05.000Z",
    },
  ],
};

const DETERMINISTIC_NEON_ENDPOINTS: Readonly<Record<string, readonly NeonEndpointRecord[]>> = {
  "neon-proj-core-prod": [
    {
      id: "ep-cool-darkness-01",
      projectId: "neon-proj-core-prod",
      branchId: "br-main-prod-01",
      type: "read_write",
      currentState: "active",
      autoscalingLimitMinCu: 0.25,
      autoscalingLimitMaxCu: 2,
      suspendTimeoutSeconds: 300,
    },
    {
      id: "ep-replica-readonly-02",
      projectId: "neon-proj-core-prod",
      branchId: "br-main-prod-01",
      type: "read_only",
      currentState: "idle",
      autoscalingLimitMinCu: 0.25,
      autoscalingLimitMaxCu: 1,
      suspendTimeoutSeconds: 300,
    },
  ],
};

export function hasNeonDiscoveryScope(grantedScopes: readonly string[]): boolean {
  return grantedScopes.includes("neon.projects.readonly");
}

export function hasNeonConsumptionScope(grantedScopes: readonly string[]): boolean {
  return grantedScopes.includes("neon.consumption.readonly");
}

export async function discoverNeonProjectsAndBranches(
  context: ReadOnlyProviderContext,
  options?: {
    fetchFn?: typeof fetch;
    maxPages?: number;
  },
): Promise<NeonProjectDiscoveryBundle> {
  const { token, keyType } = assertNeonCredentialAndSimulation(context);

  if (!hasNeonDiscoveryScope(context.grantedScopes)) {
    throw new ProviderAdapterError({
      providerKey: NEON_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
      message:
        "Missing required read-only scope `neon.projects.readonly` for Neon project and branch discovery.",
      missingScopes: ["neon.projects.readonly"],
    });
  }

  const credentialSafety = evaluateBackendCredentialSafety({
    providerKey: "neon",
    credentialType: keyType,
    rawTokenPreview: token,
    methodAllowlistEnforced: true,
  });

  if (!shouldExecuteLiveNeonApi(context, Boolean(options?.fetchFn))) {
    return {
      projects: DETERMINISTIC_NEON_PROJECTS,
      branchesByProject: DETERMINISTIC_NEON_BRANCHES,
      databasesByProject: DETERMINISTIC_NEON_DATABASES,
      endpointsByProject: DETERMINISTIC_NEON_ENDPOINTS,
      credentialSafety,
    };
  }

  const projects: NeonProjectRecord[] = [];
  const branchesByProject: Record<string, readonly NeonBranchRecord[]> = {};
  const databasesByProject: Record<string, readonly NeonDatabaseMetadataRecord[]> = {};
  const endpointsByProject: Record<string, readonly NeonEndpointRecord[]> = {};

  const maxPages = options?.maxPages ?? 5;
  let cursor: string | null = null;
  let pageCount = 0;

  do {
    const projectsUrl = new URL(`${NEON_API_BASE_URL}/projects`);
    projectsUrl.searchParams.set("limit", "50");
    if (cursor) {
      projectsUrl.searchParams.set("cursor", cursor);
    }

    const payload = await executeNeonReadOnlyGetJson<NeonApiProjectsResponse>({
      url: projectsUrl.toString(),
      apiToken: token,
      fetchFn: options?.fetchFn,
    });

    if (!payload || typeof payload !== "object" || !Array.isArray(payload.projects)) {
      throw new ProviderAdapterError({
        providerKey: NEON_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
        message: "Neon /api/v2/projects response missing `projects` array.",
      });
    }

    for (const rawProject of payload.projects) {
      if (!rawProject.id || !rawProject.name) {
        continue;
      }
      const allowedIps = rawProject.settings?.allowed_ips?.ips ?? [];
      projects.push({
        id: rawProject.id,
        name: rawProject.name,
        regionId: rawProject.region_id ?? "aws-us-east-1",
        pgVersion: rawProject.pg_version ?? 16,
        orgId: rawProject.org_id ?? null,
        createdAtIso: rawProject.created_at ?? new Date().toISOString(),
        updatedAtIso: rawProject.updated_at ?? new Date().toISOString(),
        syntheticStorageSizeBytes:
          typeof rawProject.synthetic_storage_size === "number"
            ? rawProject.synthetic_storage_size
            : null,
        branchLogicalSizeLimitBytes:
          typeof rawProject.branch_logical_size_limit_bytes === "number"
            ? rawProject.branch_logical_size_limit_bytes
            : null,
        computeLastActiveAtIso: rawProject.compute_last_active_at ?? null,
        settings: {
          ipAllowlistEnabled: allowedIps.length > 0,
          ipAllowlistCount: allowedIps.length,
          protectedBranchesOnly: Boolean(rawProject.settings?.allowed_ips?.protected_branches_only),
          historyRetentionSeconds:
            typeof rawProject.history_retention_seconds === "number"
              ? rawProject.history_retention_seconds
              : 86_400,
        },
      });
    }

    cursor = payload.pagination?.cursor ?? null;
    pageCount += 1;
  } while (cursor && pageCount < maxPages);

  for (const project of projects) {
    const branchesPayload = await executeNeonReadOnlyGetJson<NeonApiBranchesResponse>({
      url: `${NEON_API_BASE_URL}/projects/${encodeURIComponent(project.id)}/branches`,
      apiToken: token,
      fetchFn: options?.fetchFn,
    });

    const projectBranches: NeonBranchRecord[] = (branchesPayload.branches ?? [])
      .filter((b) => Boolean(b.id && b.name))
      .map((b) => {
        const isPrimary = Boolean(b.primary);
        const isDefault = Boolean(b.default ?? b.primary);
        const isProtected = Boolean(b.protected);
        const name = String(b.name);
        return {
          id: String(b.id),
          projectId: project.id,
          name,
          isPrimary,
          isDefault,
          isProtected,
          currentState: b.current_state ?? "ready",
          logicalSizeBytes: typeof b.logical_size === "number" ? b.logical_size : null,
          environmentHint: classifyNeonBranchEnvironment({
            name,
            isPrimary,
            isDefault,
            isProtected,
          }),
          createdAtIso: b.created_at ?? project.createdAtIso,
          updatedAtIso: b.updated_at ?? project.updatedAtIso,
        };
      });

    branchesByProject[project.id] = projectBranches;

    const defaultBranch =
      projectBranches.find((b) => b.isDefault || b.isPrimary) ?? projectBranches[0];
    if (defaultBranch) {
      const dbPayload = await executeNeonReadOnlyGetJson<NeonApiDatabasesResponse>({
        url: `${NEON_API_BASE_URL}/projects/${encodeURIComponent(project.id)}/branches/${encodeURIComponent(defaultBranch.id)}/databases`,
        apiToken: token,
        fetchFn: options?.fetchFn,
      });

      databasesByProject[project.id] = (dbPayload.databases ?? [])
        .filter((d) => Boolean(d.name))
        .map((d, idx) => ({
          id: typeof d.id === "number" ? d.id : idx + 1,
          projectId: project.id,
          branchId: defaultBranch.id,
          name: String(d.name),
          ownerName: d.owner_name ?? "neondb_owner",
          createdAtIso: d.created_at ?? defaultBranch.createdAtIso,
        }));
    } else {
      databasesByProject[project.id] = [];
    }

    const endpointsPayload = await executeNeonReadOnlyGetJson<NeonApiEndpointsResponse>({
      url: `${NEON_API_BASE_URL}/projects/${encodeURIComponent(project.id)}/endpoints`,
      apiToken: token,
      fetchFn: options?.fetchFn,
    });

    endpointsByProject[project.id] = (endpointsPayload.endpoints ?? [])
      .filter((ep) => Boolean(ep.id))
      .map((ep) => ({
        id: String(ep.id),
        projectId: project.id,
        branchId: ep.branch_id ?? defaultBranch?.id ?? "",
        type: ep.type === "read_only" ? "read_only" : "read_write",
        currentState: ep.current_state ?? "idle",
        autoscalingLimitMinCu:
          typeof ep.autoscaling_limit_min_cu === "number" ? ep.autoscaling_limit_min_cu : 0.25,
        autoscalingLimitMaxCu:
          typeof ep.autoscaling_limit_max_cu === "number" ? ep.autoscaling_limit_max_cu : 1,
        suspendTimeoutSeconds:
          typeof ep.suspend_timeout_seconds === "number" ? ep.suspend_timeout_seconds : 300,
      }));
  }

  return {
    projects,
    branchesByProject,
    databasesByProject,
    endpointsByProject,
    credentialSafety,
  };
}

export function mapNeonDiscoveryToExternalResources(
  bundle: NeonProjectDiscoveryBundle,
  grantedScopes: readonly string[],
): readonly DiscoveredExternalResource[] {
  const availableCapabilities = [
    ...(hasNeonDiscoveryScope(grantedScopes) ? ["resource_discovery"] : []),
    ...(hasNeonConsumptionScope(grantedScopes) ? ["postgres_metadata"] : []),
  ];

  const resources: DiscoveredExternalResource[] = [];

  for (const project of bundle.projects) {
    const branches = bundle.branchesByProject[project.id] ?? [];
    const endpoints = bundle.endpointsByProject[project.id] ?? [];
    const databases = bundle.databasesByProject[project.id] ?? [];
    const defaultBranch = branches.find((b) => b.isDefault || b.isPrimary) ?? branches[0];
    const primaryEndpoint =
      endpoints.find((ep) => ep.type === "read_write") ?? endpoints[0] ?? null;

    const totalInstantaneousBranchBytes = branches.reduce(
      (acc, b) => acc + (b.logicalSizeBytes ?? 0),
      0,
    );

    resources.push({
      externalResourceId: project.id,
      externalResourceName: project.name,
      resourceType: "neon_project",
      regionOrLocation: project.regionId,
      parentAccountOrOrg: project.orgId ?? "Neon Organization",
      availableCapabilities,
      metadata: {
        environmentHint: defaultBranch?.environmentHint ?? "PRODUCTION",
        pgVersion: project.pgVersion,
        branchCount: branches.length,
        databaseCount: databases.length,
        endpointCount: endpoints.length,
        defaultBranchId: defaultBranch?.id ?? null,
        defaultBranchName: defaultBranch?.name ?? "main",
        instantaneousStorageBytes:
          totalInstantaneousBranchBytes > 0
            ? totalInstantaneousBranchBytes
            : project.syntheticStorageSizeBytes,
        minCu: primaryEndpoint?.autoscalingLimitMinCu ?? 0.25,
        maxCu: primaryEndpoint?.autoscalingLimitMaxCu ?? 1,
        suspendTimeoutSeconds: primaryEndpoint?.suspendTimeoutSeconds ?? 300,
        protectedBranchConfigured: branches.some((b) => b.isProtected),
        ipAllowlistConfigured: project.settings.ipAllowlistEnabled,
        historyRetentionSeconds: project.settings.historyRetentionSeconds,
        intrinsicProviderReadOnly: bundle.credentialSafety.intrinsicProviderReadOnly,
        adapterGetOnlyLockActive: bundle.credentialSafety.requiresAdapterMethodAllowlist,
      },
    });
  }

  return resources;
}
