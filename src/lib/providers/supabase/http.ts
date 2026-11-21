import {
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import { evaluateBackendCredentialSafety } from "../backend-feasibility";
import { SUPABASE_PROVIDER_KEY } from "./types";

const ALLOWLISTED_SUPABASE_GET_PATH_PATTERNS: readonly RegExp[] = [
  /^\/v1\/projects$/,
  /^\/v1\/organizations$/,
  /^\/v1\/projects\/[A-Za-z0-9_-]+$/,
  /^\/v1\/projects\/[A-Za-z0-9_-]+\/health$/,
  /^\/v1\/projects\/[A-Za-z0-9_-]+\/usage$/,
  /^\/v1\/projects\/[A-Za-z0-9_-]+\/analytics\/endpoints\/usage\.api-counts$/,
  /^\/v1\/projects\/[A-Za-z0-9_-]+\/config\/database\/postgres$/,
  /^\/v1\/projects\/[A-Za-z0-9_-]+\/config\/auth$/,
  /^\/v1\/projects\/[A-Za-z0-9_-]+\/network-restrictions$/,
  /^\/v1\/organizations\/[A-Za-z0-9_-]+\/audit-logs$/,
];

const PROHIBITED_SUPABASE_PATH_SUBSTRINGS: readonly string[] = [
  "/database/query",
  "/api-keys",
  "/pgsodium",
  "/secrets",
  "/auth/users",
  "/users",
  "/restore",
  "/pause",
];

const SENSITIVE_FIELD_KEYS: ReadonlySet<string> = new Set([
  "email",
  "phone",
  "user_metadata",
  "raw_user_meta_data",
  "encrypted_password",
  "smtp_pass",
  "smtp_user",
  "smtp_admin_email",
  "jwt_secret",
  "service_role",
  "service_role_key",
  "anon_key",
  "db_pass",
  "password",
]);

/**
 * Verifies that an outbound Supabase request strictly uses GET and targets an allowlisted
 * Management API v1 metadata/analytics endpoint on api.supabase.com.
 */
export function assertAllowlistedSupabaseGetRequest(method: string, urlString: string): URL {
  const normalizedMethod = method.trim().toUpperCase();
  if (normalizedMethod !== "GET") {
    throw new ProviderAdapterError({
      providerKey: SUPABASE_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message: `Supabase read-only adapter blocked prohibited HTTP method "${normalizedMethod}". Only GET requests are permitted.`,
      retryable: false,
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new ProviderAdapterError({
      providerKey: SUPABASE_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: `Invalid Supabase Management API URL "${urlString}".`,
      retryable: false,
    });
  }

  if (parsed.origin !== "https://api.supabase.com") {
    throw new ProviderAdapterError({
      providerKey: SUPABASE_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message: `Supabase read-only adapter blocked request to untrusted origin "${parsed.origin}". Only https://api.supabase.com is permitted.`,
      retryable: false,
    });
  }

  const lowerPath = parsed.pathname.toLowerCase();
  for (const forbidden of PROHIBITED_SUPABASE_PATH_SUBSTRINGS) {
    if (lowerPath.includes(forbidden)) {
      throw new ProviderAdapterError({
        providerKey: SUPABASE_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
        message: `Supabase read-only adapter blocked prohibited endpoint "${parsed.pathname}" (${forbidden}).`,
        retryable: false,
      });
    }
  }

  const isAllowlisted = ALLOWLISTED_SUPABASE_GET_PATH_PATTERNS.some((pattern) =>
    pattern.test(parsed.pathname),
  );
  if (!isAllowlisted) {
    throw new ProviderAdapterError({
      providerKey: SUPABASE_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message: `Supabase read-only adapter blocked unallowlisted path "${parsed.pathname}".`,
      retryable: false,
    });
  }

  return parsed;
}

/**
 * Strips any accidental sensitive configuration fields or raw user PII fields from
 * upstream Supabase Management API responses before they enter Avenor memory or cache.
 */
export function sanitizeSupabaseResponseObject<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSupabaseResponseObject(item)) as unknown as T;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, entryVal] of Object.entries(value as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (
      SENSITIVE_FIELD_KEYS.has(lowerKey) ||
      lowerKey.endsWith("_secret") ||
      lowerKey.endsWith("_password") ||
      lowerKey.endsWith("_pass")
    ) {
      continue;
    }
    sanitized[key] = sanitizeSupabaseResponseObject(entryVal);
  }

  return sanitized as T;
}

