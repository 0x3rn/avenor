import {
  type DiscoveredExternalResource,
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import { evaluateBackendCredentialSafety } from "../backend-feasibility";
import {
  assertSupabaseCredentialAndSimulation,
  executeSupabaseReadOnlyGetJson,
  shouldExecuteLiveSupabaseApi,
} from "./http";
import {
  SUPABASE_API_BASE_URL,
  SUPABASE_PROVIDER_KEY,
  type SupabaseProjectDiscoveryBundle,
  type SupabaseProjectLifecycleStatus,
  type SupabaseProjectRecord,
  type SupabaseSubsystemHealth,
} from "./types";

interface SupabaseApiProjectItem {
  id?: string;
  ref?: string;
  name?: string;
  organization_id?: string;
  region?: string;
  status?: string;
  created_at?: string;
  database?: {
    version?: string;
  };
}

interface SupabaseApiHealthItem {
  name?: string;
  healthy?: boolean;
  status?: string;
}

interface SupabaseApiPostgresConfig {
  ssl_enforced?: boolean;
}

interface SupabaseApiAuthConfig {
  mfa_totp_enroll_enabled?: boolean;
  mfa_totp_verify_enabled?: boolean;
  mailer_autoconfirm?: boolean;
}

interface SupabaseApiNetworkRestrictions {
  config?: {
    dbAllowedCidrs?: string[];
  };
}

export function hasSupabaseProjectsReadScope(grantedScopes: readonly string[]): boolean {
  return grantedScopes.includes("projects:read");
}

export function hasSupabaseAnalyticsReadScope(grantedScopes: readonly string[]): boolean {
  return grantedScopes.includes("analytics:read");
}

const DETERMINISTIC_SUPABASE_PROJECTS: readonly SupabaseProjectRecord[] = [
  {
    ref: "sbref-core-prod-01",
    name: "Core Web App — Supabase Production",
    organizationId: "sb-org-corstack",
    region: "us-east-1",
    status: "ACTIVE_HEALTHY",
    databaseVersion: "15.8.1.044",
    createdAtIso: "2026-02-10T09:00:00.000Z",
    services: [
      { name: "db", healthy: true, status: "ACTIVE_HEALTHY" },
      { name: "auth", healthy: true, status: "ACTIVE_HEALTHY" },
      { name: "rest", healthy: true, status: "ACTIVE_HEALTHY" },
      { name: "storage", healthy: true, status: "ACTIVE_HEALTHY" },
      { name: "realtime", healthy: true, status: "ACTIVE_HEALTHY" },
    ],
    securityConfig: {
      sslEnforced: true,
      networkRestrictionsConfigured: true,
      mfaTotpEnabled: true,
      emailConfirmationEnabled: true,
      rlsVerificationStatus: "NOT_VERIFIED",
      rlsQualificationNote:
        "Table-level Row Level Security (pg_class.relrowsecurity) is not directly inspectable via read-only Management API without SQL execution; classified as NOT_VERIFIED.",
    },
  },
];

function normalizeSupabaseStatus(rawStatus: string | undefined): SupabaseProjectLifecycleStatus {
  const upper = (rawStatus ?? "ACTIVE_HEALTHY").toUpperCase();
  if (
    upper === "ACTIVE_HEALTHY" ||
    upper === "INACTIVE" ||
    upper === "COMING_UP" ||
    upper === "RESTORING"
  ) {
    return upper;
  }
  return "UNKNOWN";
}

export async function discoverSupabaseProjects(
  context: ReadOnlyProviderContext,
  options?: { fetchFn?: typeof fetch },
): Promise<SupabaseProjectDiscoveryBundle> {
  const { token, credentialType } = assertSupabaseCredentialAndSimulation(context);

  if (!hasSupabaseProjectsReadScope(context.grantedScopes)) {
    throw new ProviderAdapterError({
      providerKey: SUPABASE_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
      message: "Missing required read-only scope `projects:read` for Supabase project discovery.",
      missingScopes: ["projects:read"],
    });
  }

  const credentialSafety = evaluateBackendCredentialSafety({
    providerKey: "supabase",
    credentialType,
    rawTokenPreview: token,
    grantedScopes: context.grantedScopes,
  });

  if (!shouldExecuteLiveSupabaseApi(context, Boolean(options?.fetchFn))) {
    return {
      projects: DETERMINISTIC_SUPABASE_PROJECTS,
      credentialSafety,
    };
  }

  const rawProjects = await executeSupabaseReadOnlyGetJson<SupabaseApiProjectItem[]>({
    url: `${SUPABASE_API_BASE_URL}/projects`,
    apiToken: token,
    fetchFn: options?.fetchFn,
  });

  if (!Array.isArray(rawProjects)) {
    throw new ProviderAdapterError({
      providerKey: SUPABASE_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: "Supabase /v1/projects response must be a JSON array.",
    });
  }

  const projects: SupabaseProjectRecord[] = [];
  for (const item of rawProjects) {
    const ref = item.ref ?? item.id;
    if (!ref || !item.name) {
      continue;
    }

    const status = normalizeSupabaseStatus(item.status);
    let services: SupabaseSubsystemHealth[] = [
      { name: "db", healthy: status === "ACTIVE_HEALTHY", status },
      { name: "auth", healthy: status === "ACTIVE_HEALTHY", status },
      { name: "rest", healthy: status === "ACTIVE_HEALTHY", status },
      { name: "storage", healthy: status === "ACTIVE_HEALTHY", status },
      { name: "realtime", healthy: status === "ACTIVE_HEALTHY", status },
    ];

    let sslEnforced = false;
    let networkRestrictionsConfigured = false;
    let mfaTotpEnabled = false;
    let emailConfirmationEnabled = true;

    if (status === "ACTIVE_HEALTHY") {
      try {
        const healthPayload = await executeSupabaseReadOnlyGetJson<SupabaseApiHealthItem[]>({
          url: `${SUPABASE_API_BASE_URL}/projects/${encodeURIComponent(ref)}/health`,
          apiToken: token,
          fetchFn: options?.fetchFn,
        });
        if (Array.isArray(healthPayload) && healthPayload.length > 0) {
          services = healthPayload
            .filter(
              (
                h,
              ): h is {
                name: SupabaseSubsystemHealth["name"];
                healthy?: boolean;
                status?: string;
              } =>
                h.name === "db" ||
                h.name === "auth" ||
                h.name === "realtime" ||
                h.name === "storage" ||
                h.name === "rest",
            )
            .map((h) => ({
              name: h.name,
              healthy: Boolean(h.healthy),
              status: h.status ?? "ACTIVE_HEALTHY",
            }));
        }
      } catch {
        // Keep baseline service health when detailed health endpoint is restricted
      }

      try {
        const pgConfig = await executeSupabaseReadOnlyGetJson<SupabaseApiPostgresConfig>({
          url: `${SUPABASE_API_BASE_URL}/projects/${encodeURIComponent(ref)}/config/database/postgres`,
          apiToken: token,
          fetchFn: options?.fetchFn,
        });
        sslEnforced = Boolean(pgConfig?.ssl_enforced);
      } catch {
        // Non-fatal metadata enrichment
      }

      try {
        const authConfig = await executeSupabaseReadOnlyGetJson<SupabaseApiAuthConfig>({
          url: `${SUPABASE_API_BASE_URL}/projects/${encodeURIComponent(ref)}/config/auth`,
          apiToken: token,
          fetchFn: options?.fetchFn,
        });
        mfaTotpEnabled = Boolean(
          authConfig?.mfa_totp_enroll_enabled && authConfig?.mfa_totp_verify_enabled,
        );
        emailConfirmationEnabled = authConfig?.mailer_autoconfirm === false;
      } catch {
        // Non-fatal metadata enrichment
      }

      try {
        const netConfig = await executeSupabaseReadOnlyGetJson<SupabaseApiNetworkRestrictions>({
          url: `${SUPABASE_API_BASE_URL}/projects/${encodeURIComponent(ref)}/network-restrictions`,
          apiToken: token,
          fetchFn: options?.fetchFn,
        });
        const cidrs = netConfig?.config?.dbAllowedCidrs ?? [];
        networkRestrictionsConfigured = cidrs.length > 0 && !cidrs.includes("0.0.0.0/0");
      } catch {
        // Non-fatal metadata enrichment
      }
    }

    projects.push({
      ref,
      name: item.name,
      organizationId: item.organization_id ?? "sb-org",
      region: item.region ?? "us-east-1",
      status,
      databaseVersion: item.database?.version ?? "15",
      createdAtIso: item.created_at ?? new Date().toISOString(),
      services,
      securityConfig: {
        sslEnforced,
        networkRestrictionsConfigured,
        mfaTotpEnabled,
        emailConfirmationEnabled,
        rlsVerificationStatus: "NOT_VERIFIED",
        rlsQualificationNote:
          "Table-level Row Level Security (pg_class.relrowsecurity) is not directly inspectable via read-only Management API without SQL execution; classified as NOT_VERIFIED.",
      },
    });
  }

  return {
    projects,
    credentialSafety,
  };
}

export function mapSupabaseDiscoveryToExternalResources(
  bundle: SupabaseProjectDiscoveryBundle,
  grantedScopes: readonly string[],
): readonly DiscoveredExternalResource[] {
  const availableCapabilities = [
    ...(hasSupabaseProjectsReadScope(grantedScopes) ? ["resource_discovery"] : []),
    ...(hasSupabaseProjectsReadScope(grantedScopes) && hasSupabaseAnalyticsReadScope(grantedScopes)
      ? ["postgres_metadata", "user_count_posture"]
      : []),
  ];

  return bundle.projects.map((project) => {
    const healthyServicesCount = project.services.filter((s) => s.healthy).length;
    const isProdHint = !/(stg|staging|dev|preview|test)/i.test(project.name);

    return {
      externalResourceId: project.ref,
      externalResourceName: project.name,
      resourceType: "supabase_project",
      regionOrLocation: project.region,
      parentAccountOrOrg: project.organizationId,
      availableCapabilities,
      metadata: {
        environmentHint: isProdHint ? "PRODUCTION" : "STAGING",
        projectRef: project.ref,
        status: project.status,
        databaseVersion: project.databaseVersion,
        healthyServicesCount,
        totalServicesCount: project.services.length,
        sslEnforced: project.securityConfig.sslEnforced,
        networkRestrictionsConfigured: project.securityConfig.networkRestrictionsConfigured,
        mfaTotpEnabled: project.securityConfig.mfaTotpEnabled,
        emailConfirmationEnabled: project.securityConfig.emailConfirmationEnabled,
        rlsVerificationStatus: project.securityConfig.rlsVerificationStatus,
        serviceRoleRejectedByDefault: true,
      },
    };
  });
}
