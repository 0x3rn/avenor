export const FIREBASE_MONITORING_PROVIDER_KEY = "firebase-monitoring" as const;
export const GOOGLE_MONITORING_READ_SCOPE =
  "https://www.googleapis.com/auth/monitoring.read" as const;

export const FIREBASE_CANONICAL_METRIC_KEYS = {
  FIRESTORE_DOCUMENT_READS: "firebase.firestore_document_reads",
  FIRESTORE_DOCUMENT_WRITES: "firebase.firestore_document_writes",
  FIRESTORE_DOCUMENT_DELETES: "firebase.firestore_document_deletes",
  FIRESTORE_ACTIVE_LISTENERS: "firebase.firestore_active_listeners",
  FUNCTION_INVOCATIONS: "firebase.function_invocations",
  FUNCTION_ERRORS: "firebase.function_errors",
  FUNCTION_EXECUTION_TIME_MS: "firebase.function_execution_time_ms",
  STORAGE_BYTES: "firebase.storage_bytes",
  RULES_EVALUATIONS_ALLOW: "firebase.rules_evaluations_allow",
  RULES_EVALUATIONS_DENY: "firebase.rules_evaluations_deny",
  RULES_EVALUATIONS_ERROR: "firebase.rules_evaluations_error",
} as const;

export type FirebaseCanonicalMetricKey =
  (typeof FIREBASE_CANONICAL_METRIC_KEYS)[keyof typeof FIREBASE_CANONICAL_METRIC_KEYS];

export type CloudMonitoringMetricKind = "GAUGE" | "DELTA" | "CUMULATIVE";

export interface CloudMonitoringDescriptorSpec {
  readonly canonicalMetricKey: FirebaseCanonicalMetricKey;
  readonly gcpMetricType: string;
  readonly monitoredResourceType: "firestore_instance" | "cloud_function" | "gcs_bucket";
  readonly metricKind: CloudMonitoringMetricKind;
  readonly unit: "count" | "bytes" | "ms";
  readonly additionalFilter?: string;
  readonly valueUnitConversion?: "ns_to_ms" | "s_to_ms" | "identity";
}

export interface CloudMonitoringRawPoint {
  readonly interval: {
    readonly startTime?: string;
    readonly endTime: string;
  };
  readonly value: {
    readonly int64Value?: string | number;
    readonly doubleValue?: number;
    readonly distributionValue?: {
      readonly count?: string | number;
      readonly mean?: number;
    };
  };
}

export interface CloudMonitoringTimeSeries {
  readonly metric?: {
    readonly type?: string;
    readonly labels?: Record<string, string>;
  };
  readonly resource?: {
    readonly type?: string;
    readonly labels?: Record<string, string>;
  };
  readonly metricKind?: CloudMonitoringMetricKind;
  readonly valueType?: "INT64" | "DOUBLE" | "DISTRIBUTION";
  readonly points?: readonly CloudMonitoringRawPoint[];
}

export interface NormalizedMonitoringSeriesResult {
  readonly metricKind: CloudMonitoringMetricKind;
  readonly rollupStrategy:
    | "GAUGE_LATEST"
    | "GAUGE_MEAN"
    | "GAUGE_MAX"
    | "DELTA_SUM"
    | "CUMULATIVE_RESET_SAFE_DELTA";
  readonly summaryValue: number | null;
  readonly latestValue: number | null;
  readonly meanValue: number | null;
  readonly maxValue: number | null;
  readonly counterResetsDetected: number;
  readonly points: ReadonlyArray<{
    readonly timestampIso: string;
    readonly value: number;
  }>;
}

export interface FirebaseMonitoredProjectRecord {
  readonly gcpProjectId: string;
  readonly displayName: string;
  readonly region: string;
  readonly firestoreEnabled: boolean;
  readonly cloudFunctionsEnabled: boolean;
  readonly cloudStorageEnabled: boolean;
  readonly securityRulesTelemetryActive: boolean;
}