export function assertSupabaseCredentialAndSimulation(context: ReadOnlyProviderContext): {
  token: string;
  credentialType: "supabase_oauth_token" | "supabase_pat";
} {
  if (!context.organizationId || !context.workspaceId) {
    throw new ProviderAdapterError({
      providerKey: SUPABASE_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "Workspace and organization context are required for Supabase read-only access.",
    });
  }

  switch (context.simulationScenario) {
    case "expired_token":
      throw new ProviderAdapterError({
        providerKey: SUPABASE_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.CREDENTIAL_EXPIRED,
        message: "Supabase OAuth / Management token has expired.",
      });
    case "revoked_token":
      throw new ProviderAdapterError({
        providerKey: SUPABASE_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
        message: "Supabase authorization grant was revoked.",
      });
    case "rate_limited":
      throw new ProviderAdapterError({
        providerKey: SUPABASE_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.RATE_LIMITED,
        message: "Supabase Management API rate limit exceeded (HTTP 429).",
        retryable: true,
        retryAfterSeconds: 60,
      });
    case "provider_unavailable":
      throw new ProviderAdapterError({
        providerKey: SUPABASE_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
        message: "Supabase Management API is temporarily unreachable (HTTP 503).",
        retryable: true,
        retryAfterSeconds: 30,
      });
    case "malformed_response":
      throw new ProviderAdapterError({
        providerKey: SUPABASE_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
        message: "Supabase Management API returned a malformed JSON payload.",
        retryable: false,
      });
    default:
      break;
  }

  const rawToken = (context.apiToken ?? context.accessToken ?? "").trim();
  if (!rawToken) {
    throw new ProviderAdapterError({
      providerKey: SUPABASE_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "Missing Supabase read-only Management API token.",
    });
  }

  const isConnString = /^postgres(?:ql)?:\/\//i.test(rawToken);
  const isSecretKey = /^sb_secret_/i.test(rawToken);
  const isServiceRole = /service_role/i.test(rawToken);

  const detectedType = isConnString
    ? "postgres_connection_string"
    : isSecretKey
      ? "supabase_secret_key"
      : isServiceRole
        ? "supabase_service_role_key"
        : rawToken.startsWith("sbp_oauth_")
          ? "supabase_oauth_token"
          : "supabase_pat";

  const verdict = evaluateBackendCredentialSafety({
    providerKey: "supabase",
    credentialType: detectedType,
    rawTokenPreview: rawToken,
    grantedScopes: context.grantedScopes,
  });

  if (!verdict.accepted) {
    throw new ProviderAdapterError({
      providerKey: SUPABASE_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message: verdict.reason,
      retryable: false,
    });
  }

  return {
    token: rawToken,
    credentialType:
      detectedType === "supabase_oauth_token" ? "supabase_oauth_token" : "supabase_pat",
  };
}

export function shouldExecuteLiveSupabaseApi(
  context: ReadOnlyProviderContext,
  hasInjectedFetch: boolean,
): boolean {
  if (hasInjectedFetch) {
    return true;
  }
  const token = (context.apiToken ?? context.accessToken ?? "").trim();
  return token.startsWith("sbp_live_");
}

export async function executeSupabaseReadOnlyGetJson<T>(options: {
  url: string;
  apiToken: string;
  fetchFn?: typeof fetch;
}): Promise<T> {
  const parsedUrl = assertAllowlistedSupabaseGetRequest("GET", options.url);
  const fetchImpl = options.fetchFn ?? globalThis.fetch;

  const response = await fetchImpl(parsedUrl.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${options.apiToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : undefined;

    if (response.status === 401) {
      throw new ProviderAdapterError({
        providerKey: SUPABASE_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
        message: "Supabase Management API token is invalid or expired (HTTP 401).",
        retryable: false,
      });
    }

    if (
      response.status === 402 ||
      (response.status === 403 && parsedUrl.pathname.includes("audit-logs"))
    ) {
      throw new ProviderAdapterError({
        providerKey: SUPABASE_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY,
        message: "Supabase endpoint is restricted by the connected organization's plan tier.",
        retryable: false,
      });
    }

    if (response.status === 403) {
      throw new ProviderAdapterError({
        providerKey: SUPABASE_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
        message: `Supabase Management API denied read access to ${parsedUrl.pathname} (HTTP 403).`,
        retryable: false,
      });
    }

    if (response.status === 404) {
      throw new ProviderAdapterError({
        providerKey: SUPABASE_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.RESOURCE_NOT_FOUND,
        message: `Supabase resource at ${parsedUrl.pathname} was not found (HTTP 404).`,
        retryable: false,
      });
    }

    if (response.status === 429) {
      throw new ProviderAdapterError({
        providerKey: SUPABASE_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.RATE_LIMITED,
        message: "Supabase Management API rate limit reached (HTTP 429).",
        retryable: true,
        retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 45,
      });
    }

    throw new ProviderAdapterError({
      providerKey: SUPABASE_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
      message: `Supabase Management API returned HTTP ${response.status}.`,
      retryable: response.status >= 500,
    });
  }

  try {
    const rawJson = (await response.json()) as T;
    return sanitizeSupabaseResponseObject(rawJson);
  } catch {
    throw new ProviderAdapterError({
      providerKey: SUPABASE_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: "Supabase Management API returned invalid JSON.",
      retryable: false,
    });
  }
}
