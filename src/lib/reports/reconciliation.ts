import { type AuthenticatedSessionContext, authorizeProjectAccess } from "@avenor/auth";
import { assertServerRuntime } from "@avenor/config";
import { dbQuery, getDatabasePool } from "@avenor/database";
import { AppError, type EnvironmentType, ERROR_CODES } from "@avenor/types";
import {
  aggregateMetricObservations,
  CANONICAL_METRIC_DEFINITIONS,
  type CanonicalMetricDefinition,
  computeDimensionIdentity,
  getCanonicalMetricDefinition,
  getMetricObservationRevisions,
  type MetricCompletenessState,
  queryMetricObservations,
  type StoredMetricObservation,
} from "@/lib/metrics";
import { addCalendarDays, countInclusiveDays, formatDateInTimeZone } from "./date-window";

export const EXTENDED_DATE_PRESETS = [
  "today",
  "yesterday",
  "7d",
  "14d",
  "28d",
  "30d",
  "90d",
  "mtd",
  "qtd",
  "custom",
] as const;

export type ExtendedDatePreset = (typeof EXTENDED_DATE_PRESETS)[number];

export interface ComparisonDateWindowInput {
  preset?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  includeToday?: boolean;
  compareMode?: "previous_period" | "none";
  timeZone?: string;
  now?: Date;
}

export interface ResolvedComparisonDateWindow {
  preset: ExtendedDatePreset;
  timeZone: string;
  startDate: string;
  endDate: string;
  dayCount: number;
  includesIncompleteToday: boolean;
  partialDayNotice: string | null;
  compareMode: "previous_period" | "none";
  previousStartDate: string | null;
  previousEndDate: string | null;
  previousDayCount: number;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolves a timezone-aware date window with explicit handling of incomplete current-day data
 * and equal-length disjoint previous-period comparison bounds.
 */
export function resolveComparisonDateWindow(
  input?: ComparisonDateWindowInput,
): ResolvedComparisonDateWindow {
  const timeZone = input?.timeZone?.trim() || "UTC";
  const now = input?.now ?? new Date();
  const todayLocal = formatDateInTimeZone(now, timeZone);
  const yesterdayLocal = addCalendarDays(todayLocal, -1);

  const rawPreset = (input?.preset ?? "28d").toLowerCase();
  const preset: ExtendedDatePreset = (EXTENDED_DATE_PRESETS as readonly string[]).includes(
    rawPreset,
  )
    ? (rawPreset as ExtendedDatePreset)
    : "28d";

  const includeToday = Boolean(input?.includeToday) || preset === "today";
  const anchorEndDate = includeToday ? todayLocal : yesterdayLocal;

  let startDate: string;
  let endDate: string;
  let resolvedPreset: ExtendedDatePreset = preset;

  if (
    preset === "custom" &&
    input?.startDate &&
    input?.endDate &&
    ISO_DATE_RE.test(input.startDate) &&
    ISO_DATE_RE.test(input.endDate)
  ) {
    if (input.startDate > input.endDate) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `startDate (${input.startDate}) must be on or before endDate (${input.endDate}).`,
        statusCode: 400,
      });
    }
    startDate = input.startDate;
    endDate = input.endDate;
  } else if (preset === "today") {
    startDate = todayLocal;
    endDate = todayLocal;
  } else if (preset === "yesterday") {
    startDate = yesterdayLocal;
    endDate = yesterdayLocal;
  } else if (preset === "7d") {
    endDate = anchorEndDate;
    startDate = addCalendarDays(endDate, -6);
  } else if (preset === "14d") {
    endDate = anchorEndDate;
    startDate = addCalendarDays(endDate, -13);
  } else if (preset === "30d") {
    endDate = anchorEndDate;
    startDate = addCalendarDays(endDate, -29);
  } else if (preset === "90d") {
    endDate = anchorEndDate;
    startDate = addCalendarDays(endDate, -89);
  } else if (preset === "mtd") {
    const firstOfMonth = `${todayLocal.slice(0, 7)}-01`;
    startDate = firstOfMonth;
    endDate = anchorEndDate < firstOfMonth ? todayLocal : anchorEndDate;
  } else if (preset === "qtd") {
    const year = Number(todayLocal.slice(0, 4));
    const month = Number(todayLocal.slice(5, 7));
    const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
    const firstOfQuarter = `${year}-${String(quarterStartMonth).padStart(2, "0")}-01`;
    startDate = firstOfQuarter;
    endDate = anchorEndDate < firstOfQuarter ? todayLocal : anchorEndDate;
  } else {
    resolvedPreset = "28d";
    endDate = anchorEndDate;
    startDate = addCalendarDays(endDate, -27);
  }

  const dayCount = Math.max(1, countInclusiveDays(startDate, endDate));
  const includesIncompleteToday = endDate >= todayLocal;
  const partialDayNotice = includesIncompleteToday
    ? `Window includes ${todayLocal} (${timeZone}), which is still in progress and subject to intraday provider lag.`
    : null;

  const compareMode = input?.compareMode ?? "previous_period";
  const previousEndDate = compareMode === "previous_period" ? addCalendarDays(startDate, -1) : null;
  const previousStartDate =
    compareMode === "previous_period" && previousEndDate
      ? addCalendarDays(previousEndDate, -(dayCount - 1))
      : null;

  return {
    preset: resolvedPreset,
    timeZone,
    startDate,
    endDate,
    dayCount,
    includesIncompleteToday,
    partialDayNotice,
    compareMode,
    previousStartDate,
    previousEndDate,
    previousDayCount: compareMode === "previous_period" ? dayCount : 0,
  };
}

