import crypto from "node:crypto";
import { isGoogleOAuthConfigured, resolveGoogleApiMode } from "@avenor/config";
import { dbQuery, getDatabasePool } from "@avenor/database";
import { PROVIDER_ERROR_CODES, ProviderAdapterError, redactSensitiveText } from "@avenor/types";
import {
  assertReadOnlyScopesOnly,
  defaultSandboxTokenExchangeHandler,
  defaultSandboxTokenRefreshHandler,
  type OAuthTokenExchangeHandler,
  type OAuthTokenRefreshHandler,
} from "./oauth";

export const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export function isGoogleProviderKey(providerKey: string): boolean {
  return providerKey === "ga4" || providerKey === "gsc";
}

export interface PendingOAuthStateDetails {
  stateId: string;
  organizationId: string;
  workspaceId: string;
  initiatedByUserId: string;
  providerKey: string;
  redirectUri: string;
  requestedScopes: string[];
  operation: string;
  targetConnectionId: string | null;
  expiresAtIso: string;
  consumedAtIso: string | null;
}

/**
 * Resolves metadata for a pending OAuth authorization state token by SHA-256 hash.
 * Used when GET browser callbacks return `?code=...&state=...` without client-supplied metadata.
 */
export async function resolvePendingOAuthStateDetails(
  rawStateToken: string,
  connectionString?: string,
): Promise<PendingOAuthStateDetails | null> {
  const trimmed = rawStateToken.trim();
  if (!trimmed) {
    return null;
  }

  const stateHash = crypto.createHash("sha256").update(trimmed).digest("hex");
  const res = await dbQuery<{
    id: string;
    organization_id: string;
    workspace_id: string;
    initiated_by_user_id: string;
    provider_key: string;
    redirect_uri: string;
    requested_scopes: string[];
    operation: string;
    target_connection_id: string | null;
    expires_at: Date;
    consumed_at: Date | null;
  }>(
    `SELECT
       id,
       organization_id,
       workspace_id,
       initiated_by_user_id,
       provider_key,
       redirect_uri,
       requested_scopes,
       operation,
       target_connection_id,
       expires_at,
       consumed_at
     FROM oauth_authorization_states
     WHERE state_hash = $1
     LIMIT 1`,
    [stateHash],
    connectionString ? getDatabasePool(connectionString) : undefined,
  );

  if (res.rows.length === 0) {
    return null;
  }

  const row = res.rows[0];
  return {
    stateId: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    initiatedByUserId: row.initiated_by_user_id,
    providerKey: row.provider_key,
    redirectUri: row.redirect_uri,
    requestedScopes: row.requested_scopes,
    operation: row.operation,
    targetConnectionId: row.target_connection_id,
    expiresAtIso: new Date(row.expires_at).toISOString(),
    consumedAtIso: row.consumed_at ? new Date(row.consumed_at).toISOString() : null,
  };
}

/**
 * Enriches Google OAuth v2 authorization URLs with real OAuth parameters (`client_id`,
 * `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`) while preserving
 * PKCE S256 challenge and cryptographic state.
 */
export function buildGoogleAuthorizeUrl(
  baseAuthorizationUrl: string,
  options?: {
    clientId?: string;
    loginHint?: string;
  },
): string {
  const clientId = options?.clientId ?? process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    return baseAuthorizationUrl;
  }

  const url = new URL(baseAuthorizationUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  if (options?.loginHint) {
    url.searchParams.set("login_hint", options.loginHint);
  }
  return url.toString();
}

export interface GoogleOAuthHandlerOptions {
  clientId?: string;
  clientSecret?: string;
  fetchFn?: typeof fetch;
  mode?: "auto" | "live" | "sandbox";
}

interface GoogleTokenErrorBody {
  error?: string;
  error_description?: string;
}

