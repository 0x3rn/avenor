import { PROVIDER_ERROR_CODES, ProviderAdapterError } from "@avenor/types";
import type { Ga4DimensionDictionaryEntry, Ga4MetricDictionaryEntry } from "./types";

/**
 * Canonical Avenor GA4 Metric Dictionary aligned with Google Analytics Data API v1beta.
 * Preserves exact API identifiers, aggregation constraints, and provenance caveats so
 * Avenor never confuses GA4 users/sessions with Search Console clicks or averages ratios naively.
 */
export const GA4_METRIC_DICTIONARY: Readonly<Record<string, Ga4MetricDictionaryEntry>> = {
  activeUsers: {
    apiName: "activeUsers",
    avenorKey: "activeUsers",
    label: "Active Users",
    description: "Distinct users who had an engaged session or logged engagement telemetry.",
    unit: "users",
    aggregationRule: "non_additive_across_properties",
    crossPropertySummable: false,
    caveat:
      "Distinct user counts are deduplicated per GA4 property only; never sum activeUsers across distinct properties.",
  },
  totalUsers: {
    apiName: "totalUsers",
    avenorKey: "totalUsers",
    label: "Total Users",
    description: "Total distinct users who logged at least one event during the reporting window.",
    unit: "users",
    aggregationRule: "non_additive_across_properties",
    crossPropertySummable: false,
    caveat: "Deduplicated only inside a single GA4 property.",
  },
  newUsers: {
    apiName: "newUsers",
    avenorKey: "newUsers",
    label: "New Users",
    description: "Users interacting with your property for the first time during the date range.",
    unit: "users",
    aggregationRule: "non_additive_across_properties",
    crossPropertySummable: false,
    caveat:
      "Based on first_open / first_visit signals; affected by cookie retention & thresholding.",
  },
  sessions: {
    apiName: "sessions",
    avenorKey: "sessions",
    label: "Sessions",
    description: "GA4 session_start visits grouped within session timeout windows.",
    unit: "sessions",
    aggregationRule: "sum",
    crossPropertySummable: false,
    caveat:
      "GA4 sessions measure site visits and NEVER equal Google Search Console organic search clicks.",
  },
  engagedSessions: {
    apiName: "engagedSessions",
    avenorKey: "engagedSessions",
    label: "Engaged Sessions",
    description:
      "Sessions lasting >= 10 seconds, having a key event (conversion), or having >= 2 page/screen views.",
    unit: "sessions",
    aggregationRule: "sum",
    crossPropertySummable: false,
    caveat: "Definition depends on property engaged-session timer configuration.",
  },
  engagementRate: {
    apiName: "engagementRate",
    avenorKey: "engagementRate",
    label: "Engagement Rate",
    description: "Ratio of engagedSessions divided by total sessions (0.0 to 1.0).",
    unit: "ratio",
    aggregationRule: "weighted_ratio",
    crossPropertySummable: false,
    caveat:
      "Must always be weighted by sessions (engagedSessions / sessions), never averaged across rows.",
  },
  screenPageViews: {
    apiName: "screenPageViews",
    avenorKey: "screenPageViews",
    label: "Views (Page & Screen)",
    description: "Total app screens or web pages viewed, including repeated views of a single URL.",
    unit: "views",
    aggregationRule: "sum",
    crossPropertySummable: false,
    caveat: "Scoped to mapped property measurement streams.",
  },
  eventCount: {
    apiName: "eventCount",
    avenorKey: "eventCount",
    label: "Event Count",
    description: "Total events recorded during the period across all enabled streams.",
    unit: "events",
    aggregationRule: "sum",
    crossPropertySummable: false,
    caveat: "Includes automatically collected, enhanced measurement, and custom events.",
  },
  averageSessionDuration: {
    apiName: "averageSessionDuration",
    avenorKey: "averageSessionDuration",
    label: "Avg. Session Duration",
    description: "Mean duration in seconds of sessions on the mapped GA4 property.",
    unit: "seconds",
    aggregationRule: "weighted_ratio",
    crossPropertySummable: false,
    caveat: "Weight across breakdowns by session count rather than averaging row means.",
  },
  keyEvents: {
    apiName: "keyEvents",
    avenorKey: "keyEvents",
    label: "Key Events (Conversions)",
    description: "Count of events marked as Key Events (formerly Conversions) in GA4 Admin.",
    unit: "events",
    aggregationRule: "sum",
    crossPropertySummable: false,
    caveat:
      "Counts only events explicitly marked as Key Events in Google Analytics; zero means 0 triggered conversions, while null means conversion definitions or permission were unavailable.",
  },
};

