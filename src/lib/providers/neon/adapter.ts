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
  discoverNeonProjectsAndBranches,
  hasNeonDiscoveryScope,
  mapNeonDiscoveryToExternalResources,
} from "./discovery";
import {
  assertNeonCredentialAndSimulation,
  executeNeonReadOnlyGetJson,
  shouldExecuteLiveNeonApi,
} from "./http";
import { readNeonProjectMetrics } from "./metrics";
import { NEON_API_BASE_URL, NEON_PROVIDER_KEY } from "./types";

/**
 * Strictly read-only Neon Serverless Postgres Control Plane provider adapter.
 * Exposes zero mutation methods, enforces a GET-only HTTP verb and endpoint allowlist,
 * and never opens a Postgres wire connection or executes SQL against customer databases.
 */
export function createNeonReadOnlyAdapter(
  catalogEntry: ProviderCatalogEntry,
  options?: { fetchFn?: typeof fetch },
): ReadOnlyProviderAdapter {
  const fetchFn = options?.fetchFn;

  const adapter: ReadOnlyProviderAdapter = {
    providerKey: NEON_PROVIDER_KEY,
    displayName: catalogEntry.displayName,
    category: catalogEntry.category,
    authMode: catalogEntry.authMode,
    catalogEntry,
    readOnlyGuaranteed: true,

    async validateCredentials(
      context: ReadOnlyProviderContext,
    ): Promise<ProviderCredentialValidationResult> {
      const { token, keyType } = assertNeonCredentialAndSimulation(context);

      if (
        shouldExecuteLiveNeonApi(context, Boolean(fetchFn)) &&
        hasNeonDiscoveryScope(context.grantedScopes)
      ) {
        await executeNeonReadOnlyGetJson({
          url: `${NEON_API_BASE_URL}/projects?limit=1`,
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

      const labelSuffix =
        keyType === "neon_project_scoped_api_key"
          ? "Project-Scoped Control Plane Key (Adapter GET-Only Locked)"
          : "Organization Control Plane Key (Adapter GET-Only Locked)";

      return {
        valid: true,
        externalAccountId: `neon_${context.workspaceId.slice(0, 8)}`,
        externalAccountLabel: `Neon Serverless Postgres — ${labelSuffix}`,
        grantedScopes: context.grantedScopes,
        missingRequiredScopes,
        healthStatus: missingRequiredScopes.length > 0 ? "PERMISSION_MISSING" : "HEALTHY",
        capabilities,
      };
    },

    async discoverResources(
      context: ReadOnlyProviderContext,
    ): Promise<readonly DiscoveredExternalResource[]> {
      const bundle = await discoverNeonProjectsAndBranches(context, {
        fetchFn,
      });
      return mapNeonDiscoveryToExternalResources(bundle, context.grantedScopes);
    },

    async getCapabilities(context: ReadOnlyProviderContext) {
      assertNeonCredentialAndSimulation(context);
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
        const { token } = assertNeonCredentialAndSimulation(context);
        const missingScopes = catalogEntry.defaultScopes.filter(
          (s) => !context.grantedScopes.includes(s),
        );

        if (missingScopes.length > 0 || context.simulationScenario === "missing_scope") {
          return {
            providerKey: NEON_PROVIDER_KEY,
            status: "PERMISSION_MISSING",
            uxState: "permission_insufficient",
            checkedAtIso,
            latencyMs: Date.now() - started,
            grantedScopes: context.grantedScopes,
            missingScopes: missingScopes.length > 0 ? missingScopes : ["neon.consumption.readonly"],
            errorCode: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
            message: "Neon connection is missing required read-only control-plane scope(s).",
          };
        }

        if (context.simulationScenario === "stale_data") {
          return {
            providerKey: NEON_PROVIDER_KEY,
            status: "STALE",
            uxState: "stale_cached",
            checkedAtIso,
            latencyMs: Date.now() - started,
            grantedScopes: context.grantedScopes,
            missingScopes: [],
            message:
              "Neon Control Plane API is reachable, but consumption history ledger is lagging beyond the 60m freshness window.",
          };
        }

        if (shouldExecuteLiveNeonApi(context, Boolean(fetchFn))) {
          await executeNeonReadOnlyGetJson({
            url: `${NEON_API_BASE_URL}/projects?limit=1`,
            apiToken: token,
            fetchFn,
          });
        }

        return {
          providerKey: NEON_PROVIDER_KEY,
          status: "HEALTHY",
          uxState: "connected_healthy",
          checkedAtIso,
          latencyMs: Date.now() - started,
          grantedScopes: context.grantedScopes,
          missingScopes: [],
          message:
            "Neon Control Plane read-only connection verified (GET-only endpoint allowlist enforced; zero customer SQL connections).",
        };
      } catch (err) {
        const adapterErr =
          err instanceof ProviderAdapterError
            ? err
            : new ProviderAdapterError({
                providerKey: NEON_PROVIDER_KEY,
                code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
                message:
                  err instanceof Error ? err.message : "Neon Control Plane health check failed.",
              });

        return {
          providerKey: NEON_PROVIDER_KEY,
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
      return readNeonProjectMetrics(context, query, { fetchFn });
    },
  };

  return adapter;
}
