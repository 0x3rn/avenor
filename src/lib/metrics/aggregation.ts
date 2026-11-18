import type { AvenorUxState } from "@avenor/types";
import { getCanonicalMetricDefinition } from "./registry";
import type {
  AggregatedMetricResult,
  MetricCompletenessState,
  StoredMetricObservation,
} from "./types";

function hasOverlappingIntervals(observations: readonly StoredMetricObservation[]): boolean {
  const byResource = new Map<string, StoredMetricObservation[]>();
  for (const obs of observations) {
    const bucketKey = `${obs.connectedResourceId}::${obs.dimensionKeyHash}`;
    const existing = byResource.get(bucketKey) ?? [];
    existing.push(obs);
    byResource.set(bucketKey, existing);
  }

  for (const list of byResource.values()) {
    if (list.length <= 1) continue;
    const sorted = [...list].sort((a, b) =>
      a.periodStartDate < b.periodStartDate
        ? -1
        : a.periodStartDate > b.periodStartDate
          ? 1
          : a.periodEndDate.localeCompare(b.periodEndDate),
    );
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev && curr && curr.periodStartDate <= prev.periodEndDate) {
        return true;
      }
    }
  }
  return false;
}

function summarizeCompleteness(observations: readonly StoredMetricObservation[]): {
  completenessState: MetricCompletenessState;
  uxState: AvenorUxState;
} {
  const states = new Set(observations.map((o) => o.completenessState));
  if (states.has("UNAVAILABLE")) {
    return { completenessState: "UNAVAILABLE", uxState: "provider_error" };
  }
  if (states.has("STALE")) {
    return { completenessState: "STALE", uxState: "stale_cached" };
  }
  if (
    states.has("SAMPLED") ||
    states.has("THRESHOLDED") ||
    states.has("TRUNCATED") ||
    states.has("PARTIAL") ||
    states.has("PROVISIONAL")
  ) {
    const primary = states.has("SAMPLED")
      ? "SAMPLED"
      : states.has("THRESHOLDED")
        ? "THRESHOLDED"
        : states.has("TRUNCATED")
          ? "TRUNCATED"
          : states.has("PARTIAL")
            ? "PARTIAL"
            : "PROVISIONAL";
    return { completenessState: primary, uxState: "partial_coverage" };
  }
  return { completenessState: "COMPLETE", uxState: "connected_healthy" };
}

/**
 * Safely aggregates canonical metric observations according to the metric definition's
 * mathematical rules (`SUM`, `WEIGHTED_RATIO`, `WEIGHTED_AVERAGE`, `NON_ADDITIVE_DISTINCT`, etc.).
 * Never sums daily unique-user counts across dates or across distinct properties, and never
 * computes unweighted means of ratios or positions.
 */
