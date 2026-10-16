import crypto from "node:crypto";
import { assertServerRuntime } from "@avenor/config";
import { dbQuery, generateId, withTransaction, writeAuditLog } from "@avenor/database";
import {
  AppError,
  type ConnectionHealthStatus,
  ERROR_CODES,
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
} from "@avenor/types";
import { authorizeWorkspaceAccess } from "./rbac";
import type { AuthenticatedSessionContext } from "./service";
import {
  decryptConnectionCredentialForServer,
  decryptCredentialEnvelope,
  encryptCredentialPayload,
  revokeAndPurgeConnectionCredential,
  storeConnectionCredential,
  type VaultKeyRing,
} from "./vault";

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const PROHIBITED_MUTATION_SCOPE_PATTERNS = [
  /(?:^|[.:/_-])write(?:$|[.:/_-])/i,
  /(?:^|[.:/_-])admin(?:$|[.:/_-])/i,
  /(?:^|[.:/_-])delete(?:$|[.:/_-])/i,
  /(?:^|[.:/_-])mutate(?:$|[.:/_-])/i,
  /^https:\/\/www\.googleapis\.com\/auth\/cloud-platform$/i,
  /^https:\/\/www\.googleapis\.com\/auth\/analytics\.edit$/i,
  /^https:\/\/www\.googleapis\.com\/auth\/webmasters$/i,
  /^repo$/i,
  /^delete_repo$/i,
];

export function assertReadOnlyScopesOnly(providerKey: string, scopes: readonly string[]): void {
  if (scopes.length === 0) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `At least one read-only scope is required for provider "${providerKey}".`,
    });
  }

  for (const scope of scopes) {
    const trimmed = scope.trim();
    for (const pattern of PROHIBITED_MUTATION_SCOPE_PATTERNS) {
      if (pattern.test(trimmed)) {
        throw new AppError({
          code: ERROR_CODES.PRODUCTION_SAFETY_VIOLATION,
          message: `Scope "${trimmed}" is prohibited for provider "${providerKey}". Avenor only permits read-only scopes.`,
        });
      }
    }
  }
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

export function generatePkcePair(): PkcePair {
  assertServerRuntime("generatePkcePair");
  const codeVerifier = crypto.randomBytes(48).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier, "ascii")
    .digest("base64url");
  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: "S256",
  };
}

export function verifyPkceCodeChallenge(codeVerifier: string, expectedChallenge: string): boolean {
  assertServerRuntime("verifyPkceCodeChallenge");
  if (!codeVerifier || !expectedChallenge || codeVerifier.length < 43) {
    return false;
  }
  const computed = crypto.createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
  const computedBuf = Buffer.from(computed, "utf8");
  const expectedBuf = Buffer.from(expectedChallenge, "utf8");
  if (computedBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(computedBuf, expectedBuf);
}

export function hashOAuthStateToken(rawStateToken: string): string {
  return crypto.createHash("sha256").update(rawStateToken, "utf8").digest("hex");
}

export function getAllowedOAuthRedirectUris(
  rawEnv: Record<string, string | undefined> = process.env,
): readonly string[] {
  const baseOrigins = new Set<string>(["http://localhost:3000", "https://avenor.corstack.dev"]);
  for (const envUrl of [rawEnv.NEXT_PUBLIC_APP_URL, rawEnv.BETTER_AUTH_URL]) {
    if (envUrl) {
      try {
        baseOrigins.add(new URL(envUrl).origin);
      } catch {
        // Ignore invalid env URL here; validated elsewhere
      }
    }
  }

  const allowed: string[] = [];
  for (const origin of baseOrigins) {
    allowed.push(`${origin}/api/connections/oauth/callback`);
    allowed.push(`${origin}/connections`);
  }
  return allowed;
}

export function validateOAuthRedirectUri(
  redirectUri: string,
  allowedUris: readonly string[] = getAllowedOAuthRedirectUris(),
): string {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "OAuth redirect URI is not a valid URL.",
    });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "OAuth redirect URI must use http or https protocol.",
    });
  }

  if (
    redirectUri.includes("..") ||
    redirectUri.toLowerCase().includes("%2e%2e") ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname.includes("..")
  ) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message:
        "OAuth redirect URI must be an exact callback path without query parameters, fragments, or path traversal.",
    });
  }

  const normalized = `${parsed.origin}${parsed.pathname}`;
  if (!allowedUris.includes(normalized)) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: `OAuth redirect URI "${normalized}" is not in Avenor's allowlist.`,
    });
  }

  return normalized;
}

