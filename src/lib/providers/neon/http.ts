import {
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import { evaluateBackendCredentialSafety } from "../backend-feasibility";
import { NEON_PROVIDER_KEY } from "./types";

const ALLOWLISTED_NEON_GET_PATH_PATTERNS: readonly RegExp[] = [
  /^\/api\/v2\/projects$/,
  /^\/api\/v2\/projects\/[A-Za-z0-9_-]+$/,
  /^\/api\/v2\/projects\/[A-Za-z0-9_-]+\/branches$/,
  /^\/api\/v2\/projects\/[A-Za-z0-9_-]+\/branches\/[A-Za-z0-9_-]+\/databases$/,
  /^\/api\/v2\/projects\/[A-Za-z0-9_-]+\/endpoints$/,
  /^\/api\/v2\/projects\/[A-Za-z0-9_-]+\/operations$/,
  /^\/api\/v2\/consumption_history\/projects$/,
  /^\/api\/v2\/consumption_history\/account$/,
];

const PROHIBITED_NEON_PATH_SUBSTRINGS: readonly string[] = [
  "connection_uri",
  "reveal_password",
  "reset_password",
  "api_keys",
  "/roles",
  "/vpc",
];

/**
 * Verifies that a Neon HTTP request strictly uses GET and targets an allowlisted
 * read-only control-plane endpoint on console.neon.tech.
 * Because Neon API keys are not intrinsically enforced as read-only upstream,
 * this runtime gate is mandatory on every outbound request.
 */
export function assertAllowlistedNeonGetRequest(method: string, urlString: string): URL {
  const normalizedMethod = method.trim().toUpperCase();
  if (normalizedMethod !== "GET") {
    throw new ProviderAdapterError({
      providerKey: NEON_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message: `Neon read-only adapter blocked prohibited HTTP method "${normalizedMethod}". Only GET requests are permitted.`,
      retryable: false,
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new ProviderAdapterError({
      providerKey: NEON_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: `Invalid Neon API URL "${urlString}".`,
      retryable: false,
    });
  }

  if (parsed.origin !== "https://console.neon.tech") {
    throw new ProviderAdapterError({
      providerKey: NEON_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message: `Neon read-only adapter blocked request to untrusted origin "${parsed.origin}".`,
      retryable: false,
    });
  }

  const lowerPath = parsed.pathname.toLowerCase();
  for (const forbidden of PROHIBITED_NEON_PATH_SUBSTRINGS) {
    if (lowerPath.includes(forbidden)) {
      throw new ProviderAdapterError({
        providerKey: NEON_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
        message: `Neon read-only adapter blocked prohibited sensitive path "${parsed.pathname}" (${forbidden}).`,
        retryable: false,
      });
    }
  }

  const isAllowlisted = ALLOWLISTED_NEON_GET_PATH_PATTERNS.some((pattern) =>
    pattern.test(parsed.pathname),
  );
  if (!isAllowlisted) {
    throw new ProviderAdapterError({
      providerKey: NEON_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message: `Neon read-only adapter blocked unallowlisted control-plane path "${parsed.pathname}".`,
      retryable: false,
    });
  }

  return parsed;
}

export function assertNeonCredentialAndSimulation(context: ReadOnlyProviderContext): {
  token: string;
  keyType: "neon_project_scoped_api_key" | "neon_org_api_key" | "neon_personal_api_key";
} {
  if (!context.organizationId || !context.workspaceId) {
    throw new ProviderAdapterError({
      providerKey: NEON_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "Workspace and organization context are required for Neon read-only access.",
    });
  }

  switch (context.simulationScenario) {
    case "expired_token":
      throw new ProviderAdapterError({
        providerKey: NEON_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.CREDENTIAL_EXPIRED,
        message: "Neon API key has expired and requires rotation.",
      });
    case "revoked_token":
      throw new ProviderAdapterError({
        providerKey: NEON_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
        message: "Neon API key was revoked in the Neon Console.",
      });
    case "rate_limited":
      throw new ProviderAdapterError({
        providerKey: NEON_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.RATE_LIMITED,
        message: "Neon API rate limit reached (HTTP 429). Retry after cooldown.",
        retryable: true,
        retryAfterSeconds: 45,
      });
    case "provider_unavailable":
      throw new ProviderAdapterError({
        providerKey: NEON_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
        message: "Neon Control Plane API is temporarily unavailable (HTTP 503).",
        retryable: true,
        retryAfterSeconds: 30,
      });
    case "malformed_response":
      throw new ProviderAdapterError({
        providerKey: NEON_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
        message: "Neon API returned a malformed JSON payload.",
        retryable: false,
      });
    default:
      break;
  }

  const rawToken = (context.apiToken ?? context.accessToken ?? "").trim();
  if (!rawToken) {
    throw new ProviderAdapterError({
      providerKey: NEON_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "Missing Neon read-only API token.",
    });
  }

  const isConnString = /^postgres(?:ql)?:\/\//i.test(rawToken);
  const keyType = rawToken.startsWith("napi_proj_")
    ? "neon_project_scoped_api_key"
    : rawToken.startsWith("napi_org_")
      ? "neon_org_api_key"
      : "neon_personal_api_key";

  const verdict = evaluateBackendCredentialSafety({
    providerKey: "neon",
    credentialType: isConnString ? "postgres_connection_string" : keyType,
    rawTokenPreview: rawToken,
    methodAllowlistEnforced: true,
  });

  if (!verdict.accepted) {
    throw new ProviderAdapterError({
      providerKey: NEON_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message: verdict.reason,
      retryable: false,
    });
  }

  return { token: rawToken, keyType };
}

export function shouldExecuteLiveNeonApi(
  context: ReadOnlyProviderContext,
  hasInjectedFetch: boolean,
): boolean {
  if (hasInjectedFetch) {
    return true;
  }
  const token = (context.apiToken ?? context.accessToken ?? "").trim();
  return token.startsWith("napi_live_");
}

export async function executeNeonReadOnlyGetJson<T>(options: {
  url: string;
  apiToken: string;
  fetchFn?: typeof fetch;
}): Promise<T> {
  const parsedUrl = assertAllowlistedNeonGetRequest("GET", options.url);
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
    const isConsumptionEndpoint = parsedUrl.pathname.includes("/consumption_history/");

    if (response.status === 401) {
      throw new ProviderAdapterError({
        providerKey: NEON_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
        message: "Neon API key is invalid or revoked (HTTP 401).",
        retryable: false,
      });
    }

    if (response.status === 403 || (response.status === 404 && isConsumptionEndpoint)) {
      if (isConsumptionEndpoint) {
        throw new ProviderAdapterError({
          providerKey: NEON_PROVIDER_KEY,
          code: PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY,
          message:
            "Neon Consumption History API is restricted on the current Neon billing plan tier (requires Launch, Scale, Business, or Enterprise).",
          retryable: false,
        });
      }
      throw new ProviderAdapterError({
        providerKey: NEON_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
        message: `Neon API denied access to ${parsedUrl.pathname} (HTTP ${response.status}).`,
        retryable: false,
      });
    }

    if (response.status === 404) {
      throw new ProviderAdapterError({
        providerKey: NEON_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.RESOURCE_NOT_FOUND,
        message: `Neon resource at ${parsedUrl.pathname} was not found (HTTP 404).`,
        retryable: false,
      });
    }

    if (response.status === 429) {
      throw new ProviderAdapterError({
        providerKey: NEON_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.RATE_LIMITED,
        message: "Neon API rate limit exceeded (HTTP 429).",
        retryable: true,
        retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 30,
      });
    }

    throw new ProviderAdapterError({
      providerKey: NEON_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
      message: `Neon Control Plane API returned HTTP ${response.status}.`,
      retryable: response.status >= 500,
    });
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new ProviderAdapterError({
      providerKey: NEON_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: "Neon API returned invalid JSON.",
      retryable: false,
    });
  }
}
