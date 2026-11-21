export const CLOUDFLARE_PROVIDER_KEY = "cloudflare" as const;
export const CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4" as const;

export const CLOUDFLARE_CANONICAL_METRIC_KEYS = {
  EDGE_REQUESTS: "cloudflare.edge_requests",
  CACHED_REQUESTS: "cloudflare.cached_requests",
  CACHE_HIT_RATIO: "cloudflare.cache_hit_ratio",
  BANDWIDTH_BYTES: "cloudflare.bandwidth_bytes",
  CACHED_BANDWIDTH_BYTES: "cloudflare.cached_bandwidth_bytes",
  THREATS_BLOCKED: "cloudflare.threats_blocked",
  HTTP_4XX_RESPONSES: "cloudflare.http_4xx_responses",
  HTTP_5XX_RESPONSES: "cloudflare.http_5xx_responses",
  HTTP_5XX_ERROR_RATE: "cloudflare.http_5xx_error_rate",
} as const;

export type CloudflareCanonicalMetricKey =
  (typeof CLOUDFLARE_CANONICAL_METRIC_KEYS)[keyof typeof CLOUDFLARE_CANONICAL_METRIC_KEYS];

export interface CloudflareZoneRecord {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly planName: string;
  readonly accountId: string;
  readonly accountName: string;
}

export interface CloudflareZoneAnalyticsGroup {
  readonly dateIso: string;
  readonly totalRequests: number;
  readonly cachedRequests: number;
  readonly cacheHitRatio: number | null;
  readonly totalBytes: number;
  readonly cachedBytes: number;
  readonly threatsBlocked: number;
  readonly http4xxResponses: number;
  readonly http5xxResponses: number;
  readonly http5xxErrorRate: number | null;
}
