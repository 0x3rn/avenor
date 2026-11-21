import {
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import { VERCEL_PROVIDER_KEY, type VercelFocusChargeRecord } from "./types";

const ALLOWLISTED_VERCEL_GET_PATTERNS: readonly RegExp[] = [
  /^\/v9\/projects$/,
  /^\/v9\/projects\/[A-Za-z0-9_-]+$/,
  /^\/v9\/projects\/[A-Za-z0-9_-]+\/domains$/,
  /^\/v6\/deployments$/,
  /^\/v1\/billing\/charges$/,
];

const PROHIBITED_VERCEL_PATH_SUBSTRINGS: readonly string[] = [
  "/env",
  "/secrets",
  "/promote",
  "/rollback",
  "/cancel",
  "/webhooks",
  "/tokens",
];

/**
 * Enforces strict GET-only allowlisting on api.vercel.com.
 * Blocks all redeployments, rollbacks, promotions, domain changes, and decrypted env reads.
 */
export function assertAllowlistedVercelGetRequest(method: string, urlString: string): URL {
  const normalizedMethod = method.trim().toUpperCase();
  if (normalizedMethod !== "GET") {
    throw new ProviderAdapterError({
      providerKey: VERCEL_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message: `Vercel read-only adapter blocked prohibited HTTP method "${normalizedMethod}". Only GET requests are permitted.`,
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new ProviderAdapterError({
      providerKey: VERCEL_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: `Invalid Vercel API URL "${urlString}".`,
    });
  }

  if (parsed.origin !== "https://api.vercel.com") {
    throw new ProviderAdapterError({
      providerKey: VERCEL_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message: `Vercel read-only adapter blocked untrusted origin "${parsed.origin}".`,
    });
  }

  const lowerPath = parsed.pathname.toLowerCase();
  for (const forbidden of PROHIBITED_VERCEL_PATH_SUBSTRINGS) {
    if (lowerPath.includes(forbidden)) {
      throw new ProviderAdapterError({
        providerKey: VERCEL_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
        message: `Vercel read-only adapter blocked prohibited endpoint "${parsed.pathname}" (${forbidden}).`,
      });
    }
  }

  const allowed = ALLOWLISTED_VERCEL_GET_PATTERNS.some((p) => p.test(parsed.pathname));
  if (!allowed) {
    throw new ProviderAdapterError({
      providerKey: VERCEL_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message: `Vercel read-only adapter blocked unallowlisted GET path "${parsed.pathname}".`,
    });
  }

  return parsed;
}

/**
 * Parses streaming NDJSON FOCUS 1.3 billing charges returned by `GET /v1/billing/charges`.
 */
export function parseVercelFocusChargesNdjson(ndjsonText: string): VercelFocusChargeRecord[] {
  const charges: VercelFocusChargeRecord[] = [];
  const lines = ndjsonText.split(/\r?\n/);

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      throw new ProviderAdapterError({
        providerKey: VERCEL_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
        message: "Malformed NDJSON record encountered while parsing Vercel FOCUS billing charges.",
      });
    }

    const billedCost = Number(parsed.BilledCost ?? parsed.billedCost ?? 0);
    const effectiveCost = Number(parsed.EffectiveCost ?? parsed.effectiveCost ?? billedCost);
    const consumedRaw = parsed.ConsumedQuantity ?? parsed.consumedQuantity;

    charges.push({
      serviceName: String(parsed.ServiceName ?? parsed.serviceName ?? "Vercel Platform"),
      chargeCategory: String(parsed.ChargeCategory ?? parsed.chargeCategory ?? "Usage"),
      billingCurrency: String(
        parsed.BillingCurrency ?? parsed.billingCurrency ?? "USD",
      ).toUpperCase(),
      billedCost: Number.isFinite(billedCost) ? billedCost : 0,
      effectiveCost: Number.isFinite(effectiveCost) ? effectiveCost : 0,
      consumedQuantity:
        consumedRaw !== undefined && consumedRaw !== null && Number.isFinite(Number(consumedRaw))
          ? Number(consumedRaw)
          : null,
      consumedUnit:
        typeof (parsed.ConsumedUnit ?? parsed.consumedUnit) === "string"
          ? String(parsed.ConsumedUnit ?? parsed.consumedUnit)
          : null,
      chargePeriodStartIso: String(
        parsed.ChargePeriodStart ?? parsed.chargePeriodStart ?? new Date().toISOString(),
      ),
      chargePeriodEndIso: String(
        parsed.ChargePeriodEnd ?? parsed.chargePeriodEnd ?? new Date().toISOString(),
      ),
    });
  }

  return charges;
}

export function assertVercelContext(context: ReadOnlyProviderContext): { apiToken: string } {
  if (!context.organizationId || !context.workspaceId) {
    throw new ProviderAdapterError({
      providerKey: VERCEL_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "Workspace and organization context are required for Vercel read-only access.",
    });
  }

  const token = (context.apiToken ?? context.accessToken ?? "").trim();
  if (!token) {
    throw new ProviderAdapterError({
      providerKey: VERCEL_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "Missing Vercel read-only access token.",
    });
  }

  return { apiToken: token };
}

export function shouldExecuteLiveVercelApi(
  context: ReadOnlyProviderContext,
  hasInjectedFetch: boolean,
): boolean {
  if (hasInjectedFetch) return true;
  const token = (context.apiToken ?? context.accessToken ?? "").trim();
  return token.startsWith("vcl_live_");
}

export async function executeVercelReadOnlyGet(options: {
  url: string;
  apiToken: string;
  fetchFn?: typeof fetch;
}): Promise<Response> {
  const parsed = assertAllowlistedVercelGetRequest("GET", options.url);
  const fetchImpl = options.fetchFn ?? globalThis.fetch;

  const response = await fetchImpl(parsed.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${options.apiToken}`,
      Accept: "application/json, application/x-ndjson",
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new ProviderAdapterError({
        providerKey: VERCEL_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
        message: "Vercel token is invalid or revoked (HTTP 401).",
      });
    }
    if (response.status === 403 && parsed.pathname.includes("/billing/charges")) {
      throw new ProviderAdapterError({
        providerKey: VERCEL_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY,
        message:
          "Vercel FOCUS `/v1/billing/charges` requires Pro or Enterprise billing viewer scope.",
      });
    }
    if (response.status === 403) {
      throw new ProviderAdapterError({
        providerKey: VERCEL_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
        message: `Vercel API denied read access to ${parsed.pathname} (HTTP 403).`,
      });
    }
    if (response.status === 429) {
      throw new ProviderAdapterError({
        providerKey: VERCEL_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.RATE_LIMITED,
        message: "Vercel API rate limit reached (HTTP 429).",
        retryable: true,
        retryAfterSeconds: 60,
      });
    }
    throw new ProviderAdapterError({
      providerKey: VERCEL_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
      message: `Vercel API returned HTTP ${response.status}.`,
      retryable: response.status >= 500,
    });
  }

  return response;
}
