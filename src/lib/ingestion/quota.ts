import {
  AppError,
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  redactSensitiveText,
} from "@avenor/types";

export interface ProviderQuotaPolicy {
  providerKey: string;
  maxRequestsPerHourPerResource: number;
  minRemainingHourlyTokensFloor: number;
  maxConcurrentRunsPerWorkspace: number;
  baseRetryDelayMs: number;
  maxRetryDelayMs: number;
  maxAttempts: number;
  leaseDurationSeconds: number;
}

export const PROVIDER_QUOTA_POLICIES: Record<string, ProviderQuotaPolicy> = {
  ga4: {
    providerKey: "ga4",
    maxRequestsPerHourPerResource: 60,
    minRemainingHourlyTokensFloor: 100,
    maxConcurrentRunsPerWorkspace: 2,
    baseRetryDelayMs: 5_000,
    maxRetryDelayMs: 300_000,
    maxAttempts: 3,
    leaseDurationSeconds: 120,
  },
  gsc: {
    providerKey: "gsc",
    maxRequestsPerHourPerResource: 60,
    minRemainingHourlyTokensFloor: 0,
    maxConcurrentRunsPerWorkspace: 2,
    baseRetryDelayMs: 5_000,
    maxRetryDelayMs: 300_000,
    maxAttempts: 3,
    leaseDurationSeconds: 120,
  },
};

export function getProviderQuotaPolicy(providerKey: string): ProviderQuotaPolicy {
  return (
    PROVIDER_QUOTA_POLICIES[providerKey] ?? {
      providerKey,
      maxRequestsPerHourPerResource: 60,
      minRemainingHourlyTokensFloor: 0,
      maxConcurrentRunsPerWorkspace: 2,
      baseRetryDelayMs: 5_000,
      maxRetryDelayMs: 300_000,
      maxAttempts: 3,
      leaseDurationSeconds: 120,
    }
  );
}

/**
 * Computes bounded exponential retry backoff with deterministic/bounded jitter,
 * honoring upstream `Retry-After` headers when present.
 */
export function computeIngestionRetryBackoffMs(input: {
  providerKey: string;
  attemptNumber: number;
  retryAfterSeconds?: number | null;
  jitterRatio?: number;
}): number {
  const policy = getProviderQuotaPolicy(input.providerKey);
  const safeAttempt = Math.max(1, Math.min(10, input.attemptNumber));
  const exponentialMs = policy.baseRetryDelayMs * 2 ** (safeAttempt - 1);

  const retryAfterMs =
    input.retryAfterSeconds && input.retryAfterSeconds > 0 ? input.retryAfterSeconds * 1000 : 0;

  const baseCandidate = Math.max(exponentialMs, retryAfterMs);
  const clampedJitterRatio = Math.max(0, Math.min(0.25, input.jitterRatio ?? 0.1));
  const withJitter = Math.round(baseCandidate * (1 + clampedJitterRatio));

  return Math.min(policy.maxRetryDelayMs, withJitter);
}

export interface ClassifiedIngestionFailure {
  errorCode: string;
  errorCategory:
    | "AUTH_REVOKED_OR_DENIED"
    | "RATE_LIMITED"
    | "TRANSIENT_PROVIDER_FAILURE"
    | "DATABASE_FAILURE"
    | "VALIDATION_OR_CONFIG_ERROR";
  errorSummary: string;
  retryEligible: boolean;
  isRateLimited: boolean;
  isAuthFailure: boolean;
  retryAfterSeconds: number | null;
}

/**
 * Classifies an error encountered during ingestion into a safe, token-redacted category
 * and determines whether bounded retry is permitted.
 */
export function classifyIngestionError(
  err: unknown,
  attemptNumber: number,
  maxAttempts: number,
): ClassifiedIngestionFailure {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const safeSummary = redactSensitiveText(rawMessage).slice(0, 400);

  if (err instanceof ProviderAdapterError) {
    if (err.code === PROVIDER_ERROR_CODES.RATE_LIMITED) {
      const retryAfter = typeof err.retryAfterSeconds === "number" ? err.retryAfterSeconds : 60;
      return {
        errorCode: err.code,
        errorCategory: "RATE_LIMITED",
        errorSummary: safeSummary,
        retryEligible: attemptNumber < maxAttempts,
        isRateLimited: true,
        isAuthFailure: false,
        retryAfterSeconds: retryAfter,
      };
    }

    if (
      err.code === PROVIDER_ERROR_CODES.UNAUTHORIZED ||
      err.code === PROVIDER_ERROR_CODES.CREDENTIAL_EXPIRED ||
      err.code === PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE ||
      err.code === PROVIDER_ERROR_CODES.PERMISSION_DENIED
    ) {
      return {
        errorCode: err.code,
        errorCategory: "AUTH_REVOKED_OR_DENIED",
        errorSummary: safeSummary,
        retryEligible: false,
        isRateLimited: false,
        isAuthFailure: true,
        retryAfterSeconds: null,
      };
    }

    if (err.retryable) {
      return {
        errorCode: err.code,
        errorCategory: "TRANSIENT_PROVIDER_FAILURE",
        errorSummary: safeSummary,
        retryEligible: attemptNumber < maxAttempts,
        isRateLimited: false,
        isAuthFailure: false,
        retryAfterSeconds: err.retryAfterSeconds ?? null,
      };
    }
  }

  if (err instanceof AppError) {
    return {
      errorCode: err.code,
      errorCategory:
        err.code === "FORBIDDEN" || err.code === "UNAUTHENTICATED"
          ? "AUTH_REVOKED_OR_DENIED"
          : "DATABASE_FAILURE",
      errorSummary: safeSummary,
      retryEligible: false,
      isRateLimited: false,
      isAuthFailure: err.code === "FORBIDDEN" || err.code === "UNAUTHENTICATED",
      retryAfterSeconds: null,
    };
  }

  const isTransient = /timeout|500|502|503|504|temporarily unavailable|network/i.test(safeSummary);
  return {
    errorCode: isTransient ? "UPSTREAM_TRANSIENT" : "INGESTION_EXECUTION_ERROR",
    errorCategory: isTransient ? "TRANSIENT_PROVIDER_FAILURE" : "DATABASE_FAILURE",
    errorSummary: safeSummary,
    retryEligible: isTransient && attemptNumber < maxAttempts,
    isRateLimited: false,
    isAuthFailure: false,
    retryAfterSeconds: null,
  };
}
