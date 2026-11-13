import {
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import { sharedGoogleTelemetryCache } from "../google-shared/cache";
import {
  executeGoogleReadRequest,
  GOOGLE_ANALYTICS_DATA_BASE,
  shouldExecuteLiveGoogleApi,
} from "../google-shared/http";
import { assertGa4ScenarioAndScope, normalizeGa4PropertyResourceName } from "./admin";
import { parseGa4MetricNumber, validateGa4RealtimeQueryInputs } from "./dictionary";
import type { Ga4RealtimeDimensionRow, Ga4RealtimeReportBundle } from "./types";

const REALTIME_CACHE_TTL_MS = 30_000;
const REALTIME_STALE_FALLBACK_TTL_MS = 300_000;
export const GA4_REALTIME_ESTIMATE_NOTICE =
  "Estimated active users across the rolling 30-minute window (not exact instant per-second concurrency).";

interface RawRealtimeRow {
  dimensionValues?: Array<{ value?: string }>;
  metricValues?: Array<{ value?: string }>;
}

export interface RawGa4RealtimeReportResponse {
  dimensionHeaders?: Array<{ name?: string }>;
  metricHeaders?: Array<{ name?: string; type?: string }>;
  rows?: RawRealtimeRow[];
  totals?: RawRealtimeRow[];
  rowCount?: number;
}

export interface Ga4RealtimeReportInput {
  propertyId: string;
  projectId?: string | null;
  metrics?: readonly string[];
  dimensions?: readonly string[];
}

function buildRealtimeMetricHeadersIndex(
  response: RawGa4RealtimeReportResponse,
): Map<string, number> {
  const map = new Map<string, number>();
  (response.metricHeaders ?? []).forEach((header, idx) => {
    if (header.name) {
      map.set(header.name, idx);
    }
  });
  return map;
}

function getMetricValueFromRow(
  row: RawRealtimeRow | undefined,
  headerIndex: Map<string, number>,
  metricName: string,
  fallbackIndex: number,
): number | null {
  if (!row) return null;
  const idx = headerIndex.get(metricName) ?? fallbackIndex;
  return parseGa4MetricNumber(row.metricValues?.[idx]?.value);
}

function mapDimensionBreakdownRows(
  response: RawGa4RealtimeReportResponse,
  dimensionNames: readonly string[],
): Ga4RealtimeDimensionRow[] {
  const headerIdx = buildRealtimeMetricHeadersIndex(response);
  return (response.rows ?? []).map((row) => {
    const dimensionValues: Record<string, string> = {};
    dimensionNames.forEach((dimName, i) => {
      dimensionValues[dimName] = row.dimensionValues?.[i]?.value ?? "(not set)";
    });
    return {
      dimensionValues,
      activeUsers: getMetricValueFromRow(row, headerIdx, "activeUsers", 0),
      screenPageViews: getMetricValueFromRow(row, headerIdx, "screenPageViews", 1),
      eventCount: getMetricValueFromRow(row, headerIdx, "eventCount", 2),
    };
  });
}

function buildSandboxRealtimeBundle(
  context: ReadOnlyProviderContext,
  propertyName: string,
): Ga4RealtimeReportBundle {
  const numericId = propertyName.replace("properties/", "");
  const seed = Number.parseInt(numericId.slice(-3) || "142", 10) || 142;
  const isStaleScenario = context.simulationScenario === "stale_data";
  const freshnessSeconds = isStaleScenario ? 185 : 12;
  const observedAtIso = new Date(Date.now() - freshnessSeconds * 1000).toISOString();

  const minuteTrend: Array<{ minutesAgo: number; activeUsers: number | null }> = [];
  let sumViews = 0;
  let sumEvents = 0;
  for (let m = 29; m >= 0; m -= 1) {
    const base = 18 + ((seed + m * 7) % 19);
    const active = Math.max(4, Math.round(base + Math.sin(m / 4) * 6));
    sumViews += active * 2;
    sumEvents += active * 5;
    minuteTrend.push({
      minutesAgo: m,
      activeUsers: active,
    });
  }

  const activeUsersLast30m = 148 + (seed % 47);

  return {
    propertyName,
    sourceMode: "sandbox_demo",
    windowMinutes: 30,
    windowLabel: "Active users in the last 30 minutes (estimate)",
    observedAtIso,
    freshnessSeconds,
    activeUsersLast30m,
    screenPageViewsLast30m: sumViews,
    eventCountLast30m: sumEvents,
    minuteTrend,
    byCountry: [
      {
        dimensionValues: { country: "United States" },
        activeUsers: Math.round(activeUsersLast30m * 0.41),
        screenPageViews: Math.round(sumViews * 0.43),
        eventCount: Math.round(sumEvents * 0.42),
      },
      {
        dimensionValues: { country: "United Kingdom" },
        activeUsers: Math.round(activeUsersLast30m * 0.16),
        screenPageViews: Math.round(sumViews * 0.17),
        eventCount: Math.round(sumEvents * 0.16),
      },
      {
        dimensionValues: { country: "Germany" },
        activeUsers: Math.round(activeUsersLast30m * 0.14),
        screenPageViews: Math.round(sumViews * 0.13),
        eventCount: Math.round(sumEvents * 0.14),
      },
      {
        dimensionValues: { country: "Canada" },
        activeUsers: Math.round(activeUsersLast30m * 0.11),
        screenPageViews: Math.round(sumViews * 0.1),
        eventCount: Math.round(sumEvents * 0.11),
      },
    ],
    byDevice: [
      {
        dimensionValues: { deviceCategory: "desktop" },
        activeUsers: Math.round(activeUsersLast30m * 0.62),
        screenPageViews: Math.round(sumViews * 0.67),
        eventCount: Math.round(sumEvents * 0.68),
      },
      {
        dimensionValues: { deviceCategory: "mobile" },
        activeUsers: Math.round(activeUsersLast30m * 0.34),
        screenPageViews: Math.round(sumViews * 0.29),
        eventCount: Math.round(sumEvents * 0.28),
      },
      {
        dimensionValues: { deviceCategory: "tablet" },
        activeUsers: Math.max(1, Math.round(activeUsersLast30m * 0.04)),
        screenPageViews: Math.max(2, Math.round(sumViews * 0.04)),
        eventCount: Math.max(5, Math.round(sumEvents * 0.04)),
      },
    ],
    byScreenOrPage: [
      {
        dimensionValues: { unifiedScreenName: "Pricing — Avenor", platform: "web" },
        activeUsers: Math.round(activeUsersLast30m * 0.28),
        screenPageViews: Math.round(sumViews * 0.26),
        eventCount: Math.round(sumEvents * 0.25),
      },
      {
        dimensionValues: { unifiedScreenName: "Signal Atlas Docs", platform: "web" },
        activeUsers: Math.round(activeUsersLast30m * 0.24),
        screenPageViews: Math.round(sumViews * 0.29),
        eventCount: Math.round(sumEvents * 0.27),
      },
      {
        dimensionValues: { unifiedScreenName: "Home — Avenor", platform: "web" },
        activeUsers: Math.round(activeUsersLast30m * 0.21),
        screenPageViews: Math.round(sumViews * 0.2),
        eventCount: Math.round(sumEvents * 0.21),
      },
    ],
    isEstimateNotice: `${GA4_REALTIME_ESTIMATE_NOTICE} Sandbox demonstration mode active until live Google OAuth credentials are configured.`,
    rateLimited: false,
    retryAfterSeconds: null,
    stale: isStaleScenario,
  };
}

/**
 * Executes a single strictly read-only POST `:runRealtimeReport` call on GA4 Data API v1beta.
 */
export async function runGa4RealtimeReport(options: {
  accessToken: string;
  propertyName: string;
  requestBody: {
    metrics: Array<{ name: string }>;
    dimensions?: Array<{ name: string }>;
    minuteRanges?: Array<{ name?: string; startMinutesAgo: number; endMinutesAgo: number }>;
    metricAggregations?: Array<"TOTAL">;
    limit?: string;
    orderBys?: Array<Record<string, unknown>>;
  };
  fetchFn?: typeof fetch;
}): Promise<RawGa4RealtimeReportResponse> {
  const propertyName = normalizeGa4PropertyResourceName(options.propertyName);
  const url = `${GOOGLE_ANALYTICS_DATA_BASE}/${propertyName}:runRealtimeReport`;
  const result = await executeGoogleReadRequest<RawGa4RealtimeReportResponse>({
    providerKey: "ga4",
    method: "POST",
    url,
    accessToken: options.accessToken,
    body: options.requestBody,
    fetchFn: options.fetchFn,
  });
  return result;
}

/**
 * Queries supported GA4 Realtime API metrics (`activeUsers`, `screenPageViews`, `eventCount`)
 * and compatible realtime dimensions (`minutesAgo`, `country`, `deviceCategory`, `unifiedScreenName`, `platform`)
 * with strict validation, explicit rolling 30-minute estimate labeling, and stale-fallback rate-limit safety.
 */
export async function readGa4RealtimeReportBundle(
  context: ReadOnlyProviderContext,
  input: Ga4RealtimeReportInput,
  options?: {
    fetchFn?: typeof fetch;
    bypassCache?: boolean;
    fallbackToStaleOnRateLimit?: boolean;
  },
): Promise<Ga4RealtimeReportBundle> {
  const requestedMetrics =
    input.metrics && input.metrics.length > 0
      ? input.metrics
      : ["activeUsers", "screenPageViews", "eventCount"];
  const requestedDimensions =
    input.dimensions && input.dimensions.length > 0
      ? input.dimensions
      : ["minutesAgo", "country", "deviceCategory", "unifiedScreenName"];

  // Strictly reject unsupported realtime combinations BEFORE calling upstream or cache
  validateGa4RealtimeQueryInputs({
    metrics: requestedMetrics,
    dimensions: requestedDimensions,
  });

  const normalizedProperty = normalizeGa4PropertyResourceName(input.propertyId);

  const freshCacheKey = {
    organizationId: context.organizationId,
    workspaceId: context.workspaceId,
    projectId: input.projectId ?? null,
    connectionId: context.connectionId ?? "direct",
    providerKey: "ga4",
    externalResourceId: normalizedProperty,
    operation: "realtime_report",
    params: {
      metrics: [...requestedMetrics].sort().join(","),
      dimensions: [...requestedDimensions].sort().join(","),
      tokenDigestHint: options?.fetchFn
        ? "mock_fetch"
        : (context.accessToken?.slice(0, 8) ?? "none"),
    },
  };

  const staleCacheKey = {
    ...freshCacheKey,
    operation: "realtime_report_stale",
  };

  // Validate scopes & non-rate-limit scenarios cleanly
  try {
    assertGa4ScenarioAndScope(context);
  } catch (err) {
    if (
      err instanceof ProviderAdapterError &&
      err.code === PROVIDER_ERROR_CODES.RATE_LIMITED &&
      options?.fallbackToStaleOnRateLimit !== false
    ) {
      const staleCached = sharedGoogleTelemetryCache.get<Ga4RealtimeReportBundle>(staleCacheKey);
      if (staleCached) {
        const ageSec = Math.max(
          31,
          Math.round((Date.now() - Date.parse(staleCached.value.observedAtIso)) / 1000),
        );
        return {
          ...staleCached.value,
          freshnessSeconds: ageSec,
          rateLimited: true,
          retryAfterSeconds: err.retryAfterSeconds ?? 30,
          stale: true,
        };
      }
    }
    throw err;
  }

  if (!options?.bypassCache && !context.simulationScenario) {
    const cached = sharedGoogleTelemetryCache.get<Ga4RealtimeReportBundle>(freshCacheKey);
    if (cached) {
      const ageSec = Math.max(
        0,
        Math.round((Date.now() - Date.parse(cached.value.observedAtIso)) / 1000),
      );
      return {
        ...cached.value,
        freshnessSeconds: ageSec,
        stale: ageSec > 60,
      };
    }
  }

  const executeLive = shouldExecuteLiveGoogleApi(context, Boolean(options?.fetchFn), "ga4");
  if (!executeLive) {
    const demo = buildSandboxRealtimeBundle(context, normalizedProperty);
    if (!options?.bypassCache) {
      sharedGoogleTelemetryCache.set(freshCacheKey, demo, REALTIME_CACHE_TTL_MS);
      sharedGoogleTelemetryCache.set(staleCacheKey, demo, REALTIME_STALE_FALLBACK_TTL_MS);
    }
    return demo;
  }

  const accessToken = context.accessToken ?? "";
  if (!accessToken) {
    throw new ProviderAdapterError({
      providerKey: "ga4",
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "Missing Google Analytics OAuth access token for Realtime API report.",
    });
  }

  const metricsSpec = [
    { name: "activeUsers" },
    { name: "screenPageViews" },
    { name: "eventCount" },
  ];
  const minuteRanges = [{ name: "last_30_minutes", startMinutesAgo: 29, endMinutesAgo: 0 }];

  try {
    const [minuteReport, countryReport, deviceReport, screenReport] = await Promise.all([
      runGa4RealtimeReport({
        accessToken,
        propertyName: normalizedProperty,
        fetchFn: options?.fetchFn,
        requestBody: {
          dimensions: [{ name: "minutesAgo" }],
          metrics: metricsSpec,
          minuteRanges,
          metricAggregations: ["TOTAL"],
          orderBys: [{ dimension: { dimensionName: "minutesAgo" } }],
          limit: "30",
        },
      }),
      runGa4RealtimeReport({
        accessToken,
        propertyName: normalizedProperty,
        fetchFn: options?.fetchFn,
        requestBody: {
          dimensions: [{ name: "country" }],
          metrics: metricsSpec,
          minuteRanges,
          orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
          limit: "15",
        },
      }),
      runGa4RealtimeReport({
        accessToken,
        propertyName: normalizedProperty,
        fetchFn: options?.fetchFn,
        requestBody: {
          dimensions: [{ name: "deviceCategory" }],
          metrics: metricsSpec,
          minuteRanges,
          orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
          limit: "10",
        },
      }),
      runGa4RealtimeReport({
        accessToken,
        propertyName: normalizedProperty,
        fetchFn: options?.fetchFn,
        requestBody: {
          dimensions: [{ name: "unifiedScreenName" }, { name: "platform" }],
          metrics: metricsSpec,
          minuteRanges,
          orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
          limit: "20",
        },
      }),
    ]);

    const minuteHeaderIdx = buildRealtimeMetricHeadersIndex(minuteReport);
    const totalRow = minuteReport.totals?.[0];

    const minuteTrend = (minuteReport.rows ?? [])
      .map((row) => ({
        minutesAgo: Number.parseInt(row.dimensionValues?.[0]?.value ?? "0", 10) || 0,
        activeUsers: getMetricValueFromRow(row, minuteHeaderIdx, "activeUsers", 0),
      }))
      .sort((a, b) => b.minutesAgo - a.minutesAgo);

    const activeUsersLast30m = totalRow
      ? getMetricValueFromRow(totalRow, minuteHeaderIdx, "activeUsers", 0)
      : (minuteReport.rows?.length ?? 0) === 0
        ? 0
        : null;

    const sumOrTotalMetric = (metricName: "screenPageViews" | "eventCount", idx: number) => {
      if (totalRow) {
        return getMetricValueFromRow(totalRow, minuteHeaderIdx, metricName, idx);
      }
      if ((minuteReport.rows?.length ?? 0) === 0) {
        return 0;
      }
      let sawNumeric = false;
      let sum = 0;
      for (const row of minuteReport.rows ?? []) {
        const val = getMetricValueFromRow(row, minuteHeaderIdx, metricName, idx);
        if (val !== null) {
          sawNumeric = true;
          sum += val;
        }
      }
      return sawNumeric ? sum : null;
    };

    const bundle: Ga4RealtimeReportBundle = {
      propertyName: normalizedProperty,
      sourceMode: "live",
      windowMinutes: 30,
      windowLabel: "Active users in the last 30 minutes (estimate)",
      observedAtIso: new Date().toISOString(),
      freshnessSeconds: 0,
      activeUsersLast30m,
      screenPageViewsLast30m: sumOrTotalMetric("screenPageViews", 1),
      eventCountLast30m: sumOrTotalMetric("eventCount", 2),
      minuteTrend,
      byCountry: mapDimensionBreakdownRows(countryReport, ["country"]),
      byDevice: mapDimensionBreakdownRows(deviceReport, ["deviceCategory"]),
      byScreenOrPage: mapDimensionBreakdownRows(screenReport, ["unifiedScreenName", "platform"]),
      isEstimateNotice: GA4_REALTIME_ESTIMATE_NOTICE,
      rateLimited: false,
      retryAfterSeconds: null,
      stale: false,
    };

    if (!options?.bypassCache) {
      sharedGoogleTelemetryCache.set(freshCacheKey, bundle, REALTIME_CACHE_TTL_MS);
      sharedGoogleTelemetryCache.set(staleCacheKey, bundle, REALTIME_STALE_FALLBACK_TTL_MS);
    }

    return bundle;
  } catch (err) {
    if (
      err instanceof ProviderAdapterError &&
      err.code === PROVIDER_ERROR_CODES.RATE_LIMITED &&
      options?.fallbackToStaleOnRateLimit !== false
    ) {
      const staleCached = sharedGoogleTelemetryCache.get<Ga4RealtimeReportBundle>(staleCacheKey);
      if (staleCached) {
        const ageSec = Math.max(
          31,
          Math.round((Date.now() - Date.parse(staleCached.value.observedAtIso)) / 1000),
        );
        return {
          ...staleCached.value,
          freshnessSeconds: ageSec,
          rateLimited: true,
          retryAfterSeconds: err.retryAfterSeconds ?? 30,
          stale: true,
        };
      }
    }
    throw err;
  }
}