export interface TimezoneAlignmentAssessment {
  isAligned: boolean;
  timezones: string[];
  hasGscPacificFixed: boolean;
  hasCustomGa4Timezone: boolean;
  warningMessage: string | null;
}

/**
 * Evaluates whether multiple mapped resources report on identical or divergent calendar day boundaries.
 */
export function assessSourceTimezoneAlignment(
  sources: ReadonlyArray<{
    providerKey: string;
    displayName: string;
    reportingTimezone: string;
  }>,
): TimezoneAlignmentAssessment {
  const timezones = Array.from(
    new Set(sources.map((s) => s.reportingTimezone.trim()).filter(Boolean)),
  );
  const hasGscPacificFixed = sources.some(
    (s) =>
      s.providerKey === "gsc" ||
      s.providerKey === "google_search_console" ||
      s.reportingTimezone === "America/Los_Angeles",
  );
  const hasCustomGa4Timezone = sources.some(
    (s) =>
      (s.providerKey === "ga4" || s.providerKey === "google_analytics_4") &&
      s.reportingTimezone !== "America/Los_Angeles",
  );

  if (timezones.length <= 1) {
    return {
      isAligned: true,
      timezones,
      hasGscPacificFixed,
      hasCustomGa4Timezone,
      warningMessage: null,
    };
  }

  return {
    isAligned: false,
    timezones,
    hasGscPacificFixed,
    hasCustomGa4Timezone,
    warningMessage: `Mapped sources report on different calendar timezone boundaries (${timezones.join(" vs ")}). Daily dates are preserved in each source's native reporting timezone rather than coerced into browser local time.`,
  };
}

export interface CapabilityFilterValidationInput {
  canonicalMetricKeys: readonly string[];
  dimensionFilters?: Record<string, string | null | undefined>;
}

export interface CapabilityFilterValidationResult {
  valid: boolean;
  normalizedFilters: Record<string, string>;
  unsupportedByMetric: Array<{
    canonicalMetricKey: string;
    unsupportedDimensions: string[];
    supportedDimensions: readonly string[];
  }>;
  errorMessage: string | null;
}

/**
 * Validates requested dimension filters against the canonical metric definitions' `supportedDimensions`.
 * Prevents applying unsupported filters (e.g., filtering GA4 sessions by GSC `query`).
 */
export function validateMetricCapabilityFilters(
  input: CapabilityFilterValidationInput,
): CapabilityFilterValidationResult {
  const normalizedFilters: Record<string, string> = {};
  for (const [rawKey, rawVal] of Object.entries(input.dimensionFilters ?? {})) {
    const k = rawKey.trim();
    const v = typeof rawVal === "string" ? rawVal.trim() : "";
    if (k && v) {
      normalizedFilters[k] = v;
    }
  }

  const filterDimensionKeys = Object.keys(normalizedFilters);
  if (filterDimensionKeys.length === 0) {
    return {
      valid: true,
      normalizedFilters: {},
      unsupportedByMetric: [],
      errorMessage: null,
    };
  }

  const unsupportedByMetric: CapabilityFilterValidationResult["unsupportedByMetric"] = [];

  for (const metricKey of input.canonicalMetricKeys) {
    const def: CanonicalMetricDefinition = getCanonicalMetricDefinition(metricKey);
    const supportedSet = new Set(def.supportedDimensions);
    // "date" is always a time axis, not a dimension key stored in the dimension map
    const unsupported = filterDimensionKeys.filter((dim) => !supportedSet.has(dim));
    if (unsupported.length > 0) {
      unsupportedByMetric.push({
        canonicalMetricKey: def.canonicalKey,
        unsupportedDimensions: unsupported,
        supportedDimensions: def.supportedDimensions,
      });
    }
  }

  if (unsupportedByMetric.length > 0) {
    const summary = unsupportedByMetric
      .map(
        (u) =>
          `${u.canonicalMetricKey} does not support dimension(s): ${u.unsupportedDimensions.join(", ")}`,
      )
      .join("; ");
    return {
      valid: false,
      normalizedFilters,
      unsupportedByMetric,
      errorMessage: `Incompatible dimension filter for selected metric(s): ${summary}.`,
    };
  }

  return {
    valid: true,
    normalizedFilters,
    unsupportedByMetric: [],
    errorMessage: null,
  };
}

