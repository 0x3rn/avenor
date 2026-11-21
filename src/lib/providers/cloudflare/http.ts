import {
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import { CLOUDFLARE_PROVIDER_KEY } from "./types";

const ALLOWLISTED_CLOUDFLARE_GET_PATTERNS: readonly RegExp[] = [
  /^\/client\/v4\/user\/tokens\/verify$/,
  /^\/client\/v4\/zones$/,
  /^\/client\/v4\/zones\/[A-Za-z0-9_-]+$/,
];

const PROHIBITED_CLOUDFLARE_PATH_SUBSTRINGS: readonly string[] = [
  "/dns_records",
  "/purge_cache",
  "/firewall/rules",
  "/rulesets",
  "/page_rules",
  "/workers/scripts",
  "/kv/namespaces",
  "/access/",
  "/settings/",
];

/**
 * Verifies a Cloudflare GraphQL document is strictly a read-only `query` targeting
 * `viewer.zones` analytics datasets, rejecting any `mutation` or `subscription`.
 */
export function assertReadOnlyCloudflareGraphqlQuery(queryText: string): void {
  const normalized = queryText.replace(/#[^\n]*/g, "").trim();
  if (!normalized) {
    throw new ProviderAdapterError({
      providerKey: CLOUDFLARE_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: "Empty Cloudflare GraphQL query rejected.",
    });
  }

  if (/\b(mutation|subscription)\b/i.test(normalized)) {
    throw new ProviderAdapterError({
      providerKey: CLOUDFLARE_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message:
        "Cloudflare read-only adapter blocked GraphQL mutation/subscription operation. Only read-only analytics queries are permitted.",
    });
  }

  if (!/\bviewer\b/.test(normalized) || !/\bzones\b/.test(normalized)) {
    throw new ProviderAdapterError({
      providerKey: CLOUDFLARE_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message:
        "Cloudflare GraphQL query must target allowlisted `viewer { zones(...) }` analytics datasets.",
    });
  }
}

/**
 * Enforces strict endpoint and HTTP verb allowlisting for Cloudflare API v4.
 * Permits only allowlisted GET discovery/verify endpoints and read-only GraphQL analytics queries.
 */
export function assertAllowlistedCloudflareRequest(
  method: string,
  urlString: string,
  graphqlQuery?: string,
): URL {
  const normalizedMethod = method.trim().toUpperCase();
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new ProviderAdapterError({
      providerKey: CLOUDFLARE_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: `Invalid Cloudflare API URL "${urlString}".`,
    });
  }

  if (parsed.origin !== "https://api.cloudflare.com") {
    throw new ProviderAdapterError({
      providerKey: CLOUDFLARE_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message: `Cloudflare read-only adapter blocked untrusted origin "${parsed.origin}".`,
    });
  }

  const lowerPath = parsed.pathname.toLowerCase();
  for (const forbidden of PROHIBITED_CLOUDFLARE_PATH_SUBSTRINGS) {
    if (lowerPath.includes(forbidden)) {
      throw new ProviderAdapterError({
        providerKey: CLOUDFLARE_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
        message: `Cloudflare read-only adapter blocked prohibited administrative endpoint "${parsed.pathname}" (${forbidden}).`,
      });
    }
  }

  if (normalizedMethod === "GET") {
    const allowed = ALLOWLISTED_CLOUDFLARE_GET_PATTERNS.some((p) => p.test(parsed.pathname));
    if (!allowed) {
      throw new ProviderAdapterError({
        providerKey: CLOUDFLARE_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
        message: `Cloudflare read-only adapter blocked unallowlisted GET path "${parsed.pathname}".`,
      });
    }
    return parsed;
  }

  if (normalizedMethod === "POST" && parsed.pathname === "/client/v4/graphql") {
    assertReadOnlyCloudflareGraphqlQuery(graphqlQuery ?? "");
    return parsed;
  }

  throw new ProviderAdapterError({
    providerKey: CLOUDFLARE_PROVIDER_KEY,
    code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
    message: `Cloudflare read-only adapter blocked "${normalizedMethod} ${parsed.pathname}". DNS, WAF, cache purge, and deployment mutations are strictly prohibited.`,
  });
}

export function assertCloudflareContext(context: ReadOnlyProviderContext): { apiToken: string } {
  if (!context.organizationId || !context.workspaceId) {
    throw new ProviderAdapterError({
      providerKey: CLOUDFLARE_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "Workspace and organization context are required for Cloudflare read-only access.",
    });
  }

  switch (context.simulationScenario) {
    case "expired_token":
      throw new ProviderAdapterError({
        providerKey: CLOUDFLARE_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.CREDENTIAL_EXPIRED,
        message: "Cloudflare API token has expired.",
      });
    case "revoked_token":
      throw new ProviderAdapterError({
        providerKey: CLOUDFLARE_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
        message: "Cloudflare API token was revoked.",
      });
    case "rate_limited":
      throw new ProviderAdapterError({
        providerKey: CLOUDFLARE_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.RATE_LIMITED,
        message: "Cloudflare Analytics API rate limit reached (HTTP 429).",
        retryable: true,
        retryAfterSeconds: 60,
      });
    case "provider_unavailable":
      throw new ProviderAdapterError({
        providerKey: CLOUDFLARE_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
        message: "Cloudflare API is temporarily unavailable.",
        retryable: true,
        retryAfterSeconds: 30,
      });
    default:
      break;
  }

  const token = (context.apiToken ?? context.accessToken ?? "").trim();
  if (!token) {
    throw new ProviderAdapterError({
      providerKey: CLOUDFLARE_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "Missing Cloudflare read-only API token (`Zone.Analytics:Read`).",
    });
  }

  return { apiToken: token };
}

export function shouldExecuteLiveCloudflareApi(
  context: ReadOnlyProviderContext,
  hasInjectedFetch: boolean,
): boolean {
  if (hasInjectedFetch) return true;
  const token = (context.apiToken ?? context.accessToken ?? "").trim();
  return token.startsWith("cf_live_");
}

export async function executeCloudflareReadRequest<T>(options: {
  method: "GET" | "POST";
  url: string;
  apiToken: string;
  graphqlBody?: { query: string; variables?: Record<string, unknown> };
  fetchFn?: typeof fetch;
}): Promise<T> {
  const parsed = assertAllowlistedCloudflareRequest(
    options.method,
    options.url,
    options.graphqlBody?.query,
  );
  const fetchImpl = options.fetchFn ?? globalThis.fetch;

  const response = await fetchImpl(parsed.toString(), {
    method: options.method,
    headers: {
      Authorization: `Bearer ${options.apiToken}`,
      Accept: "application/json",
      ...(options.method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    ...(options.method === "POST" && options.graphqlBody
      ? { body: JSON.stringify(options.graphqlBody) }
      : {}),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new ProviderAdapterError({
        providerKey: CLOUDFLARE_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
        message: "Cloudflare API token rejected (HTTP 401).",
      });
    }
    if (response.status === 403) {
      throw new ProviderAdapterError({
        providerKey: CLOUDFLARE_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
        message: "Cloudflare token lacks `Zone.Analytics:Read` permission (HTTP 403).",
      });
    }
    if (response.status === 429) {
      const retry = Number.parseInt(response.headers.get("retry-after") ?? "60", 10);
      throw new ProviderAdapterError({
        providerKey: CLOUDFLARE_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.RATE_LIMITED,
        message: "Cloudflare API rate limit reached (HTTP 429).",
        retryable: true,
        retryAfterSeconds: Number.isFinite(retry) ? retry : 60,
      });
    }
    throw new ProviderAdapterError({
      providerKey: CLOUDFLARE_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
      message: `Cloudflare API returned HTTP ${response.status}.`,
      retryable: response.status >= 500,
    });
  }

  return (await response.json()) as T;
}