export interface InitiateOAuthAuthorizationInput {
  session: AuthenticatedSessionContext | null;
  workspaceId: string;
  providerKey: string;
  authorizeEndpointUrl: string;
  requestedScopes: readonly string[];
  redirectUri: string;
  operation?: "connect" | "reconsent";
  targetConnectionId?: string;
  allowedRedirectUris?: readonly string[];
  ttlMs?: number;
  keyRing?: VaultKeyRing;
}

export interface InitiateOAuthAuthorizationResult {
  stateId: string;
  rawStateToken: string;
  authorizationUrl: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  redirectUri: string;
  requestedScopes: readonly string[];
  expiresAtIso: string;
}

export async function initiateOAuthAuthorization(
  input: InitiateOAuthAuthorizationInput,
): Promise<InitiateOAuthAuthorizationResult> {
  assertServerRuntime("initiateOAuthAuthorization");

  const access = await authorizeWorkspaceAccess({
    session: input.session,
    workspaceId: input.workspaceId,
    requiredPermission: "connection:manage",
  });

  const operation = input.operation ?? "connect";
  assertReadOnlyScopesOnly(input.providerKey, input.requestedScopes);
  const validatedRedirectUri = validateOAuthRedirectUri(
    input.redirectUri,
    input.allowedRedirectUris,
  );

  if (operation === "reconsent") {
    if (!input.targetConnectionId) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "targetConnectionId is required when initiating a reconsent OAuth flow.",
      });
    }
    const existingConn = await dbQuery<{ id: string; workspace_id: string; provider_key: string }>(
      `SELECT id, workspace_id, provider_key FROM provider_connections WHERE id = $1 LIMIT 1`,
      [input.targetConnectionId],
    );
    if (
      existingConn.rows.length === 0 ||
      existingConn.rows[0].workspace_id !== input.workspaceId ||
      existingConn.rows[0].provider_key !== input.providerKey
    ) {
      throw new AppError({
        code: ERROR_CODES.FORBIDDEN,
        message: "Target connection does not belong to this workspace or provider.",
      });
    }
  }

  const stateId = generateId("oas");
  const rawStateToken = crypto.randomBytes(32).toString("base64url");
  const stateTokenHash = hashOAuthStateToken(rawStateToken);
  const pkce = generatePkcePair();
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? OAUTH_STATE_TTL_MS));

  // Encrypt PKCE codeVerifier at rest using tenant-bound AAD
  const verifierEnvelope = encryptCredentialPayload(
    {
      accessToken: pkce.codeVerifier,
      scopes: input.requestedScopes,
    },
    {
      organizationId: access.organizationId,
      workspaceId: input.workspaceId,
      connectionId: stateId,
      providerKey: input.providerKey,
      credentialType: "oauth_tokens",
    },
    input.keyRing,
  );

  await dbQuery(
    `INSERT INTO oauth_authorization_states (
       id,
       state_token_hash,
       organization_id,
       workspace_id,
       user_id,
       provider_key,
       operation,
       target_connection_id,
       redirect_uri,
       requested_scopes,
       code_verifier_ciphertext,
       code_challenge,
       code_challenge_method,
       expires_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'S256', $13)`,
    [
      stateId,
      stateTokenHash,
      access.organizationId,
      input.workspaceId,
      access.session.user.id,
      input.providerKey,
      operation,
      input.targetConnectionId ?? null,
      validatedRedirectUri,
      [...input.requestedScopes],
      JSON.stringify(verifierEnvelope),
      pkce.codeChallenge,
      expiresAt,
    ],
  );

  await writeAuditLog({
    organizationId: access.organizationId,
    workspaceId: input.workspaceId,
    actorUserId: access.session.user.id,
    action: "connection.oauth_initiated",
    entityType: "OAuthAuthorizationState",
    entityId: stateId,
    summary: `Initiated read-only OAuth ${operation} flow for ${input.providerKey} with PKCE (S256).`,
    metadata: {
      providerKey: input.providerKey,
      operation,
      requestedScopes: [...input.requestedScopes],
      redirectUri: validatedRedirectUri,
    },
  });

  const authUrl = new URL(input.authorizeEndpointUrl, "https://avenor.corstack.dev");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", validatedRedirectUri);
  authUrl.searchParams.set("scope", input.requestedScopes.join(" "));
  authUrl.searchParams.set("state", rawStateToken);
  authUrl.searchParams.set("code_challenge", pkce.codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("access_type", "offline");

  return {
    stateId,
    rawStateToken,
    authorizationUrl: input.authorizeEndpointUrl.startsWith("http")
      ? authUrl.toString()
      : `${authUrl.pathname}${authUrl.search}`,
    codeChallenge: pkce.codeChallenge,
    codeChallengeMethod: "S256",
    redirectUri: validatedRedirectUri,
    requestedScopes: input.requestedScopes,
    expiresAtIso: expiresAt.toISOString(),
  };
}