export interface MetricPeriodComparisonDetail {
  canonicalMetricKey: string;
  displayName: string;
  unit: string;
  currentValue: number | null;
  previousValue: number | null;
  absoluteDelta: number | null;
  percentDelta: number | null;
  basisPointsDelta: number | null;
  direction: "up" | "down" | "flat" | "new_activity" | "non_comparable" | "unavailable";
  isImprovement: boolean | null;
  formattedDeltaLabel: string;
  explanation: string;
}

/**
 * Computes mathematically defensible period-over-period comparisons respecting metric value types,
 * zero-denominator edge cases, inverted ranking polarity, and non-additive unique-user constraints.
 */
export function evaluateCanonicalMetricPeriodComparison(input: {
  canonicalMetricKey: string;
  currentObservations: readonly StoredMetricObservation[];
  previousObservations: readonly StoredMetricObservation[];
  currentWindow: { startDate: string; endDate: string };
  previousWindow: { startDate: string; endDate: string };
}): MetricPeriodComparisonDetail {
  const def = getCanonicalMetricDefinition(input.canonicalMetricKey);
  const currentAgg = aggregateMetricObservations({
    canonicalMetricKey: def.canonicalKey,
    observations: input.currentObservations,
    requestedStartDate: input.currentWindow.startDate,
    requestedEndDate: input.currentWindow.endDate,
  });
  const previousAgg = aggregateMetricObservations({
    canonicalMetricKey: def.canonicalKey,
    observations: input.previousObservations,
    requestedStartDate: input.previousWindow.startDate,
    requestedEndDate: input.previousWindow.endDate,
  });

  if (
    currentAgg.status === "non_additive_unavailable" ||
    currentAgg.status === "cross_resource_rejected" ||
    previousAgg.status === "non_additive_unavailable" ||
    previousAgg.status === "cross_resource_rejected"
  ) {
    return {
      canonicalMetricKey: def.canonicalKey,
      displayName: def.displayName,
      unit: def.unit,
      currentValue: currentAgg.value,
      previousValue: previousAgg.value,
      absoluteDelta: null,
      percentDelta: null,
      basisPointsDelta: null,
      direction: "non_comparable",
      isImprovement: null,
      formattedDeltaLabel: "Non-additive across scope",
      explanation: currentAgg.status !== "ok" ? currentAgg.explanation : previousAgg.explanation,
    };
  }

  const currentValue = currentAgg.value;
  const previousValue = previousAgg.value;

  if (currentValue === null || previousValue === null) {
    return {
      canonicalMetricKey: def.canonicalKey,
      displayName: def.displayName,
      unit: def.unit,
      currentValue,
      previousValue,
      absoluteDelta: null,
      percentDelta: null,
      basisPointsDelta: null,
      direction: "unavailable",
      isImprovement: null,
      formattedDeltaLabel: "Prior period unavailable",
      explanation: `Comparison unavailable because ${currentValue === null ? "current" : "prior"} period has no complete observations.`,
    };
  }

  const invertPolarity = def.valueType === "POSITION";
  const absoluteDelta = Number((currentValue - previousValue).toFixed(6));
  const basisPointsDelta =
    def.valueType === "RATIO" || def.valueType === "PERCENTAGE"
      ? Number(((currentValue - previousValue) * 10000).toFixed(1))
      : null;

  if (Math.abs(previousValue) < 1e-9) {
    if (Math.abs(currentValue) < 1e-9) {
      return {
        canonicalMetricKey: def.canonicalKey,
        displayName: def.displayName,
        unit: def.unit,
        currentValue,
        previousValue,
        absoluteDelta: 0,
        percentDelta: 0,
        basisPointsDelta: basisPointsDelta ?? 0,
        direction: "flat",
        isImprovement: null,
        formattedDeltaLabel: "0.0% vs prior period",
        explanation: "Both current and prior periods recorded 0.",
      };
    }

    return {
      canonicalMetricKey: def.canonicalKey,
      displayName: def.displayName,
      unit: def.unit,
      currentValue,
      previousValue,
      absoluteDelta,
      percentDelta: null,
      basisPointsDelta,
      direction: "new_activity",
      isImprovement: !invertPolarity,
      formattedDeltaLabel: "New activity vs 0 prior",
      explanation:
        "Prior period recorded 0; percentage change is omitted to avoid division-by-zero distortion.",
    };
  }

  const rawPercent = ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
  const percentDelta = Number(rawPercent.toFixed(2));

  if (Math.abs(percentDelta) < 0.05) {
    return {
      canonicalMetricKey: def.canonicalKey,
      displayName: def.displayName,
      unit: def.unit,
      currentValue,
      previousValue,
      absoluteDelta,
      percentDelta: 0,
      basisPointsDelta,
      direction: "flat",
      isImprovement: null,
      formattedDeltaLabel: "0.0% vs prior period",
      explanation: "Change between periods is within ±0.05%.",
    };
  }

  const isImprovement = invertPolarity ? rawPercent < 0 : rawPercent > 0;
  const direction = rawPercent > 0 ? "up" : "down";
  const sign = rawPercent > 0 ? "+" : "";

  const formattedDeltaLabel =
    def.valueType === "POSITION"
      ? `${absoluteDelta > 0 ? "+" : ""}${absoluteDelta.toFixed(2)} pos (${sign}${percentDelta.toFixed(1)}%)`
      : `${sign}${percentDelta.toFixed(1)}% vs prior period`;

  return {
    canonicalMetricKey: def.canonicalKey,
    displayName: def.displayName,
    unit: def.unit,
    currentValue,
    previousValue,
    absoluteDelta,
    percentDelta,
    basisPointsDelta,
    direction,
    isImprovement,
    formattedDeltaLabel,
    explanation: `Compared ${input.currentWindow.startDate}..${input.currentWindow.endDate} against ${input.previousWindow.startDate}..${input.previousWindow.endDate}.`,
  };
}