export const GA4_DIMENSION_DICTIONARY: Readonly<Record<string, Ga4DimensionDictionaryEntry>> = {
  date: {
    apiName: "date",
    avenorKey: "date",
    label: "Date (Property Timezone)",
    description:
      "Calendar date formatted as YYYYMMDD by GA4 Data API in the property's configured timezone.",
    realtimeSupported: false,
    standardSupported: true,
  },
  country: {
    apiName: "country",
    avenorKey: "country",
    label: "Country",
    description: "Country inferred from session IP geolocation.",
    realtimeSupported: true,
    standardSupported: true,
  },
  city: {
    apiName: "city",
    avenorKey: "city",
    label: "City",
    description: "City inferred from session IP geolocation (subject to Google thresholding).",
    realtimeSupported: true,
    standardSupported: true,
  },
  deviceCategory: {
    apiName: "deviceCategory",
    avenorKey: "deviceCategory",
    label: "Device Category",
    description: "desktop, mobile, or tablet classification.",
    realtimeSupported: true,
    standardSupported: true,
  },
  platform: {
    apiName: "platform",
    avenorKey: "platform",
    label: "Platform",
    description: "web, iOS, or Android data stream platform.",
    realtimeSupported: true,
    standardSupported: true,
  },
  sessionDefaultChannelGroup: {
    apiName: "sessionDefaultChannelGroup",
    avenorKey: "sessionDefaultChannelGroup",
    label: "Session Default Channel Group",
    description: "GA4 acquisition channel (Organic Search, Direct, Paid Search, Referral, etc.).",
    realtimeSupported: false,
    standardSupported: true,
  },
  sessionSourceMedium: {
    apiName: "sessionSourceMedium",
    avenorKey: "sessionSourceMedium",
    label: "Session Source / Medium",
    description: "Attribution pair for the session (e.g., google / organic).",
    realtimeSupported: false,
    standardSupported: true,
  },
  landingPage: {
    apiName: "landingPage",
    avenorKey: "landingPage",
    label: "Landing Page",
    description: "Page path associated with the start of a session.",
    realtimeSupported: false,
    standardSupported: true,
  },
  pagePath: {
    apiName: "pagePath",
    avenorKey: "pagePath",
    label: "Page Path",
    description: "URL path without host or query string.",
    realtimeSupported: false,
    standardSupported: true,
  },
  pageTitle: {
    apiName: "pageTitle",
    avenorKey: "pageTitle",
    label: "Page Title",
    description: "Document title associated with the page view.",
    realtimeSupported: false,
    standardSupported: true,
  },
  eventName: {
    apiName: "eventName",
    avenorKey: "eventName",
    label: "Event Name",
    description: "Recorded GA4 event identifier.",
    realtimeSupported: true,
    standardSupported: true,
  },
  unifiedScreenName: {
    apiName: "unifiedScreenName",
    avenorKey: "unifiedScreenName",
    label: "Screen / Page Title (Realtime)",
    description: "Supported screen/page title dimension exclusive to GA4 Realtime API.",
    realtimeSupported: true,
    standardSupported: false,
  },
  minutesAgo: {
    apiName: "minutesAgo",
    avenorKey: "minutesAgo",
    label: "Minutes Ago (00–29)",
    description: "Supported minute-offset dimension exclusive to GA4 Realtime API.",
    realtimeSupported: true,
    standardSupported: false,
  },
};

export const GA4_STANDARD_ALLOWED_METRICS = new Set(Object.keys(GA4_METRIC_DICTIONARY));
export const GA4_STANDARD_ALLOWED_DIMENSIONS = new Set(
  Object.values(GA4_DIMENSION_DICTIONARY)
    .filter((d) => d.standardSupported)
    .map((d) => d.apiName),
);

export const GA4_REALTIME_ALLOWED_METRICS = new Set([
  "activeUsers",
  "screenPageViews",
  "eventCount",
]);
export const GA4_REALTIME_ALLOWED_DIMENSIONS = new Set(
  Object.values(GA4_DIMENSION_DICTIONARY)
    .filter((d) => d.realtimeSupported)
    .map((d) => d.apiName),
);

