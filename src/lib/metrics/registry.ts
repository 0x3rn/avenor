import { AppError, ERROR_CODES } from "@avenor/types";
import {
  type CanonicalMetricDefinition,
  METRIC_AGGREGATION_RULES,
  METRIC_CATEGORIES,
  METRIC_GRANULARITIES,
  METRIC_TIMEZONE_BEHAVIORS,
  METRIC_VALUE_TYPES,
  type MetricAggregationRule,
  type MetricCategory,
  type MetricGranularity,
  type MetricTimezoneBehavior,
  type MetricValueType,
} from "./types";

export const CANONICAL_METRIC_DEFINITIONS: readonly CanonicalMetricDefinition[] = [
  {
    id: "mdef_ga4_active_users_v1",
    canonicalKey: "ga4.active_users",
    providerKey: "ga4",
    providerMetricName: "activeUsers",
    displayName: "Active Users (GA4)",
    description:
      "Distinct users who had an engaged session or when Analytics collected first_visit/engagement_time_msec. Non-additive across dates and properties; requires GA4 RESERVED_TOTAL window aggregation.",
    category: "audience",
    unit: "users",
    valueType: "DISTINCT_COUNT",
    aggregationRule: "NON_ADDITIVE_DISTINCT",
    numeratorMetricKey: null,
    denominatorMetricKey: null,
    weightMetricKey: null,
    isAdditiveAcrossDates: false,
    isAdditiveAcrossResources: false,
    supportedDimensions: [
      "date",
      "sessionDefaultChannelGroup",
      "landingPagePlusQueryString",
      "pagePath",
      "deviceCategory",
      "country",
    ],
    supportedGranularities: ["DAILY", "WINDOW_TOTAL", "REALTIME_SNAPSHOT"],
    timezoneBehavior: "PROPERTY_LOCAL",
    freshnessWindowMinutes: 240,
    capabilityKey: "analytics_sessions",
    schemaVersion: 1,
  },
  {
    id: "mdef_ga4_total_users_v1",
    canonicalKey: "ga4.total_users",
    providerKey: "ga4",
    providerMetricName: "totalUsers",
    displayName: "Total Users (GA4)",
    description:
      "Distinct unique users who logged any event in the reporting window. Non-additive across dates and properties.",
    category: "audience",
    unit: "users",
    valueType: "DISTINCT_COUNT",
    aggregationRule: "NON_ADDITIVE_DISTINCT",
    numeratorMetricKey: null,
    denominatorMetricKey: null,
    weightMetricKey: null,
    isAdditiveAcrossDates: false,
    isAdditiveAcrossResources: false,
    supportedDimensions: [
      "date",
      "sessionDefaultChannelGroup",
      "landingPagePlusQueryString",
      "pagePath",
      "deviceCategory",
      "country",
    ],
    supportedGranularities: ["DAILY", "WINDOW_TOTAL"],
    timezoneBehavior: "PROPERTY_LOCAL",
    freshnessWindowMinutes: 240,
    capabilityKey: "analytics_sessions",
    schemaVersion: 1,
  },
  {
    id: "mdef_ga4_new_users_v1",
    canonicalKey: "ga4.new_users",
    providerKey: "ga4",
    providerMetricName: "newUsers",
    displayName: "New Users (GA4)",
    description:
      "Users interacting with the site or app for the first time (first_visit / first_open events).",
    category: "acquisition",
    unit: "users",
    valueType: "COUNT",
    aggregationRule: "SUM",
    numeratorMetricKey: null,
    denominatorMetricKey: null,
    weightMetricKey: null,
    isAdditiveAcrossDates: true,
    isAdditiveAcrossResources: false,
    supportedDimensions: [
      "date",
      "sessionDefaultChannelGroup",
      "landingPagePlusQueryString",
      "deviceCategory",
      "country",
    ],
    supportedGranularities: ["DAILY", "WINDOW_TOTAL"],
    timezoneBehavior: "PROPERTY_LOCAL",
    freshnessWindowMinutes: 240,
    capabilityKey: "analytics_sessions",
    schemaVersion: 1,
  },
  {
    id: "mdef_ga4_sessions_v1",
    canonicalKey: "ga4.sessions",
    providerKey: "ga4",
    providerMetricName: "sessions",
    displayName: "Sessions (GA4)",
    description:
      "Total GA4 sessions initiated on the property (session_start). Additive across disjoint dates within the same property; distinct from Search Console clicks.",
    category: "acquisition",
    unit: "sessions",
    valueType: "COUNT",
    aggregationRule: "SUM",
    numeratorMetricKey: null,
    denominatorMetricKey: null,
    weightMetricKey: null,
    isAdditiveAcrossDates: true,
    isAdditiveAcrossResources: true,
    supportedDimensions: [
      "date",
      "sessionDefaultChannelGroup",
      "landingPagePlusQueryString",
      "pagePath",
      "deviceCategory",
      "country",
    ],
    supportedGranularities: ["DAILY", "WINDOW_TOTAL"],
    timezoneBehavior: "PROPERTY_LOCAL",
    freshnessWindowMinutes: 240,
    capabilityKey: "analytics_sessions",
    schemaVersion: 1,
  },
  {
    id: "mdef_ga4_engaged_sessions_v1",
    canonicalKey: "ga4.engaged_sessions",
    providerKey: "ga4",
    providerMetricName: "engagedSessions",
    displayName: "Engaged Sessions (GA4)",
    description:
      "Sessions lasting 10 seconds or longer, having 1+ key events, or 2+ page/screen views.",
    category: "engagement",
    unit: "sessions",
    valueType: "COUNT",
    aggregationRule: "SUM",
    numeratorMetricKey: null,
    denominatorMetricKey: null,
    weightMetricKey: null,
    isAdditiveAcrossDates: true,
    isAdditiveAcrossResources: true,
    supportedDimensions: [
      "date",
      "sessionDefaultChannelGroup",
      "landingPagePlusQueryString",
      "pagePath",
      "deviceCategory",
      "country",
    ],
    supportedGranularities: ["DAILY", "WINDOW_TOTAL"],
    timezoneBehavior: "PROPERTY_LOCAL",
    freshnessWindowMinutes: 240,
    capabilityKey: "analytics_sessions",
    schemaVersion: 1,
  },
  {
    id: "mdef_ga4_engagement_rate_v1",
    canonicalKey: "ga4.engagement_rate",
    providerKey: "ga4",
    providerMetricName: "engagementRate",
    displayName: "Engagement Rate (GA4)",
    description:
      "Session-weighted ratio of engagedSessions divided by sessions (0..1). Never compute as an unweighted average of daily ratios.",
    category: "engagement",
    unit: "ratio",
    valueType: "RATIO",
    aggregationRule: "WEIGHTED_RATIO",
    numeratorMetricKey: "ga4.engaged_sessions",
    denominatorMetricKey: "ga4.sessions",
    weightMetricKey: "ga4.sessions",
    isAdditiveAcrossDates: false,
    isAdditiveAcrossResources: false,
    supportedDimensions: [
      "date",
      "sessionDefaultChannelGroup",
      "landingPagePlusQueryString",
      "pagePath",
      "deviceCategory",
      "country",
    ],
    supportedGranularities: ["DAILY", "WINDOW_TOTAL"],
    timezoneBehavior: "PROPERTY_LOCAL",
    freshnessWindowMinutes: 240,
    capabilityKey: "analytics_sessions",
    schemaVersion: 1,
  },
  {
    id: "mdef_ga4_screen_page_views_v1",
    canonicalKey: "ga4.screen_page_views",
    providerKey: "ga4",
    providerMetricName: "screenPageViews",
    displayName: "Views (GA4)",
    description:
      "Total app screens or web pages viewed by users, including repeated views of a single page/screen.",
    category: "engagement",
    unit: "views",
    valueType: "COUNT",
    aggregationRule: "SUM",
    numeratorMetricKey: null,
    denominatorMetricKey: null,
    weightMetricKey: null,
    isAdditiveAcrossDates: true,
    isAdditiveAcrossResources: true,
    supportedDimensions: [
      "date",
      "sessionDefaultChannelGroup",
      "landingPagePlusQueryString",
      "pagePath",
      "deviceCategory",
      "country",
    ],
    supportedGranularities: ["DAILY", "WINDOW_TOTAL", "REALTIME_SNAPSHOT"],
    timezoneBehavior: "PROPERTY_LOCAL",
    freshnessWindowMinutes: 240,
    capabilityKey: "analytics_sessions",
    schemaVersion: 1,
  },
  {
    id: "mdef_ga4_event_count_v1",
    canonicalKey: "ga4.event_count",
    providerKey: "ga4",
    providerMetricName: "eventCount",
    displayName: "Event Count (GA4)",
    description: "Total count of GA4 events triggered across the property.",
    category: "engagement",
    unit: "events",
    valueType: "COUNT",
    aggregationRule: "SUM",
    numeratorMetricKey: null,
    denominatorMetricKey: null,
    weightMetricKey: null,
    isAdditiveAcrossDates: true,
    isAdditiveAcrossResources: true,
    supportedDimensions: [
      "date",
      "eventName",
      "sessionDefaultChannelGroup",
      "pagePath",
      "deviceCategory",
      "country",
    ],
    supportedGranularities: ["DAILY", "WINDOW_TOTAL", "REALTIME_SNAPSHOT"],
    timezoneBehavior: "PROPERTY_LOCAL",
    freshnessWindowMinutes: 240,
    capabilityKey: "analytics_sessions",
    schemaVersion: 1,
  },
  {
    id: "mdef_ga4_average_session_duration_v1",
    canonicalKey: "ga4.average_session_duration",
    providerKey: "ga4",
    providerMetricName: "averageSessionDuration",
    displayName: "Average Session Duration (GA4)",
    description:
      "Session-weighted average duration in seconds across sessions. Must be weighted by sessions rather than averaging daily averages.",
    category: "engagement",
    unit: "seconds",
    valueType: "DURATION",
    aggregationRule: "WEIGHTED_AVERAGE",
    numeratorMetricKey: null,
    denominatorMetricKey: "ga4.sessions",
    weightMetricKey: "ga4.sessions",
    isAdditiveAcrossDates: false,
    isAdditiveAcrossResources: false,
    supportedDimensions: [
      "date",
      "sessionDefaultChannelGroup",
      "landingPagePlusQueryString",
      "deviceCategory",
      "country",
    ],
    supportedGranularities: ["DAILY", "WINDOW_TOTAL"],
    timezoneBehavior: "PROPERTY_LOCAL",
    freshnessWindowMinutes: 240,
    capabilityKey: "analytics_sessions",
    schemaVersion: 1,
  },
  {
    id: "mdef_ga4_key_events_v1",
    canonicalKey: "ga4.key_events",
    providerKey: "ga4",
    providerMetricName: "keyEvents",
    displayName: "Key Events (GA4)",
    description:
      "Count of events marked as Key Events (conversions) in the GA4 property configuration.",
    category: "engagement",
    unit: "events",
    valueType: "COUNT",
    aggregationRule: "SUM",
    numeratorMetricKey: null,
    denominatorMetricKey: null,
    weightMetricKey: null,
    isAdditiveAcrossDates: true,
    isAdditiveAcrossResources: true,
    supportedDimensions: [
      "date",
      "eventName",
      "sessionDefaultChannelGroup",
      "landingPagePlusQueryString",
      "deviceCategory",
      "country",
    ],
    supportedGranularities: ["DAILY", "WINDOW_TOTAL"],
    timezoneBehavior: "PROPERTY_LOCAL",
    freshnessWindowMinutes: 240,
    capabilityKey: "analytics_sessions",
    schemaVersion: 1,
  },
  {
    id: "mdef_gsc_clicks_v1",
    canonicalKey: "gsc.clicks",
    providerKey: "gsc",
    providerMetricName: "clicks",
    displayName: "Search Clicks (GSC)",
    description:
      "Pre-click Google Search result taps that sent a user outside Google Search. Additive across disjoint dates within the same unsegmented property scope; never equate with GA4 sessions.",
    category: "search",
    unit: "clicks",
    valueType: "COUNT",
    aggregationRule: "SUM",
    numeratorMetricKey: null,
    denominatorMetricKey: null,
    weightMetricKey: null,
    isAdditiveAcrossDates: true,
    isAdditiveAcrossResources: false,
    supportedDimensions: [
      "date",
      "query",
      "page",
      "country",
      "device",
      "searchAppearance",
      "searchType",
    ],
    supportedGranularities: ["DAILY", "WINDOW_TOTAL"],
    timezoneBehavior: "PACIFIC_TIME_FIXED",
    freshnessWindowMinutes: 1440,
    capabilityKey: "search_queries",
    schemaVersion: 1,
  },
  {
    id: "mdef_gsc_impressions_v1",
    canonicalKey: "gsc.impressions",
    providerKey: "gsc",
    providerMetricName: "impressions",
    displayName: "Search Impressions (GSC)",
    description:
      "Count of times a link to the site appeared in Google Search results seen by a user. Additive across disjoint dates when unsegmented scope aligns.",
    category: "search",
    unit: "impressions",
    valueType: "COUNT",
    aggregationRule: "SUM",
    numeratorMetricKey: null,
    denominatorMetricKey: null,
    weightMetricKey: null,
    isAdditiveAcrossDates: true,
    isAdditiveAcrossResources: false,
    supportedDimensions: [
      "date",
      "query",
      "page",
      "country",
      "device",
      "searchAppearance",
      "searchType",
    ],
    supportedGranularities: ["DAILY", "WINDOW_TOTAL"],
    timezoneBehavior: "PACIFIC_TIME_FIXED",
    freshnessWindowMinutes: 1440,
    capabilityKey: "search_queries",
    schemaVersion: 1,
  },
  {
    id: "mdef_gsc_ctr_v1",
    canonicalKey: "gsc.ctr",
    providerKey: "gsc",
    providerMetricName: "ctr",
    displayName: "Click-Through Rate (GSC)",
    description:
      "Impression-weighted click-through ratio (clicks / impressions, 0..1). Must always be derived from total clicks divided by total impressions.",
    category: "search",
    unit: "ratio",
    valueType: "RATIO",
    aggregationRule: "WEIGHTED_RATIO",
    numeratorMetricKey: "gsc.clicks",
    denominatorMetricKey: "gsc.impressions",
    weightMetricKey: "gsc.impressions",
    isAdditiveAcrossDates: false,
    isAdditiveAcrossResources: false,
    supportedDimensions: [
      "date",
      "query",
      "page",
      "country",
      "device",
      "searchAppearance",
      "searchType",
    ],
    supportedGranularities: ["DAILY", "WINDOW_TOTAL"],
    timezoneBehavior: "PACIFIC_TIME_FIXED",
    freshnessWindowMinutes: 1440,
    capabilityKey: "search_queries",
    schemaVersion: 1,
  },
  {
    id: "mdef_gsc_average_position_v1",
    canonicalKey: "gsc.average_position",
    providerKey: "gsc",
    providerMetricName: "position",
    displayName: "Average Position (GSC)",
    description:
      "Impression-weighted average topmost ranking position in Google Search results (1.0 is top rank). Weighted by impressions across periods.",
    category: "search",
    unit: "rank",
    valueType: "POSITION",
    aggregationRule: "WEIGHTED_AVERAGE",
    numeratorMetricKey: null,
    denominatorMetricKey: "gsc.impressions",
    weightMetricKey: "gsc.impressions",
    isAdditiveAcrossDates: false,
    isAdditiveAcrossResources: false,
    supportedDimensions: [
      "date",
      "query",
      "page",
      "country",
      "device",
      "searchAppearance",
      "searchType",
    ],
    supportedGranularities: ["DAILY", "WINDOW_TOTAL"],
    timezoneBehavior: "PACIFIC_TIME_FIXED",
    freshnessWindowMinutes: 1440,
    capabilityKey: "search_queries",
    schemaVersion: 1,
  },
  {
    id: "mdef_gcp_billing_gross_cost_v1",
    canonicalKey: "gcp_billing.gross_cost",
    providerKey: "gcp-billing",
    providerMetricName: "gross_cost",
    displayName: "Gross Cloud Cost (Before Credits)",
    description:
      "Google Cloud usage cost before promotional, sustained-use, committed-use, or free-tier credits from BigQuery Cloud Billing Export.",
    category: "cost",
    unit: "currency",
    valueType: "CURRENCY",
    aggregationRule: "SUM",
    numeratorMetricKey: null,
    denominatorMetricKey: null,
    weightMetricKey: null,
    isAdditiveAcrossDates: true,
    isAdditiveAcrossResources: true,
    supportedDimensions: [
      "date",
      "service",
      "sku",
      "project",
      "region",
      "currency",
      "invoiceMonth",
      "costType",
    ],
    supportedGranularities: ["DAILY", "MONTHLY", "WINDOW_TOTAL"],
    timezoneBehavior: "BILLING_ACCOUNT_LOCAL",
    freshnessWindowMinutes: 720,
    capabilityKey: "billing_cost_export",
    schemaVersion: 1,
  },
  {
    id: "mdef_gcp_billing_credits_v1",
    canonicalKey: "gcp_billing.credits",
    providerKey: "gcp-billing",
    providerMetricName: "credits",
    displayName: "Cloud Billing Credits & Discounts",
    description:
      "Total applied Google Cloud credits (sustained-use discounts, committed-use discounts, free tier, promotions) from BigQuery Cloud Billing Export.",
    category: "cost",
    unit: "currency",
    valueType: "CURRENCY",
    aggregationRule: "SUM",
    numeratorMetricKey: null,
    denominatorMetricKey: null,
    weightMetricKey: null,
    isAdditiveAcrossDates: true,
    isAdditiveAcrossResources: true,
    supportedDimensions: [
      "date",
      "service",
      "sku",
      "project",
      "region",
      "currency",
      "invoiceMonth",
      "creditType",
    ],
    supportedGranularities: ["DAILY", "MONTHLY", "WINDOW_TOTAL"],
    timezoneBehavior: "BILLING_ACCOUNT_LOCAL",
    freshnessWindowMinutes: 720,
    capabilityKey: "billing_cost_export",
    schemaVersion: 1,
  },
  {
    id: "mdef_gcp_billing_net_cost_v1",
    canonicalKey: "gcp_billing.net_cost",
    providerKey: "gcp-billing",
    providerMetricName: "net_cost",
    displayName: "Net Cloud Cost (After Credits)",
    description:
      "Actual net Google Cloud spend after subtracting applicable usage credits and discounts (cost + credits.amount) from BigQuery Cloud Billing Export.",
    category: "cost",
    unit: "currency",
    valueType: "CURRENCY",
    aggregationRule: "SUM",
    numeratorMetricKey: null,
    denominatorMetricKey: null,
    weightMetricKey: null,
    isAdditiveAcrossDates: true,
    isAdditiveAcrossResources: true,
    supportedDimensions: [
      "date",
      "service",
      "sku",
      "project",
      "region",
      "currency",
      "invoiceMonth",
      "costType",
    ],
    supportedGranularities: ["DAILY", "MONTHLY", "WINDOW_TOTAL"],
    timezoneBehavior: "BILLING_ACCOUNT_LOCAL",
    freshnessWindowMinutes: 720,
    capabilityKey: "billing_cost_export",
    schemaVersion: 1,
  },
] as const;

