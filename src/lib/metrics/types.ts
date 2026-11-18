import type { AvenorUxState } from "@avenor/types";

export const METRIC_VALUE_TYPES = [
  "COUNT",
  "DISTINCT_COUNT",
  "RATIO",
  "PERCENTAGE",
  "AVERAGE",
  "POSITION",
  "DURATION",
  "SIZE",
  "CURRENCY",
  "GAUGE",
] as const;

export type MetricValueType = (typeof METRIC_VALUE_TYPES)[number];

export const METRIC_AGGREGATION_RULES = [
  "SUM",
  "WEIGHTED_RATIO",
  "WEIGHTED_AVERAGE",
  "NON_ADDITIVE_DISTINCT",
  "PROVIDER_TOTAL_ONLY",
  "LATEST_GAUGE",
] as const;

export type MetricAggregationRule = (typeof METRIC_AGGREGATION_RULES)[number];

export const METRIC_GRANULARITIES = [
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "WINDOW_TOTAL",
  "REALTIME_SNAPSHOT",
] as const;

export type MetricGranularity = (typeof METRIC_GRANULARITIES)[number];

export const METRIC_TIMEZONE_BEHAVIORS = [
  "PROPERTY_LOCAL",
  "PACIFIC_TIME_FIXED",
  "UTC",
  "BILLING_ACCOUNT_LOCAL",
] as const;

export type MetricTimezoneBehavior = (typeof METRIC_TIMEZONE_BEHAVIORS)[number];

export const METRIC_COMPLETENESS_STATES = [
  "COMPLETE",
  "PROVISIONAL",
  "PARTIAL",
  "SAMPLED",
  "THRESHOLDED",
  "TRUNCATED",
  "STALE",
  "UNAVAILABLE",
] as const;

export type MetricCompletenessState = (typeof METRIC_COMPLETENESS_STATES)[number];

export const METRIC_CATEGORIES = [
  "audience",
  "acquisition",
  "engagement",
  "search",
  "cost",
  "backend",
  "reliability",
] as const;

export type MetricCategory = (typeof METRIC_CATEGORIES)[number];

export interface CanonicalMetricDefinition {
  id: string;
  canonicalKey: string;
  providerKey: string;
  providerMetricName: string;
  displayName: string;
  description: string;
  category: MetricCategory;
  unit: string;
  valueType: MetricValueType;
  aggregationRule: MetricAggregationRule;
  numeratorMetricKey: string | null;
  denominatorMetricKey: string | null;
  weightMetricKey: string | null;
  isAdditiveAcrossDates: boolean;
  isAdditiveAcrossResources: boolean;
  supportedDimensions: readonly string[];
  supportedGranularities: readonly MetricGranularity[];
  timezoneBehavior: MetricTimezoneBehavior;
  freshnessWindowMinutes: number;
  capabilityKey: string;
  schemaVersion: number;
}

export interface NormalizedDimensionIdentity {
  dimensions: Record<string, string>;
  canonicalKey: string;
  hash: string;
}

export interface HalfOpenPeriodBounds {
  periodStartDate: string;
  periodEndDate: string;
  reportingTimezone: string;
  periodStartUtc: Date;
  periodEndUtc: Date;
  elapsedHours: number;
  dayCount: number;
  hasDstTransition: boolean;
}

export interface CanonicalDataQualityFlags {
  isSampled?: boolean;
  samplingReadPercent?: number | null;
  isThresholded?: boolean;
  hasOtherRowTruncation?: boolean;
  hasPrivacyAnonymizationGap?: boolean;
  anonymizedClicksDelta?: number | null;
  isWithinLagWindow?: boolean;
  lagWindowHours?: string | null;
  notes?: string[];
}

export interface CanonicalMetricObservationInput {
  organizationId: string;
  workspaceId: string;
  projectId: string | null;
  environmentId: string | null;
  providerConnectionId: string;
  connectedResourceId: string;
  providerKey: string;
  externalResourceId: string;
  canonicalMetricKey: string;
  providerMetricName?: string;
  metricDefinitionVersion?: number;
  granularity: MetricGranularity;
  periodStartDate: string;
  periodEndDate: string;
  reportingTimezone: string;
  dimensions?: Record<string, string>;
  queryFingerprint?: string;
  unit?: string;
  currency?: string | null;
  numericValue: number | null;
  numeratorValue?: number | null;
  denominatorValue?: number | null;
  completenessState?: MetricCompletenessState;
  dataQualityFlags?: CanonicalDataQualityFlags;
  sourceUpdatedAt?: Date | string | null;
  collectedAt?: Date | string;
  ingestionRunId?: string | null;
  revisionReason?: string | null;
}

export interface StoredMetricObservation {
  id: string;
  organizationId: string;
  workspaceId: string;
  projectId: string | null;
  environmentId: string | null;
  providerConnectionId: string;
  connectedResourceId: string;
  providerKey: string;
  externalResourceId: string;
  canonicalMetricKey: string;
  providerMetricName: string;
  metricDefinitionVersion: number;
  granularity: MetricGranularity;
  periodStartDate: string;
  periodEndDate: string;
  periodStartUtcIso: string;
  periodEndUtcIso: string;
  reportingTimezone: string;
  dimensionKeyHash: string;
  dimensionCanonicalKey: string;
  dimensions: Record<string, string>;
  queryFingerprint: string;
  unit: string;
  currency: string | null;
  numericValue: number | null;
  numeratorValue: number | null;
  denominatorValue: number | null;
  completenessState: MetricCompletenessState;
  dataQualityFlags: CanonicalDataQualityFlags;
  sourceUpdatedAtIso: string | null;
  collectedAtIso: string;
  ingestionRunId: string | null;
  revisionNumber: number;
  previousNumericValue: number | null;
  revisionReason: string | null;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface MetricObservationRevisionRecord {
  id: string;
  observationId: string;
  organizationId: string;
  workspaceId: string;
  canonicalMetricKey: string;
  revisionNumber: number;
  previousValue: number | null;
  newValue: number | null;
  previousCompleteness: MetricCompletenessState;
  newCompleteness: MetricCompletenessState;
  revisionReason: string;
  ingestionRunId: string | null;
  recordedAtIso: string;
}

export interface MetricUpsertOutcome {
  action: "inserted" | "updated" | "unchanged";
  observation: StoredMetricObservation;
  revisionRecorded: boolean;
}

export interface MetricBatchUpsertResult {
  processedCount: number;
  insertedCount: number;
  updatedCount: number;
  unchangedCount: number;
  observations: StoredMetricObservation[];
}

export interface AggregatedMetricResult {
  canonicalMetricKey: string;
  displayName: string;
  unit: string;
  valueType: MetricValueType;
  aggregationRule: MetricAggregationRule;
  value: number | null;
  numeratorSum: number | null;
  denominatorSum: number | null;
  uxState: AvenorUxState;
  completenessState: MetricCompletenessState;
  status:
    | "ok"
    | "empty"
    | "unavailable"
    | "non_additive_unavailable"
    | "overlapping_periods_rejected"
    | "cross_resource_rejected"
    | "mixed_currency_rejected";
  explanation: string;
  observationCount: number;
  reportingTimezones: string[];
  resourcesIncluded: string[];
  latestCollectedAtIso: string | null;
}