/**
 * Resolves an Avenor metric key to its canonical GA4 Data API metric descriptor.
 */
export function resolveGa4MetricDefinition(metricKey: string): Ga4MetricDictionaryEntry {
  const entry = GA4_METRIC_DICTIONARY[metricKey];
  if (!entry) {
    throw new ProviderAdapterError({
      providerKey: "ga4",
      code: PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY,
      message: `Unsupported GA4 standard metric "${metricKey}". Supported metrics: ${Object.keys(GA4_METRIC_DICTIONARY).join(", ")}.`,
    });
  }
  return entry;
}

/**
 * Validates standard GA4 Data API metrics, dimensions, and ISO YYYY-MM-DD date ranges.
 * Rejects Realtime-only dimensions in Standard Data API and enforces chronological dates.
 */
export function validateGa4StandardQueryInputs(options: {
  startDate: string;
  endDate: string;
  metrics: readonly string[];
  dimensions?: readonly string[];
}): void {
  const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoPattern.test(options.startDate) || !isoPattern.test(options.endDate)) {
    throw new ProviderAdapterError({
      providerKey: "ga4",
      code: PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY,
      message: `Invalid GA4 date range "${options.startDate}" to "${options.endDate}". Expected ISO YYYY-MM-DD.`,
    });
  }
  if (options.startDate > options.endDate) {
    throw new ProviderAdapterError({
      providerKey: "ga4",
      code: PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY,
      message: `Invalid GA4 date range: startDate (${options.startDate}) cannot be after endDate (${options.endDate}).`,
    });
  }

  for (const metric of options.metrics) {
    if (!GA4_STANDARD_ALLOWED_METRICS.has(metric)) {
      throw new ProviderAdapterError({
        providerKey: "ga4",
        code: PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY,
        message: `Metric "${metric}" is not part of Avenor's GA4 Standard Reporting dictionary.`,
      });
    }
  }

  for (const dim of options.dimensions ?? []) {
    if (!GA4_STANDARD_ALLOWED_DIMENSIONS.has(dim)) {
      const dimEntry = GA4_DIMENSION_DICTIONARY[dim];
      const hint = dimEntry?.realtimeSupported
        ? ` Dimension "${dim}" is exclusive to GA4 Realtime API and cannot be queried in historical reports.`
        : "";
      throw new ProviderAdapterError({
        providerKey: "ga4",
        code: PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY,
        message: `Unsupported GA4 standard dimension "${dim}".${hint}`,
      });
    }
  }
}

/**
 * Validates GA4 Realtime Data API metrics & dimensions cleanly.
 * Explicitly blocks historical-only dimensions such as `sessionDefaultChannelGroup`, `date`, or `landingPage`.
 */
export function validateGa4RealtimeQueryInputs(options: {
  metrics: readonly string[];
  dimensions?: readonly string[];
}): void {
  for (const metric of options.metrics) {
    if (!GA4_REALTIME_ALLOWED_METRICS.has(metric)) {
      throw new ProviderAdapterError({
        providerKey: "ga4",
        code: PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY,
        message: `Metric "${metric}" is not supported by GA4 Realtime API. Supported realtime metrics: ${Array.from(GA4_REALTIME_ALLOWED_METRICS).join(", ")}.`,
      });
    }
  }

  for (const dim of options.dimensions ?? []) {
    if (!GA4_REALTIME_ALLOWED_DIMENSIONS.has(dim)) {
      throw new ProviderAdapterError({
        providerKey: "ga4",
        code: PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY,
        message: `Dimension "${dim}" is incompatible with GA4 Realtime API. Supported realtime dimensions: ${Array.from(GA4_REALTIME_ALLOWED_DIMENSIONS).join(", ")}.`,
      });
    }
  }
}

export function formatGa4DateValue(rawDate: string): string {
  const trimmed = rawDate.trim();
  if (/^\d{8}$/.test(trimmed)) {
    return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
  }
  return trimmed;
}

/**
 * Parses numeric metric strings from GA4 Data API v1beta without coercing missing slots to 0.
 * Returns numeric `0` ONLY when upstream explicitly returned `"0"` / `"0.0"`.
 */
export function parseGa4MetricNumber(rawValue: string | null | undefined): number | null {
  if (rawValue === undefined || rawValue === null) {
    return null;
  }
  const trimmed = String(rawValue).trim();
  if (trimmed === "") {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
