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
import {
  assertGa4ScenarioAndScope,
  discoverGa4PropertiesAndStreams,
  hasGa4ReadOnlyScope,
  listGa4AccountSummaries,
  mapGa4PropertiesToDiscoveryItems,
} from "./admin";
import { resolveGa4MetricDefinition, validateGa4RealtimeQueryInputs } from "./dictionary";
import { readGa4RealtimeReportBundle } from "./realtime";
import { readGa4StandardReportBundle } from "./reporting";
import { GA4_READONLY_SCOPE } from "./types";

/**
 * Strictly read-only Google Analytics 4 (GA4) provider adapter.
 * Exposes zero write/mutation methods and delegates Admin API discovery cleanly.
 */
export function createGa4ReadOnlyAdapter(
  catalogEntry: ProviderCatalogEntry,
  options?: { fetchFn?: typeof fetch },
): ReadOnlyProviderAdapter {
  const fetchFn = options?.fetchFn;

  const adapter: ReadOnlyProviderAdapter = {
    providerKey: "ga4",
    displayName: catalogEntry.displayName,
    category: catalogEntry.category,
    authMode: catalogEntry.authMode,
    catalogEntry,
    readOnlyGuaranteed: true,

    async validateCredentials(
      context: ReadOnlyProviderContext,
    ): Promise<ProviderCredentialValidationResult> {
      assertGa4ScenarioAndScope(context);

      const hasToken = Boolean(context.accessToken || context.apiToken);
      if (!hasToken) {
        throw new ProviderAdapterError({
          providerKey: "ga4",
          code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
          message: "Missing Google Analytics read-only credential token.",
        });
      }

      if (shouldExecuteLiveGoogleApi(context, Boolean(fetchFn), "ga4")) {
        await listGa4AccountSummaries({
          accessToken: context.accessToken ?? "",
          fetchFn,
          pageSize: 1,
          maxPages: 1,
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
        externalAccountId: `google_ga4_${context.workspaceId.slice(0, 8)}`,
        externalAccountLabel: "Google Analytics (Read-Only)",
        grantedScopes: context.grantedScopes,
        missingRequiredScopes,
        healthStatus: missingRequiredScopes.length > 0 ? "PERMISSION_MISSING" : "HEALTHY",
        capabilities,
      };
    },

    async discoverResources(
      context: ReadOnlyProviderContext,
    ): Promise<readonly DiscoveredExternalResource[]> {
      const discovery = await discoverGa4PropertiesAndStreams(context, {
        fetchFn,
      });
      const availableCaps = catalogEntry.capabilities.map((c) => c.capabilityKey);
      return mapGa4PropertiesToDiscoveryItems(discovery.properties, availableCaps);
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
        assertGa4ScenarioAndScope(context);
        const missingScopes = catalogEntry.defaultScopes.filter(
          (s) => !context.grantedScopes.includes(s),
        );

        if (missingScopes.length > 0 || !hasGa4ReadOnlyScope(context.grantedScopes)) {
          return {
            providerKey: "ga4",
            status: "PERMISSION_MISSING",
            uxState: "permission_insufficient",
            checkedAtIso,
            latencyMs: Math.max(1, Date.now() - started),
            grantedScopes: context.grantedScopes,
            missingScopes: missingScopes.length > 0 ? missingScopes : [GA4_READONLY_SCOPE],
            message: `Google Analytics connection is missing read-only scope: ${GA4_READONLY_SCOPE}.`,
            errorCode: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
          };
        }

        if (context.simulationScenario === "stale_data") {
          return {
            providerKey: "ga4",
            status: "STALE",
            uxState: "stale_cached",
            checkedAtIso,
            latencyMs: Math.max(1, Date.now() - started),
            grantedScopes: context.grantedScopes,
            missingScopes: [],
            message: "Google Analytics data freshness exceeded expected processing window.",
          };
        }

        if (shouldExecuteLiveGoogleApi(context, Boolean(fetchFn), "ga4")) {
          const probe = await listGa4AccountSummaries({
            accessToken: context.accessToken ?? "",
            fetchFn,
            pageSize: 1,
            maxPages: 1,
          });
          return {
            providerKey: "ga4",
            status: "HEALTHY",
            uxState: "connected_healthy",
            checkedAtIso,
            latencyMs: Math.max(1, Date.now() - started),
            grantedScopes: context.grantedScopes,
            missingScopes: [],
            message:
              probe.accountSummaries.length === 0
                ? "Google Analytics OAuth grant verified; account currently lists 0 GA4 properties."
                : "Google Analytics Admin API read-only probe succeeded.",
          };
        }

        return {
          providerKey: "ga4",
          status: "HEALTHY",
          uxState: "connected_healthy",
          checkedAtIso,
          latencyMs: Math.max(1, Date.now() - started),
          grantedScopes: context.grantedScopes,
          missingScopes: [],
          message:
            context.accessToken === "sbx_empty_account"
              ? "Google Analytics OAuth grant verified; account currently lists 0 GA4 properties."
              : "Google Analytics Admin API read-only connection verified.",
        };
      } catch (error) {
        if (error instanceof ProviderAdapterError) {
          return {
            providerKey: "ga4",
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
          providerKey: "ga4",
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
          providerKey: "ga4",
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

      assertGa4ScenarioAndScope(context);

      if (query.capabilityKey === "realtime_activity") {
        validateGa4RealtimeQueryInputs({
          metrics: [query.metricKey],
          dimensions: query.dimensions,
        });

        const realtime = await readGa4RealtimeReportBundle(
          context,
          {
            propertyId: query.externalResourceId,
            metrics: [query.metricKey],
            dimensions: query.dimensions,
          },
          { fetchFn },
        );

        const metricValue =
          query.metricKey === "screenPageViews"
            ? realtime.screenPageViewsLast30m
            : query.metricKey === "eventCount"
              ? realtime.eventCountLast30m
              : realtime.activeUsersLast30m;

        return {
          providerKey: "ga4",
          externalResourceId: realtime.propertyName,
          capabilityKey: query.capabilityKey,
          metricKey: query.metricKey,
          capabilityStatus: matchingCap.status,
          uxState: realtime.rateLimited
            ? "rate_limited"
            : realtime.stale
              ? "stale_cached"
              : matchingCap.uxState,
          observedAtIso: realtime.observedAtIso,
          sourceFreshnessMinutes: Math.max(1, Math.ceil(realtime.freshnessSeconds / 60)),
          provenanceLabel: `${catalogEntry.shortName} • ${realtime.propertyName} • ${realtime.windowLabel} • ${realtime.sourceMode === "live" ? "Live Realtime API" : "Sandbox Demo"}`,
          statusExplanation: `${matchingCap.statusExplanation} ${realtime.isEstimateNotice}`,
          points: [
            {
              timestampIso: realtime.observedAtIso,
              metricKey: query.metricKey,
              value: metricValue,
              unit:
                query.metricKey === "screenPageViews"
                  ? "views"
                  : query.metricKey === "eventCount"
                    ? "events"
                    : "users",
              dimensions: {
                window: "30m_estimate",
                stale: String(realtime.stale),
                rateLimited: String(realtime.rateLimited),
              },
            },
          ],
        };
      }

      const metricDef = resolveGa4MetricDefinition(query.metricKey);
      const startDate = query.startDateIso.slice(0, 10);
      const endDate = query.endDateIso.slice(0, 10);

      const report = await readGa4StandardReportBundle(
        context,
        {
          propertyId: query.externalResourceId,
          startDate,
          endDate,
        },
        { fetchFn },
      );

      const seriesKey = metricDef.avenorKey as keyof (typeof report.dailySeries)[number];
      const points =
        report.dailySeries.length > 0
          ? report.dailySeries.map((day) => {
              const rawVal = day[seriesKey];
              const value = typeof rawVal === "number" ? rawVal : null;
              return {
                timestampIso: `${day.date}T00:00:00.000Z`,
                metricKey: metricDef.avenorKey,
                value,
                unit: metricDef.unit,
                dimensions: {
                  reportingTimeZone: report.reportingTimeZone,
                },
              };
            })
          : [
              {
                timestampIso: query.startDateIso,
                metricKey: metricDef.avenorKey,
                value: null,
                unit: metricDef.unit,
                dimensions: {
                  reportingTimeZone: report.reportingTimeZone,
                },
              },
            ];

      const explanation =
        report.dataQuality.notices.length > 0
          ? `${matchingCap.statusExplanation} ${report.dataQuality.notices.join(" ")}`
          : matchingCap.statusExplanation;

      return {
        providerKey: "ga4",
        externalResourceId: report.propertyName,
        capabilityKey: query.capabilityKey,
        metricKey: metricDef.avenorKey,
        capabilityStatus: matchingCap.status,
        uxState:
          report.dataQuality.emptyReason === "NO_DATA"
            ? "empty_filtered"
            : report.dataQuality.isSampled || report.dataQuality.isThresholded
              ? "partial_coverage"
              : matchingCap.uxState,
        observedAtIso: report.fetchedAtIso,
        sourceFreshnessMinutes: matchingCap.freshnessWindowMinutes,
        provenanceLabel: `${catalogEntry.shortName} • ${report.propertyName} • ${report.reportingTimeZone} • ${report.sourceMode === "live" ? "Live Data API" : "Sandbox Demo"}`,
        statusExplanation: explanation,
        points,
      };
    },
  };

  return adapter;
}