export interface OAuthTokenExchangeResponse {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresInSeconds?: number;
  grantedScopes: readonly string[];
  externalAccountId?: string;
  externalAccountLabel?: string;
}

export type OAuthTokenExchangeHandler = (params: {
  providerKey: string;
  authorizationCode: string;
  codeVerifier: string;
  redirectUri: string;
  requestedScopes: readonly string[];
}) => Promise<OAuthTokenExchangeResponse>;

export const defaultSandboxTokenExchangeHandler: OAuthTokenExchangeHandler = async (params) => {
  if (params.authorizationCode === "invalid_code") {
    throw new ProviderAdapterError({
      providerKey: params.providerKey,
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "Authorization code was rejected or expired during token exchange.",
    });
  }

  const isPartialScopeCode = params.authorizationCode.includes("partial_scope");
  const grantedScopes = isPartialScopeCode
    ? params.requestedScopes.slice(0, 1)
    : params.requestedScopes;

  const omitRefreshToken = params.authorizationCode.includes("no_refresh_token");

  return {
    accessToken: `avn_ro_access_${params.providerKey}_${crypto.randomBytes(12).toString("hex")}`,
    ...(omitRefreshToken
      ? {}
      : {
          refreshToken: `avn_ro_refresh_${params.providerKey}_${crypto.randomBytes(12).toString("hex")}`,
        }),
    tokenType: "Bearer",
    expiresInSeconds: 3600,
    grantedScopes,
    externalAccountId: `acct_${params.providerKey}_verified`,
    externalAccountLabel: `${params.providerKey.toUpperCase()} Verified Read-Only Account`,
  };
};

export interface CompleteOAuthCallbackInput {
  session: AuthenticatedSessionContext | null;
  workspaceId: string;
  providerKey: string;
  displayName?: string;
  rawStateToken: string;
  redirectUri: string;
  authorizationCode?: string;
  oauthError?: string;
  oauthErrorDescription?: string;
  exchangeTokenFn?: OAuthTokenExchangeHandler;
  keyRing?: VaultKeyRing;
  connectionString?: string;
}

export interface CompleteOAuthCallbackResult {
  connectionId: string;
  providerKey: string;
  displayName: string;
  status: ConnectionHealthStatus;
  operation: "connect" | "reconsent";
  requestedScopes: readonly string[];
  grantedScopes: readonly string[];
  missingScopes: readonly string[];
  refreshTokenPresent: boolean;
  externalAccountId: string | null;
  externalAccountLabel: string | null;
}

