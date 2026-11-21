import {
  type CloudMonitoringDescriptorSpec,
  type CloudMonitoringMetricKind,
  type CloudMonitoringRawPoint,
  FIREBASE_CANONICAL_METRIC_KEYS,
  type FirebaseCanonicalMetricKey,
  type NormalizedMonitoringSeriesResult,
} from "./types";

export const FIREBASE_MONITORING_DESCRIPTOR_SPECS: Readonly<
  Record<FirebaseCanonicalMetricKey, CloudMonitoringDescriptorSpec>
> = {
  [FIREBASE_CANONICAL_METRIC_KEYS.FIRESTORE_DOCUMENT_READS]: {
    canonicalMetricKey: FIREBASE_CANONICAL_METRIC_KEYS.FIRESTORE_DOCUMENT_READS,
    gcpMetricType: "firestore.googleapis.com/document/read_count",
    monitoredResourceType: "firestore_instance",
    metricKind: "DELTA",
    unit: "count",
    valueUnitConversion: "identity",
  },
  [FIREBASE_CANONICAL_METRIC_KEYS.FIRESTORE_DOCUMENT_WRITES]: {
    canonicalMetricKey: FIREBASE_CANONICAL_METRIC_KEYS.FIRESTORE_DOCUMENT_WRITES,
    gcpMetricType: "firestore.googleapis.com/document/write_count",
    monitoredResourceType: "firestore_instance",
    metricKind: "DELTA",
    unit: "count",
    valueUnitConversion: "identity",
  },
  [FIREBASE_CANONICAL_METRIC_KEYS.FIRESTORE_DOCUMENT_DELETES]: {
    canonicalMetricKey: FIREBASE_CANONICAL_METRIC_KEYS.FIRESTORE_DOCUMENT_DELETES,
    gcpMetricType: "firestore.googleapis.com/document/delete_count",
    monitoredResourceType: "firestore_instance",
    metricKind: "DELTA",
    unit: "count",
    valueUnitConversion: "identity",
  },
  [FIREBASE_CANONICAL_METRIC_KEYS.FIRESTORE_ACTIVE_LISTENERS]: {
    canonicalMetricKey: FIREBASE_CANONICAL_METRIC_KEYS.FIRESTORE_ACTIVE_LISTENERS,
    gcpMetricType: "firestore.googleapis.com/network/active_connections",
    monitoredResourceType: "firestore_instance",
    metricKind: "GAUGE",
    unit: "count",
    valueUnitConversion: "identity",
  },
  [FIREBASE_CANONICAL_METRIC_KEYS.FUNCTION_INVOCATIONS]: {
    canonicalMetricKey: FIREBASE_CANONICAL_METRIC_KEYS.FUNCTION_INVOCATIONS,
    gcpMetricType: "cloudfunctions.googleapis.com/function/execution_count",
    monitoredResourceType: "cloud_function",
    metricKind: "DELTA",
    unit: "count",
    valueUnitConversion: "identity",
  },
  [FIREBASE_CANONICAL_METRIC_KEYS.FUNCTION_ERRORS]: {
    canonicalMetricKey: FIREBASE_CANONICAL_METRIC_KEYS.FUNCTION_ERRORS,
    gcpMetricType: "cloudfunctions.googleapis.com/function/execution_count",
    monitoredResourceType: "cloud_function",
    metricKind: "DELTA",
    unit: "count",
    additionalFilter: 'metric.labels.status != "ok"',
    valueUnitConversion: "identity",
  },
  [FIREBASE_CANONICAL_METRIC_KEYS.FUNCTION_EXECUTION_TIME_MS]: {
    canonicalMetricKey: FIREBASE_CANONICAL_METRIC_KEYS.FUNCTION_EXECUTION_TIME_MS,
    gcpMetricType: "cloudfunctions.googleapis.com/function/execution_times",
    monitoredResourceType: "cloud_function",
    metricKind: "GAUGE",
    unit: "ms",
    valueUnitConversion: "ns_to_ms",
  },
  [FIREBASE_CANONICAL_METRIC_KEYS.STORAGE_BYTES]: {
    canonicalMetricKey: FIREBASE_CANONICAL_METRIC_KEYS.STORAGE_BYTES,
    gcpMetricType: "storage.googleapis.com/storage/total_bytes",
    monitoredResourceType: "gcs_bucket",
    metricKind: "GAUGE",
    unit: "bytes",
    valueUnitConversion: "identity",
  },
  [FIREBASE_CANONICAL_METRIC_KEYS.RULES_EVALUATIONS_ALLOW]: {
    canonicalMetricKey: FIREBASE_CANONICAL_METRIC_KEYS.RULES_EVALUATIONS_ALLOW,
    gcpMetricType: "firestore.googleapis.com/rules/evaluation_count",
    monitoredResourceType: "firestore_instance",
    metricKind: "DELTA",
    unit: "count",
    additionalFilter: 'metric.labels.result = "ALLOW"',
    valueUnitConversion: "identity",
  },
  [FIREBASE_CANONICAL_METRIC_KEYS.RULES_EVALUATIONS_DENY]: {
    canonicalMetricKey: FIREBASE_CANONICAL_METRIC_KEYS.RULES_EVALUATIONS_DENY,
    gcpMetricType: "firestore.googleapis.com/rules/evaluation_count",
    monitoredResourceType: "firestore_instance",
    metricKind: "DELTA",
    unit: "count",
    additionalFilter: 'metric.labels.result = "DENY"',
    valueUnitConversion: "identity",
  },
  [FIREBASE_CANONICAL_METRIC_KEYS.RULES_EVALUATIONS_ERROR]: {
    canonicalMetricKey: FIREBASE_CANONICAL_METRIC_KEYS.RULES_EVALUATIONS_ERROR,
    gcpMetricType: "firestore.googleapis.com/rules/evaluation_count",
    monitoredResourceType: "firestore_instance",
    metricKind: "DELTA",
    unit: "count",
    additionalFilter: 'metric.labels.result = "ERROR"',
    valueUnitConversion: "identity",
  },
};

