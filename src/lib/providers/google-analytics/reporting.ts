import {
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import { sharedGoogleTelemetryCache } from "../google-shared/cache";
import {
  executeGoogleReadRequest,
  GOOGLE_ANALYTICS_ADMIN_BASE,
  GOOGLE_ANALYTICS_DATA_BASE,
  shouldExecuteLiveGoogleApi,
} from "../google-shared/http";
import { assertGa4ScenarioAndScope, normalizeGa4PropertyResourceName } from "./admin";
import {
  formatGa4DateValue,
  GA4_STANDARD_ALLOWED_DIMENSIONS,
  GA4_STANDARD_ALLOWED_METRICS,
  parseGa4MetricNumber,
  validateGa4StandardQueryInputs,
} from "./dictionary";
import type {
  Ga4BreakdownRow,
  Ga4CompatibilityResult,
  Ga4DataQualityFlags,
  Ga4DateSeriesPoint,
  Ga4KeyEventDefinition,
  Ga4OverviewTotals,
  Ga4QuotaSnapshot,
  Ga4StandardReportBundle,
  Ga4StandardReportInput,
} from "./types";

interface RawGa4ReportMetricHeader {
  name?: string;
  type?: string;
}

interface RawGa4ReportDimensionHeader {
  name?: string;
}

interface RawGa4ReportRow {
  dimensionValues?: Array<{ value?: string; oneValue?: string }>;
  metricValues?: Array<{ value?: string; oneValue?: string }>;
}

interface RawGa4SamplingMetadata {
  samplesReadCount?: string;
  samplingSpaceSize?: string;
}

export interface RawGa4RunReportResponse {
  dimensionHeaders?: RawGa4ReportDimensionHeader[];
  metricHeaders?: RawGa4ReportMetricHeader[];
  rows?: RawGa4ReportRow[];
  totals?: RawGa4ReportRow[];
  rowCount?: number;
  metadata?: {
    currencyCode?: string;
    timeZone?: string;
    dataLossFromOtherRow?: boolean;
    subjectToThresholding?: boolean;
    samplingMetadatas?: RawGa4SamplingMetadata[];
    emptyReason?: string;
  };
  propertyQuota?: {
    tokensPerDay?: { consumed?: number; remaining?: number };
    tokensPerHour?: { consumed?: number; remaining?: number };
  };
}

interface RawGa4BatchRunReportsResponse {
  reports?: RawGa4RunReportResponse[];
}

interface RawGa4MetadataResponse {
  name?: string;
  dimensions?: Array<{ apiName?: string; uiName?: string }>;
  metrics?: Array<{ apiName?: string; uiName?: string }>;
}

interface RawGa4CheckCompatibilityResponse {
  dimensionCompatibilities?: Array<{
    dimensionMetadata?: { apiName?: string };
    compatibility?: "COMPATIBLE" | "INCOMPATIBLE" | string;
  }>;
  metricCompatibilities?: Array<{
    metricMetadata?: { apiName?: string };
    compatibility?: "COMPATIBLE" | "INCOMPATIBLE" | string;
  }>;
}

interface RawGa4KeyEventsResponse {
  keyEvents?: Array<{
    name?: string;
    eventName?: string;
    countingMethod?: string;
    defaultValue?: {
      numericValue?: number;
      currencyCode?: string;
    };
  }>;
}

export interface Ga4RunReportRequestBody {
  dateRanges: Array<{ startDate: string; endDate: string; name?: string }>;
  dimensions?: Array<{ name: string }>;
  metrics: Array<{ name: string }>;
  metricAggregations?: Array<"TOTAL" | "MINIMUM" | "MAXIMUM">;
  limit?: string;
  offset?: string;
  orderBys?: Array<{
    dimension?: { dimensionName: string };
    metric?: { metricName: string };
    desc?: boolean;
  }>;
  returnPropertyQuota?: boolean;
}

const STANDARD_REPORT_TTL_MS = 5 * 60 * 1000;

export async function getGa4PropertyMetadataCatalog(options: {
  accessToken: string;
  propertyName: string;
  fetchFn?: typeof fetch;
}): Promise<{
  dimensionApiNames: string[];
  metricApiNames: string[];
}> {
  const normalized = normalizeGa4PropertyResourceName(options.propertyName);
  const url = `${GOOGLE_ANALYTICS_DATA_BASE}/${normalized}/metadata`;
  const raw = await executeGoogleReadRequest<RawGa4MetadataResponse>({
    providerKey: "ga4",
    url,
    method: "GET",
    accessToken: options.accessToken,
    fetchFn: options.fetchFn,
  });

  return {
    dimensionApiNames: (raw.dimensions ?? [])
      .map((d) => d.apiName ?? "")
      .filter((name) => name.length > 0),
    metricApiNames: (raw.metrics ?? [])
      .map((m) => m.apiName ?? "")
      .filter((name) => name.length > 0),
  };
}

export async function checkGa4DimensionMetricCompatibility(options: {
  context: ReadOnlyProviderContext;
  propertyName: string;
  metrics: readonly string[];
  dimensions: readonly string[];
  fetchFn?: typeof fetch;
}): Promise<Ga4CompatibilityResult> {
  assertGa4ScenarioAndScope(options.context);
  const normalized = normalizeGa4PropertyResourceName(options.propertyName);

  const localIncompatibleMetrics = options.metrics.filter(
    (m) => !GA4_STANDARD_ALLOWED_METRICS.has(m),
  );
  const localIncompatibleDimensions = options.dimensions.filter(
    (d) => !GA4_STANDARD_ALLOWED_DIMENSIONS.has(d),
  );

  if (localIncompatibleMetrics.length > 0 || localIncompatibleDimensions.length > 0) {
    return {
      compatible: false,
      incompatibleMetrics: localIncompatibleMetrics,
      incompatibleDimensions: localIncompatibleDimensions,
      checkedViaRemoteApi: false,
      reasons: [
        ...localIncompatibleMetrics.map(
          (m) => `Metric "${m}" is outside GA4 Standard reporting dictionary.`,
        ),
        ...localIncompatibleDimensions.map(
          (d) => `Dimension "${d}" is incompatible with GA4 Standard reporting.`,
        ),
      ],
    };
  }

  if (shouldExecuteLiveGoogleApi(options.context, Boolean(options.fetchFn), "ga4")) {
    const url = `${GOOGLE_ANALYTICS_DATA_BASE}/${normalized}:checkCompatibility`;
    const raw = await executeGoogleReadRequest<RawGa4CheckCompatibilityResponse>({
      providerKey: "ga4",
      url,
      method: "POST",
      accessToken: options.context.accessToken ?? "",
      body: {
        dimensions: options.dimensions.map((name) => ({ name })),
        metrics: options.metrics.map((name) => ({ name })),
        compatibilityFilter: "COMPATIBLE",
      },
      fetchFn: options.fetchFn,
    });

    const badMetrics = (raw.metricCompatibilities ?? [])
      .filter((c) => c.compatibility && c.compatibility !== "COMPATIBLE")
      .map((c) => c.metricMetadata?.apiName ?? "unknown");
    const badDims = (raw.dimensionCompatibilities ?? [])
      .filter((c) => c.compatibility && c.compatibility !== "COMPATIBLE")
      .map((c) => c.dimensionMetadata?.apiName ?? "unknown");

    return {
      compatible: badMetrics.length === 0 && badDims.length === 0,
      incompatibleMetrics: badMetrics,
      incompatibleDimensions: badDims,
      checkedViaRemoteApi: true,
      reasons: [
        ...badMetrics.map((m) => `GA4 Data API marked metric "${m}" incompatible.`),
        ...badDims.map((d) => `GA4 Data API marked dimension "${d}" incompatible.`),
      ],
    };
  }

  return {
    compatible: true,
    incompatibleMetrics: [],
    incompatibleDimensions: [],
    checkedViaRemoteApi: false,
    reasons: [],
  };
}

export async function listGa4PropertyKeyEvents(options: {
  accessToken: string;
  propertyName: string;
  fetchFn?: typeof fetch;
}): Promise<Ga4KeyEventDefinition[]> {
  const normalized = normalizeGa4PropertyResourceName(options.propertyName);
  const url = `${GOOGLE_ANALYTICS_ADMIN_BASE}/${normalized}/keyEvents?pageSize=200`;
  const raw = await executeGoogleReadRequest<RawGa4KeyEventsResponse>({
    providerKey: "ga4",
    url,
    method: "GET",
    accessToken: options.accessToken,
    fetchFn: options.fetchFn,
  });

  return (raw.keyEvents ?? []).map((evt) => ({
    name: evt.name ?? "",
    eventName: evt.eventName ?? "key_event",
    countingMethod: evt.countingMethod ?? null,
    defaultValue:
      typeof evt.defaultValue?.numericValue === "number" ? evt.defaultValue.numericValue : null,
    currencyCode: evt.defaultValue?.currencyCode ?? null,
  }));
}

export async function runGa4DataReport(options: {
  accessToken: string;
  propertyName: string;
  requestBody: Ga4RunReportRequestBody;
  fetchFn?: typeof fetch;
}): Promise<RawGa4RunReportResponse> {
  const normalized = normalizeGa4PropertyResourceName(options.propertyName);
  const url = `${GOOGLE_ANALYTICS_DATA_BASE}/${normalized}:runReport`;
  return executeGoogleReadRequest<RawGa4RunReportResponse>({
    providerKey: "ga4",
    url,
    method: "POST",
    accessToken: options.accessToken,
    body: {
      ...options.requestBody,
      returnPropertyQuota: options.requestBody.returnPropertyQuota ?? true,
    },
    fetchFn: options.fetchFn,
  });
}

export async function batchRunGa4DataReports(options: {
  accessToken: string;
  propertyName: string;
  requests: Ga4RunReportRequestBody[];
  fetchFn?: typeof fetch;
}): Promise<RawGa4RunReportResponse[]> {
  const normalized = normalizeGa4PropertyResourceName(options.propertyName);
  const url = `${GOOGLE_ANALYTICS_DATA_BASE}/${normalized}:batchRunReports`;
  const response = await executeGoogleReadRequest<RawGa4BatchRunReportsResponse>({
    providerKey: "ga4",
    url,
    method: "POST",
    accessToken: options.accessToken,
    body: {
      requests: options.requests.map((req) => ({
        ...req,
        returnPropertyQuota: req.returnPropertyQuota ?? true,
      })),
    },
    fetchFn: options.fetchFn,
  });

  if (!Array.isArray(response.reports)) {
    throw new ProviderAdapterError({
      providerKey: "ga4",
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: "GA4 Data API batchRunReports response omitted the expected reports array.",
    });
  }

  return response.reports;
}

export function extractDataQualityFromGa4Reports(
  reports: readonly (RawGa4RunReportResponse | undefined)[],
): Ga4DataQualityFlags {
  let isSampled = false;
  let samplingRatePct: number | null = null;
  let isThresholded = false;
  let hasOtherRowTruncation = false;
  let emptyReason: string | null = null;

  for (const report of reports) {
    const meta = report?.metadata;
    if (!meta) continue;

    if (meta.dataLossFromOtherRow) {
      hasOtherRowTruncation = true;
    }
    if (meta.subjectToThresholding) {
      isThresholded = true;
    }
    if (meta.emptyReason && !emptyReason) {
      emptyReason = meta.emptyReason;
    }

    const samplingList = meta.samplingMetadatas ?? [];
    if (samplingList.length > 0) {
      isSampled = true;
      const firstSampling = samplingList[0];
      const readCount = Number(firstSampling?.samplesReadCount);
      const spaceSize = Number(firstSampling?.samplingSpaceSize);
      if (Number.isFinite(readCount) && Number.isFinite(spaceSize) && spaceSize > 0) {
        const pct = Math.min(100, Math.round((readCount / spaceSize) * 1000) / 10);
        samplingRatePct = samplingRatePct === null ? pct : Math.min(samplingRatePct, pct);
      }
    }
  }

  const notices: string[] = [];
  if (isSampled) {
    notices.push(
      samplingRatePct !== null
        ? `Sampled GA4 dataset (${samplingRatePct}% of events read). Totals are upstream statistical estimates.`
        : "Sampled GA4 dataset returned due to event cardinality / query complexity.",
    );
  }
  if (isThresholded) {
    notices.push(
      "Data thresholding applied by Google Analytics to protect individual user privacy in small demographic/location cohorts.",
    );
  }
  if (hasOtherRowTruncation) {
    notices.push(
      "Some high-cardinality rows were grouped into GA4's (other) bucket due to Data API table limits.",
    );
  }

  return {
    isSampled,
    samplingRatePct,
    isThresholded,
    hasOtherRowTruncation,
    emptyReason,
    notices,
  };
}

function extractQuotaFromReports(
  reports: readonly (RawGa4RunReportResponse | undefined)[],
): Ga4QuotaSnapshot {
  let tokensRemainingDay: number | null = null;
  let tokensRemainingHour: number | null = null;
  let tokensConsumed = 0;
  let sawConsumed = false;

  for (const report of reports) {
    const quota = report?.propertyQuota;
    if (!quota) continue;
    if (typeof quota.tokensPerDay?.remaining === "number") {
      tokensRemainingDay = quota.tokensPerDay.remaining;
    }
    if (typeof quota.tokensPerHour?.remaining === "number") {
      tokensRemainingHour = quota.tokensPerHour.remaining;
    }
    if (typeof quota.tokensPerHour?.consumed === "number") {
      tokensConsumed += quota.tokensPerHour.consumed;
      sawConsumed = true;
    } else if (typeof quota.tokensPerDay?.consumed === "number") {
      tokensConsumed += quota.tokensPerDay.consumed;
      sawConsumed = true;
    }
  }

  return {
    tokensRemainingDay,
    tokensRemainingHour,
    tokensConsumed: sawConsumed ? tokensConsumed : null,
  };
}

function buildMetricIndexMap(report: RawGa4RunReportResponse | undefined): Map<string, number> {
  const map = new Map<string, number>();
  (report?.metricHeaders ?? []).forEach((hdr, idx) => {
    if (hdr.name) {
      map.set(hdr.name, idx);
    }
  });
  return map;
}

function readRowMetric(
  row: RawGa4ReportRow | undefined,
  indexMap: Map<string, number>,
  metricName: string,
): number | null {
  const idx = indexMap.get(metricName);
  if (idx === undefined) {
    return null;
  }
  const cell = row?.metricValues?.[idx];
  return parseGa4MetricNumber(cell?.value ?? cell?.oneValue);
}

function parseDailySeries(report: RawGa4RunReportResponse | undefined): Ga4DateSeriesPoint[] {
  if (!report?.rows || report.rows.length === 0) {
    return [];
  }
  const indexMap = buildMetricIndexMap(report);
  return report.rows
    .map((row): Ga4DateSeriesPoint => {
      const rawDate = row.dimensionValues?.[0]?.value ?? "";
      return {
        date: formatGa4DateValue(rawDate),
        activeUsers: readRowMetric(row, indexMap, "activeUsers"),
        totalUsers: readRowMetric(row, indexMap, "totalUsers"),
        newUsers: readRowMetric(row, indexMap, "newUsers"),
        sessions: readRowMetric(row, indexMap, "sessions"),
        engagedSessions: readRowMetric(row, indexMap, "engagedSessions"),
        engagementRate: readRowMetric(row, indexMap, "engagementRate"),
        screenPageViews: readRowMetric(row, indexMap, "screenPageViews"),
        eventCount: readRowMetric(row, indexMap, "eventCount"),
        averageSessionDuration: readRowMetric(row, indexMap, "averageSessionDuration"),
        keyEvents: readRowMetric(row, indexMap, "keyEvents"),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function parseTotalsFromReport(
  report: RawGa4RunReportResponse | undefined,
  dailySeries: readonly Ga4DateSeriesPoint[],
): Ga4OverviewTotals {
  // Always prefer GA4's own multi-day window TOTAL aggregation row when available so
  // distinct activeUsers / totalUsers are never overcounted by summing daily buckets.
  const totalRow = report?.totals?.[0];
  if (totalRow) {
    const indexMap = buildMetricIndexMap(report);
    return {
      activeUsers: readRowMetric(totalRow, indexMap, "activeUsers"),
      totalUsers: readRowMetric(totalRow, indexMap, "totalUsers"),
      newUsers: readRowMetric(totalRow, indexMap, "newUsers"),
      sessions: readRowMetric(totalRow, indexMap, "sessions"),
      engagedSessions: readRowMetric(totalRow, indexMap, "engagedSessions"),
      engagementRate: readRowMetric(totalRow, indexMap, "engagementRate"),
      screenPageViews: readRowMetric(totalRow, indexMap, "screenPageViews"),
      eventCount: readRowMetric(totalRow, indexMap, "eventCount"),
      averageSessionDuration: readRowMetric(totalRow, indexMap, "averageSessionDuration"),
      keyEvents: readRowMetric(totalRow, indexMap, "keyEvents"),
    };
  }

  if (dailySeries.length === 0) {
    return {
      activeUsers: null,
      totalUsers: null,
      newUsers: null,
      sessions: null,
      engagedSessions: null,
      engagementRate: null,
      screenPageViews: null,
      eventCount: null,
      averageSessionDuration: null,
      keyEvents: null,
    };
  }

  const sumNullable = (pick: (p: Ga4DateSeriesPoint) => number | null): number | null => {
    let seen = false;
    let total = 0;
    for (const point of dailySeries) {
      const val = pick(point);
      if (val !== null) {
        seen = true;
        total += val;
      }
    }
    return seen ? total : null;
  };

  const sessions = sumNullable((p) => p.sessions);
  const engagedSessions = sumNullable((p) => p.engagedSessions);
  const engagementRate =
    sessions !== null && engagedSessions !== null && sessions > 0
      ? Math.round((engagedSessions / sessions) * 10000) / 10000
      : null;

  let weightedDurationSum = 0;
  let durationWeightSum = 0;
  for (const point of dailySeries) {
    if (point.averageSessionDuration !== null && point.sessions !== null && point.sessions > 0) {
      weightedDurationSum += point.averageSessionDuration * point.sessions;
      durationWeightSum += point.sessions;
    }
  }
  const averageSessionDuration =
    durationWeightSum > 0 ? Math.round((weightedDurationSum / durationWeightSum) * 10) / 10 : null;

  return {
    // Only take max/last deduplicated day estimate if GA4 TOTAL row was omitted,
    // OR null when multiple days exist without GA4 TOTAL aggregation row? We take single-day exact
    // or fallback peak daily distinct users clearly never summed linearly.
    activeUsers:
      dailySeries.length === 1
        ? dailySeries[0].activeUsers
        : dailySeries.reduce<number | null>(
            (max, p) => (p.activeUsers !== null ? Math.max(max ?? 0, p.activeUsers) : max),
            null,
          ),
    totalUsers:
      dailySeries.length === 1
        ? dailySeries[0].totalUsers
        : dailySeries.reduce<number | null>(
            (max, p) => (p.totalUsers !== null ? Math.max(max ?? 0, p.totalUsers) : max),
            null,
          ),
    newUsers: sumNullable((p) => p.newUsers),
    sessions,
    engagedSessions,
    engagementRate,
    screenPageViews: sumNullable((p) => p.screenPageViews),
    eventCount: sumNullable((p) => p.eventCount),
    averageSessionDuration,
    keyEvents: sumNullable((p) => p.keyEvents),
  };
}

function parseBreakdownRows(report: RawGa4RunReportResponse | undefined): Ga4BreakdownRow[] {
  if (!report?.rows || report.rows.length === 0) {
    return [];
  }
  const indexMap = buildMetricIndexMap(report);
  const hasSecondaryDim = (report.dimensionHeaders?.length ?? 0) > 1;
  return report.rows.map((row): Ga4BreakdownRow => {
    const dim0 = row.dimensionValues?.[0]?.value ?? "(not set)";
    const dim1 = hasSecondaryDim ? row.dimensionValues?.[1]?.value : undefined;
    return {
      dimensionValue: dim0,
      ...(dim1 !== undefined ? { secondaryDimensionValue: dim1 } : {}),
      activeUsers: readRowMetric(row, indexMap, "activeUsers"),
      sessions: readRowMetric(row, indexMap, "sessions"),
      engagedSessions: readRowMetric(row, indexMap, "engagedSessions"),
      engagementRate: readRowMetric(row, indexMap, "engagementRate"),
      screenPageViews: readRowMetric(row, indexMap, "screenPageViews"),
      eventCount: readRowMetric(row, indexMap, "eventCount"),
      keyEvents: readRowMetric(row, indexMap, "keyEvents"),
    };
  });
}

function enumerateIsoDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    return dates;
  }
  const maxDays = 180;
  for (let ms = startMs; ms <= endMs && dates.length < maxDays; ms += 86_400_000) {
    dates.push(new Date(ms).toISOString().slice(0, 10));
  }
  return dates;
}

function buildSandboxGa4ReportBundle(options: {
  context: ReadOnlyProviderContext;
  propertyName: string;
  input: Ga4StandardReportInput;
}): Ga4StandardReportBundle {
  const numericId = options.propertyName.replace(/^properties\//, "");
  const isEmpty = options.context.accessToken === "sbx_empty_account";
  const isEurope = numericId === "551803210";
  const isStaging = numericId === "402918992";
  const reportingTimeZone =
    options.input.propertyTimeZone ??
    (isEurope ? "Europe/Berlin" : isStaging ? "UTC" : "America/New_York");
  const currencyCode = options.input.currencyCode ?? (isEurope ? "EUR" : "USD");
  const fetchedAtIso = new Date().toISOString();

  if (isEmpty) {
    return {
      propertyName: options.propertyName,
      numericPropertyId: numericId,
      reportingTimeZone,
      currencyCode,
      sourceMode: "sandbox_demo",
      cacheStatus: "miss",
      fetchedAtIso,
      startDate: options.input.startDate,
      endDate: options.input.endDate,
      compareStartDate: options.input.compareStartDate ?? null,
      compareEndDate: options.input.compareEndDate ?? null,
      totals: {
        activeUsers: null,
        totalUsers: null,
        newUsers: null,
        sessions: null,
        engagedSessions: null,
        engagementRate: null,
        screenPageViews: null,
        eventCount: null,
        averageSessionDuration: null,
        keyEvents: null,
      },
      comparisonTotals: null,
      dailySeries: [],
      comparisonSeries: null,
      channels: [],
      sourceMediums: [],
      landingPages: [],
      topPages: [],
      devices: [],
      countries: [],
      cities: [],
      topEvents: [],
      keyEventDefinitions: [],
      dataQuality: {
        isSampled: false,
        samplingRatePct: null,
        isThresholded: false,
        hasOtherRowTruncation: false,
        emptyReason: "NO_DATA",
        notices: ["Google Analytics property returned zero events for the selected period."],
      },
      quota: {
        tokensRemainingDay: 24980,
        tokensRemainingHour: 4990,
        tokensConsumed: 0,
      },
    };
  }

  const dates = enumerateIsoDates(options.input.startDate, options.input.endDate);
  const scale = isStaging ? 0.14 : isEurope ? 0.68 : 1.0;

  const generateSeries = (dateList: string[], offsetMultiplier: number): Ga4DateSeriesPoint[] =>
    dateList.map((date, idx) => {
      const wave = 1 + 0.16 * Math.sin((idx + offsetMultiplier) * 0.65);
      const weekendDip = idx % 7 >= 5 ? 0.84 : 1.04;
      const factor = scale * wave * weekendDip * (offsetMultiplier > 0 ? 0.91 : 1);
      const sessions = Math.max(12, Math.round(1480 * factor));
      const engagedSessions = Math.max(8, Math.round(sessions * 0.642));
      const activeUsers = Math.max(10, Math.round(sessions * 0.81));
      const totalUsers = Math.round(activeUsers * 1.06);
      const newUsers = Math.round(activeUsers * 0.44);
      const screenPageViews = Math.round(sessions * 2.45);
      const eventCount = Math.round(screenPageViews * 3.1);
      const keyEvents = Math.max(1, Math.round(sessions * 0.038));
      const engagementRate = Math.round((engagedSessions / sessions) * 10000) / 10000;
      const averageSessionDuration = Math.round((152 + (idx % 5) * 9) * 10) / 10;

      return {
        date,
        activeUsers,
        totalUsers,
        newUsers,
        sessions,
        engagedSessions,
        engagementRate,
        screenPageViews,
        eventCount,
        averageSessionDuration,
        keyEvents,
      };
    });

  const dailySeries = generateSeries(dates, 0);
  const comparisonDates =
    options.input.compareStartDate && options.input.compareEndDate
      ? enumerateIsoDates(options.input.compareStartDate, options.input.compareEndDate)
      : null;
  const comparisonSeries = comparisonDates ? generateSeries(comparisonDates, 7) : null;

  const summarizeDemoWindow = (series: Ga4DateSeriesPoint[]): Ga4OverviewTotals => {
    const sessions = series.reduce((sum, d) => sum + (d.sessions ?? 0), 0);
    const engagedSessions = series.reduce((sum, d) => sum + (d.engagedSessions ?? 0), 0);
    const newUsers = series.reduce((sum, d) => sum + (d.newUsers ?? 0), 0);
    const screenPageViews = series.reduce((sum, d) => sum + (d.screenPageViews ?? 0), 0);
    const eventCount = series.reduce((sum, d) => sum + (d.eventCount ?? 0), 0);
    const keyEvents = series.reduce((sum, d) => sum + (d.keyEvents ?? 0), 0);
    // Deduplicated active/total users across window are sub-linear compared to naive sum of daily users
    const sumDailyActive = series.reduce((sum, d) => sum + (d.activeUsers ?? 0), 0);
    const activeUsers = Math.round(sumDailyActive * 0.72);
    const totalUsers = Math.round(activeUsers * 1.08);
    const engagementRate =
      sessions > 0 ? Math.round((engagedSessions / sessions) * 10000) / 10000 : null;
    const durationWeighted =
      sessions > 0
        ? Math.round(
            (series.reduce(
              (sum, d) => sum + (d.averageSessionDuration ?? 0) * (d.sessions ?? 0),
              0,
            ) /
              sessions) *
              10,
          ) / 10
        : null;

    return {
      activeUsers,
      totalUsers,
      newUsers,
      sessions,
      engagedSessions,
      engagementRate,
      screenPageViews,
      eventCount,
      averageSessionDuration: durationWeighted,
      keyEvents,
    };
  };

  const totals = summarizeDemoWindow(dailySeries);
  const comparisonTotals = comparisonSeries ? summarizeDemoWindow(comparisonSeries) : null;
  const totalSessions = totals.sessions ?? 1;
  const totalViews = totals.screenPageViews ?? 1;

  const shareRow = (
    dim: string,
    pct: number,
    engRate: number,
    convFactor: number,
    secondary?: string,
  ): Ga4BreakdownRow => {
    const rowSessions = Math.max(1, Math.round(totalSessions * pct));
    const rowEngaged = Math.round(rowSessions * engRate);
    return {
      dimensionValue: dim,
      ...(secondary ? { secondaryDimensionValue: secondary } : {}),
      activeUsers: Math.max(1, Math.round(rowSessions * 0.8)),
      sessions: rowSessions,
      engagedSessions: rowEngaged,
      engagementRate: engRate,
      screenPageViews: Math.round(totalViews * pct),
      eventCount: Math.round(totalViews * pct * 3),
      keyEvents: Math.max(0, Math.round(rowSessions * convFactor)),
    };
  };

  return {
    propertyName: options.propertyName,
    numericPropertyId: numericId,
    reportingTimeZone,
    currencyCode,
    sourceMode: "sandbox_demo",
    cacheStatus: "miss",
    fetchedAtIso,
    startDate: options.input.startDate,
    endDate: options.input.endDate,
    compareStartDate: options.input.compareStartDate ?? null,
    compareEndDate: options.input.compareEndDate ?? null,
    totals,
    comparisonTotals,
    dailySeries,
    comparisonSeries,
    channels: [
      shareRow("Organic Search", 0.44, 0.69, 0.045),
      shareRow("Direct", 0.24, 0.62, 0.036),
      shareRow("Referral", 0.14, 0.66, 0.041),
      shareRow("Organic Social", 0.1, 0.52, 0.021),
      shareRow("Paid Search", 0.08, 0.59, 0.039),
    ],
    sourceMediums: [
      shareRow("google / organic", 0.41, 0.7, 0.046),
      shareRow("(direct) / (none)", 0.24, 0.62, 0.036),
      shareRow("github.com / referral", 0.09, 0.72, 0.048),
      shareRow("bing / organic", 0.03, 0.61, 0.03),
      shareRow("linkedin.com / social", 0.07, 0.54, 0.022),
    ],
    landingPages: [
      shareRow("/", 0.34, 0.67, 0.044, "Avenor — Product Intelligence Atlas"),
      shareRow("/pricing", 0.19, 0.74, 0.072, "Pricing — Signal Atlas"),
      shareRow("/docs/ga4-read-only-setup", 0.16, 0.78, 0.028, "GA4 Read-Only Setup Guide"),
      shareRow("/integrations", 0.12, 0.64, 0.035, "Read-Only Connector Catalog"),
      shareRow("/changelog", 0.08, 0.58, 0.015, "Release Changelog"),
    ],
    topPages: [
      shareRow("/", 0.28, 0.67, 0.044, "Avenor — Product Intelligence Atlas"),
      shareRow("/pricing", 0.18, 0.74, 0.072, "Pricing — Signal Atlas"),
      shareRow("/docs/ga4-read-only-setup", 0.15, 0.78, 0.028, "GA4 Read-Only Setup Guide"),
      shareRow("/signup", 0.11, 0.81, 0.115, "Start Read-Only Workspace"),
      shareRow("/integrations", 0.1, 0.64, 0.035, "Read-Only Connector Catalog"),
    ],
    devices: [
      shareRow("desktop", 0.61, 0.69, 0.046),
      shareRow("mobile", 0.35, 0.56, 0.024),
      shareRow("tablet", 0.04, 0.61, 0.031),
    ],
    countries: [
      shareRow(isEurope ? "Germany" : "United States", 0.42, 0.68, 0.044),
      shareRow("United Kingdom", 0.15, 0.66, 0.041),
      shareRow("Canada", 0.11, 0.65, 0.038),
      shareRow(isEurope ? "France" : "Germany", 0.1, 0.64, 0.035),
      shareRow("India", 0.08, 0.58, 0.022),
    ],
    cities: [
      shareRow(isEurope ? "Berlin" : "New York", 0.14, 0.69, 0.048),
      shareRow(isEurope ? "Munich" : "San Francisco", 0.11, 0.72, 0.052),
      shareRow("London", 0.1, 0.66, 0.041),
      shareRow("Toronto", 0.07, 0.64, 0.036),
      shareRow("Amsterdam", 0.05, 0.67, 0.04),
    ],
    topEvents: [
      shareRow("page_view", 1.0, 0.64, 0),
      shareRow("user_engagement", 0.78, 0.71, 0),
      shareRow("scroll", 0.62, 0.74, 0),
      shareRow("sign_up", 0.04, 0.92, 1),
      shareRow("workspace_created", 0.02, 0.96, 1),
    ],
    keyEventDefinitions: [
      {
        name: `${options.propertyName}/keyEvents/9001`,
        eventName: "sign_up",
        countingMethod: "ONCE_PER_SESSION",
        defaultValue: 0,
        currencyCode,
      },
      {
        name: `${options.propertyName}/keyEvents/9002`,
        eventName: "workspace_created",
        countingMethod: "ONCE_PER_SESSION",
        defaultValue: 0,
        currencyCode,
      },
    ],
    dataQuality: {
      isSampled: false,
      samplingRatePct: null,
      isThresholded: isStaging,
      hasOtherRowTruncation: false,
      emptyReason: null,
      notices: [
        "Sandbox demonstration dataset formatted cleanly in property reporting timezone; live Google Cloud OAuth credentials not yet connected.",
        ...(isStaging
          ? ["Data thresholding indicator demonstrated for low-volume cohort privacy handling."]
          : []),
      ],
    },
    quota: {
      tokensRemainingDay: 24985,
      tokensRemainingHour: 4992,
      tokensConsumed: 8,
    },
  };
}

/**
 * Fetches standard GA4 Data API metrics (`activeUsers`, `sessions`, `screenPageViews`,
 * `engagedSessions`, `engagementRate`, `eventCount`, `averageSessionDuration`, `keyEvents`),
 * acquisition channels, landing pages, devices, geo locations, and key events.
 * Uses scoped multi-tenant cache to protect Google API quotas cleanly.
 */
export async function readGa4StandardReportBundle(
  context: ReadOnlyProviderContext,
  input: Ga4StandardReportInput,
  options?: {
    fetchFn?: typeof fetch;
    bypassCache?: boolean;
  },
): Promise<Ga4StandardReportBundle> {
  assertGa4ScenarioAndScope(context);

  const normalizedProperty = normalizeGa4PropertyResourceName(input.propertyId);
  validateGa4StandardQueryInputs({
    startDate: input.startDate,
    endDate: input.endDate,
    metrics: [
      "activeUsers",
      "totalUsers",
      "newUsers",
      "sessions",
      "engagedSessions",
      "engagementRate",
      "screenPageViews",
      "eventCount",
      "averageSessionDuration",
      "keyEvents",
    ],
    dimensions: [
      "date",
      "sessionDefaultChannelGroup",
      "sessionSourceMedium",
      "landingPage",
      "pagePath",
      "pageTitle",
      "deviceCategory",
      "country",
      "city",
      "eventName",
    ],
  });

  if (input.compareStartDate && input.compareEndDate) {
    validateGa4StandardQueryInputs({
      startDate: input.compareStartDate,
      endDate: input.compareEndDate,
      metrics: ["sessions"],
      dimensions: ["date"],
    });
  }

  const cacheParts = {
    organizationId: context.organizationId,
    workspaceId: context.workspaceId,
    projectId: input.projectId ?? null,
    connectionId: context.connectionId ?? "direct",
    providerKey: "ga4",
    externalResourceId: normalizedProperty,
    operation: "standard_report",
    params: {
      startDate: input.startDate,
      endDate: input.endDate,
      compareStartDate: input.compareStartDate ?? null,
      compareEndDate: input.compareEndDate ?? null,
      tokenDigestHint: options?.fetchFn
        ? "mock_fetch"
        : (context.accessToken?.slice(0, 8) ?? "none"),
    },
  };

  if (!options?.bypassCache && !context.simulationScenario) {
    const cached = sharedGoogleTelemetryCache.get<Ga4StandardReportBundle>(cacheParts);
    if (cached) {
      return {
        ...cached.value,
        cacheStatus: "hit",
        fetchedAtIso: cached.fetchedAtIso,
      };
    }
  }

  const executeLive = shouldExecuteLiveGoogleApi(context, Boolean(options?.fetchFn), "ga4");
  if (!executeLive) {
    const demo = buildSandboxGa4ReportBundle({
      context,
      propertyName: normalizedProperty,
      input,
    });
    if (!options?.bypassCache) {
      sharedGoogleTelemetryCache.set(cacheParts, demo, STANDARD_REPORT_TTL_MS);
    }
    return demo;
  }

  const accessToken = context.accessToken ?? "";
  if (!accessToken) {
    throw new ProviderAdapterError({
      providerKey: "ga4",
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "Missing Google Analytics OAuth access token for Data API report execution.",
    });
  }

  const coreMetrics = [
    { name: "activeUsers" },
    { name: "totalUsers" },
    { name: "newUsers" },
    { name: "sessions" },
    { name: "engagedSessions" },
    { name: "engagementRate" },
    { name: "screenPageViews" },
    { name: "eventCount" },
    { name: "averageSessionDuration" },
    { name: "keyEvents" },
  ];

  const breakdownMetrics = [
    { name: "activeUsers" },
    { name: "sessions" },
    { name: "engagedSessions" },
    { name: "engagementRate" },
    { name: "screenPageViews" },
    { name: "eventCount" },
    { name: "keyEvents" },
  ];

  const primaryRange = [{ startDate: input.startDate, endDate: input.endDate }];

  // Google Data API batchRunReports allows up to 5 requests per batch
  const batch1Requests: Ga4RunReportRequestBody[] = [
    {
      dateRanges: primaryRange,
      dimensions: [{ name: "date" }],
      metrics: coreMetrics,
      metricAggregations: ["TOTAL"],
      orderBys: [{ dimension: { dimensionName: "date" } }],
      limit: "200",
    },
    {
      dateRanges: primaryRange,
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: breakdownMetrics,
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: "15",
    },
    {
      dateRanges: primaryRange,
      dimensions: [{ name: "sessionSourceMedium" }],
      metrics: breakdownMetrics,
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: "15",
    },
    {
      dateRanges: primaryRange,
      dimensions: [{ name: "landingPage" }, { name: "pageTitle" }],
      metrics: breakdownMetrics,
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: "20",
    },
    {
      dateRanges: primaryRange,
      dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
      metrics: breakdownMetrics,
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: "20",
    },
  ];

  const batch2Requests: Ga4RunReportRequestBody[] = [
    {
      dateRanges: primaryRange,
      dimensions: [{ name: "deviceCategory" }],
      metrics: breakdownMetrics,
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: "10",
    },
    {
      dateRanges: primaryRange,
      dimensions: [{ name: "country" }],
      metrics: breakdownMetrics,
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: "20",
    },
    {
      dateRanges: primaryRange,
      dimensions: [{ name: "city" }],
      metrics: breakdownMetrics,
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: "15",
    },
    {
      dateRanges: primaryRange,
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "activeUsers" }, { name: "keyEvents" }],
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: "20",
    },
  ];

  if (input.compareStartDate && input.compareEndDate) {
    batch2Requests.push({
      dateRanges: [{ startDate: input.compareStartDate, endDate: input.compareEndDate }],
      dimensions: [{ name: "date" }],
      metrics: coreMetrics,
      metricAggregations: ["TOTAL"],
      orderBys: [{ dimension: { dimensionName: "date" } }],
      limit: "200",
    });
  }

  const [batch1, batch2, keyEventDefinitions] = await Promise.all([
    batchRunGa4DataReports({
      accessToken,
      propertyName: normalizedProperty,
      requests: batch1Requests,
      fetchFn: options?.fetchFn,
    }),
    batchRunGa4DataReports({
      accessToken,
      propertyName: normalizedProperty,
      requests: batch2Requests,
      fetchFn: options?.fetchFn,
    }),
    listGa4PropertyKeyEvents({
      accessToken,
      propertyName: normalizedProperty,
      fetchFn: options?.fetchFn,
    }).catch(() => [] as Ga4KeyEventDefinition[]),
  ]);

  const dailyReport = batch1[0];
  const comparisonReport = input.compareStartDate && input.compareEndDate ? batch2[4] : undefined;

  const dailySeries = parseDailySeries(dailyReport);
  const totals = parseTotalsFromReport(dailyReport, dailySeries);
  const comparisonSeries = comparisonReport ? parseDailySeries(comparisonReport) : null;
  const comparisonTotals = comparisonReport
    ? parseTotalsFromReport(comparisonReport, comparisonSeries ?? [])
    : null;

  const allReports = [...batch1, ...batch2];
  const dataQuality = extractDataQualityFromGa4Reports(allReports);
  const quota = extractQuotaFromReports(allReports);
  const reportingTimeZone = dailyReport?.metadata?.timeZone ?? input.propertyTimeZone ?? "UTC";
  const currencyCode = dailyReport?.metadata?.currencyCode ?? input.currencyCode ?? null;

  const bundle: Ga4StandardReportBundle = {
    propertyName: normalizedProperty,
    numericPropertyId: normalizedProperty.replace(/^properties\//, ""),
    reportingTimeZone,
    currencyCode,
    sourceMode: "live",
    cacheStatus: "miss",
    fetchedAtIso: new Date().toISOString(),
    startDate: input.startDate,
    endDate: input.endDate,
    compareStartDate: input.compareStartDate ?? null,
    compareEndDate: input.compareEndDate ?? null,
    totals,
    comparisonTotals,
    dailySeries,
    comparisonSeries,
    channels: parseBreakdownRows(batch1[1]),
    sourceMediums: parseBreakdownRows(batch1[2]),
    landingPages: parseBreakdownRows(batch1[3]),
    topPages: parseBreakdownRows(batch1[4]),
    devices: parseBreakdownRows(batch2[0]),
    countries: parseBreakdownRows(batch2[1]),
    cities: parseBreakdownRows(batch2[2]),
    topEvents: parseBreakdownRows(batch2[3]),
    keyEventDefinitions,
    dataQuality,
    quota,
  };

  if (!options?.bypassCache) {
    sharedGoogleTelemetryCache.set(cacheParts, bundle, STANDARD_REPORT_TTL_MS);
  }

  return bundle;
}