export async function completeOAuthCallback(
  input: CompleteOAuthCallbackInput,
): Promise<CompleteOAuthCallbackResult> {
  assertServerRuntime("completeOAuthCallback");

  const access = await authorizeWorkspaceAccess({
    session: input.session,
    workspaceId: input.workspaceId,
    requiredPermission: "connection:manage",
  });

  if (!input.rawStateToken || input.rawStateToken.trim().length < 16) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "Missing or malformed OAuth state parameter.",
    });
  }

  const stateTokenHash = hashOAuthStateToken(input.rawStateToken.trim());

  const txOutcome = await withTransaction<
    { ok: true; value: CompleteOAuthCallbackResult } | { ok: false; error: Error }
  >(
    async (client) => {
      const stateRes = await dbQuery<{
        id: string;
        organization_id: string;
        workspace_id: string;
        user_id: string;
        provider_key: string;
        operation: "connect" | "reconsent";
        target_connection_id: string | null;
        redirect_uri: string;
        requested_scopes: string[];
        code_verifier_ciphertext: string;
        code_challenge: string;
        expires_at: Date;
        consumed_at: Date | null;
      }>(
        `SELECT
           id,
           organization_id,
           workspace_id,
           user_id,
           provider_key,
           operation,
           target_connection_id,
           redirect_uri,
           requested_scopes,
           code_verifier_ciphertext,
           code_challenge,
           expires_at,
           consumed_at
         FROM oauth_authorization_states
         WHERE state_token_hash = $1
         FOR UPDATE`,
        [stateTokenHash],
        client,
      );

      if (stateRes.rows.length === 0) {
        return {
          ok: false,
          error: new AppError({
            code: ERROR_CODES.FORBIDDEN,
            message: "Invalid or unknown OAuth authorization state.",
          }),
        };
      }

      const stateRow = stateRes.rows[0];

      if (
        stateRow.organization_id !== access.organizationId ||
        stateRow.workspace_id !== input.workspaceId ||
        stateRow.user_id !== access.session.user.id ||
        stateRow.provider_key !== input.providerKey
      ) {
        await writeAuditLog(
          {
            organizationId: access.organizationId,
            workspaceId: input.workspaceId,
            actorUserId: access.session.user.id,
            action: "connection.oauth_rejected",
            entityType: "OAuthAuthorizationState",
            entityId: stateRow.id,
            summary: `Blocked cross-user or cross-workspace OAuth callback mismatch for ${input.providerKey}.`,
            metadata: {
              reason: "binding_mismatch",
              expectedProvider: stateRow.provider_key,
              receivedProvider: input.providerKey,
            },
          },
          client,
        );
        return {
          ok: false,
          error: new AppError({
            code: ERROR_CODES.FORBIDDEN,
            message:
              "OAuth state binding mismatch: callback user, workspace, or provider does not match the initiating session.",
          }),
        };
      }

      if (stateRow.redirect_uri !== input.redirectUri) {
        return {
          ok: false,
          error: new AppError({
            code: ERROR_CODES.FORBIDDEN,
            message: "OAuth redirect URI mismatch against authorization state.",
          }),
        };
      }

      if (stateRow.consumed_at !== null) {
        await writeAuditLog(
          {
            organizationId: access.organizationId,
            workspaceId: input.workspaceId,
            actorUserId: access.session.user.id,
            action: "connection.oauth_rejected",
            entityType: "OAuthAuthorizationState",
            entityId: stateRow.id,
            summary: `Blocked replayed OAuth authorization state for ${input.providerKey}.`,
            metadata: { reason: "state_replayed" },
          },
          client,
        );
        return {
          ok: false,
          error: new AppError({
            code: ERROR_CODES.FORBIDDEN,
            message: "OAuth authorization state has already been consumed (replay blocked).",
          }),
        };
      }

      if (new Date(stateRow.expires_at).getTime() <= Date.now()) {
        await dbQuery(
          `UPDATE oauth_authorization_states SET consumed_at = now() WHERE id = $1`,
          [stateRow.id],
          client,
        );
        return {
          ok: false,
          error: new AppError({
            code: ERROR_CODES.VALIDATION_ERROR,
            message:
              "OAuth authorization state has expired. Please start the connection flow again.",
          }),
        };
      }

      // Consume the state atomically so it can never be replayed
      await dbQuery(
        `UPDATE oauth_authorization_states SET consumed_at = now() WHERE id = $1`,
        [stateRow.id],
        client,
      );

      // Handle user consent denial or upstream OAuth error cleanly
      if (input.oauthError) {
        await writeAuditLog(
          {
            organizationId: access.organizationId,
            workspaceId: input.workspaceId,
            actorUserId: access.session.user.id,
            action: "connection.oauth_denied",
            entityType: "OAuthAuthorizationState",
            entityId: stateRow.id,
            summary: `OAuth authorization for ${input.providerKey} was denied or cancelled (${input.oauthError}).`,
            metadata: {
              providerKey: input.providerKey,
              oauthError: input.oauthError,
              oauthErrorDescription: input.oauthErrorDescription ?? null,
            },
          },
          client,
        );
        return {
          ok: false,
          error: new AppError({
            code: ERROR_CODES.VALIDATION_ERROR,
            message:
              input.oauthErrorDescription ??
              `Authorization was cancelled or denied (${input.oauthError}). No connection changes were made.`,
          }),
        };
      }

      if (!input.authorizationCode || input.authorizationCode.trim().length < 4) {
        return {
          ok: false,
          error: new AppError({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: "Missing OAuth authorization code in callback.",
          }),
        };
      }

      const verifierEnvelope = JSON.parse(stateRow.code_verifier_ciphertext);
      const verifierHandle = decryptCredentialEnvelope(
        verifierEnvelope,
        {
          organizationId: stateRow.organization_id,
          workspaceId: stateRow.workspace_id,
          connectionId: stateRow.id,
          providerKey: stateRow.provider_key,
          credentialType: "oauth_tokens",
          version: verifierEnvelope.version,
        },
        input.keyRing,
      );
      const codeVerifier = verifierHandle.exposeSecretForServerAdapter().accessToken ?? "";

      if (!verifyPkceCodeChallenge(codeVerifier, stateRow.code_challenge)) {
        return {
          ok: false,
          error: new AppError({
            code: ERROR_CODES.FORBIDDEN,
            message: "PKCE code verifier validation failed against S256 challenge.",
          }),
        };
      }

      const exchangeFn = input.exchangeTokenFn ?? defaultSandboxTokenExchangeHandler;
      const exchanged = await exchangeFn({
        providerKey: input.providerKey,
        authorizationCode: input.authorizationCode.trim(),
        codeVerifier,
        redirectUri: stateRow.redirect_uri,
        requestedScopes: stateRow.requested_scopes,
      });

      assertReadOnlyScopesOnly(input.providerKey, exchanged.grantedScopes);

      const missingScopes = stateRow.requested_scopes.filter(
        (reqScope) => !exchanged.grantedScopes.includes(reqScope),
      );
      const connectionStatus: ConnectionHealthStatus =
        missingScopes.length > 0 ? "PERMISSION_MISSING" : "HEALTHY";

      let connectionId = stateRow.target_connection_id;
      let preservedRefreshToken = exchanged.refreshToken;
      const displayName =
        input.displayName?.trim() ||
        exchanged.externalAccountLabel ||
        `${input.providerKey.toUpperCase()} Read-Only Connection`;

      if (stateRow.operation === "reconsent" && connectionId) {
        // Preserve existing valid refresh token if repeated consent omits a new refresh token
        if (!preservedRefreshToken) {
          try {
            const existingCred = await decryptConnectionCredentialForServer(
              {
                organizationId: access.organizationId,
                workspaceId: input.workspaceId,
                connectionId,
                keyRing: input.keyRing,
              },
              client,
            );
            preservedRefreshToken = existingCred.exposeSecretForServerAdapter().refreshToken;
          } catch {
            // If no previous active credential existed, proceed with exchanged response
          }
        }

        await dbQuery(
          `UPDATE provider_connections
           SET display_name = $1,
               status = $2,
               requested_scopes = $3,
               granted_scopes = $4,
               external_account_id = COALESCE($5, external_account_id),
               external_account_label = COALESCE($6, external_account_label),
               last_error_code = $7,
               last_error_summary = $8,
               last_verified_at = now(),
               disconnected_at = NULL,
               updated_at = now()
           WHERE id = $9 AND workspace_id = $10`,
          [
            displayName,
            connectionStatus,
            stateRow.requested_scopes,
            [...exchanged.grantedScopes],
            exchanged.externalAccountId ?? null,
            exchanged.externalAccountLabel ?? null,
            missingScopes.length > 0 ? PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE : null,
            missingScopes.length > 0
              ? `Missing required read-only scope(s): ${missingScopes.join(", ")}`
              : null,
            connectionId,
            input.workspaceId,
          ],
          client,
        );
      } else {
        connectionId = generateId("con");
        await dbQuery(
          `INSERT INTO provider_connections (
             id,
             workspace_id,
             provider_key,
             display_name,
             auth_mode,
             external_account_id,
             external_account_label,
             status,
             requested_scopes,
             granted_scopes,
             last_error_code,
             last_error_summary,
             last_verified_at,
             created_by_user_id
           )
           VALUES ($1, $2, $3, $4, 'oauth2', $5, $6, $7, $8, $9, $10, $11, now(), $12)`,
          [
            connectionId,
            input.workspaceId,
            input.providerKey,
            displayName,
            exchanged.externalAccountId ?? null,
            exchanged.externalAccountLabel ?? null,
            connectionStatus,
            stateRow.requested_scopes,
            [...exchanged.grantedScopes],
            missingScopes.length > 0 ? PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE : null,
            missingScopes.length > 0
              ? `Missing required read-only scope(s): ${missingScopes.join(", ")}`
              : null,
            access.session.user.id,
          ],
          client,
        );
      }

      const expiresAtIso = exchanged.expiresInSeconds
        ? new Date(Date.now() + exchanged.expiresInSeconds * 1000).toISOString()
        : null;

      const storedCred = await storeConnectionCredential(
        {
          organizationId: access.organizationId,
          workspaceId: input.workspaceId,
          connectionId,
          providerKey: input.providerKey,
          credentialType: "oauth_tokens",
          payload: {
            accessToken: exchanged.accessToken,
            ...(preservedRefreshToken ? { refreshToken: preservedRefreshToken } : {}),
            tokenType: exchanged.tokenType ?? "Bearer",
            scopes: exchanged.grantedScopes,
            expiresAtIso,
          },
          actorUserId: access.session.user.id,
          keyRing: input.keyRing,
        },
        client,
      );

      await writeAuditLog(
        {
          organizationId: access.organizationId,
          workspaceId: input.workspaceId,
          actorUserId: access.session.user.id,
          action:
            stateRow.operation === "reconsent"
              ? "connection.reconsented"
              : "connection.oauth_completed",
          entityType: "ProviderConnection",
          entityId: connectionId,
          summary: `Completed read-only OAuth ${stateRow.operation} for ${input.providerKey} (${connectionStatus}).`,
          metadata: {
            providerKey: input.providerKey,
            operation: stateRow.operation,
            status: connectionStatus,
            grantedScopes: [...exchanged.grantedScopes],
            missingScopes,
            refreshTokenPresent: storedCred.refreshTokenPresent,
          },
        },
        client,
      );

      return {
        ok: true,
        value: {
          connectionId,
          providerKey: input.providerKey,
          displayName,
          status: connectionStatus,
          operation: stateRow.operation,
          requestedScopes: stateRow.requested_scopes,
          grantedScopes: exchanged.grantedScopes,
          missingScopes,
          refreshTokenPresent: storedCred.refreshTokenPresent,
          externalAccountId: exchanged.externalAccountId ?? null,
          externalAccountLabel: exchanged.externalAccountLabel ?? null,
        },
      };
    },
    { connectionString: input.connectionString },
  );

  if (!txOutcome.ok) {
    throw txOutcome.error;
  }
  return txOutcome.value;
}