export type ReconciliationStatus =
  | "MATCHED"
  | "RECONCILED_WITH_KNOWN_VARIANCE"
  | "RECONCILED_WITH_PRIVACY_THRESHOLD"
  | "REVISION_SUPERSEDED"
  | "DRIFT_DETECTED"
  | "MISSING_IN_AVENOR";

export interface ProviderExpectedMetricBenchmark {
  canonicalMetricKey: string;
  externalResourceId: string;
  periodStartDate: string;
  periodEndDate: string;
  reportingTimezone: string;
  expectedValue: number;
  dimensions?: Record<string, string>;
  providerCompleteness?: MetricCompletenessState;
  queryTableSummedClicks?: number | null;
  notes?: string;
}

export interface ReconciledMetricItemDto {
  canonicalMetricKey: string;
  displayName: string;
  providerKey: string;
  externalResourceId: string;
  reportingTimezone: string;
  periodStartDate: string;
  periodEndDate: string;
  avenorStoredValue: number | null;
  providerBenchmarkValue: number;
  absoluteDifference: number | null;
  allowedTolerance: number;
  status: ReconciliationStatus;
  completenessState: MetricCompletenessState;
  revisionCount: number;
  anonymizedClicksGap: number | null;
  explanation: string;
}

export interface SourceReconciliationReportDto {
  organizationId: string;
  workspaceId: string;
  projectId: string;
  environmentId: string | null;
  generatedAtIso: string;
  dateWindow: ResolvedComparisonDateWindow;
  timezoneAlignment: TimezoneAlignmentAssessment;
  filterValidation: CapabilityFilterValidationResult;
  comparisons: MetricPeriodComparisonDetail[];
  reconciliationItems: ReconciledMetricItemDto[];
  summary: {
    totalChecked: number;
    matchedCount: number;
    knownVarianceCount: number;
    driftDetectedCount: number;
    missingCount: number;
    allWithinContract: boolean;
  };
}

