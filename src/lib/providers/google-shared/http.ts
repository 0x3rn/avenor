import { resolveGoogleApiMode } from "@avenor/config";
import {
  AppError,
  ERROR_CODES,
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  redactSensitiveText,
} from "@avenor/types";

export const GOOGLE_ANALYTICS_ADMIN_BASE = "https://analyticsadmin.googleapis.com/v1beta";
export const GOOGLE_ANALYTICS_DATA_BASE = "https://analyticsdata.googleapis.com/v1beta";
export const GOOGLE_SEARCH_CONSOLE_V3_BASE = "https://www.googleapis.com/webmasters/v3";
export const GOOGLE_CLOUD_BILLING_V1_BASE = "https://cloudbilling.googleapis.com/v1";
export const GOOGLE_BIGQUERY_V2_BASE = "https://bigquery.googleapis.com/bigquery/v2";
export const GOOGLE_CLOUD_MONITORING_V3_BASE = "https://monitoring.googleapis.com/v3";

const ALLOWED_POST_SUFFIXES = [
  ":runReport",
  ":batchRunReports",
  ":runRealtimeReport",
  ":checkCompatibility",
  "/searchAnalytics/query",
  "/queries",
] as const;

export function isGoogleSandboxToken(accessToken: string | undefined): boolean {
  return Boolean(
    accessToken && (accessToken.startsWith("sbx_") || accessToken.startsWith("avn_ro_")),
  );
}

/**
 * Determines whether a Google adapter call must hit the live Google REST API
 * versus deterministic local/sandbox simulation.
 */
export function shouldExecuteLiveGoogleApi(
  context: {
    accessToken?: string;
    simulationScenario?: string;
  },
  hasInjectedFetch = false,
  providerKey = "ga4",
): boolean {
  if (hasInjectedFetch) {
    return true;
  }

  if (context.simulationScenario) {
    return false;
  }

  const mode = resolveGoogleApiMode();
  if (mode === "live") {
    if (!context.accessToken || isGoogleSandboxToken(context.accessToken)) {
      throw new ProviderAdapterError({
        providerKey,
        code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
        message:
          "GOOGLE_API_MODE is set to 'live', but the connection holds a sandbox credential rather than a real Google OAuth grant.",
      });
    }
    return true;
  }

  if (!context.accessToken || isGoogleSandboxToken(context.accessToken)) {
    return false;
  }

  return true;
}

/**
 * Compile-and-runtime read-only allowlist for Google REST URLs & verbs.
 * Blocks all create/patch/delete/mutate admin or Search Console endpoints.
 */
export function assertAllowedGoogleReadEndpoint(rawUrl: string, method: "GET" | "POST"): URL {
  const parsed = new URL(rawUrl);
  const full = parsed.toString();

  const allowedOrigin =
    full.startsWith(`${GOOGLE_ANALYTICS_ADMIN_BASE}/`) ||
    full.startsWith(`${GOOGLE_ANALYTICS_DATA_BASE}/`) ||
    full.startsWith(`${GOOGLE_SEARCH_CONSOLE_V3_BASE}/`) ||
    full.startsWith(`${GOOGLE_CLOUD_BILLING_V1_BASE}/`) ||
    full.startsWith(`${GOOGLE_BIGQUERY_V2_BASE}/`) ||
    full.startsWith(`${GOOGLE_CLOUD_MONITORING_V3_BASE}/`);

  if (!allowedOrigin) {
    throw new AppError({
      code: ERROR_CODES.PRODUCTION_SAFETY_VIOLATION,
      message: `Blocked non-allowlisted Google endpoint origin: ${parsed.origin}${parsed.pathname}`,
    });
  }

  if (method === "GET") {
    if (
      full.startsWith(`${GOOGLE_ANALYTICS_DATA_BASE}/`) &&
      !parsed.pathname.endsWith("/metadata")
    ) {
      throw new AppError({
        code: ERROR_CODES.PRODUCTION_SAFETY_VIOLATION,
        message: `Blocked unapproved Google GET endpoint path: ${parsed.pathname}`,
      });
    }
    if (full.startsWith(`${GOOGLE_CLOUD_MONITORING_V3_BASE}/`)) {
      const allowedMonitoringGet =
        /^\/v3\/projects\/[A-Za-z0-9._-]+\/(metricDescriptors|monitoredResourceDescriptors|timeSeries)$/.test(
          parsed.pathname,
        );
      if (!allowedMonitoringGet) {
        throw new AppError({
          code: ERROR_CODES.PRODUCTION_SAFETY_VIOLATION,
          message: `Blocked unapproved Cloud Monitoring GET path: ${parsed.pathname}`,
        });
      }
    }
    return parsed;
  }

  if (full.startsWith(`${GOOGLE_CLOUD_BILLING_V1_BASE}/`)) {
    throw new AppError({
      code: ERROR_CODES.PRODUCTION_SAFETY_VIOLATION,
      message: `Blocked Cloud Billing POST endpoint "${parsed.pathname}". Cloud Billing metadata access is strictly GET-only.`,
    });
  }

  if (full.startsWith(`${GOOGLE_CLOUD_MONITORING_V3_BASE}/`)) {
    throw new AppError({
      code: ERROR_CODES.PRODUCTION_SAFETY_VIOLATION,
      message: `Blocked Cloud Monitoring POST endpoint "${parsed.pathname}". Cloud Monitoring telemetry access is strictly GET-only.`,
    });
  }

  const isAllowedQueryPost = ALLOWED_POST_SUFFIXES.some((suffix) =>
    parsed.pathname.endsWith(suffix),
  );
  if (!isAllowedQueryPost) {
    throw new AppError({
      code: ERROR_CODES.PRODUCTION_SAFETY_VIOLATION,
      message: `Blocked Google POST mutation path "${parsed.pathname}". Only documented read-only reporting query RPCs are permitted.`,
    });
  }

  return parsed;
}