export type OAuthTokenRefreshHandler = (params: {
  providerKey: string;
  refreshToken: string;
  grantedScopes: readonly string[];
}) => Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds?: number;
  grantedScopes?: readonly string[];
}>;

export const defaultSandboxTokenRefreshHandler: OAuthTokenRefreshHandler = async (params) => {
  if (params.refreshToken.includes("revoked") || params.refreshToken.includes("invalid_grant")) {
    throw new ProviderAdapterError({
      providerKey: params.providerKey,
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "OAuth refresh token was revoked upstream (invalid_grant).",
    });
  }
  if (params.refreshToken.includes("rate_limit")) {
    throw new ProviderAdapterError({
      providerKey: params.providerKey,
      code: PROVIDER_ERROR_CODES.RATE_LIMITED,
      message: "OAuth token endpoint rate limited refresh request.",
      retryable: true,
      retryAfterSeconds: 60,
    });
  }

  return {
    accessToken: `avn_ro_refreshed_${params.providerKey}_${crypto.randomBytes(12).toString("hex")}`,
    expiresInSeconds: 3600,
    grantedScopes: params.grantedScopes,
  };
};

export interface RefreshConnectionOAuthTokenInput {
  organizationId: string;
  workspaceId: string;
  connectionId: string;
  actorUserId?: string | null;
  refreshFn?: OAuthTokenRefreshHandler;
  keyRing?: VaultKeyRing;
  connectionString?: string;
}