export function extractRawPointNumericValue(
  point: CloudMonitoringRawPoint,
  conversion: "ns_to_ms" | "s_to_ms" | "identity" = "identity",
): number {
  let rawValue = 0;

  if (point.value.int64Value !== undefined) {
    rawValue =
      typeof point.value.int64Value === "number"
        ? point.value.int64Value
        : Number.parseFloat(point.value.int64Value);
  } else if (typeof point.value.doubleValue === "number") {
    rawValue = point.value.doubleValue;
  } else if (typeof point.value.distributionValue?.mean === "number") {
    rawValue = point.value.distributionValue.mean;
  }

  if (!Number.isFinite(rawValue)) {
    return 0;
  }

  if (conversion === "ns_to_ms") {
    return Math.round((rawValue / 1_000_000) * 100) / 100;
  }
  if (conversion === "s_to_ms") {
    return Math.round(rawValue * 1000 * 100) / 100;
  }
  return Math.round(rawValue * 100) / 100;
}

/**
 * Normalizes and aggregates Cloud Monitoring v3 time-series points according to
 * their semantic `metricKind` (`GAUGE`, `DELTA`, or `CUMULATIVE`):
 *
 * - `GAUGE`: Represents an instantaneous state measurement (e.g., active listeners,
 *   stored bytes, mean execution latency). NEVER sums sampled gauge points across time!
 *   Aggregates via `GAUGE_LATEST` (default), `GAUGE_MEAN`, or `GAUGE_MAX`.
 * - `DELTA`: Represents change over an alignment interval. Sums interval deltas cleanly.
 * - `CUMULATIVE`: Represents a monotonically increasing counter since `interval.startTime`.
 *   Computes non-negative interval deltas between consecutive points and detects counter
 *   resets (either when `startTime` changes or `current < previous`), treating the post-reset
 *   reading as a positive delta from 0 rather than emitting a negative spike.
 */