const BY_CANONICAL_KEY = new Map<string, CanonicalMetricDefinition>(
  CANONICAL_METRIC_DEFINITIONS.map((def) => [def.canonicalKey, def]),
);

const BY_PROVIDER_METRIC = new Map<string, CanonicalMetricDefinition>(
  CANONICAL_METRIC_DEFINITIONS.map((def) => [`${def.providerKey}:${def.providerMetricName}`, def]),
);

export function getCanonicalMetricDefinition(canonicalKey: string): CanonicalMetricDefinition {
  const def = BY_CANONICAL_KEY.get(canonicalKey);
  if (!def) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Unknown canonical metric key "${canonicalKey}".`,
    });
  }
  return def;
}

export function findCanonicalMetricDefinition(
  canonicalKey: string,
): CanonicalMetricDefinition | null {
  return BY_CANONICAL_KEY.get(canonicalKey) ?? null;
}

export function resolveCanonicalMetricByProviderName(
  providerKey: string,
  providerMetricName: string,
): CanonicalMetricDefinition {
  const def = BY_PROVIDER_METRIC.get(`${providerKey}:${providerMetricName}`);
  if (!def) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Unsupported metric "${providerMetricName}" for provider "${providerKey}".`,
    });
  }
  return def;
}

export function listCanonicalMetricDefinitions(options?: {
  providerKey?: string;
  category?: MetricCategory;
}): CanonicalMetricDefinition[] {
  return CANONICAL_METRIC_DEFINITIONS.filter((def) => {
    if (options?.providerKey && def.providerKey !== options.providerKey) {
      return false;
    }
    if (options?.category && def.category !== options.category) {
      return false;
    }
    return true;
  });
}