interface GoogleErrorDetail {
  "@type"?: string;
  reason?: string;
  domain?: string;
  metadata?: Record<string, string>;
}

interface GoogleApiErrorEnvelope {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: GoogleErrorDetail[];
  };
}

function parseRetryAfterMs(headers: Headers, fallbackMs: number, maxDelayMs: number): number {
  const raw = headers.get("retry-after");
  if (!raw) {
    return Math.min(fallbackMs, maxDelayMs);
  }
  const asSeconds = Number(raw);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.min(Math.max(50, Math.round(asSeconds * 1000)), maxDelayMs);
  }
  return Math.min(fallbackMs, maxDelayMs);
}

function normalizeGoogleApiError(options: {
  providerKey: string;
  status: number;
  rawBody: string;
  headers: Headers;
}): ProviderAdapterError {
  let envelope: GoogleApiErrorEnvelope = {};
  try {
    envelope = JSON.parse(options.rawBody) as GoogleApiErrorEnvelope;
  } catch {
    envelope = {};
  }

  const errorObj = envelope.error;
  const reasons = (errorObj?.details ?? []).map((d) => d.reason ?? "").filter((r) => r.length > 0);
  const googleStatus = (errorObj?.status ?? "").toUpperCase();
  const safeMessage = redactSensitiveText(
    errorObj?.message ?? `Google API responded with HTTP ${options.status}.`,
  );

  if (options.status === 401 || googleStatus === "UNAUTHENTICATED") {
    return new ProviderAdapterError({
      providerKey: options.providerKey,
      code: PROVIDER_ERROR_CODES.CREDENTIAL_EXPIRED,
      retryable: false,
      message: `Google OAuth access token expired or invalid (${safeMessage}). Re-authorization or token refresh required.`,
    });
  }

  if (
    reasons.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
    safeMessage.toLowerCase().includes("insufficient authentication scopes")
  ) {
    return new ProviderAdapterError({
      providerKey: options.providerKey,
      code: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
      retryable: false,
      message: `Google OAuth token lacks the required read-only scope (${safeMessage}).`,
    });
  }

  if (
    reasons.includes("SERVICE_DISABLED") ||
    safeMessage.toLowerCase().includes("has not been used in project") ||
    safeMessage.toLowerCase().includes("is disabled")
  ) {
    return new ProviderAdapterError({
      providerKey: options.providerKey,
      code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
      retryable: false,
      message: `Required Google API is disabled on the Google Cloud OAuth project: ${safeMessage}`,
    });
  }

  if (options.status === 403 || googleStatus === "PERMISSION_DENIED") {
    return new ProviderAdapterError({
      providerKey: options.providerKey,
      code: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
      retryable: false,
      message: `Google account lacks permission to inspect the requested property or resource: ${safeMessage}`,
    });
  }

  if (
    options.status === 429 ||
    googleStatus === "RESOURCE_EXHAUSTED" ||
    reasons.includes("RATE_LIMIT_EXCEEDED") ||
    reasons.includes("QUOTA_EXCEEDED")
  ) {
    return new ProviderAdapterError({
      providerKey: options.providerKey,
      code: PROVIDER_ERROR_CODES.RATE_LIMITED,
      retryable: true,
      retryAfterSeconds: Math.ceil(parseRetryAfterMs(options.headers, 1000, 60_000) / 1000),
      message: `Google API quota or rate limit exceeded (${safeMessage}).`,
    });
  }

  if (options.status === 404) {
    return new ProviderAdapterError({
      providerKey: options.providerKey,
      code: PROVIDER_ERROR_CODES.RESOURCE_NOT_FOUND,
      retryable: false,
      message: `Requested Google property or resource was not found (${safeMessage}).`,
    });
  }

  if (options.status === 400 || googleStatus === "INVALID_ARGUMENT") {
    return new ProviderAdapterError({
      providerKey: options.providerKey,
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      retryable: false,
      message: `Google API rejected request parameters (${safeMessage}).`,
    });
  }

  return new ProviderAdapterError({
    providerKey: options.providerKey,
    code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
    retryable: options.status >= 500,
    message: `Google API temporarily unavailable (${safeMessage}).`,
  });
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface GoogleReadRequestOptions {
  providerKey: string;
  url: string;
  method?: "GET" | "POST";
  accessToken: string;
  body?: unknown;
  fetchFn?: typeof fetch;
  maxRetries?: number;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
}

/**
 * Executes a strictly allowlisted read-only Google REST API request with bounded retry/backoff
 * for HTTP 429 and transient 5xx responses, normalizing errors with full secret redaction.
 */
export async function executeGoogleReadRequest<T>(options: GoogleReadRequestOptions): Promise<T> {
  const method = options.method ?? "GET";
  const parsedUrl = assertAllowedGoogleReadEndpoint(options.url, method);
  const fetchFn = options.fetchFn ?? fetch;
  const maxRetries = Math.max(0, Math.min(options.maxRetries ?? 2, 4));
  const baseRetryDelayMs = options.baseRetryDelayMs ?? 150;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? 1500;

  let lastError: ProviderAdapterError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetchFn(parsedUrl.toString(), {
        method,
        headers: {
          authorization: `Bearer ${options.accessToken}`,
          accept: "application/json",
          ...(method === "POST" ? { "content-type": "application/json" } : {}),
        },
        ...(method === "POST" && options.body !== undefined
          ? { body: JSON.stringify(options.body) }
          : {}),
      });

      const rawBody = await response.text();
      if (response.ok) {
        return (rawBody.trim().length > 0 ? JSON.parse(rawBody) : {}) as T;
      }

      const normalized = normalizeGoogleApiError({
        providerKey: options.providerKey,
        status: response.status,
        rawBody,
        headers: response.headers,
      });
      lastError = normalized;

      if (!normalized.retryable || attempt >= maxRetries) {
        throw normalized;
      }

      const backoff = parseRetryAfterMs(
        response.headers,
        baseRetryDelayMs * 2 ** attempt,
        maxRetryDelayMs,
      );
      await waitMs(backoff);
    } catch (err) {
      if (err instanceof ProviderAdapterError) {
        if (!err.retryable || attempt >= maxRetries) {
          throw err;
        }
        lastError = err;
      } else {
        const message = err instanceof Error ? err.message : "Network error calling Google API";
        lastError = new ProviderAdapterError({
          providerKey: options.providerKey,
          code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
          retryable: attempt < maxRetries,
          message: `Google API network failure: ${redactSensitiveText(message)}`,
        });
        if (attempt >= maxRetries) {
          throw lastError;
        }
        await waitMs(Math.min(baseRetryDelayMs * 2 ** attempt, maxRetryDelayMs));
      }
    }
  }

  throw (
    lastError ??
    new ProviderAdapterError({
      providerKey: options.providerKey,
      code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
      message: "Google API request failed after bounded retries.",
    })
  );
}