export function normalizeCloudMonitoringPoints(
  rawPoints: readonly CloudMonitoringRawPoint[],
  metricKind: CloudMonitoringMetricKind,
  options?: {
    conversion?: "ns_to_ms" | "s_to_ms" | "identity";
    gaugeRollup?: "GAUGE_LATEST" | "GAUGE_MEAN" | "GAUGE_MAX";
  },
): NormalizedMonitoringSeriesResult {
  const conversion = options?.conversion ?? "identity";
  const gaugeRollup = options?.gaugeRollup ?? "GAUGE_LATEST";

  // Sort chronologically by interval.endTime ascending (Cloud Monitoring returns reverse chronological by default)
  const sorted = [...rawPoints].sort(
    (a, b) => Date.parse(a.interval.endTime) - Date.parse(b.interval.endTime),
  );

  if (sorted.length === 0) {
    return {
      metricKind,
      rollupStrategy:
        metricKind === "GAUGE"
          ? gaugeRollup
          : metricKind === "DELTA"
            ? "DELTA_SUM"
            : "CUMULATIVE_RESET_SAFE_DELTA",
      summaryValue: null,
      latestValue: null,
      meanValue: null,
      maxValue: null,
      counterResetsDetected: 0,
      points: [],
    };
  }

  if (metricKind === "GAUGE") {
    const normalizedPoints = sorted.map((pt) => ({
      timestampIso: pt.interval.endTime,
      value: extractRawPointNumericValue(pt, conversion),
    }));

    const values = normalizedPoints.map((p) => p.value);
    const latestValue = values[values.length - 1] ?? null;
    const sumForMeanOnly = values.reduce((acc, v) => acc + v, 0);
    const meanValue = Math.round((sumForMeanOnly / values.length) * 100) / 100;
    const maxValue = Math.max(...values);

    const summaryValue =
      gaugeRollup === "GAUGE_MEAN"
        ? meanValue
        : gaugeRollup === "GAUGE_MAX"
          ? maxValue
          : latestValue;

    return {
      metricKind: "GAUGE",
      rollupStrategy: gaugeRollup,
      summaryValue,
      latestValue,
      meanValue,
      maxValue,
      counterResetsDetected: 0,
      points: normalizedPoints,
    };
  }

  if (metricKind === "DELTA") {
    const normalizedPoints = sorted.map((pt) => ({
      timestampIso: pt.interval.endTime,
      value: Math.max(0, extractRawPointNumericValue(pt, conversion)),
    }));

    const values = normalizedPoints.map((p) => p.value);
    const totalSum = Math.round(values.reduce((acc, v) => acc + v, 0) * 100) / 100;
    const latestValue = values[values.length - 1] ?? null;
    const meanValue = Math.round((totalSum / values.length) * 100) / 100;
    const maxValue = Math.max(...values);

    return {
      metricKind: "DELTA",
      rollupStrategy: "DELTA_SUM",
      summaryValue: totalSum,
      latestValue,
      meanValue,
      maxValue,
      counterResetsDetected: 0,
      points: normalizedPoints,
    };
  }

  // CUMULATIVE: Compute reset-safe non-negative deltas across consecutive readings
  const deltaPoints: Array<{ timestampIso: string; value: number }> = [];
  let counterResetsDetected = 0;
  let prevCumulativeValue: number | null = null;
  let prevStartTime: string | undefined;

  for (const pt of sorted) {
    const currentVal = Math.max(0, extractRawPointNumericValue(pt, conversion));
    const currentStart = pt.interval.startTime;

    if (prevCumulativeValue === null) {
      deltaPoints.push({
        timestampIso: pt.interval.endTime,
        value: currentVal,
      });
    } else if (
      (currentStart && prevStartTime && currentStart !== prevStartTime) ||
      currentVal < prevCumulativeValue
    ) {
      // Counter reset detected! Treat currentVal as fresh positive delta since reset
      counterResetsDetected += 1;
      deltaPoints.push({
        timestampIso: pt.interval.endTime,
        value: currentVal,
      });
    } else {
      deltaPoints.push({
        timestampIso: pt.interval.endTime,
        value: Math.round((currentVal - prevCumulativeValue) * 100) / 100,
      });
    }

    prevCumulativeValue = currentVal;
    prevStartTime = currentStart;
  }

  const values = deltaPoints.map((p) => p.value);
  const totalDeltaSum = Math.round(values.reduce((acc, v) => acc + v, 0) * 100) / 100;
  const latestValue = values[values.length - 1] ?? null;
  const meanValue = Math.round((totalDeltaSum / values.length) * 100) / 100;
  const maxValue = Math.max(...values);

  return {
    metricKind: "CUMULATIVE",
    rollupStrategy: "CUMULATIVE_RESET_SAFE_DELTA",
    summaryValue: totalDeltaSum,
    latestValue,
    meanValue,
    maxValue,
    counterResetsDetected,
    points: deltaPoints,
  };
}