export interface RefreshConnectionOAuthTokenResult {
  connectionId: string;
  status: ConnectionHealthStatus;
  tokenExpiresAtIso: string | null;
  refreshTokenPreserved: boolean;
}

export async function refreshConnectionOAuthToken(
  input: RefreshConnectionOAuthTokenInput,
): Promise<RefreshConnectionOAuthTokenResult> {
  assertServerRuntime("refreshConnectionOAuthToken");

  const txOutcome = await withTransaction<
    { ok: true; value: RefreshConnectionOAuthTokenResult } | { ok: false; error: Error }
  >(
    async (client) => {
      // Lock the connection row to serialize concurrent refresh attempts safely
      const connRes = await dbQuery<{
        id: string;
        workspace_id: string;
        provider_key: string;
        granted_scopes: string[];
        requested_scopes: string[];
        org_id: string;
      }>(
        `SELECT
           pc.id,
           pc.workspace_id,
           pc.provider_key,
           pc.granted_scopes,
           pc.requested_scopes,
           w.organization_id AS org_id
         FROM provider_connections pc
         INNER JOIN workspaces w ON w.id = pc.workspace_id
         WHERE pc.id = $1
         FOR UPDATE`,
        [input.connectionId],
        client,
      );

      if (connRes.rows.length === 0) {
        return {
          ok: false,
          error: new AppError({
            code: ERROR_CODES.NOT_FOUND,
            message: "Provider connection not found.",
          }),
        };
      }

      const conn = connRes.rows[0];
      if (conn.workspace_id !== input.workspaceId || conn.org_id !== input.organizationId) {
        return {
          ok: false,
          error: new AppError({
            code: ERROR_CODES.FORBIDDEN,
            message: "Cross-tenant token refresh denied.",
          }),
        };
      }

      const credHandle = await decryptConnectionCredentialForServer(
        {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          connectionId: input.connectionId,
          keyRing: input.keyRing,
        },
        client,
      );
      const currentPayload = credHandle.exposeSecretForServerAdapter();

      if (!currentPayload.refreshToken) {
        await dbQuery(
          `UPDATE provider_connections
           SET status = 'TOKEN_EXPIRED',
               last_error_code = 'CREDENTIAL_EXPIRED',
               last_error_summary = 'Access token expired and no refresh token is available. Re-authorize connection.',
               updated_at = now()
           WHERE id = $1`,
          [input.connectionId],
          client,
        );
        return {
          ok: false,
          error: new ProviderAdapterError({
            providerKey: conn.provider_key,
            code: PROVIDER_ERROR_CODES.CREDENTIAL_EXPIRED,
            message: "Cannot refresh credential: no refresh token is stored for this connection.",
          }),
        };
      }

      const refreshFn = input.refreshFn ?? defaultSandboxTokenRefreshHandler;

      try {
        const refreshed = await refreshFn({
          providerKey: conn.provider_key,
          refreshToken: currentPayload.refreshToken,
          grantedScopes: conn.granted_scopes,
        });

        const nextRefreshToken = refreshed.refreshToken ?? currentPayload.refreshToken;
        const nextScopes = refreshed.grantedScopes ?? conn.granted_scopes;
        const expiresAtIso = refreshed.expiresInSeconds
          ? new Date(Date.now() + refreshed.expiresInSeconds * 1000).toISOString()
          : null;

        await storeConnectionCredential(
          {
            organizationId: input.organizationId,
            workspaceId: input.workspaceId,
            connectionId: input.connectionId,
            providerKey: conn.provider_key,
            credentialType: "oauth_tokens",
            payload: {
              accessToken: refreshed.accessToken,
              refreshToken: nextRefreshToken,
              tokenType: currentPayload.tokenType ?? "Bearer",
              scopes: nextScopes,
              expiresAtIso,
            },
            actorUserId: input.actorUserId ?? null,
            keyRing: input.keyRing,
          },
          client,
        );

        const missingScopes = (conn.requested_scopes ?? []).filter((s) => !nextScopes.includes(s));
        const nextStatus: ConnectionHealthStatus =
          missingScopes.length > 0 ? "PERMISSION_MISSING" : "HEALTHY";

        await dbQuery(
          `UPDATE provider_connections
           SET status = $1,
               granted_scopes = $2,
               last_error_code = NULL,
               last_error_summary = NULL,
               last_verified_at = now(),
               updated_at = now()
           WHERE id = $3`,
          [nextStatus, [...nextScopes], input.connectionId],
          client,
        );

        await writeAuditLog(
          {
            organizationId: input.organizationId,
            workspaceId: input.workspaceId,
            actorUserId: input.actorUserId ?? null,
            action: "connection.token_refreshed",
            entityType: "ProviderConnection",
            entityId: input.connectionId,
            summary: `Refreshed read-only OAuth access token for ${conn.provider_key}.`,
            metadata: {
              providerKey: conn.provider_key,
              status: nextStatus,
              refreshTokenRotated: Boolean(refreshed.refreshToken),
            },
          },
          client,
        );

        return {
          ok: true,
          value: {
            connectionId: input.connectionId,
            status: nextStatus,
            tokenExpiresAtIso: expiresAtIso,
            refreshTokenPreserved: Boolean(nextRefreshToken),
          },
        };
      } catch (err) {
        if (err instanceof ProviderAdapterError) {
          await dbQuery(
            `UPDATE provider_connections
             SET status = $1,
                 last_error_code = $2,
                 last_error_summary = $3,
                 updated_at = now()
             WHERE id = $4`,
            [err.healthStatus, err.code, err.message, input.connectionId],
            client,
          );

          await writeAuditLog(
            {
              organizationId: input.organizationId,
              workspaceId: input.workspaceId,
              actorUserId: input.actorUserId ?? null,
              action: "connection.refresh_failed",
              entityType: "ProviderConnection",
              entityId: input.connectionId,
              summary: `OAuth token refresh failed for ${conn.provider_key} (${err.code}).`,
              metadata: {
                providerKey: conn.provider_key,
                errorCode: err.code,
                healthStatus: err.healthStatus,
              },
            },
            client,
          );
          return {
            ok: false,
            error: err,
          };
        }
        throw err;
      }
    },
    { connectionString: input.connectionString },
  );

  if (!txOutcome.ok) {
    throw txOutcome.error;
  }
  return txOutcome.value;
}

