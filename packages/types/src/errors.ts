export const ERROR_CODES = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  EXTERNAL_PROVIDER_ERROR: "EXTERNAL_PROVIDER_ERROR",
  PRODUCTION_SAFETY_VIOLATION: "PRODUCTION_SAFETY_VIOLATION",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  EXTERNAL_PROVIDER_ERROR: 502,
  PRODUCTION_SAFETY_VIOLATION: 403,
  INTERNAL_ERROR: 500,
};

export interface PublicErrorPayload {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, string[] | string>;
    requestId?: string;
  };
}

const SENSITIVE_PATTERNS = [
  /postgres(?:ql)?:\/\/[^\s"']+/gi,
  /bearer\s+[a-z0-9._~+/-]+=*/gi,
  /(?:access_token|refresh_token|client_secret|code_verifier|authorization_code|raw_secret|ciphertext|secret|password|token|api[_-]?key)\s*["']?\s*[:=]\s*["']?[^\s,"'}]+/gi,
  /\b(?:ghp|gho|ghu|ghs|ghr|sbp|napi|vcp|sntrys|avn_live|avn_test|ya29)_[a-zA-Z0-9._~-]{8,}\b/g,
];

export function redactSensitiveText(input: string): string {
  let sanitized = input;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }
  return sanitized;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, string[] | string>;
  public readonly requestId?: string;

  constructor(options: {
    code: ErrorCode;
    message: string;
    statusCode?: number;
    details?: Record<string, string[] | string>;
    requestId?: string;
    cause?: unknown;
  }) {
    super(redactSensitiveText(options.message), { cause: options.cause });
    this.name = "AppError";
    this.code = options.code;
    this.statusCode = options.statusCode ?? ERROR_HTTP_STATUS[options.code];
    this.details = options.details;
    this.requestId = options.requestId;
  }

  public toPublicJson(): PublicErrorPayload {
    return {
      error: {
        code: this.code,
        message: redactSensitiveText(this.message),
        ...(this.details ? { details: this.details } : {}),
        ...(this.requestId ? { requestId: this.requestId } : {}),
      },
    };
  }
}

export function toAppError(
  err: unknown,
  fallbackMessage = "An unexpected error occurred.",
): AppError {
  if (err instanceof AppError) {
    return err;
  }
  if (err instanceof Error) {
    return new AppError({
      code: ERROR_CODES.INTERNAL_ERROR,
      message: redactSensitiveText(err.message || fallbackMessage),
      cause: err,
    });
  }
  return new AppError({
    code: ERROR_CODES.INTERNAL_ERROR,
    message: fallbackMessage,
  });
}