/**
 * Determines the strict mathematical tolerance for reconciling a canonical metric against
 * an authoritative provider report.
 * - Integer counts (sessions, clicks, impressions, events) require exact 0 tolerance when COMPLETE.
 * - Floating-point ratios and weighted positions allow 1e-4 IEEE-754 rounding tolerance.
 */
export function getDeterministicMetricTolerance(canonicalMetricKey: string): number {
  const def = getCanonicalMetricDefinition(canonicalMetricKey);
  if (
    def.valueType === "RATIO" ||
    def.valueType === "PERCENTAGE" ||
    def.valueType === "POSITION" ||
    def.valueType === "AVERAGE" ||
    def.valueType === "DURATION"
  ) {
    return 0.0001;
  }
  return 0;
}

/**
 * Reconciles Avenor's stored observations against provider benchmark figures (from live provider
 * verification or deterministic provider fixtures).
 */
export function evaluateProviderBenchmarkReconciliation(input: {
  observations: readonly StoredMetricObservation[];
  benchmarks: readonly ProviderExpectedMetricBenchmark[];
}): ReconciledMetricItemDto[] {
  const items: ReconciledMetricItemDto[] = [];

  for (const b of input.benchmarks) {
    const def = getCanonicalMetricDefinition(b.canonicalMetricKey);
    const targetDimHash = computeDimensionIdentity(b.dimensions ?? {}).hash;
    const gscWebDimHash = computeDimensionIdentity({ searchType: "web" }).hash;

    const matchingObs = input.observations.filter(
      (o) =>
        o.canonicalMetricKey === def.canonicalKey &&
        o.externalResourceId === b.externalResourceId &&
        o.periodStartDate >= b.periodStartDate &&
        o.periodEndDate <= b.periodEndDate &&
        (o.dimensionKeyHash === targetDimHash ||
          (Object.keys(b.dimensions ?? {}).length === 0 && o.dimensionKeyHash === gscWebDimHash)),
    );

    const allowedTolerance = getDeterministicMetricTolerance(def.canonicalKey);

    if (matchingObs.length === 0) {
      items.push({
        canonicalMetricKey: def.canonicalKey,
        displayName: def.displayName,
        providerKey: def.providerKey,
        externalResourceId: b.externalResourceId,
        reportingTimezone: b.reportingTimezone,
        periodStartDate: b.periodStartDate,
        periodEndDate: b.periodEndDate,
        avenorStoredValue: null,
        providerBenchmarkValue: b.expectedValue,
        absoluteDifference: null,
        allowedTolerance,
        status: "MISSING_IN_AVENOR",
        completenessState: "UNAVAILABLE",
        revisionCount: 0,
        anonymizedClicksGap: null,
        explanation: `No stored observation in Avenor for ${def.canonicalKey} on ${b.externalResourceId} (${b.periodStartDate}..${b.periodEndDate}).`,
      });
      continue;
    }

    const agg = aggregateMetricObservations({
      canonicalMetricKey: def.canonicalKey,
      observations: matchingObs,
      requestedStartDate: b.periodStartDate,
      requestedEndDate: b.periodEndDate,
    });

    const avenorVal = agg.value;
    const maxRevision = matchingObs.reduce((max, o) => Math.max(max, o.revisionNumber), 1);
    const hasSamplingOrThresholding = matchingObs.some(
      (o) =>
        Boolean(o.dataQualityFlags.isSampled) ||
        Boolean(o.dataQualityFlags.isThresholded) ||
        Boolean(o.dataQualityFlags.isWithinLagWindow),
    );
    const anonymizedClicksGap =
      b.queryTableSummedClicks !== undefined && b.queryTableSummedClicks !== null
        ? Number((b.expectedValue - b.queryTableSummedClicks).toFixed(4))
        : (matchingObs.find((o) => o.dataQualityFlags.anonymizedClicksDelta != null)
            ?.dataQualityFlags.anonymizedClicksDelta ?? null);

    if (avenorVal === null) {
      items.push({
        canonicalMetricKey: def.canonicalKey,
        displayName: def.displayName,
        providerKey: def.providerKey,
        externalResourceId: b.externalResourceId,
        reportingTimezone: b.reportingTimezone,
        periodStartDate: b.periodStartDate,
        periodEndDate: b.periodEndDate,
        avenorStoredValue: null,
        providerBenchmarkValue: b.expectedValue,
        absoluteDifference: null,
        allowedTolerance,
        status: "MISSING_IN_AVENOR",
        completenessState: agg.completenessState,
        revisionCount: maxRevision,
        anonymizedClicksGap,
        explanation: agg.explanation,
      });
      continue;
    }

    const diff = Number(Math.abs(avenorVal - b.expectedValue).toFixed(6));

    let status: ReconciliationStatus;
    let explanation: string;

    if (diff <= allowedTolerance) {
      if (
        def.canonicalKey === "gsc.clicks" &&
        anonymizedClicksGap !== null &&
        anonymizedClicksGap > 0
      ) {
        status = "RECONCILED_WITH_PRIVACY_THRESHOLD";
        explanation = `Site-level GSC clicks (${avenorVal}) match provider property total (${b.expectedValue}); query breakdown table omits ${anonymizedClicksGap} privacy-anonymized long-tail clicks as documented by Search Console.`;
      } else if (maxRevision > 1) {
        status = "REVISION_SUPERSEDED";
        explanation = `Stored value (${avenorVal}) matches provider benchmark (${b.expectedValue}) after ${maxRevision - 1} in-place historical revision update(s).`;
      } else {
        status = "MATCHED";
        explanation = `Stored value (${avenorVal}) reconciles with provider benchmark (${b.expectedValue}) within tolerance (${allowedTolerance}).`;
      }
    } else if (
      hasSamplingOrThresholding ||
      agg.completenessState === "PROVISIONAL" ||
      agg.completenessState === "PARTIAL" ||
      agg.completenessState === "SAMPLED" ||
      agg.completenessState === "THRESHOLDED"
    ) {
      status = "RECONCILED_WITH_KNOWN_VARIANCE";
      explanation = `Variance of ${diff} between stored value (${avenorVal}) and benchmark (${b.expectedValue}) is explained by provider completeness state (${agg.completenessState}) or sampling/lag window.`;
    } else {
      status = "DRIFT_DETECTED";
      explanation = `Unexplained drift of ${diff} exceeds tolerance (${allowedTolerance}) between Avenor stored value (${avenorVal}) and provider benchmark (${b.expectedValue}).`;
    }

    items.push({
      canonicalMetricKey: def.canonicalKey,
      displayName: def.displayName,
      providerKey: def.providerKey,
      externalResourceId: b.externalResourceId,
      reportingTimezone: b.reportingTimezone,
      periodStartDate: b.periodStartDate,
      periodEndDate: b.periodEndDate,
      avenorStoredValue: avenorVal,
      providerBenchmarkValue: b.expectedValue,
      absoluteDifference: diff,
      allowedTolerance,
      status,
      completenessState: agg.completenessState,
      revisionCount: maxRevision,
      anonymizedClicksGap,
      explanation,
    });
  }

  return items;
}

