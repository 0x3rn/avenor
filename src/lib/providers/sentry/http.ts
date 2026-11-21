import {
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ReadOnlyProviderContext,
  redactSensitiveText,
} from "@avenor/types";
import { SENTRY_PROVIDER_KEY } from "./types";

const ALLOWLISTED_SENTRY_ORIGINS = new Set([
  "https://sentry.io",
  "https://us.sentry.io",
  "https://de.sentry.io",
]);

const ALLOWLISTED_SENTRY_GET_PATTERNS: readonly RegExp[] = [
  /^\/api\/0\/organizations\/?$/,
  /^\/api\/0\/organizations\/[A-Za-z0-9_-]+\/projects\/?$/,
  /^\/api\/0\/organizations\/[A-Za-z0-9_-]+\/stats_v2\/?$/,
  /^\/api\/0\/organizations\/[A-Za-z0-9_-]+\/sessions\/?$/,
  /^\/api\/0\/projects\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/issues\/?$/,
  /^\/api\/0\/projects\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/releases\/?$/,
];

const PROHIBITED_SENTRY_PATH_SUBSTRINGS: readonly string[] = [
  "/events/",
  "/events",
  "/files/",
  "/dsyms",
  "/rules",
  "/alert-rules",
  "/keys",
  "/hooks",
  "/members",
  "/teams",
];

const PROHIBITED_SENTRY_WRITE_SCOPES = new Set([
  "org:admin",
  "org:write",
  "project:admin",
  "project:write",
  "event:admin",
  "event:write",
  "team:admin",
  "team:write",
  "member:admin",
  "member:write",
]);

/**
 * Enforces strict GET-only allowlist on official Sentry API origins.
 * Blocks all write verbs, raw event payload endpoints, source maps, alert rules, and team/key mutations.
 */
export function assertAllowlistedSentryGetRequest(method: string, urlString: string): URL {
  const normalizedMethod = method.trim().toUpperCase();
  if (normalizedMethod !== "GET") {
    throw new ProviderAdapterError({
      providerKey: SENTRY_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message: `Sentry read-only adapter blocked prohibited HTTP method "${normalizedMethod}". Only GET requests are permitted.`,
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new ProviderAdapterError({
      providerKey: SENTRY_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: `Invalid Sentry API URL "${urlString}".`,
    });
  }

  if (!ALLOWLISTED_SENTRY_ORIGINS.has(parsed.origin)) {
    throw new ProviderAdapterError({
      providerKey: SENTRY_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message: `Sentry read-only adapter blocked untrusted origin "${parsed.origin}".`,
    });
  }

  const lowerPath = parsed.pathname.toLowerCase();
  for (const forbidden of PROHIBITED_SENTRY_PATH_SUBSTRINGS) {
    if (lowerPath.endsWith(forbidden) || lowerPath.includes(`${forbidden}/`)) {
      throw new ProviderAdapterError({
        providerKey: SENTRY_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
        message: `Sentry read-only adapter blocked prohibited or raw-PII endpoint "${parsed.pathname}" (${forbidden}).`,
      });
    }
  }

  const allowed = ALLOWLISTED_SENTRY_GET_PATTERNS.some((p) => p.test(parsed.pathname));
  if (!allowed) {
    throw new ProviderAdapterError({
      providerKey: SENTRY_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message: `Sentry read-only adapter blocked unallowlisted GET path "${parsed.pathname}".`,
    });
  }

  return parsed;
}

/**
 * Redacts PII, auth headers, cookies, tokens, IPs, emails, and query secrets from
 * Sentry issue titles/summaries before anything is persisted or sent to the browser.
 */
export function sanitizeSentryTextAndDropPii(raw: string): string {
  const trimmed = raw.slice(0, 240);
  const redacted = trimmed
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, "Bearer [REDACTED_TOKEN]")
    .replace(
      /(authorization|cookie|set-cookie|x-api-key)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi,
      "$1=[REDACTED_HEADER]",
    )
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[REDACTED_JWT]")
    .replace(
      /([?&](?:token|key|secret|password|auth|session|cookie)=)[^&\s]+/gi,
      "$1[REDACTED_SECRET]",
    )
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[REDACTED_IP]");

  return redactSensitiveText(redacted);
}

export function validateVerifiedSentryPermalink(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (
      parsed.protocol === "https:" &&
      (parsed.hostname === "sentry.io" || parsed.hostname.endsWith(".sentry.io"))
    ) {
      return `${parsed.origin}${parsed.pathname}`;
    }
  } catch {
    return null;
  }
  return null;
}

export function assertSentryContext(context: ReadOnlyProviderContext): { apiToken: string } {
  if (!context.organizationId || !context.workspaceId) {
    throw new ProviderAdapterError({
      providerKey: SENTRY_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "Workspace and organization context are required for Sentry read-only access.",
    });
  }

  const token = (context.apiToken ?? context.accessToken ?? "").trim();
  if (!token) {
    throw new ProviderAdapterError({
      providerKey: SENTRY_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "Missing Sentry read-only auth token.",
    });
  }

  const prohibitedGranted = context.grantedScopes.filter((s) =>
    PROHIBITED_SENTRY_WRITE_SCOPES.has(s.toLowerCase()),
  );
  if (prohibitedGranted.length > 0) {
    throw new ProviderAdapterError({
      providerKey: SENTRY_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message: `Sentry read-only adapter refused overly broad write/admin token scopes: ${prohibitedGranted.join(", ")}.`,
    });
  }

  return { apiToken: token };
}

export function shouldExecuteLiveSentryApi(
  context: ReadOnlyProviderContext,
  hasInjectedFetch: boolean,
): boolean {
  if (hasInjectedFetch) return true;
  const token = (context.apiToken ?? context.accessToken ?? "").trim();
  return token.startsWith("sntrys_");
}

export async function executeSentryReadOnlyGet(options: {
  url: string;
  apiToken: string;
  fetchFn?: typeof fetch;
}): Promise<Response> {
  const parsed = assertAllowlistedSentryGetRequest("GET", options.url);
  const fetchImpl = options.fetchFn ?? globalThis.fetch;

  const response = await fetchImpl(parsed.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${options.apiToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new ProviderAdapterError({
        providerKey: SENTRY_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.CREDENTIAL_EXPIRED,
        message: "Sentry auth token is invalid or expired (HTTP 401).",
      });
    }
    if (response.status === 403) {
      throw new ProviderAdapterError({
        providerKey: SENTRY_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
        message: `Sentry token lacks read scope for ${parsed.pathname} (HTTP 403).`,
      });
    }
    if (response.status === 429) {
      throw new ProviderAdapterError({
        providerKey: SENTRY_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.RATE_LIMITED,
        message: "Sentry API rate limit reached (HTTP 429).",
        retryable: true,
        retryAfterSeconds: 60,
      });
    }
    throw new ProviderAdapterError({
      providerKey: SENTRY_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
      message: `Sentry API returned HTTP ${response.status}.`,
      retryable: response.status >= 500,
    });
  }

  return response;
}