const CANONICAL_KEY_RE = /^[a-z0-9_]+\.[a-z0-9_]+$/;

export function validateMetricDefinitionInput(input: {
  id: string;
  canonicalKey: string;
  providerKey: string;
  providerMetricName: string;
  displayName: string;
  description: string;
  category: string;
  unit: string;
  valueType: string;
  aggregationRule: string;
  numeratorMetricKey?: string | null;
  denominatorMetricKey?: string | null;
  weightMetricKey?: string | null;
  isAdditiveAcrossDates?: boolean;
  isAdditiveAcrossResources?: boolean;
  supportedDimensions?: readonly string[];
  supportedGranularities?: readonly string[];
  timezoneBehavior: string;
  freshnessWindowMinutes: number;
  capabilityKey: string;
  schemaVersion?: number;
}): CanonicalMetricDefinition {
  if (!CANONICAL_KEY_RE.test(input.canonicalKey)) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Invalid canonical metric key "${input.canonicalKey}". Expected "<provider>.<metric_name>".`,
    });
  }
  if (!METRIC_VALUE_TYPES.includes(input.valueType as MetricValueType)) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Invalid metric valueType "${input.valueType}".`,
    });
  }
  if (!METRIC_AGGREGATION_RULES.includes(input.aggregationRule as MetricAggregationRule)) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Invalid metric aggregationRule "${input.aggregationRule}".`,
    });
  }
  if (!METRIC_CATEGORIES.includes(input.category as MetricCategory)) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Invalid metric category "${input.category}".`,
    });
  }
  if (!METRIC_TIMEZONE_BEHAVIORS.includes(input.timezoneBehavior as MetricTimezoneBehavior)) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Invalid metric timezoneBehavior "${input.timezoneBehavior}".`,
    });
  }
  if (
    input.valueType === "DISTINCT_COUNT" &&
    (input.isAdditiveAcrossDates || input.isAdditiveAcrossResources)
  ) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `DISTINCT_COUNT metric "${input.canonicalKey}" cannot be marked additive across dates or resources.`,
    });
  }
  if (
    input.aggregationRule === "WEIGHTED_RATIO" &&
    (!input.numeratorMetricKey || !input.denominatorMetricKey)
  ) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `WEIGHTED_RATIO metric "${input.canonicalKey}" requires both numeratorMetricKey and denominatorMetricKey.`,
    });
  }
  const granularities = (input.supportedGranularities ?? ["DAILY"]).map((g) => {
    if (!METRIC_GRANULARITIES.includes(g as MetricGranularity)) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Unsupported metric granularity "${g}".`,
      });
    }
    return g as MetricGranularity;
  });

  return {
    id: input.id.trim(),
    canonicalKey: input.canonicalKey.trim(),
    providerKey: input.providerKey.trim(),
    providerMetricName: input.providerMetricName.trim(),
    displayName: input.displayName.trim(),
    description: input.description.trim(),
    category: input.category as MetricCategory,
    unit: input.unit.trim(),
    valueType: input.valueType as MetricValueType,
    aggregationRule: input.aggregationRule as MetricAggregationRule,
    numeratorMetricKey: input.numeratorMetricKey ?? null,
    denominatorMetricKey: input.denominatorMetricKey ?? null,
    weightMetricKey: input.weightMetricKey ?? null,
    isAdditiveAcrossDates: Boolean(input.isAdditiveAcrossDates),
    isAdditiveAcrossResources: Boolean(input.isAdditiveAcrossResources),
    supportedDimensions: [...(input.supportedDimensions ?? [])],
    supportedGranularities: granularities,
    timezoneBehavior: input.timezoneBehavior as MetricTimezoneBehavior,
    freshnessWindowMinutes: Math.max(1, Math.trunc(input.freshnessWindowMinutes)),
    capabilityKey: input.capabilityKey.trim(),
    schemaVersion: Math.max(1, Math.trunc(input.schemaVersion ?? 1)),
  };
}