/**
 * Generates an authorized Project Comparison, Filtering & Source Reconciliation Report
 * from stored PostgreSQL observations and optional provider verification benchmarks.
 */
export async function generateProjectReconciliationReport(
  session: AuthenticatedSessionContext | null,
  projectId: string,
  input?: {
    environmentId?: string | null;
    environmentType?: EnvironmentType | null;
    preset?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    includeToday?: boolean;
    canonicalMetricKeys?: readonly string[];
    dimensionFilters?: Record<string, string | null | undefined>;
    benchmarks?: readonly ProviderExpectedMetricBenchmark[];
    now?: Date;
  },
  options?: { connectionString?: string },
): Promise<SourceReconciliationReportDto> {
  assertServerRuntime("generateProjectReconciliationReport");

  const access = await authorizeProjectAccess({
    session,
    projectId,
    expectedWorkspaceId: session?.activeWorkspace.id,
    requiredPermission: "project:read",
  });

  const pool = getDatabasePool(options?.connectionString);

  const wsRes = await dbQuery<{ default_timezone: string }>(
    `SELECT default_timezone FROM workspaces WHERE id = $1 LIMIT 1`,
    [access.workspaceId],
    pool,
  );
  const workspaceTimezone = wsRes.rows[0]?.default_timezone ?? "UTC";

  const requestedMetrics =
    input?.canonicalMetricKeys && input.canonicalMetricKeys.length > 0
      ? input.canonicalMetricKeys
      : [
          "ga4.sessions",
          "ga4.active_users",
          "ga4.engaged_sessions",
          "ga4.engagement_rate",
          "gsc.clicks",
          "gsc.impressions",
          "gsc.ctr",
          "gsc.average_position",
        ];

  const filterValidation = validateMetricCapabilityFilters({
    canonicalMetricKeys: requestedMetrics,
    dimensionFilters: input?.dimensionFilters,
  });

  if (!filterValidation.valid) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: filterValidation.errorMessage ?? "Invalid metric dimension filter.",
      statusCode: 400,
      details: {
        unsupportedByMetric: filterValidation.unsupportedByMetric.map(
          (u) => `${u.canonicalMetricKey}: ${u.unsupportedDimensions.join(", ")}`,
        ),
      },
    });
  }

  const mappingsRes = await dbQuery<{
    connected_resource_id: string;
    external_resource_id: string;
    display_name: string;
    provider_key: string;
    metadata: Record<string, unknown> | null;
    environment_id: string | null;
  }>(
    `SELECT
       cr.id AS connected_resource_id,
       cr.external_resource_id,
       cr.display_name,
       pc.provider_key,
       cr.metadata,
       rm.environment_id
     FROM resource_mappings rm
     INNER JOIN connected_resources cr ON cr.id = rm.connected_resource_id
     INNER JOIN provider_connections pc ON pc.id = cr.provider_connection_id
     WHERE rm.project_id = $1 AND rm.workspace_id = $2`,
    [access.projectId, access.workspaceId],
    pool,
  );

  const scopedMappings = input?.environmentId
    ? mappingsRes.rows.filter(
        (m) => m.environment_id === input.environmentId || m.environment_id === null,
      )
    : mappingsRes.rows;

  const timezoneSources = scopedMappings.map((m) => {
    const metaTz =
      typeof m.metadata?.timeZone === "string"
        ? m.metadata.timeZone
        : typeof m.metadata?.reportingTimezone === "string"
          ? m.metadata.reportingTimezone
          : null;
    const defaultSourceTz =
      m.provider_key === "gsc" || m.provider_key === "google_search_console"
        ? "America/Los_Angeles"
        : workspaceTimezone;
    return {
      providerKey: m.provider_key,
      displayName: m.display_name,
      reportingTimezone: metaTz ?? defaultSourceTz,
    };
  });

  const timezoneAlignment = assessSourceTimezoneAlignment(timezoneSources);
  const dateWindow = resolveComparisonDateWindow({
    preset: input?.preset,
    startDate: input?.startDate,
    endDate: input?.endDate,
    includeToday: input?.includeToday,
    timeZone: timezoneSources[0]?.reportingTimezone ?? workspaceTimezone,
    now: input?.now,
  });

  const earliestDate = dateWindow.previousStartDate ?? dateWindow.startDate;
  const allObs = await queryMetricObservations(
    {
      organizationId: access.organizationId,
      workspaceId: access.workspaceId,
      projectId: access.projectId,
      environmentId: input?.environmentId ?? undefined,
      periodStartDate: earliestDate,
      periodEndDate: dateWindow.endDate,
    },
    { executor: pool },
  );

  const hasDimensionFilter = Object.keys(filterValidation.normalizedFilters).length > 0;
  const emptyHash = computeDimensionIdentity({}).hash;
  const gscWebHash = computeDimensionIdentity({ searchType: "web" }).hash;

  const matchingFilterObs = allObs.filter((o) => {
    if (!hasDimensionFilter) {
      return o.dimensionKeyHash === emptyHash || o.dimensionKeyHash === gscWebHash;
    }
    return Object.entries(filterValidation.normalizedFilters).every(
      ([k, v]) => o.dimensions[k] === v,
    );
  });

  const currentObs = matchingFilterObs.filter(
    (o) => o.periodStartDate >= dateWindow.startDate && o.periodEndDate <= dateWindow.endDate,
  );
  const prevStart = dateWindow.previousStartDate;
  const prevEnd = dateWindow.previousEndDate;
  const previousObs =
    prevStart && prevEnd
      ? matchingFilterObs.filter(
          (o) => o.periodStartDate >= prevStart && o.periodEndDate <= prevEnd,
        )
      : [];

  const comparisons = requestedMetrics.map((metricKey) =>
    evaluateCanonicalMetricPeriodComparison({
      canonicalMetricKey: metricKey,
      currentObservations: currentObs,
      previousObservations: previousObs,
      currentWindow: {
        startDate: dateWindow.startDate,
        endDate: dateWindow.endDate,
      },
      previousWindow: {
        startDate: prevStart ?? dateWindow.startDate,
        endDate: prevEnd ?? dateWindow.endDate,
      },
    }),
  );

  // If explicit provider benchmarks are supplied, reconcile against them;
  // otherwise self-reconcile stored aggregate observations against daily observation rollups & revision trails.
  const benchmarksToEvaluate: ProviderExpectedMetricBenchmark[] =
    input?.benchmarks && input.benchmarks.length > 0
      ? [...input.benchmarks]
      : buildSelfVerificationBenchmarks(currentObs, dateWindow);

  const reconciliationItems = evaluateProviderBenchmarkReconciliation({
    observations: currentObs,
    benchmarks: benchmarksToEvaluate,
  });

  // Attach database revision counts where available
  for (const item of reconciliationItems) {
    const sampleObs = currentObs.find(
      (o) =>
        o.canonicalMetricKey === item.canonicalMetricKey &&
        o.externalResourceId === item.externalResourceId,
    );
    if (sampleObs && sampleObs.revisionNumber > 1) {
      const revisions = await getMetricObservationRevisions(
        {
          organizationId: access.organizationId,
          workspaceId: access.workspaceId,
          observationId: sampleObs.id,
        },
        { executor: pool },
      );
      item.revisionCount = Math.max(item.revisionCount, revisions.length + 1);
    }
  }

  const matchedCount = reconciliationItems.filter(
    (i) => i.status === "MATCHED" || i.status === "REVISION_SUPERSEDED",
  ).length;
  const knownVarianceCount = reconciliationItems.filter(
    (i) =>
      i.status === "RECONCILED_WITH_KNOWN_VARIANCE" ||
      i.status === "RECONCILED_WITH_PRIVACY_THRESHOLD",
  ).length;
  const driftDetectedCount = reconciliationItems.filter(
    (i) => i.status === "DRIFT_DETECTED",
  ).length;
  const missingCount = reconciliationItems.filter((i) => i.status === "MISSING_IN_AVENOR").length;

  return {
    organizationId: access.organizationId,
    workspaceId: access.workspaceId,
    projectId: access.projectId,
    environmentId: input?.environmentId ?? null,
    generatedAtIso: new Date().toISOString(),
    dateWindow,
    timezoneAlignment,
    filterValidation,
    comparisons,
    reconciliationItems,
    summary: {
      totalChecked: reconciliationItems.length,
      matchedCount,
      knownVarianceCount,
      driftDetectedCount,
      missingCount,
      allWithinContract: driftDetectedCount === 0,
    },
  };
}

