export const SENTRY_PROVIDER_KEY = "sentry" as const;
export const SENTRY_DEFAULT_BASE_URL = "https://sentry.io" as const;

export const SENTRY_CANONICAL_METRIC_KEYS = {
  ERROR_EVENTS_TOTAL: "sentry.error_events_total",
  UNRESOLVED_ISSUES_COUNT: "sentry.unresolved_issues_count",
  CRASH_FREE_SESSION_RATE: "sentry.crash_free_session_rate",
  TRANSACTION_P50_MS: "sentry.transaction_p50_ms",
  TRANSACTION_P95_MS: "sentry.transaction_p95_ms",
  TRANSACTION_THROUGHPUT: "sentry.transaction_throughput",
} as const;

export type SentryCanonicalMetricKey =
  (typeof SENTRY_CANONICAL_METRIC_KEYS)[keyof typeof SENTRY_CANONICAL_METRIC_KEYS];

export interface SentryProjectRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly organizationSlug: string;
  readonly platform: string | null;
  readonly environments: readonly string[];
}

export interface SentrySanitizedIssueSummary {
  readonly id: string;
  readonly shortId: string;
  readonly sanitizedTitle: string;
  readonly level: "fatal" | "error" | "warning" | "info" | "unknown";
  readonly status: "unresolved" | "resolved" | "ignored";
  /** Count of error events, strictly distinct from unique affected users. */
  readonly errorEventCount: number;
  readonly firstSeenIso: string;
  readonly lastSeenIso: string;
  readonly releaseVersion: string | null;
  readonly environment: string;
  readonly verifiedPermalink: string | null;
}

export interface SentryPerformanceSnapshot {
  readonly projectSlug: string;
  readonly environment: string;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly throughput: number | null;
  readonly crashFreeSessionRate: number | null;
  readonly sampled: boolean;
  readonly sampleRate: number | null;
  readonly windowStartIso: string;
  readonly windowEndIso: string;
}
