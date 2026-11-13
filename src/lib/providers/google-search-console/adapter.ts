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
import { shouldExecuteLiveGoogleApi } from "../google-shared/http";
import { readSearchAnalyticsReportBundle } from "./reporting";
import {
  assertGscScenarioAndScope,
  discoverSearchConsoleSites,
  hasGscReadOnlyScope,
  listSearchConsoleSites,
  mapGscSitesToDiscoveryItems,
} from "./sites";
import { GSC_READONLY_SCOPE, type GscMetricKey } from "./types";

/**
 * Strictly read-only Google Search Console (`gsc`) provider adapter.
 * Enforces `https://www.googleapis.com/auth/webmasters.readonly` and zero mutations.
 */
export function createGscReadOnlyAdapter(
  catalogEntry: ProviderCatalogEntry,
  options?: { fetchFn?: typeof fetch },
): ReadOnlyProviderAdapter {
  const fetchFn = options?.fetchFn;

  const adapter: ReadOnlyProviderAdapter = {
    providerKey: "gsc",
    displayName: catalogEntry.displayName,
    category: catalogEntry.category,
    authMode: catalogEntry.authMode,
    catalogEntry,
    readOnlyGuaranteed: true,

    async validateCredentials(
      context: ReadOnlyProviderContext,
    ): Promise<ProviderCredentialValidationResult> {
      assertGscScenarioAndScope(context);

      const discovery = await discoverSearchConsoleSites(context, {
        fetchFn,
      });

      const missingRequiredScopes = catalogEntry.defaultScopes.filter(
        (scope) => !context.grantedScopes.includes(scope),
      );

      const capabilities = evaluateCapabilityMatrix(
        catalogEntry.capabilities,
        context.grantedScopes,
        { providerPlanTier: context.providerPlanTier ?? "pro" },
      );

      return {
        valid: missingRequiredScopes.length === 0,
        externalAccountId:
          discovery.sites[0]?.siteUrl ?? `gsc-account-${context.workspaceId.slice(0, 8)}`,
        externalAccountLabel:
          discovery.sites.length > 0
            ? `Search Console (${discovery.sites.length} site${discovery.sites.length === 1 ? "" : "s"})`
            : "Search Console Account (0 verified sites)",
        grantedScopes: context.grantedScopes,
        missingRequiredScopes,
        healthStatus: missingRequiredScopes.length === 0 ? "HEALTHY" : "PERMISSION_MISSING",
        capabilities,
      };
    },

    async discoverResources(
      context: ReadOnlyProviderContext,
    ): Promise<readonly DiscoveredExternalResource[]> {
      assertGscScenarioAndScope(context);
      const discovery = await discoverSearchConsoleSites(context, {
        fetchFn,
      });
      const availableCaps = catalogEntry.capabilities.map((c) => c.capabilityKey);
      return mapGscSitesToDiscoveryItems(discovery.sites, availableCaps);
    },

    async getCapabilities(context: ReadOnlyProviderContext) {
      return evaluateCapabilityMatrix(catalogEntry.capabilities, context.grantedScopes, {
        providerPlanTier: context.providerPlanTier ?? "pro",
      });
    },

    async getConnectionHealth(
      context: ReadOnlyProviderContext,
    ): Promise<ProviderConnectionHealthSnapshot> {
      const checkedAtIso = new Date().toISOString();
      const started = Date.now();

      try {
        assertGscScenarioAndScope(context);

        if (context.simulationScenario === "stale_data") {
          return {
            providerKey: "gsc",
            status: "STALE",
            uxState: "stale_cached",
            checkedAtIso,
            latencyMs: Math.max(1, Date.now() - started),
            grantedScopes: context.grantedScopes,
            missingScopes: [],
            message:
              "Search Console final search analytics data carries normal 48-72 hour indexing lag.",
          };
        }

        if (shouldExecuteLiveGoogleApi(context, Boolean(fetchFn), "gsc")) {
          const sites = await listSearchConsoleSites({
            accessToken: context.accessToken ?? "",
            fetchFn,
          });
          const verifiedCount = sites.filter(
            (s) => s.permissionLevel && s.permissionLevel !== "siteUnverifiedUser",
          ).length;

          if (sites.length > 0 && verifiedCount === 0) {
            return {
              providerKey: "gsc",
              status: "PERMISSION_MISSING",
              uxState: "permission_insufficient",
              checkedAtIso,
              latencyMs: Math.max(1, Date.now() - started),
              grantedScopes: context.grantedScopes,
              missingScopes: [],
              message:
                "Google Search Console returned only unverified properties (`siteUnverifiedUser`). Verify site ownership in Search Console.",
              errorCode: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
            };
          }

          return {
            providerKey: "gsc",
            status: "HEALTHY",
            uxState: "connected_healthy",
            checkedAtIso,
            latencyMs: Math.max(1, Date.now() - started),
            grantedScopes: context.grantedScopes,
            missingScopes: [],
            message:
              sites.length === 0
                ? "Search Console OAuth grant verified; account currently lists 0 sites."
                : `Search Console sites.list read-only probe verified (${verifiedCount} verified property${verifiedCount === 1 ? "" : "ies"}).`,
          };
        }

        const missingScopes = hasGscReadOnlyScope(context.grantedScopes)
          ? []
          : [GSC_READONLY_SCOPE];

        return {
          providerKey: "gsc",
          status: missingScopes.length === 0 ? "HEALTHY" : "PERMISSION_MISSING",
          uxState: missingScopes.length === 0 ? "connected_healthy" : "permission_insufficient",
          checkedAtIso,
          latencyMs: Math.max(1, Date.now() - started),
          grantedScopes: context.grantedScopes,
          missingScopes,
          message:
            context.accessToken === "sbx_empty_account"
              ? "Search Console OAuth grant verified; account currently lists 0 sites."
              : "Search Console read-only connection verified.",
        };
      } catch (error) {
        if (error instanceof ProviderAdapterError) {
          return {
            providerKey: "gsc",
            status: error.healthStatus,
            uxState: error.uxState,
            checkedAtIso,
            latencyMs: Math.max(1, Date.now() - started),
            grantedScopes: context.grantedScopes,
            missingScopes: error.missingScopes,
            message: error.message,
            errorCode: error.code,
          };
        }
        throw error;
      }
    },

    async readMetrics(
      context: ReadOnlyProviderContext,
      query: ProviderMetricQuery,
    ): Promise<ProviderMetricReadResult> {
      const capabilities = await adapter.getCapabilities(context);
      const matchingCap = capabilities.find((cap) => cap.capabilityKey === query.capabilityKey);

      if (!matchingCap) {
        throw new ProviderAdapterError({
          providerKey: "gsc",
          code: PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY,
          message: `Capability "${query.capabilityKey}" is not supported by ${catalogEntry.displayName}.`,
        });
      }

      const observedAtIso = new Date().toISOString();

      if (
        !matchingCap.allowsNumericMetric ||
        context.simulationScenario === "missing_scope" ||
        context.simulationScenario === "plan_restricted"
      ) {
        return {
          providerKey: "gsc",
          externalResourceId: query.externalResourceId,
          capabilityKey: query.capabilityKey,
          metricKey: query.metricKey,
          capabilityStatus: matchingCap.status,
          uxState: matchingCap.uxState,
          observedAtIso,
          sourceFreshnessMinutes: matchingCap.freshnessWindowMinutes,
          provenanceLabel: `${catalogEntry.shortName} • ${query.externalResourceId}`,
          statusExplanation: matchingCap.statusExplanation,
          points: [
            {
              timestampIso: query.startDateIso,
              metricKey: query.metricKey,
              value: null,
              unit: "count",
            },
          ],
        };
      }

      assertGscScenarioAndScope(context);

      const allowedMetrics: readonly GscMetricKey[] = ["clicks", "impressions", "ctr", "position"];
      const normalizedMetric = allowedMetrics.find((m) => m === query.metricKey);
      if (!normalizedMetric) {
        throw new ProviderAdapterError({
          providerKey: "gsc",
          code: PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY,
          message: `Unsupported Search Console metric "${query.metricKey}". Supported metrics: ${allowedMetrics.join(", ")}.`,
        });
      }

      const startDate = query.startDateIso.slice(0, 10);
      const endDate = query.endDateIso.slice(0, 10);

      const bundle = await readSearchAnalyticsReportBundle(
        context,
        {
          siteUrl: query.externalResourceId,
          startDate,
          endDate,
          dimensions: ["date"],
        },
        { fetchFn },
      );

      const points =
        bundle.dailySeries.length > 0
          ? bundle.dailySeries.map((row) => ({
              timestampIso: `${row.date ?? startDate}T00:00:00.000Z`,
              metricKey: normalizedMetric,
              value: row[normalizedMetric],
              unit:
                normalizedMetric === "ctr"
                  ? "ratio"
                  : normalizedMetric === "position"
                    ? "rank"
                    : "count",
              dimensions: {
                reportingTimeZone: bundle.coverage.reportingTimeZone,
                dataState: bundle.dataState,
                searchType: bundle.searchType,
              },
            }))
          : [
              {
                timestampIso: query.startDateIso,
                metricKey: normalizedMetric,
                value: null,
                unit:
                  normalizedMetric === "ctr"
                    ? "ratio"
                    : normalizedMetric === "position"
                      ? "rank"
                      : "count",
                dimensions: {
                  reportingTimeZone: bundle.coverage.reportingTimeZone,
                },
              },
            ];

      const explanation =
        bundle.coverage.notices.length > 0
          ? `${matchingCap.statusExplanation} ${bundle.coverage.notices.join(" ")}`
          : matchingCap.statusExplanation;

      return {
        providerKey: "gsc",
        externalResourceId: bundle.siteUrl,
        capabilityKey: query.capabilityKey,
        metricKey: normalizedMetric,
        capabilityStatus: matchingCap.status,
        uxState:
          bundle.dailySeries.length === 0
            ? "empty_filtered"
            : bundle.coverage.hasPreliminaryDatesInWindow
              ? "stale_cached"
              : matchingCap.uxState,
        observedAtIso: bundle.fetchedAtIso,
        sourceFreshnessMinutes: matchingCap.freshnessWindowMinutes,
        provenanceLabel: `${catalogEntry.shortName} • ${bundle.siteUrl} • ${bundle.coverage.reportingTimeZone} • ${bundle.sourceMode === "live" ? "Live Search Analytics API" : "Sandbox Demo"}`,
        statusExplanation: explanation,
        points,
      };
    },
  };

  return adapter;
}