interface GoogleTokenSuccessBody {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

function mapGoogleOAuthHttpFailure(options: {
  providerKey: string;
  status: number;
  bodyText: string;
  operation: "exchange" | "refresh";
}): ProviderAdapterError {
  let parsed: GoogleTokenErrorBody = {};
  try {
    parsed = JSON.parse(options.bodyText) as GoogleTokenErrorBody;
  } catch {
    parsed = {};
  }

  const googleError = (parsed.error ?? "").toLowerCase();
  const detail = redactSensitiveText(
    parsed.error_description ?? parsed.error ?? `HTTP ${options.status}`,
  );

  if (options.status === 429) {
    return new ProviderAdapterError({
      providerKey: options.providerKey,
      code: PROVIDER_ERROR_CODES.RATE_LIMITED,
      retryable: true,
      retryAfterSeconds: 30,
      message: `Google OAuth token endpoint rate limited during ${options.operation}: ${detail}`,
    });
  }

  if (googleError === "invalid_grant") {
    return new ProviderAdapterError({
      providerKey: options.providerKey,
      code: PROVIDER_ERROR_CODES.CREDENTIAL_EXPIRED,
      retryable: false,
      message: `Google OAuth grant is expired or revoked during ${options.operation}: ${detail}`,
    });
  }

  if (
    googleError === "invalid_client" ||
    googleError === "unauthorized_client" ||
    options.status === 401
  ) {
    return new ProviderAdapterError({
      providerKey: options.providerKey,
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      retryable: false,
      message: `Google OAuth client authentication failed during ${options.operation}: ${detail}`,
    });
  }

  if (options.status >= 500) {
    return new ProviderAdapterError({
      providerKey: options.providerKey,
      code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
      retryable: true,
      message: `Google OAuth service temporarily unavailable during ${options.operation}.`,
    });
  }

  return new ProviderAdapterError({
    providerKey: options.providerKey,
    code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
    retryable: false,
    message: `Google OAuth ${options.operation} rejected: ${detail}`,
  });
}

function shouldUseSandboxGoogleFallback(
  options: GoogleOAuthHandlerOptions | undefined,
  codeOrToken: string,
): boolean {
  if (options?.fetchFn) {
    return false;
  }

  const mode = options?.mode ?? resolveGoogleApiMode();
  if (mode === "sandbox") {
    return true;
  }

  const configured =
    Boolean(options?.clientId && options?.clientSecret) || isGoogleOAuthConfigured();
  if (mode === "live") {
    return false;
  }

  if (!configured) {
    return true;
  }

  return codeOrToken.startsWith("sbx_") || codeOrToken.startsWith("code_");
}

async function fetchGoogleAccountSummary(
  accessToken: string,
  fetchFn: typeof fetch,
): Promise<{ externalAccountId?: string; externalAccountLabel?: string }> {
  try {
    const res = await fetchFn(GOOGLE_USERINFO_URL, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
      },
    });
    if (!res.ok) {
      return {};
    }
    const profile = (await res.json()) as { sub?: string; email?: string; name?: string };
    return {
      externalAccountId: profile.sub ? `google_sub_${profile.sub}` : undefined,
      externalAccountLabel: profile.email ?? profile.name ?? undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Creates a Google OAuth 2.0 + PKCE token exchange handler for GA4 and Search Console.
 */
export function createGoogleOAuthTokenExchangeHandler(
  options?: GoogleOAuthHandlerOptions,
): OAuthTokenExchangeHandler {
  return async (params) => {
    assertReadOnlyScopesOnly(params.providerKey, params.requestedScopes);

    if (shouldUseSandboxGoogleFallback(options, params.authorizationCode)) {
      const sandbox = await defaultSandboxTokenExchangeHandler(params);
      const tokenSuffix = crypto.randomBytes(8).toString("hex");
      return {
        ...sandbox,
        accessToken: `sbx_google_${params.providerKey}_at_${tokenSuffix}`,
        refreshToken: `sbx_google_${params.providerKey}_rt_${tokenSuffix}`,
      };
    }

    const clientId = options?.clientId ?? process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = options?.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      throw new ProviderAdapterError({
        providerKey: params.providerKey,
        code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
        message:
          "Google OAuth client credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) are missing for live OAuth exchange.",
      });
    }

    const fetchFn = options?.fetchFn ?? fetch;
    const form = new URLSearchParams({
      code: params.authorizationCode,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: params.redirectUri,
      grant_type: "authorization_code",
      code_verifier: params.codeVerifier,
    });

    const response = await fetchFn(GOOGLE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: form.toString(),
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw mapGoogleOAuthHttpFailure({
        providerKey: params.providerKey,
        status: response.status,
        bodyText: rawText,
        operation: "exchange",
      });
    }

    const payload = JSON.parse(rawText) as GoogleTokenSuccessBody;
    if (!payload.access_token) {
      throw new ProviderAdapterError({
        providerKey: params.providerKey,
        code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
        message: "Google OAuth token exchange response omitted access_token.",
      });
    }

    const grantedScopes =
      typeof payload.scope === "string" && payload.scope.trim().length > 0
        ? payload.scope.trim().split(/\s+/)
        : [...params.requestedScopes];

    assertReadOnlyScopesOnly(params.providerKey, grantedScopes);

    const userInfo = await fetchGoogleAccountSummary(payload.access_token, fetchFn);
    const expiresInSeconds = typeof payload.expires_in === "number" ? payload.expires_in : 3600;

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      tokenType: payload.token_type ?? "Bearer",
      expiresInSeconds,
      grantedScopes,
      externalAccountId:
        userInfo.externalAccountId ?? `google_${params.providerKey}_authorized_account`,
      externalAccountLabel:
        userInfo.externalAccountLabel ?? `Google (${params.providerKey.toUpperCase()})`,
    };
  };
}

