import {
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import { sharedGoogleTelemetryCache } from "../google-shared/cache";
import {
  executeGoogleReadRequest,
  GOOGLE_SEARCH_CONSOLE_V3_BASE,
  shouldExecuteLiveGoogleApi,
} from "../google-shared/http";
import { assertGscScenarioAndScope, normalizeCanonicalGscSiteUrl } from "./sites";
import {
  GSC_MAX_FINAL_LAG_HOURS,
  GSC_MAX_ROW_LIMIT,
  GSC_MIN_FINAL_LAG_HOURS,
  GSC_REPORTING_TIMEZONE,
  type GscDataCoverageMetadata,
  type GscDataState,
  type GscDimension,
  type GscDimensionFilterGroup,
  type GscSearchAnalyticsBundle,
  type GscSearchAnalyticsInput,
  type GscSearchAnalyticsRow,
  type GscSearchAnalyticsTotals,
  type GscSearchType,
} from "./types";

const GSC_REPORT_CACHE_TTL_MS = 5 * 60 * 1000;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const VALID_SEARCH_TYPES = new Set<GscSearchType>([
  "WEB",
  "IMAGE",
  "VIDEO",
  "NEWS",
  "DISCOVER",
  "GOOGLE_NEWS",
]);

const VALID_DIMENSIONS = new Set<GscDimension>([
  "date",
  "query",
  "page",
  "country",
  "device",
  "searchAppearance",
]);

interface RawSearchAnalyticsApiRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

interface RawSearchAnalyticsQueryResponse {
  rows?: RawSearchAnalyticsApiRow[];
  responseAggregationType?: string;
}

export interface SearchAnalyticsQueryRequestBody {
  startDate: string;
  endDate: string;
  dimensions?: GscDimension[];
  type?: GscSearchType;
  dataState?: GscDataState;
  dimensionFilterGroups?: readonly GscDimensionFilterGroup[];
  rowLimit?: number;
  startRow?: number;
  aggregationType?: "auto" | "byPage" | "byProperty";
}

function getPacificDateStringOffset(daysOffset: number, now = new Date()): string {
  // Format "now + daysOffset" in America/Los_Angeles (Search Console native timezone)
  const target = new Date(now.getTime() + daysOffset * 86_400_000);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: GSC_REPORTING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(target);
}

/**
 * Validates Search Analytics inputs cleanly against Search Console constraints:
 * - YYYY-MM-DD ordering (`startDate <= endDate`)
 * - Valid `searchType` and `dimensions`
 * - Rejects `query` dimension/filter on `DISCOVER` and `GOOGLE_NEWS` where query attribution does not exist
 * - Clamps pagination to Google's 25,000 rows/request ceiling
 */
export function validateSearchAnalyticsInput(input: GscSearchAnalyticsInput): {
  searchType: GscSearchType;
  dataState: GscDataState;
  rowLimit: number;
  startRow: number;
  maxPagesToFetch: number;
  dimensions: GscDimension[];
} {
  if (!ISO_DATE_REGEX.test(input.startDate) || !ISO_DATE_REGEX.test(input.endDate)) {
    throw new ProviderAdapterError({
      providerKey: "gsc",
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: "Search Console queries require YYYY-MM-DD startDate and endDate.",
    });
  }

  if (input.startDate > input.endDate) {
    throw new ProviderAdapterError({
      providerKey: "gsc",
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: `Search Console date range is inverted (${input.startDate} > ${input.endDate}).`,
    });
  }

  if (input.compareStartDate || input.compareEndDate) {
    if (
      !input.compareStartDate ||
      !input.compareEndDate ||
      !ISO_DATE_REGEX.test(input.compareStartDate) ||
      !ISO_DATE_REGEX.test(input.compareEndDate) ||
      input.compareStartDate > input.compareEndDate
    ) {
      throw new ProviderAdapterError({
        providerKey: "gsc",
        code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
        message: "Search Console comparison range requires valid ordered YYYY-MM-DD dates.",
      });
    }
  }

  const searchType: GscSearchType = input.searchType ?? "WEB";
  if (!VALID_SEARCH_TYPES.has(searchType)) {
    throw new ProviderAdapterError({
      providerKey: "gsc",
      code: PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY,
      message: `Unsupported Search Console searchType "${String(searchType)}".`,
    });
  }

  const dataState: GscDataState = input.dataState === "all" ? "all" : "final";
  const dimensions = [...(input.dimensions ?? [])];
  for (const dim of dimensions) {
    if (!VALID_DIMENSIONS.has(dim)) {
      throw new ProviderAdapterError({
        providerKey: "gsc",
        code: PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY,
        message: `Unsupported Search Console dimension "${String(dim)}".`,
      });
    }
  }

  const usesQueryFilter = (input.dimensionFilterGroups ?? []).some((group) =>
    group.filters.some((f) => f.dimension === "query"),
  );
  if (
    (searchType === "DISCOVER" || searchType === "GOOGLE_NEWS") &&
    (dimensions.includes("query") || usesQueryFilter)
  ) {
    throw new ProviderAdapterError({
      providerKey: "gsc",
      code: PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY,
      message: `Search Console does not provide the "query" dimension or query filters for searchType "${searchType}".`,
    });
  }

  if (dimensions.includes("searchAppearance") && dimensions.length > 1) {
    throw new ProviderAdapterError({
      providerKey: "gsc",
      code: PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY,
      message:
        'Search Console requires querying "searchAppearance" separately from other dimensions in Search Analytics API.',
    });
  }

  const rowLimit = Math.max(1, Math.min(input.rowLimit ?? 1000, GSC_MAX_ROW_LIMIT));
  const startRow = Math.max(0, input.startRow ?? 0);
  const maxPagesToFetch = Math.max(1, Math.min(input.maxPagesToFetch ?? 3, 10));

  return {
    searchType,
    dataState,
    rowLimit,
    startRow,
    maxPagesToFetch,
    dimensions,
  };
}

/**
 * Computes Search Console aggregate clicks, impressions, true CTR (`clicks / impressions`),
 * and impression-weighted average position (`sum(position * impressions) / sum(impressions)`).
 * Never takes an unweighted mean across rows!
 */
export function computeWeightedSearchTotalsFromRows(
  rows: readonly GscSearchAnalyticsRow[],
): GscSearchAnalyticsTotals {
  if (rows.length === 0) {
    return {
      clicks: null,
      impressions: null,
      ctr: null,
      position: null,
    };
  }

  let totalClicks = 0;
  let totalImpressions = 0;
  let weightedPositionSum = 0;
  let impressionWeightSum = 0;

  for (const row of rows) {
    totalClicks += row.clicks;
    totalImpressions += row.impressions;
    if (row.position !== null && row.impressions > 0) {
      weightedPositionSum += row.position * row.impressions;
      impressionWeightSum += row.impressions;
    }
  }

  return {
    clicks: totalClicks,
    impressions: totalImpressions,
    ctr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
    position: impressionWeightSum > 0 ? weightedPositionSum / impressionWeightSum : null,
  };
}

function mapRawRows(
  rawRows: readonly RawSearchAnalyticsApiRow[],
  dimensions: readonly GscDimension[],
): GscSearchAnalyticsRow[] {
  return rawRows.map((row) => {
    const keys = Array.isArray(row.keys) ? row.keys : [];
    const mapped: GscSearchAnalyticsRow = {
      keys,
      clicks: typeof row.clicks === "number" && Number.isFinite(row.clicks) ? row.clicks : 0,
      impressions:
        typeof row.impressions === "number" && Number.isFinite(row.impressions)
          ? row.impressions
          : 0,
      ctr: typeof row.ctr === "number" && Number.isFinite(row.ctr) ? row.ctr : 0,
      position:
        typeof row.position === "number" && Number.isFinite(row.position) ? row.position : null,
    };
    dimensions.forEach((dim, idx) => {
      const value = keys[idx] ?? "";
      mapped[dim] = value;
    });
    return mapped;
  });
}

/**
 * Executes a strictly read-only POST `/webmasters/v3/sites/{encodedSiteUrl}/searchAnalytics/query` call.
 */
export async function querySearchAnalytics(options: {
  accessToken: string;
  siteUrl: string;
  requestBody: SearchAnalyticsQueryRequestBody;
  fetchFn?: typeof fetch;
}): Promise<GscSearchAnalyticsRow[]> {
  const canonical = normalizeCanonicalGscSiteUrl(options.siteUrl);
  const url = `${GOOGLE_SEARCH_CONSOLE_V3_BASE}/sites/${canonical.encodedSiteUrl}/searchAnalytics/query`;

  const response = await executeGoogleReadRequest<RawSearchAnalyticsQueryResponse>({
    providerKey: "gsc",
    method: "POST",
    url,
    accessToken: options.accessToken,
    body: options.requestBody,
    fetchFn: options.fetchFn,
  });

  if (response.rows !== undefined && !Array.isArray(response.rows)) {
    throw new ProviderAdapterError({
      providerKey: "gsc",
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: "Search Console searchAnalytics.query returned a malformed rows array.",
    });
  }

  return mapRawRows(response.rows ?? [], options.requestBody.dimensions ?? []);
}

/**
 * Executes paginated Search Analytics queries respecting Google's 25,000 rows per page cap.
 */
export async function paginatedSearchAnalyticsQuery(options: {
  accessToken: string;
  siteUrl: string;
  requestBody: Omit<SearchAnalyticsQueryRequestBody, "startRow" | "rowLimit">;
  pageSize?: number;
  startRow?: number;
  maxPagesToFetch?: number;
  fetchFn?: typeof fetch;
}): Promise<{
  rows: GscSearchAnalyticsRow[];
  hasMore: boolean;
  pagesFetched: number;
  hitRowLimitCap: boolean;
}> {
  const pageSize = Math.max(1, Math.min(options.pageSize ?? 1000, GSC_MAX_ROW_LIMIT));
  const initialStart = Math.max(0, options.startRow ?? 0);
  const maxPages = Math.max(1, Math.min(options.maxPagesToFetch ?? 3, 10));

  const collected: GscSearchAnalyticsRow[] = [];
  let pagesFetched = 0;
  let currentStart = initialStart;
  let hasMore = false;

  for (let page = 0; page < maxPages; page += 1) {
    const pageRows = await querySearchAnalytics({
      accessToken: options.accessToken,
      siteUrl: options.siteUrl,
      fetchFn: options.fetchFn,
      requestBody: {
        ...options.requestBody,
        rowLimit: pageSize,
        startRow: currentStart,
      },
    });
    pagesFetched += 1;
    collected.push(...pageRows);

    if (pageRows.length < pageSize) {
      hasMore = false;
      break;
    }

    currentStart += pageRows.length;
    if (page === maxPages - 1) {
      hasMore = true;
    }
  }

  return {
    rows: collected,
    hasMore,
    pagesFetched,
    hitRowLimitCap: hasMore || collected.length >= GSC_MAX_ROW_LIMIT,
  };
}

function buildDemoDatesBetween(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const cursor = new Date(start);
  while (cursor <= end && dates.length < 180) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function buildCoverageMetadata(params: {
  startDate: string;
  endDate: string;
  dataState: GscDataState;
  searchType: GscSearchType;
  totals: GscSearchAnalyticsTotals;
  topQueries: readonly GscSearchAnalyticsRow[];
  isTopRowLimited: boolean;
  sourceMode: "live" | "sandbox_demo";
}): GscDataCoverageMetadata {
  const finalDataCutoffDate = getPacificDateStringOffset(-2);
  const hasPreliminaryDatesInWindow =
    params.dataState === "all" || params.endDate > finalDataCutoffDate;

  const returnedQueryClicks =
    params.topQueries.length > 0
      ? params.topQueries.reduce((sum, row) => sum + row.clicks, 0)
      : null;

  const omittedClicksEstimate =
    params.totals.clicks !== null && returnedQueryClicks !== null
      ? Math.max(0, params.totals.clicks - returnedQueryClicks)
      : null;

  const notices: string[] = [
    `Dates align to Search Console reporting timezone (${GSC_REPORTING_TIMEZONE} / Pacific Time).`,
    `Standard Search Console totals lag ${GSC_MIN_FINAL_LAG_HOURS}-${GSC_MAX_FINAL_LAG_HOURS} hours for finalization (final cutoff: ${finalDataCutoffDate}).`,
    "Search Console Clicks count clicks from Google search results and are NOT equivalent to GA4 Sessions or Active Users.",
  ];

  if (hasPreliminaryDatesInWindow) {
    notices.push(
      params.dataState === "all"
        ? "Window includes preliminary ('all') data from recent hours that may still adjust."
        : `Selected range ends after final cutoff (${finalDataCutoffDate}); most recent days may stabilize further.`,
    );
  }

  if (params.searchType === "DISCOVER" || params.searchType === "GOOGLE_NEWS") {
    notices.push(
      `Query breakdown is unavailable for searchType=${params.searchType}; Google does not expose query strings for this surface.`,
    );
  } else if (omittedClicksEstimate !== null && omittedClicksEstimate > 0) {
    notices.push(
      `Returned query rows account for ${returnedQueryClicks?.toLocaleString() ?? 0} of ${params.totals.clicks?.toLocaleString() ?? 0} total clicks (${omittedClicksEstimate.toLocaleString()} anonymized rare-query or truncated long-tail clicks omitted by Search Console privacy thresholds).`,
    );
  } else {
    notices.push(
      "Rare or sensitive queries are excluded from the Query table for Search Console privacy anonymization.",
    );
  }

  if (params.isTopRowLimited) {
    notices.push(
      "Row limit reached: Search Console API caps single requests at 25,000 rows; remaining tail queries/pages may require narrower date or prefix filters.",
    );
  }

  if (params.sourceMode === "sandbox_demo") {
    notices.push(
      "Sandbox demonstration dataset active until live Google Search Console OAuth credentials are configured.",
    );
  }

  return {
    reportingTimeZone: GSC_REPORTING_TIMEZONE,
    dataState: params.dataState,
    finalDataCutoffDate,
    expectedLagHours: hasPreliminaryDatesInWindow
      ? GSC_MIN_FINAL_LAG_HOURS
      : GSC_MAX_FINAL_LAG_HOURS,
    hasPreliminaryDatesInWindow,
    isTopRowLimited: params.isTopRowLimited,
    privacyAnonymizedPossible: true,
    queryClicksVsTotalClicksGap:
      params.searchType === "DISCOVER" || params.searchType === "GOOGLE_NEWS"
        ? null
        : {
            unsegmentedClicks: params.totals.clicks,
            returnedQueryClicks,
            omittedClicksEstimate,
          },
    notices,
  };
}

function buildSandboxSearchAnalyticsBundle(options: {
  siteUrl: string;
  encodedSiteUrl: string;
  propertyKind: "DOMAIN" | "URL_PREFIX";
  input: GscSearchAnalyticsInput;
  validated: ReturnType<typeof validateSearchAnalyticsInput>;
}): GscSearchAnalyticsBundle {
  const { siteUrl, encodedSiteUrl, propertyKind, input, validated } = options;
  const domainLabel = siteUrl.replace(/^sc-domain:/, "").replace(/^https?:\/\/|\/.*$/g, "");
  const isStaging = siteUrl.includes("staging.");
  const scale = isStaging ? 0.14 : propertyKind === "DOMAIN" ? 1.0 : 0.84;

  const generateSeries = (start: string, end: string): GscSearchAnalyticsRow[] => {
    const dates = buildDemoDatesBetween(start, end);
    return dates.map((d, idx) => {
      const wave = 1 + Math.sin((idx + 2) / 3) * 0.18;
      const clicks = Math.max(0, Math.round(285 * scale * wave));
      const impressions = Math.max(clicks * 12, Math.round(7400 * scale * wave));
      const ctr = impressions > 0 ? Math.round((clicks / impressions) * 10000) / 10000 : 0;
      const position = Math.round((9.4 - Math.sin(idx / 5) * 1.1) * 10) / 10;
      return {
        keys: [d],
        date: d,
        clicks,
        impressions,
        ctr,
        position,
      };
    });
  };

  const dailySeries = generateSeries(input.startDate, input.endDate);
  const comparisonDailySeries =
    input.compareStartDate && input.compareEndDate
      ? generateSeries(input.compareStartDate, input.compareEndDate)
      : null;

  const totals = computeWeightedSearchTotalsFromRows(dailySeries);
  const comparisonTotals = comparisonDailySeries
    ? computeWeightedSearchTotalsFromRows(comparisonDailySeries)
    : null;

  const totalClicks = totals.clicks ?? 0;
  const totalImpr = totals.impressions ?? 1;

  const makeRow = (
    dim: GscDimension,
    val: string,
    clickShare: number,
    imprShare: number,
    pos: number,
  ): GscSearchAnalyticsRow => {
    const clicks = Math.round(totalClicks * clickShare);
    const impressions = Math.max(clicks, Math.round(totalImpr * imprShare));
    return {
      keys: [val],
      [dim]: val,
      clicks,
      impressions,
      ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 10000 : 0,
      position: pos,
    };
  };

  // Notice topQueries deliberately sums to ~86% of total clicks so privacy anonymization gap is genuinely visible!
  const allowQueries =
    validated.searchType !== "DISCOVER" && validated.searchType !== "GOOGLE_NEWS";

  const topQueries: GscSearchAnalyticsRow[] = allowQueries
    ? [
        makeRow("query", "avenor analytics workspace", 0.24, 0.14, 1.8),
        makeRow("query", "read only google analytics dashboard", 0.17, 0.16, 4.3),
        makeRow("query", "multi project seo reporting tool", 0.14, 0.18, 6.2),
        makeRow("query", `${domainLabel} documentation`, 0.12, 0.08, 2.1),
        makeRow("query", "ga4 search console reconciliation", 0.09, 0.15, 7.9),
        makeRow("query", "read only infrastructure telemetry", 0.06, 0.11, 11.4),
        makeRow("query", "verify gsc domain vs url prefix", 0.04, 0.08, 8.7),
      ]
    : [];

  const baseHost = domainLabel || "avenor.dev";
  const topPages: GscSearchAnalyticsRow[] = [
    makeRow("page", `https://${baseHost}/`, 0.34, 0.28, 3.6),
    makeRow("page", `https://${baseHost}/pricing`, 0.19, 0.15, 5.1),
    makeRow("page", `https://${baseHost}/docs/ga4-read-only-setup`, 0.16, 0.21, 4.4),
    makeRow("page", `https://${baseHost}/docs/search-console-guide`, 0.13, 0.17, 6.8),
    makeRow("page", `https://${baseHost}/integrations`, 0.1, 0.12, 8.2),
  ];

  const byCountry: GscSearchAnalyticsRow[] = [
    makeRow("country", "usa", 0.43, 0.41, 6.4),
    makeRow("country", "gbr", 0.15, 0.14, 6.9),
    makeRow("country", "deu", 0.12, 0.13, 7.5),
    makeRow("country", "can", 0.09, 0.09, 6.8),
    makeRow("country", "ind", 0.07, 0.11, 11.2),
  ];

  const byDevice: GscSearchAnalyticsRow[] = [
    makeRow("device", "DESKTOP", 0.64, 0.59, 6.2),
    makeRow("device", "MOBILE", 0.32, 0.37, 8.9),
    makeRow("device", "TABLET", 0.04, 0.04, 7.4),
  ];

  const bySearchAppearance: GscSearchAnalyticsRow[] = [
    makeRow("searchAppearance", "RICHCARD", 0.12, 0.1, 4.9),
    makeRow("searchAppearance", "WEB_LIGHT_RESULTS", 0.02, 0.03, 12.1),
  ];

  const requestedDims = validated.dimensions;
  const customRows =
    requestedDims.includes("query") && topQueries.length > 0
      ? topQueries.slice(validated.startRow, validated.startRow + validated.rowLimit)
      : requestedDims.includes("page")
        ? topPages.slice(validated.startRow, validated.startRow + validated.rowLimit)
        : dailySeries.slice(validated.startRow, validated.startRow + validated.rowLimit);

  const coverage = buildCoverageMetadata({
    startDate: input.startDate,
    endDate: input.endDate,
    dataState: validated.dataState,
    searchType: validated.searchType,
    totals,
    topQueries,
    isTopRowLimited: false,
    sourceMode: "sandbox_demo",
  });

  return {
    siteUrl,
    encodedSiteUrl,
    propertyKind,
    sourceMode: "sandbox_demo",
    cacheStatus: "miss",
    fetchedAtIso: new Date().toISOString(),
    searchType: validated.searchType,
    dataState: validated.dataState,
    startDate: input.startDate,
    endDate: input.endDate,
    compareStartDate: input.compareStartDate ?? null,
    compareEndDate: input.compareEndDate ?? null,
    totals,
    comparisonTotals,
    dailySeries,
    comparisonDailySeries,
    topQueries,
    topPages,
    byCountry,
    byDevice,
    bySearchAppearance,
    customRows,
    pagination: {
      rowLimit: validated.rowLimit,
      startRow: validated.startRow,
      rowsReturned: customRows.length,
      hasMore: false,
      pagesFetched: 1,
    },
    coverage,
  };
}

/**
 * Fetches Google Search Console Search Analytics report data across unsegmented totals,
 * daily trend, top queries (omitted for Discover/Google News), top landing pages, countries,
 * devices, and search appearances, with impression-weighted CTR/Position and Pacific Time coverage notes.
 */
export async function readSearchAnalyticsReportBundle(
  context: ReadOnlyProviderContext,
  input: GscSearchAnalyticsInput,
  options?: {
    fetchFn?: typeof fetch;
    bypassCache?: boolean;
  },
): Promise<GscSearchAnalyticsBundle> {
  assertGscScenarioAndScope(context);

  const canonical = normalizeCanonicalGscSiteUrl(input.siteUrl);
  const validated = validateSearchAnalyticsInput(input);

  const cacheParts = {
    organizationId: context.organizationId,
    workspaceId: context.workspaceId,
    projectId: input.projectId ?? null,
    connectionId: context.connectionId ?? "direct",
    providerKey: "gsc",
    externalResourceId: canonical.siteUrl,
    operation: "search_analytics_report",
    params: {
      startDate: input.startDate,
      endDate: input.endDate,
      compareStartDate: input.compareStartDate ?? null,
      compareEndDate: input.compareEndDate ?? null,
      searchType: validated.searchType,
      dataState: validated.dataState,
      dimensions: validated.dimensions.join(","),
      rowLimit: validated.rowLimit,
      startRow: validated.startRow,
      filters: input.dimensionFilterGroups ? JSON.stringify(input.dimensionFilterGroups) : null,
      tokenDigestHint: options?.fetchFn
        ? "mock_fetch"
        : (context.accessToken?.slice(0, 8) ?? "none"),
    },
  };

  if (!options?.bypassCache && !context.simulationScenario) {
    const cached = sharedGoogleTelemetryCache.get<GscSearchAnalyticsBundle>(cacheParts);
    if (cached) {
      return {
        ...cached.value,
        cacheStatus: "hit",
        fetchedAtIso: cached.fetchedAtIso,
      };
    }
  }

  const executeLive = shouldExecuteLiveGoogleApi(context, Boolean(options?.fetchFn), "gsc");
  if (!executeLive) {
    const demo = buildSandboxSearchAnalyticsBundle({
      siteUrl: canonical.siteUrl,
      encodedSiteUrl: canonical.encodedSiteUrl,
      propertyKind: canonical.propertyKind,
      input,
      validated,
    });
    if (!options?.bypassCache) {
      sharedGoogleTelemetryCache.set(cacheParts, demo, GSC_REPORT_CACHE_TTL_MS);
    }
    return demo;
  }

  const accessToken = context.accessToken ?? "";
  if (!accessToken) {
    throw new ProviderAdapterError({
      providerKey: "gsc",
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "Missing Search Console OAuth access token.",
    });
  }

  const baseReq = {
    startDate: input.startDate,
    endDate: input.endDate,
    type: validated.searchType,
    dataState: validated.dataState,
    dimensionFilterGroups: input.dimensionFilterGroups,
  };

  const allowQueries =
    validated.searchType !== "DISCOVER" && validated.searchType !== "GOOGLE_NEWS";

  const [
    unsegmentedRows,
    dailySeries,
    queryPaged,
    topPages,
    byCountry,
    byDevice,
    bySearchAppearance,
    comparisonUnsegmented,
    comparisonDaily,
  ] = await Promise.all([
    querySearchAnalytics({
      accessToken,
      siteUrl: canonical.siteUrl,
      fetchFn: options?.fetchFn,
      requestBody: { ...baseReq, rowLimit: 10 },
    }),
    querySearchAnalytics({
      accessToken,
      siteUrl: canonical.siteUrl,
      fetchFn: options?.fetchFn,
      requestBody: { ...baseReq, dimensions: ["date"], rowLimit: 500 },
    }),
    allowQueries
      ? paginatedSearchAnalyticsQuery({
          accessToken,
          siteUrl: canonical.siteUrl,
          fetchFn: options?.fetchFn,
          requestBody: { ...baseReq, dimensions: ["query"] },
          pageSize: validated.rowLimit,
          startRow: validated.startRow,
          maxPagesToFetch: validated.maxPagesToFetch,
        })
      : Promise.resolve({
          rows: [] as GscSearchAnalyticsRow[],
          hasMore: false,
          pagesFetched: 0,
          hitRowLimitCap: false,
        }),
    querySearchAnalytics({
      accessToken,
      siteUrl: canonical.siteUrl,
      fetchFn: options?.fetchFn,
      requestBody: { ...baseReq, dimensions: ["page"], rowLimit: 100 },
    }),
    querySearchAnalytics({
      accessToken,
      siteUrl: canonical.siteUrl,
      fetchFn: options?.fetchFn,
      requestBody: { ...baseReq, dimensions: ["country"], rowLimit: 50 },
    }),
    querySearchAnalytics({
      accessToken,
      siteUrl: canonical.siteUrl,
      fetchFn: options?.fetchFn,
      requestBody: { ...baseReq, dimensions: ["device"], rowLimit: 10 },
    }),
    validated.searchType === "WEB" ||
    validated.searchType === "IMAGE" ||
    validated.searchType === "VIDEO"
      ? querySearchAnalytics({
          accessToken,
          siteUrl: canonical.siteUrl,
          fetchFn: options?.fetchFn,
          requestBody: { ...baseReq, dimensions: ["searchAppearance"], rowLimit: 25 },
        }).catch(() => [] as GscSearchAnalyticsRow[])
      : Promise.resolve([] as GscSearchAnalyticsRow[]),
    input.compareStartDate && input.compareEndDate
      ? querySearchAnalytics({
          accessToken,
          siteUrl: canonical.siteUrl,
          fetchFn: options?.fetchFn,
          requestBody: {
            startDate: input.compareStartDate,
            endDate: input.compareEndDate,
            type: validated.searchType,
            dataState: validated.dataState,
            dimensionFilterGroups: input.dimensionFilterGroups,
            rowLimit: 10,
          },
        })
      : Promise.resolve(null),
    input.compareStartDate && input.compareEndDate
      ? querySearchAnalytics({
          accessToken,
          siteUrl: canonical.siteUrl,
          fetchFn: options?.fetchFn,
          requestBody: {
            startDate: input.compareStartDate,
            endDate: input.compareEndDate,
            dimensions: ["date"],
            type: validated.searchType,
            dataState: validated.dataState,
            dimensionFilterGroups: input.dimensionFilterGroups,
            rowLimit: 500,
          },
        })
      : Promise.resolve(null),
  ]);

  // Prefer unsegmented Search Analytics total row (`dimensions: []`); fallback to impression-weighted daily rollup
  const totals =
    unsegmentedRows.length > 0
      ? computeWeightedSearchTotalsFromRows(unsegmentedRows)
      : computeWeightedSearchTotalsFromRows(dailySeries);

  const comparisonTotals = comparisonUnsegmented
    ? comparisonUnsegmented.length > 0
      ? computeWeightedSearchTotalsFromRows(comparisonUnsegmented)
      : comparisonDaily
        ? computeWeightedSearchTotalsFromRows(comparisonDaily)
        : null
    : null;

  const customRows =
    validated.dimensions.length > 0 && validated.dimensions[0] === "page"
      ? topPages
      : validated.dimensions.length > 0 && validated.dimensions[0] === "date"
        ? dailySeries
        : queryPaged.rows;

  const coverage = buildCoverageMetadata({
    startDate: input.startDate,
    endDate: input.endDate,
    dataState: validated.dataState,
    searchType: validated.searchType,
    totals,
    topQueries: queryPaged.rows,
    isTopRowLimited: queryPaged.hitRowLimitCap,
    sourceMode: "live",
  });

  const bundle: GscSearchAnalyticsBundle = {
    siteUrl: canonical.siteUrl,
    encodedSiteUrl: canonical.encodedSiteUrl,
    propertyKind: canonical.propertyKind,
    sourceMode: "live",
    cacheStatus: "miss",
    fetchedAtIso: new Date().toISOString(),
    searchType: validated.searchType,
    dataState: validated.dataState,
    startDate: input.startDate,
    endDate: input.endDate,
    compareStartDate: input.compareStartDate ?? null,
    compareEndDate: input.compareEndDate ?? null,
    totals,
    comparisonTotals,
    dailySeries: [...dailySeries].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
    comparisonDailySeries: comparisonDaily
      ? [...comparisonDaily].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
      : null,
    topQueries: queryPaged.rows,
    topPages,
    byCountry,
    byDevice,
    bySearchAppearance,
    customRows,
    pagination: {
      rowLimit: validated.rowLimit,
      startRow: validated.startRow,
      rowsReturned: customRows.length,
      hasMore: queryPaged.hasMore,
      pagesFetched: queryPaged.pagesFetched,
    },
    coverage,
  };

  if (!options?.bypassCache && !context.simulationScenario) {
    sharedGoogleTelemetryCache.set(cacheParts, bundle, GSC_REPORT_CACHE_TTL_MS);
  }

  return bundle;
}