export async function disconnectProviderConnection(input: {
  session: AuthenticatedSessionContext | null;
  workspaceId: string;
  connectionId: string;
  reason?: string;
  connectionString?: string;
}): Promise<{
  connectionId: string;
  status: "DISCONNECTED";
  unmappedResourceCount: number;
  disconnectedAtIso: string;
}> {
  assertServerRuntime("disconnectProviderConnection");

  const access = await authorizeWorkspaceAccess({
    session: input.session,
    workspaceId: input.workspaceId,
    requiredPermission: "connection:manage",
  });

  return withTransaction(
    async (client) => {
      const connRes = await dbQuery<{
        id: string;
        workspace_id: string;
        provider_key: string;
        display_name: string;
      }>(
        `SELECT id, workspace_id, provider_key, display_name
         FROM provider_connections
         WHERE id = $1
         FOR UPDATE`,
        [input.connectionId],
        client,
      );

      if (connRes.rows.length === 0) {
        throw new AppError({
          code: ERROR_CODES.NOT_FOUND,
          message: "Provider connection not found.",
        });
      }

      const conn = connRes.rows[0];
      if (conn.workspace_id !== input.workspaceId) {
        throw new AppError({
          code: ERROR_CODES.FORBIDDEN,
          message: "Cross-tenant disconnect denied: connection does not belong to this workspace.",
        });
      }

      await revokeAndPurgeConnectionCredential(
        {
          organizationId: access.organizationId,
          workspaceId: input.workspaceId,
          connectionId: input.connectionId,
          actorUserId: access.session.user.id,
          reason: input.reason ?? "user_disconnect",
        },
        client,
      );

      const unmapRes = await dbQuery<{ id: string }>(
        `DELETE FROM resource_mappings
         WHERE workspace_id = $1
           AND connected_resource_id IN (
             SELECT id FROM connected_resources WHERE provider_connection_id = $2
           )
         RETURNING id`,
        [input.workspaceId, input.connectionId],
        client,
      );

      const disconnectedRes = await dbQuery<{ disconnected_at: Date }>(
        `UPDATE provider_connections
         SET status = 'DISCONNECTED',
             granted_scopes = '{}',
             encrypted_credentials_ciphertext = NULL,
             last_error_code = NULL,
             last_error_summary = 'Connection disconnected by workspace administrator.',
             disconnected_at = now(),
             updated_at = now()
         WHERE id = $1
         RETURNING disconnected_at`,
        [input.connectionId],
        client,
      );

      const disconnectedAtIso = new Date(disconnectedRes.rows[0].disconnected_at).toISOString();

      await writeAuditLog(
        {
          organizationId: access.organizationId,
          workspaceId: input.workspaceId,
          actorUserId: access.session.user.id,
          action: "connection.disconnected",
          entityType: "ProviderConnection",
          entityId: input.connectionId,
          summary: `Disconnected ${conn.display_name} (${conn.provider_key}), revoked encrypted credentials, and unmapped ${unmapRes.rows.length} resource(s).`,
          metadata: {
            providerKey: conn.provider_key,
            unmappedResourceCount: unmapRes.rows.length,
            reason: input.reason ?? "user_disconnect",
          },
        },
        client,
      );

      return {
        connectionId: input.connectionId,
        status: "DISCONNECTED",
        unmappedResourceCount: unmapRes.rows.length,
        disconnectedAtIso,
      };
    },
    { connectionString: input.connectionString },
  );
}