function buildSelfVerificationBenchmarks(
  observations: readonly StoredMetricObservation[],
  dateWindow: ResolvedComparisonDateWindow,
): ProviderExpectedMetricBenchmark[] {
  const benchmarks: ProviderExpectedMetricBenchmark[] = [];
  const pairs = new Map<
    string,
    { canonicalMetricKey: string; externalResourceId: string; reportingTimezone: string }
  >();

  for (const o of observations) {
    const key = `${o.canonicalMetricKey}::${o.externalResourceId}`;
    if (!pairs.has(key)) {
      pairs.set(key, {
        canonicalMetricKey: o.canonicalMetricKey,
        externalResourceId: o.externalResourceId,
        reportingTimezone: o.reportingTimezone,
      });
    }
  }

  for (const pair of pairs.values()) {
    const subset = observations.filter(
      (o) =>
        o.canonicalMetricKey === pair.canonicalMetricKey &&
        o.externalResourceId === pair.externalResourceId,
    );
    const agg = aggregateMetricObservations({
      canonicalMetricKey: pair.canonicalMetricKey,
      observations: subset,
      requestedStartDate: dateWindow.startDate,
      requestedEndDate: dateWindow.endDate,
    });
    if (agg.value !== null) {
      benchmarks.push({
        canonicalMetricKey: pair.canonicalMetricKey,
        externalResourceId: pair.externalResourceId,
        periodStartDate: dateWindow.startDate,
        periodEndDate: dateWindow.endDate,
        reportingTimezone: pair.reportingTimezone,
        expectedValue: agg.value,
      });
    }
  }

  return benchmarks;
}

export function listSupportedDimensionsForMetrics(
  canonicalMetricKeys: readonly string[],
): string[] {
  if (canonicalMetricKeys.length === 0) {
    return Array.from(new Set(CANONICAL_METRIC_DEFINITIONS.flatMap((d) => d.supportedDimensions)));
  }
  const sets = canonicalMetricKeys.map(
    (k) => new Set(getCanonicalMetricDefinition(k).supportedDimensions),
  );
  const first = sets[0];
  if (!first) return [];
  return Array.from(first).filter((dim) => sets.every((s) => s.has(dim)));
}