export function aggregateMetricObservations(input: {
  canonicalMetricKey: string;
  observations: readonly StoredMetricObservation[];
  requestedStartDate?: string;
  requestedEndDate?: string;
}): AggregatedMetricResult {
  const def = getCanonicalMetricDefinition(input.canonicalMetricKey);
  const matching = input.observations.filter((o) => o.canonicalMetricKey === def.canonicalKey);

  const reportingTimezones = Array.from(new Set(matching.map((o) => o.reportingTimezone)));
  const resourcesIncluded = Array.from(new Set(matching.map((o) => o.externalResourceId)));
  const latestCollectedAtIso =
    matching.length > 0
      ? matching.reduce(
          (max, o) => (o.collectedAtIso > max ? o.collectedAtIso : max),
          matching[0]?.collectedAtIso ?? "",
        )
      : null;

  if (matching.length === 0) {
    return {
      canonicalMetricKey: def.canonicalKey,
      displayName: def.displayName,
      unit: def.unit,
      valueType: def.valueType,
      aggregationRule: def.aggregationRule,
      value: null,
      numeratorSum: null,
      denominatorSum: null,
      uxState: "empty_first_use",
      completenessState: "UNAVAILABLE",
      status: "empty",
      explanation: `No stored observations found for ${def.displayName} in the requested scope.`,
      observationCount: 0,
      reportingTimezones: [],
      resourcesIncluded: [],
      latestCollectedAtIso: null,
    };
  }

  // Guard 1: Mixed currency check for CURRENCY metrics
  if (def.valueType === "CURRENCY") {
    const currencies = new Set(matching.map((o) => o.currency).filter(Boolean));
    if (currencies.size > 1) {
      return {
        canonicalMetricKey: def.canonicalKey,
        displayName: def.displayName,
        unit: def.unit,
        valueType: def.valueType,
        aggregationRule: def.aggregationRule,
        value: null,
        numeratorSum: null,
        denominatorSum: null,
        uxState: "unsupported_plan",
        completenessState: "UNAVAILABLE",
        status: "mixed_currency_rejected",
        explanation: `Cannot aggregate ${def.displayName} across multiple currencies (${Array.from(currencies).join(", ")}) without an explicit conversion ledger.`,
        observationCount: matching.length,
        reportingTimezones,
        resourcesIncluded,
        latestCollectedAtIso,
      };
    }
  }

  // Guard 2: Cross-resource additivity check
  if (resourcesIncluded.length > 1 && !def.isAdditiveAcrossResources) {
    return {
      canonicalMetricKey: def.canonicalKey,
      displayName: def.displayName,
      unit: def.unit,
      valueType: def.valueType,
      aggregationRule: def.aggregationRule,
      value: null,
      numeratorSum: null,
      denominatorSum: null,
      uxState: "partial_coverage",
      completenessState: "UNAVAILABLE",
      status: "cross_resource_rejected",
      explanation: `${def.displayName} (${def.aggregationRule}) cannot be summed or merged across multiple external properties (${resourcesIncluded.join(", ")}) because audiences or search scopes overlap.`,
      observationCount: matching.length,
      reportingTimezones,
      resourcesIncluded,
      latestCollectedAtIso,
    };
  }

  // Rule A: NON_ADDITIVE_DISTINCT (e.g., ga4.active_users, ga4.total_users)
  if (
    def.aggregationRule === "NON_ADDITIVE_DISTINCT" ||
    def.aggregationRule === "PROVIDER_TOTAL_ONLY"
  ) {
    const exactWindowMatches = matching.filter((o) => {
      if (o.granularity === "WINDOW_TOTAL") {
        if (input.requestedStartDate && o.periodStartDate !== input.requestedStartDate) {
          return false;
        }
        if (input.requestedEndDate && o.periodEndDate !== input.requestedEndDate) {
          return false;
        }
        return true;
      }
      if (
        o.granularity === "DAILY" &&
        input.requestedStartDate &&
        input.requestedEndDate &&
        input.requestedStartDate === input.requestedEndDate &&
        o.periodStartDate === input.requestedStartDate
      ) {
        return true;
      }
      return false;
    });

    if (exactWindowMatches.length === 1 && exactWindowMatches[0]?.numericValue !== null) {
      const single = exactWindowMatches[0];
      const { completenessState, uxState } = summarizeCompleteness([single]);
      return {
        canonicalMetricKey: def.canonicalKey,
        displayName: def.displayName,
        unit: def.unit,
        valueType: def.valueType,
        aggregationRule: def.aggregationRule,
        value: single.numericValue,
        numeratorSum: null,
        denominatorSum: null,
        uxState,
        completenessState,
        status: "ok",
        explanation: `Exact provider deduplicated window total (${single.periodStartDate}..${single.periodEndDate}) for ${single.externalResourceId}.`,
        observationCount: 1,
        reportingTimezones: [single.reportingTimezone],
        resourcesIncluded: [single.externalResourceId],
        latestCollectedAtIso: single.collectedAtIso,
      };
    }

    // If only 1 observation was passed without explicit date bounds and it is valid
    if (
      !input.requestedStartDate &&
      !input.requestedEndDate &&
      matching.length === 1 &&
      matching[0]?.numericValue !== null
    ) {
      const single = matching[0];
      const { completenessState, uxState } = summarizeCompleteness([single]);
      return {
        canonicalMetricKey: def.canonicalKey,
        displayName: def.displayName,
        unit: def.unit,
        valueType: def.valueType,
        aggregationRule: def.aggregationRule,
        value: single.numericValue,
        numeratorSum: null,
        denominatorSum: null,
        uxState,
        completenessState,
        status: "ok",
        explanation: `Single deduplicated observation (${single.periodStartDate}..${single.periodEndDate}).`,
        observationCount: 1,
        reportingTimezones,
        resourcesIncluded,
        latestCollectedAtIso,
      };
    }

    return {
      canonicalMetricKey: def.canonicalKey,
      displayName: def.displayName,
      unit: def.unit,
      valueType: def.valueType,
      aggregationRule: def.aggregationRule,
      value: null,
      numeratorSum: null,
      denominatorSum: null,
      uxState: "partial_coverage",
      completenessState: "UNAVAILABLE",
      status: "non_additive_unavailable",
      explanation: `${def.displayName} is a deduplicated unique-user metric and cannot be derived by summing ${matching.length} daily or multi-period observations.`,
      observationCount: matching.length,
      reportingTimezones,
      resourcesIncluded,
      latestCollectedAtIso,
    };
  }

  // Prefer exact WINDOW_TOTAL when a single exact window observation matches requested range
  if (input.requestedStartDate && input.requestedEndDate) {
    const exactWindow = matching.filter(
      (o) =>
        o.granularity === "WINDOW_TOTAL" &&
        o.periodStartDate === input.requestedStartDate &&
        o.periodEndDate === input.requestedEndDate &&
        o.numericValue !== null,
    );
    if (exactWindow.length === 1 && exactWindow[0]) {
      const winObs = exactWindow[0];
      const { completenessState, uxState } = summarizeCompleteness([winObs]);
      return {
        canonicalMetricKey: def.canonicalKey,
        displayName: def.displayName,
        unit: def.unit,
        valueType: def.valueType,
        aggregationRule: def.aggregationRule,
        value: winObs.numericValue,
        numeratorSum: winObs.numeratorValue,
        denominatorSum: winObs.denominatorValue,
        uxState,
        completenessState,
        status: "ok",
        explanation: `Exact window aggregate (${winObs.periodStartDate}..${winObs.periodEndDate}).`,
        observationCount: 1,
        reportingTimezones: [winObs.reportingTimezone],
        resourcesIncluded: [winObs.externalResourceId],
        latestCollectedAtIso: winObs.collectedAtIso,
      };
    }
  }

  // Filter out WINDOW_TOTAL rows if DAILY rows are also present to avoid double counting
  const dailyOnly = matching.filter((o) => o.granularity === "DAILY");
  const candidateRows = dailyOnly.length > 0 ? dailyOnly : matching;

  if (hasOverlappingIntervals(candidateRows)) {
    return {
      canonicalMetricKey: def.canonicalKey,
      displayName: def.displayName,
      unit: def.unit,
      valueType: def.valueType,
      aggregationRule: def.aggregationRule,
      value: null,
      numeratorSum: null,
      denominatorSum: null,
      uxState: "provider_error",
      completenessState: "UNAVAILABLE",
      status: "overlapping_periods_rejected",
      explanation: `Cannot aggregate overlapping reporting intervals for ${def.displayName}; periods must be strictly disjoint.`,
      observationCount: candidateRows.length,
      reportingTimezones,
      resourcesIncluded,
      latestCollectedAtIso,
    };
  }

  const validRows = candidateRows.filter((o) => o.numericValue !== null);
  if (validRows.length === 0) {
    return {
      canonicalMetricKey: def.canonicalKey,
      displayName: def.displayName,
      unit: def.unit,
      valueType: def.valueType,
      aggregationRule: def.aggregationRule,
      value: null,
      numeratorSum: null,
      denominatorSum: null,
      uxState: "partial_coverage",
      completenessState: "UNAVAILABLE",
      status: "unavailable",
      explanation: `Observations for ${def.displayName} contain unavailable (null) values; Avenor never substitutes synthetic zeroes.`,
      observationCount: candidateRows.length,
      reportingTimezones,
      resourcesIncluded,
      latestCollectedAtIso,
    };
  }

  const { completenessState, uxState } = summarizeCompleteness(validRows);

  // Rule B: SUM
  if (def.aggregationRule === "SUM") {
    let sum = 0;
    for (const row of validRows) {
      sum += row.numericValue ?? 0;
    }
    return {
      canonicalMetricKey: def.canonicalKey,
      displayName: def.displayName,
      unit: def.unit,
      valueType: def.valueType,
      aggregationRule: def.aggregationRule,
      value: Number(sum.toFixed(6)),
      numeratorSum: null,
      denominatorSum: null,
      uxState,
      completenessState,
      status: "ok",
      explanation: `Summed across ${validRows.length} disjoint observation(s).`,
      observationCount: validRows.length,
      reportingTimezones,
      resourcesIncluded,
      latestCollectedAtIso,
    };
  }

  // Rule C: WEIGHTED_RATIO or WEIGHTED_AVERAGE
  if (def.aggregationRule === "WEIGHTED_RATIO" || def.aggregationRule === "WEIGHTED_AVERAGE") {
    let numeratorSum = 0;
    let denominatorSum = 0;
    let hasExplicitWeights = true;

    for (const row of validRows) {
      if (row.numeratorValue === null || row.denominatorValue === null) {
        hasExplicitWeights = false;
        break;
      }
      numeratorSum += row.numeratorValue;
      denominatorSum += row.denominatorValue;
    }

    if (!hasExplicitWeights) {
      if (validRows.length === 1 && validRows[0]?.numericValue !== null) {
        return {
          canonicalMetricKey: def.canonicalKey,
          displayName: def.displayName,
          unit: def.unit,
          valueType: def.valueType,
          aggregationRule: def.aggregationRule,
          value: validRows[0].numericValue,
          numeratorSum: null,
          denominatorSum: null,
          uxState,
          completenessState,
          status: "ok",
          explanation: `Single period observation for ${def.displayName}.`,
          observationCount: 1,
          reportingTimezones,
          resourcesIncluded,
          latestCollectedAtIso,
        };
      }
      return {
        canonicalMetricKey: def.canonicalKey,
        displayName: def.displayName,
        unit: def.unit,
        valueType: def.valueType,
        aggregationRule: def.aggregationRule,
        value: null,
        numeratorSum: null,
        denominatorSum: null,
        uxState: "partial_coverage",
        completenessState: "UNAVAILABLE",
        status: "non_additive_unavailable",
        explanation: `${def.displayName} requires numerator/denominator weighting across multiple periods and cannot be computed as an unweighted mean of ${validRows.length} ratios/averages.`,
        observationCount: validRows.length,
        reportingTimezones,
        resourcesIncluded,
        latestCollectedAtIso,
      };
    }

    if (denominatorSum <= 0) {
      return {
        canonicalMetricKey: def.canonicalKey,
        displayName: def.displayName,
        unit: def.unit,
        valueType: def.valueType,
        aggregationRule: def.aggregationRule,
        value: def.aggregationRule === "WEIGHTED_RATIO" ? 0 : null,
        numeratorSum: 0,
        denominatorSum: 0,
        uxState,
        completenessState,
        status: "ok",
        explanation: `Denominator total is 0 across ${validRows.length} observation(s).`,
        observationCount: validRows.length,
        reportingTimezones,
        resourcesIncluded,
        latestCollectedAtIso,
      };
    }

    const weightedValue = Number((numeratorSum / denominatorSum).toFixed(6));
    return {
      canonicalMetricKey: def.canonicalKey,
      displayName: def.displayName,
      unit: def.unit,
      valueType: def.valueType,
      aggregationRule: def.aggregationRule,
      value: weightedValue,
      numeratorSum: Number(numeratorSum.toFixed(6)),
      denominatorSum: Number(denominatorSum.toFixed(6)),
      uxState,
      completenessState,
      status: "ok",
      explanation: `Computed ${def.aggregationRule.toLowerCase()} (${numeratorSum.toFixed(2)} / ${denominatorSum.toFixed(2)}) across ${validRows.length} disjoint observation(s).`,
      observationCount: validRows.length,
      reportingTimezones,
      resourcesIncluded,
      latestCollectedAtIso,
    };
  }

  // Rule D: LATEST_GAUGE
  const sortedByEnd = [...validRows].sort((a, b) => b.periodEndDate.localeCompare(a.periodEndDate));
  const latest = sortedByEnd[0];
  return {
    canonicalMetricKey: def.canonicalKey,
    displayName: def.displayName,
    unit: def.unit,
    valueType: def.valueType,
    aggregationRule: def.aggregationRule,
    value: latest?.numericValue ?? null,
    numeratorSum: null,
    denominatorSum: null,
    uxState,
    completenessState,
    status: "ok",
    explanation: `Latest gauge reading (${latest?.periodEndDate}).`,
    observationCount: validRows.length,
    reportingTimezones,
    resourcesIncluded,
    latestCollectedAtIso,
  };
}