/**
 * Creates a Google OAuth 2.0 token refresh handler for GA4 and Search Console connections.
 */
export function createGoogleOAuthRefreshHandler(
  options?: GoogleOAuthHandlerOptions,
): OAuthTokenRefreshHandler {
  return async (params) => {
    if (shouldUseSandboxGoogleFallback(options, params.refreshToken)) {
      const sandbox = await defaultSandboxTokenRefreshHandler(params);
      const tokenSuffix = crypto.randomBytes(8).toString("hex");
      return {
        ...sandbox,
        accessToken: `sbx_google_${params.providerKey}_at_refreshed_${tokenSuffix}`,
        refreshToken:
          sandbox.refreshToken && sandbox.refreshToken !== params.refreshToken
            ? sandbox.refreshToken
            : `sbx_google_${params.providerKey}_rt_rotated_${tokenSuffix}`,
      };
    }

    const clientId = options?.clientId ?? process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = options?.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      throw new ProviderAdapterError({
        providerKey: params.providerKey,
        code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
        message:
          "Google OAuth client credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) are missing for token refresh.",
      });
    }

    const fetchFn = options?.fetchFn ?? fetch;
    const form = new URLSearchParams({
      refresh_token: params.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    });

    const response = await fetchFn(GOOGLE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: form.toString(),
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw mapGoogleOAuthHttpFailure({
        providerKey: params.providerKey,
        status: response.status,
        bodyText: rawText,
        operation: "refresh",
      });
    }

    const payload = JSON.parse(rawText) as GoogleTokenSuccessBody;
    if (!payload.access_token) {
      throw new ProviderAdapterError({
        providerKey: params.providerKey,
        code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
        message: "Google OAuth refresh response omitted access_token.",
      });
    }

    const grantedScopes =
      typeof payload.scope === "string" && payload.scope.trim().length > 0
        ? payload.scope.trim().split(/\s+/)
        : [...params.grantedScopes];

    assertReadOnlyScopesOnly(params.providerKey, grantedScopes);

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      tokenType: payload.token_type ?? "Bearer",
      expiresInSeconds: typeof payload.expires_in === "number" ? payload.expires_in : 3600,
      grantedScopes,
    };
  };
}
