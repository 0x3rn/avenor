import {
  type DiscoveredExternalResource,
  evaluateCapabilityMatrix,
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ProviderCatalogEntry,
  type ProviderConnectionHealthSnapshot,
  type ProviderCredentialValidationResult,
  type ProviderMetricPoint,
  type ProviderMetricQuery,
  type ProviderMetricReadResult,
  type ReadOnlyProviderAdapter,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import {
  assertCloudflareContext,
  executeCloudflareReadRequest,
  shouldExecuteLiveCloudflareApi,
} from "./http";
import {
  CLOUDFLARE_API_BASE_URL,
  CLOUDFLARE_CANONICAL_METRIC_KEYS,
  CLOUDFLARE_PROVIDER_KEY,
  type CloudflareZoneAnalyticsGroup,
  type CloudflareZoneRecord,
} from "./types";

interface CloudflareZonesApiResponse {
  success?: boolean;
  result?: Array<{
    id?: string;
    name?: string;
    status?: string;
    plan?: { name?: string };
    account?: { id?: string; name?: string };
  }>;
}

interface CloudflareGraphqlResponse {
  data?: {
    viewer?: {
      zones?: Array<{
        httpRequests1dGroups?: Array<{
          dimensions?: { date?: string };
          sum?: {
            requests?: number;
            cachedRequests?: number;
            bytes?: number;
            cachedBytes?: number;
            threats?: number;
            responseStatusMap?: Array<{ edgeResponseStatus?: number; requests?: number }>;
          };
        }>;
      }>;
    };
  };
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
}

const CLOUDFLARE_ZONE_ANALYTICS_QUERY = `
query AvenorZoneAnalytics($zoneTag: String!, $startDate: Date!, $endDate: Date!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      httpRequests1dGroups(
        limit: 90
        filter: { date_geq: $startDate, date_leq: $endDate }
        orderBy: [date_ASC]
      ) {
        dimensions { date }
        sum {
          requests
          cachedRequests
          bytes
          cachedBytes
          threats
          responseStatusMap { edgeResponseStatus requests }
        }
      }
    }
  }
}`;

const DETERMINISTIC_ZONES: readonly CloudflareZoneRecord[] = [
  {
    id: "cf_zone_avenor_prod_01",
    name: "avenor.corstack.dev",
    status: "active",
    planName: "Pro Website",
    accountId: "cf_acct_corstack_01",
    accountName: "Corstack Edge Account",
  },
];

const DETERMINISTIC_ANALYTICS_GROUPS: readonly CloudflareZoneAnalyticsGroup[] = [
  {
    dateIso: "2026-11-19T00:00:00.000Z",
    totalRequests: 185_000,
    cachedRequests: 148_000,
    cacheHitRatio: 0.8,
    totalBytes: 4_820_000_000,
    cachedBytes: 3_950_000_000,
    threatsBlocked: 412,
    http4xxResponses: 1_240,
    http5xxResponses: 37,
    http5xxErrorRate: 0.0002,
  },
  {
    dateIso: "2026-11-20T00:00:00.000Z",
    totalRequests: 215_000,
    cachedRequests: 176_300,
    cacheHitRatio: 0.82,
    totalBytes: 5_410_000_000,
    cachedBytes: 4_520_000_000,
    threatsBlocked: 389,
    http4xxResponses: 1_310,
    http5xxResponses: 43,
    http5xxErrorRate: 0.0002,
  },
];

export function computeWeightedCloudflareRatios(groups: readonly CloudflareZoneAnalyticsGroup[]): {
  totalRequests: number;
  cachedRequests: number;
  weightedCacheHitRatio: number | null;
  total5xx: number;
  weighted5xxErrorRate: number | null;
} {
  const totalRequests = groups.reduce((acc, g) => acc + g.totalRequests, 0);
  const cachedRequests = groups.reduce((acc, g) => acc + g.cachedRequests, 0);
  const total5xx = groups.reduce((acc, g) => acc + g.http5xxResponses, 0);

  return {
    totalRequests,
    cachedRequests,
    weightedCacheHitRatio:
      totalRequests > 0 ? Math.round((cachedRequests / totalRequests) * 10_000) / 10_000 : null,
    total5xx,
    weighted5xxErrorRate:
      totalRequests > 0 ? Math.round((total5xx / totalRequests) * 1_000_000) / 1_000_000 : null,
  };
}

function getCloudflareMetricUnit(metricKey: string): string {
  switch (metricKey) {
    case CLOUDFLARE_CANONICAL_METRIC_KEYS.BANDWIDTH_BYTES:
    case CLOUDFLARE_CANONICAL_METRIC_KEYS.CACHED_BANDWIDTH_BYTES:
      return "bytes";
    case CLOUDFLARE_CANONICAL_METRIC_KEYS.CACHE_HIT_RATIO:
    case CLOUDFLARE_CANONICAL_METRIC_KEYS.HTTP_5XX_ERROR_RATE:
      return "ratio";
    default:
      return "count";
  }
}

export function createCloudflareReadOnlyAdapter(
  catalogEntry: ProviderCatalogEntry,
  options?: { fetchFn?: typeof fetch },
): ReadOnlyProviderAdapter {
  const fetchFn = options?.fetchFn;

  return {
    providerKey: CLOUDFLARE_PROVIDER_KEY,
    displayName: catalogEntry.displayName,
    category: catalogEntry.category,
    authMode: catalogEntry.authMode,
    catalogEntry,
    readOnlyGuaranteed: true,

    async validateCredentials(
      context: ReadOnlyProviderContext,
    ): Promise<ProviderCredentialValidationResult> {
      const { apiToken } = assertCloudflareContext(context);

      if (shouldExecuteLiveCloudflareApi(context, Boolean(fetchFn))) {
        await executeCloudflareReadRequest({
          method: "GET",
          url: `${CLOUDFLARE_API_BASE_URL}/user/tokens/verify`,
          apiToken,
          fetchFn,
        });
      }

      const missingRequiredScopes = catalogEntry.defaultScopes.filter(
        (s) => !context.grantedScopes.includes(s),
      );
      const capabilities = evaluateCapabilityMatrix(
        catalogEntry.capabilities,
        context.grantedScopes,
        { providerPlanTier: context.providerPlanTier ?? "pro" },
      );

      return {
        valid: true,
        externalAccountId: `cf_${context.workspaceId.slice(0, 8)}`,
        externalAccountLabel: "Cloudflare Zone Analytics (Read-Only)",
        grantedScopes: context.grantedScopes,
        missingRequiredScopes,
        healthStatus: missingRequiredScopes.length > 0 ? "PERMISSION_MISSING" : "HEALTHY",
        capabilities,
      };
    },

    async discoverResources(
      context: ReadOnlyProviderContext,
    ): Promise<readonly DiscoveredExternalResource[]> {
      const { apiToken } = assertCloudflareContext(context);

      let zones: readonly CloudflareZoneRecord[] = DETERMINISTIC_ZONES;
      if (shouldExecuteLiveCloudflareApi(context, Boolean(fetchFn))) {
        const res = await executeCloudflareReadRequest<CloudflareZonesApiResponse>({
          method: "GET",
          url: `${CLOUDFLARE_API_BASE_URL}/zones?per_page=50`,
          apiToken,
          fetchFn,
        });
        zones = (res.result ?? [])
          .filter((z) => Boolean(z.id && z.name))
          .map((z) => ({
            id: String(z.id),
            name: String(z.name),
            status: z.status ?? "active",
            planName: z.plan?.name ?? "Free Website",
            accountId: z.account?.id ?? "cf_account",
            accountName: z.account?.name ?? "Cloudflare Account",
          }));
      }

      return zones.map((zone) => ({
        externalResourceId: zone.id,
        externalResourceName: zone.name,
        resourceType: "cloudflare_zone",
        regionOrLocation: "Global Edge",
        parentAccountOrOrg: zone.accountName,
        availableCapabilities: ["edge_traffic"],
        metadata: {
          environmentHint: "PRODUCTION",
          zoneStatus: zone.status,
          planName: zone.planName,
          accountId: zone.accountId,
          dnsAndWafMutationsBlocked: true,
        },
      }));
    },

    async getCapabilities(context: ReadOnlyProviderContext) {
      assertCloudflareContext(context);
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
        const { apiToken } = assertCloudflareContext(context);
        const missingScopes = catalogEntry.defaultScopes.filter(
          (s) => !context.grantedScopes.includes(s),
        );
        if (missingScopes.length > 0) {
          return {
            providerKey: CLOUDFLARE_PROVIDER_KEY,
            status: "PERMISSION_MISSING",
            uxState: "permission_insufficient",
            checkedAtIso,
            latencyMs: Date.now() - started,
            grantedScopes: context.grantedScopes,
            missingScopes,
            errorCode: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
            message: `Missing required Cloudflare read-only scope(s): ${missingScopes.join(", ")}.`,
          };
        }

        if (shouldExecuteLiveCloudflareApi(context, Boolean(fetchFn))) {
          await executeCloudflareReadRequest({
            method: "GET",
            url: `${CLOUDFLARE_API_BASE_URL}/user/tokens/verify`,
            apiToken,
            fetchFn,
          });
        }

        return {
          providerKey: CLOUDFLARE_PROVIDER_KEY,
          status: "HEALTHY",
          uxState: "connected_healthy",
          checkedAtIso,
          latencyMs: Date.now() - started,
          grantedScopes: context.grantedScopes,
          missingScopes: [],
          message:
            "Cloudflare GraphQL Analytics read-only connection verified (DNS/WAF/cache-purge mutations blocked).",
        };
      } catch (err) {
        const adapterErr =
          err instanceof ProviderAdapterError
            ? err
            : new ProviderAdapterError({
                providerKey: CLOUDFLARE_PROVIDER_KEY,
                code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
                message: err instanceof Error ? err.message : "Cloudflare health check failed.",
              });
        return {
          providerKey: CLOUDFLARE_PROVIDER_KEY,
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
      const { apiToken } = assertCloudflareContext(context);
      const observedAtIso = new Date().toISOString();
      const unit = getCloudflareMetricUnit(query.metricKey);

      if (
        !context.grantedScopes.includes("zone.analytics:read") ||
        context.simulationScenario === "missing_scope"
      ) {
        return {
          providerKey: CLOUDFLARE_PROVIDER_KEY,
          externalResourceId: query.externalResourceId,
          capabilityKey: query.capabilityKey,
          metricKey: query.metricKey,
          capabilityStatus: "MISSING_PERMISSION",
          uxState: "permission_insufficient",
          observedAtIso,
          sourceFreshnessMinutes: 30,
          provenanceLabel: `Cloudflare GraphQL Analytics • ${query.externalResourceId}`,
          statusExplanation: "Missing required read-only scope `zone.analytics:read`.",
          points: [
            { timestampIso: query.endDateIso, metricKey: query.metricKey, value: null, unit },
          ],
        };
      }

      // Adaptive security/WAF log detail is plan-restricted on Free tier
      if (
        (context.providerPlanTier === "free" || context.simulationScenario === "plan_restricted") &&
        query.metricKey === CLOUDFLARE_CANONICAL_METRIC_KEYS.THREATS_BLOCKED
      ) {
        return {
          providerKey: CLOUDFLARE_PROVIDER_KEY,
          externalResourceId: query.externalResourceId,
          capabilityKey: query.capabilityKey,
          metricKey: query.metricKey,
          capabilityStatus: "PLAN_RESTRICTED",
          uxState: "unsupported_plan",
          observedAtIso,
          sourceFreshnessMinutes: 30,
          provenanceLabel: `Cloudflare GraphQL Analytics • ${query.externalResourceId}`,
          statusExplanation:
            "Detailed WAF threat telemetry is plan-gated on Cloudflare Free tier. Returning transparent non-numeric state instead of 0.",
          points: [
            { timestampIso: query.endDateIso, metricKey: query.metricKey, value: null, unit },
          ],
        };
      }

      let groups: readonly CloudflareZoneAnalyticsGroup[] = DETERMINISTIC_ANALYTICS_GROUPS;

      if (shouldExecuteLiveCloudflareApi(context, Boolean(fetchFn))) {
        const gqlRes = await executeCloudflareReadRequest<CloudflareGraphqlResponse>({
          method: "POST",
          url: `${CLOUDFLARE_API_BASE_URL}/graphql`,
          apiToken,
          graphqlBody: {
            query: CLOUDFLARE_ZONE_ANALYTICS_QUERY,
            variables: {
              zoneTag: query.externalResourceId,
              startDate: query.startDateIso.slice(0, 10),
              endDate: query.endDateIso.slice(0, 10),
            },
          },
          fetchFn,
        });

        if (gqlRes.errors && gqlRes.errors.length > 0) {
          const msg = gqlRes.errors.map((e) => e.message ?? "GraphQL error").join("; ");
          if (/plan|entitlement|not authorized/i.test(msg)) {
            return {
              providerKey: CLOUDFLARE_PROVIDER_KEY,
              externalResourceId: query.externalResourceId,
              capabilityKey: query.capabilityKey,
              metricKey: query.metricKey,
              capabilityStatus: "PLAN_RESTRICTED",
              uxState: "unsupported_plan",
              observedAtIso,
              sourceFreshnessMinutes: 30,
              provenanceLabel: `Cloudflare GraphQL Analytics • ${query.externalResourceId}`,
              statusExplanation: msg,
              points: [
                { timestampIso: query.endDateIso, metricKey: query.metricKey, value: null, unit },
              ],
            };
          }
          throw new ProviderAdapterError({
            providerKey: CLOUDFLARE_PROVIDER_KEY,
            code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
            message: msg,
          });
        }

        const rawGroups = gqlRes.data?.viewer?.zones?.[0]?.httpRequests1dGroups ?? [];
        groups = rawGroups.map((g) => {
          const totalReq = g.sum?.requests ?? 0;
          const cachedReq = g.sum?.cachedRequests ?? 0;
          const statusMap = g.sum?.responseStatusMap ?? [];
          let c4xx = 0;
          let c5xx = 0;
          for (const st of statusMap) {
            const code = st.edgeResponseStatus ?? 0;
            const count = st.requests ?? 0;
            if (code >= 400 && code < 500) c4xx += count;
            if (code >= 500 && code < 600) c5xx += count;
          }
          return {
            dateIso: `${g.dimensions?.date ?? query.endDateIso.slice(0, 10)}T00:00:00.000Z`,
            totalRequests: totalReq,
            cachedRequests: cachedReq,
            cacheHitRatio:
              totalReq > 0 ? Math.round((cachedReq / totalReq) * 10_000) / 10_000 : null,
            totalBytes: g.sum?.bytes ?? 0,
            cachedBytes: g.sum?.cachedBytes ?? 0,
            threatsBlocked: g.sum?.threats ?? 0,
            http4xxResponses: c4xx,
            http5xxResponses: c5xx,
            http5xxErrorRate:
              totalReq > 0 ? Math.round((c5xx / totalReq) * 1_000_000) / 1_000_000 : null,
          };
        });
      }

      const points: ProviderMetricPoint[] = groups.map((g) => {
        let value: number | null = g.totalRequests;
        switch (query.metricKey) {
          case CLOUDFLARE_CANONICAL_METRIC_KEYS.EDGE_REQUESTS:
            value = g.totalRequests;
            break;
          case CLOUDFLARE_CANONICAL_METRIC_KEYS.CACHED_REQUESTS:
            value = g.cachedRequests;
            break;
          case CLOUDFLARE_CANONICAL_METRIC_KEYS.CACHE_HIT_RATIO:
            value = g.cacheHitRatio;
            break;
          case CLOUDFLARE_CANONICAL_METRIC_KEYS.BANDWIDTH_BYTES:
            value = g.totalBytes;
            break;
          case CLOUDFLARE_CANONICAL_METRIC_KEYS.CACHED_BANDWIDTH_BYTES:
            value = g.cachedBytes;
            break;
          case CLOUDFLARE_CANONICAL_METRIC_KEYS.THREATS_BLOCKED:
            value = g.threatsBlocked;
            break;
          case CLOUDFLARE_CANONICAL_METRIC_KEYS.HTTP_4XX_RESPONSES:
            value = g.http4xxResponses;
            break;
          case CLOUDFLARE_CANONICAL_METRIC_KEYS.HTTP_5XX_RESPONSES:
            value = g.http5xxResponses;
            break;
          case CLOUDFLARE_CANONICAL_METRIC_KEYS.HTTP_5XX_ERROR_RATE:
            value = g.http5xxErrorRate;
            break;
          default:
            value = g.totalRequests;
            break;
        }
        return {
          timestampIso: g.dateIso,
          metricKey: query.metricKey,
          value,
          unit,
          dimensions: { zoneTag: query.externalResourceId },
        };
      });

      const weighted = computeWeightedCloudflareRatios(groups);
      return {
        providerKey: CLOUDFLARE_PROVIDER_KEY,
        externalResourceId: query.externalResourceId,
        capabilityKey: query.capabilityKey,
        metricKey: query.metricKey,
        capabilityStatus: "SUPPORTED",
        uxState: "connected_healthy",
        observedAtIso,
        sourceFreshnessMinutes: 5,
        provenanceLabel: `Cloudflare GraphQL Analytics • ${query.externalResourceId}`,
        statusExplanation: `Read-only Cloudflare zone analytics verified (weighted cache hit ratio=${weighted.weightedCacheHitRatio ?? "n/a"}, 5xx rate=${weighted.weighted5xxErrorRate ?? "n/a"}).`,
        points,
      };
    },
  };
}
