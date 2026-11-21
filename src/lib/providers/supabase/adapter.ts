import {
  type DiscoveredExternalResource,
  evaluateCapabilityMatrix,
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ProviderCatalogEntry,
  type ProviderConnectionHealthSnapshot,
  type ProviderCredentialValidationResult,
  type ProviderMetricQuery,
  type ProviderMetricReadResult,
  type ReadOnlyProviderAdapter,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import {
  discoverSupabaseProjects,
  hasSupabaseProjectsReadScope,
  mapSupabaseDiscoveryToExternalResources,
} from "./discovery";
import {
  assertSupabaseCredentialAndSimulation,
  executeSupabaseReadOnlyGetJson,
  shouldExecuteLiveSupabaseApi,
} from "./http";
import { readSupabaseProjectMetrics } from "./metrics";
import { SUPABASE_API_BASE_URL, SUPABASE_PROVIDER_KEY } from "./types";

/**
 * Strictly read-only Supabase Management API v1 provider adapter.
 * Exposes zero mutation methods, unconditionally rejects `service_role` JWTs and `sb_secret` keys,
 * blocks `/database/query` and `/api-keys`, and never enumerates raw `auth.users` rows.
 */
export function createSupabaseReadOnlyAdapter(
  catalogEntry: ProviderCatalogEntry,
  options?: { fetchFn?: typeof fetch },
): ReadOnlyProviderAdapter {
  const fetchFn = options?.fetchFn;

  const adapter: ReadOnlyProviderAdapter = {
    providerKey: SUPABASE_PROVIDER_KEY,
    displayName: catalogEntry.displayName,
    category: catalogEntry.category,
    authMode: catalogEntry.authMode,
    catalogEntry,
    readOnlyGuaranteed: true,

    async validateCredentials(
      context: ReadOnlyProviderContext,
    ): Promise<ProviderCredentialValidationResult> {
      const { token } = assertSupabaseCredentialAndSimulation(context);

      if (
        shouldExecuteLiveSupabaseApi(context, Boolean(fetchFn)) &&
        hasSupabaseProjectsReadScope(context.grantedScopes)
      ) {
        await executeSupabaseReadOnlyGetJson({
          url: `${SUPABASE_API_BASE_URL}/projects`,
          apiToken: token,
          fetchFn,
        });
      }

      const missingRequiredScopes = catalogEntry.defaultScopes.filter(
        (reqScope) => !context.grantedScopes.includes(reqScope),
      );
      const capabilities = evaluateCapabilityMatrix(
        catalogEntry.capabilities,
        context.grantedScopes,
        { providerPlanTier: context.providerPlanTier ?? "pro" },
      );

      return {
        valid: true,
        externalAccountId: `supabase_${context.workspaceId.slice(0, 8)}`,
        externalAccountLabel: "Supabase Management API (Read-Only Scoped)",
        grantedScopes: context.grantedScopes,
        missingRequiredScopes,
        healthStatus: missingRequiredScopes.length > 0 ? "PERMISSION_MISSING" : "HEALTHY",
        capabilities,
      };
    },

    async discoverResources(
      context: ReadOnlyProviderContext,
    ): Promise<readonly DiscoveredExternalResource[]> {
      const bundle = await discoverSupabaseProjects(context, { fetchFn });
      return mapSupabaseDiscoveryToExternalResources(bundle, context.grantedScopes);
    },

    async getCapabilities(context: ReadOnlyProviderContext) {
      assertSupabaseCredentialAndSimulation(context);
      const effectiveScopes =
        context.simulationScenario === "missing_scope"
          ? context.grantedScopes.slice(0, 1)
          : context.grantedScopes;
      const effectiveTier =
        context.simulationScenario === "plan_restricted"
          ? "free"
          : (context.providerPlanTier ?? "pro");

      return evaluateCapabilityMatrix(catalogEntry.capabilities, effectiveScopes, {
        providerPlanTier: effectiveTier,
      });
    },

    async getConnectionHealth(
      context: ReadOnlyProviderContext,
    ): Promise<ProviderConnectionHealthSnapshot> {
      const checkedAtIso = new Date().toISOString();
      const started = Date.now();

      try {
        const { token } = assertSupabaseCredentialAndSimulation(context);
        const missingScopes = catalogEntry.defaultScopes.filter(
          (s) => !context.grantedScopes.includes(s),
        );

        if (missingScopes.length > 0 || context.simulationScenario === "missing_scope") {
          return {
            providerKey: SUPABASE_PROVIDER_KEY,
            status: "PERMISSION_MISSING",
            uxState: "permission_insufficient",
            checkedAtIso,
            latencyMs: Date.now() - started,
            grantedScopes: context.grantedScopes,
            missingScopes: missingScopes.length > 0 ? missingScopes : ["analytics:read"],
            errorCode: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
            message:
              "Supabase connection is missing required read-only Management API scope(s) (`projects:read`, `analytics:read`).",
          };
        }

        if (context.simulationScenario === "stale_data") {
          return {
            providerKey: SUPABASE_PROVIDER_KEY,
            status: "STALE",
            uxState: "stale_cached",
            checkedAtIso,
            latencyMs: Date.now() - started,
            grantedScopes: context.grantedScopes,
            missingScopes: [],
            message:
              "Supabase Management API is reachable, but analytics counters are lagging beyond the 60m freshness window.",
          };
        }

        if (shouldExecuteLiveSupabaseApi(context, Boolean(fetchFn))) {
          await executeSupabaseReadOnlyGetJson({
            url: `${SUPABASE_API_BASE_URL}/projects`,
            apiToken: token,
            fetchFn,
          });
        }

        return {
          providerKey: SUPABASE_PROVIDER_KEY,
          status: "HEALTHY",
          uxState: "connected_healthy",
          checkedAtIso,
          latencyMs: Date.now() - started,
          grantedScopes: context.grantedScopes,
          missingScopes: [],
          message:
            "Supabase Management API read-only connection verified (`service_role` and `sb_secret` rejected; zero raw `auth.users` access).",
        };
      } catch (err) {
        const adapterErr =
          err instanceof ProviderAdapterError
            ? err
            : new ProviderAdapterError({
                providerKey: SUPABASE_PROVIDER_KEY,
                code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
                message:
                  err instanceof Error
                    ? err.message
                    : "Supabase Management API health check failed.",
              });

        return {
          providerKey: SUPABASE_PROVIDER_KEY,
          status: adapterErr.healthStatus,
          uxState: adapterErr.uxState,
          checkedAtIso,
          latencyMs: Date.now() - started,
          grantedScopes: context.grantedScopes,
          missingScopes: adapterErr.missingScopes,
          errorCode: adapterErr.code,
          message: adapterErr.message,
        };
      }
    },

    async readMetrics(
      context: ReadOnlyProviderContext,
      query: ProviderMetricQuery,
    ): Promise<ProviderMetricReadResult> {
      return readSupabaseProjectMetrics(context, query, { fetchFn });
    },
  };

  return adapter;
}
