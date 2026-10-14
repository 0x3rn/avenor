import "dotenv/config";
import {
  completeOAuthCallback,
  decryptConnectionCredentialForServer,
  defaultSandboxTokenRefreshHandler,
  disconnectProviderConnection,
  initiateOAuthAuthorization,
  refreshConnectionOAuthToken,
  registerUserWithDefaultOwnership,
} from "@avenor/auth";
import { closeAllDatabasePools, resetTestDatabaseRecords, runMigrations } from "@avenor/database";
import { ERROR_CODES, PROVIDER_ERROR_CODES } from "@avenor/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const CALLBACK_URI = "http://localhost:3000/api/connections/oauth/callback";

describe("THE-119: OAuth authorization, PKCE callback, replay protection, re-consent, concurrency-safe refresh, and disconnect", () => {
  beforeAll(async () => {
    await runMigrations({ connectionString: TEST_DB_URL });
    await resetTestDatabaseRecords({ connectionString: TEST_DB_URL });
  });

  afterAll(async () => {
    await resetTestDatabaseRecords({ connectionString: TEST_DB_URL });
    await closeAllDatabasePools();
  });

  it("blocks state replay, expired states, cross-user/workspace callbacks, and handles consent denial cleanly", async () => {
    const tenantA = await registerUserWithDefaultOwnership({
      name: "OAuth Owner A",
      email: "oauth-a@avenor.test",
      password: "OAuthSecurePassword!123",
      organizationName: "OAuth Org A",
      workspaceName: "OAuth Workspace A",
    });

    const tenantB = await registerUserWithDefaultOwnership({
      name: "OAuth Owner B",
      email: "oauth-b@avenor.test",
      password: "OAuthSecurePassword!123",
      organizationName: "OAuth Org B",
      workspaceName: "OAuth Workspace B",
    });

    // 1. Expired state is rejected
    const expiredInit = await initiateOAuthAuthorization({
      session: tenantA.context,
      workspaceId: tenantA.context.activeWorkspace.id,
      providerKey: "avenor-sandbox",
      authorizeEndpointUrl: "/api/connections/oauth/sandbox-authorize",
      requestedScopes: ["sandbox.resources.readonly", "sandbox.metrics.readonly"],
      redirectUri: CALLBACK_URI,
      ttlMs: -5000,
    });

    await expect(
      completeOAuthCallback({
        session: tenantA.context,
        workspaceId: tenantA.context.activeWorkspace.id,
        providerKey: "avenor-sandbox",
        rawStateToken: expiredInit.rawStateToken,
        redirectUri: CALLBACK_URI,
        authorizationCode: "valid_code_123",
        connectionString: TEST_DB_URL,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
    });

    // 2. Consent denial is recorded cleanly without creating a broken connection
    const deniedInit = await initiateOAuthAuthorization({
      session: tenantA.context,
      workspaceId: tenantA.context.activeWorkspace.id,
      providerKey: "avenor-sandbox",
      authorizeEndpointUrl: "/api/connections/oauth/sandbox-authorize",
      requestedScopes: ["sandbox.resources.readonly", "sandbox.metrics.readonly"],
      redirectUri: CALLBACK_URI,
    });

    await expect(
      completeOAuthCallback({
        session: tenantA.context,
        workspaceId: tenantA.context.activeWorkspace.id,
        providerKey: "avenor-sandbox",
        rawStateToken: deniedInit.rawStateToken,
        redirectUri: CALLBACK_URI,
        oauthError: "access_denied",
        oauthErrorDescription: "User declined consent screen.",
        connectionString: TEST_DB_URL,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
    });

    // 3. Cross-tenant / cross-user callback attempt is blocked with FORBIDDEN
    const validInit = await initiateOAuthAuthorization({
      session: tenantA.context,
      workspaceId: tenantA.context.activeWorkspace.id,
      providerKey: "avenor-sandbox",
      authorizeEndpointUrl: "/api/connections/oauth/sandbox-authorize",
      requestedScopes: ["sandbox.resources.readonly", "sandbox.metrics.readonly"],
      redirectUri: CALLBACK_URI,
    });

    await expect(
      completeOAuthCallback({
        session: tenantB.context,
        workspaceId: tenantB.context.activeWorkspace.id,
        providerKey: "avenor-sandbox",
        rawStateToken: validInit.rawStateToken,
        redirectUri: CALLBACK_URI,
        authorizationCode: "valid_code_123",
        connectionString: TEST_DB_URL,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });

    // 4. Tenant A completes the valid state -> succeeds
    const completed = await completeOAuthCallback({
      session: tenantA.context,
      workspaceId: tenantA.context.activeWorkspace.id,
      providerKey: "avenor-sandbox",
      rawStateToken: validInit.rawStateToken,
      redirectUri: CALLBACK_URI,
      authorizationCode: "valid_code_123",
      connectionString: TEST_DB_URL,
    });
    expect(completed.status).toBe("HEALTHY");
    expect(completed.refreshTokenPresent).toBe(true);

    // 5. Replaying the exact same state token a second time is blocked with FORBIDDEN
    await expect(
      completeOAuthCallback({
        session: tenantA.context,
        workspaceId: tenantA.context.activeWorkspace.id,
        providerKey: "avenor-sandbox",
        rawStateToken: validInit.rawStateToken,
        redirectUri: CALLBACK_URI,
        authorizationCode: "valid_code_123",
        connectionString: TEST_DB_URL,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });
  });

  it("handles partial scopes (PERMISSION_MISSING), preserves refreshToken on re-consent without new refresh_token, serializes concurrent refreshes, and disconnects cleanly", async () => {
    const owner = await registerUserWithDefaultOwnership({
      name: "Lifecycle Owner",
      email: "oauth-lifecycle@avenor.test",
      password: "OAuthLifecyclePassword!123",
      organizationName: "Lifecycle Org",
      workspaceName: "Lifecycle Workspace",
    });

    const workspaceId = owner.context.activeWorkspace.id;
    const organizationId = owner.context.activeWorkspace.organizationId;

    // Step 1: Connect with partial scopes -> PERMISSION_MISSING
    const partialInit = await initiateOAuthAuthorization({
      session: owner.context,
      workspaceId,
      providerKey: "avenor-sandbox",
      authorizeEndpointUrl: "/api/connections/oauth/sandbox-authorize",
      requestedScopes: ["sandbox.resources.readonly", "sandbox.metrics.readonly"],
      redirectUri: CALLBACK_URI,
    });

    const partialResult = await completeOAuthCallback({
      session: owner.context,
      workspaceId,
      providerKey: "avenor-sandbox",
      rawStateToken: partialInit.rawStateToken,
      redirectUri: CALLBACK_URI,
      authorizationCode: "code_partial_scope",
      connectionString: TEST_DB_URL,
    });

    expect(partialResult.status).toBe("PERMISSION_MISSING");
    expect(partialResult.missingScopes).toEqual(["sandbox.metrics.readonly"]);
    expect(partialResult.refreshTokenPresent).toBe(true);

    const initialCred = await decryptConnectionCredentialForServer({
      organizationId,
      workspaceId,
      connectionId: partialResult.connectionId,
    });
    const originalRefreshToken = initialCred.exposeSecretForServerAdapter().refreshToken;
    expect(originalRefreshToken).toBeDefined();

    // Step 2: Re-consent with full scopes where upstream omits a new refresh_token
    const reconsentInit = await initiateOAuthAuthorization({
      session: owner.context,
      workspaceId,
      providerKey: "avenor-sandbox",
      authorizeEndpointUrl: "/api/connections/oauth/sandbox-authorize",
      requestedScopes: ["sandbox.resources.readonly", "sandbox.metrics.readonly"],
      redirectUri: CALLBACK_URI,
      operation: "reconsent",
      targetConnectionId: partialResult.connectionId,
    });

    const reconsentResult = await completeOAuthCallback({
      session: owner.context,
      workspaceId,
      providerKey: "avenor-sandbox",
      rawStateToken: reconsentInit.rawStateToken,
      redirectUri: CALLBACK_URI,
      authorizationCode: "code_full_no_refresh_token",
      connectionString: TEST_DB_URL,
    });

    expect(reconsentResult.connectionId).toBe(partialResult.connectionId);
    expect(reconsentResult.status).toBe("HEALTHY");
    expect(reconsentResult.missingScopes).toHaveLength(0);
    expect(reconsentResult.refreshTokenPresent).toBe(true);

    const credAfterReconsent = await decryptConnectionCredentialForServer({
      organizationId,
      workspaceId,
      connectionId: partialResult.connectionId,
    });
    expect(credAfterReconsent.exposeSecretForServerAdapter().refreshToken).toBe(
      originalRefreshToken,
    );

    // Step 3: Concurrency-safe token refresh with row locking
    const [refresh1, refresh2] = await Promise.all([
      refreshConnectionOAuthToken({
        organizationId,
        workspaceId,
        connectionId: partialResult.connectionId,
        actorUserId: owner.context.user.id,
        connectionString: TEST_DB_URL,
      }),
      refreshConnectionOAuthToken({
        organizationId,
        workspaceId,
        connectionId: partialResult.connectionId,
        actorUserId: owner.context.user.id,
        connectionString: TEST_DB_URL,
      }),
    ]);

    expect(refresh1.status).toBe("HEALTHY");
    expect(refresh2.status).toBe("HEALTHY");
    expect(refresh1.refreshTokenPreserved).toBe(true);
    expect(refresh2.refreshTokenPreserved).toBe(true);

    // Step 4: Simulate upstream revoked refresh token -> transitions connection to REVOKED
    await expect(
      refreshConnectionOAuthToken({
        organizationId,
        workspaceId,
        connectionId: partialResult.connectionId,
        refreshFn: async () => {
          return defaultSandboxTokenRefreshWithRevokedError();
        },
        connectionString: TEST_DB_URL,
      }),
    ).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      healthStatus: "REVOKED",
    });

    // Step 5: Disconnect revokes and purges credentials and transitions connection to DISCONNECTED
    const disconnected = await disconnectProviderConnection({
      session: owner.context,
      workspaceId,
      connectionId: partialResult.connectionId,
      connectionString: TEST_DB_URL,
    });
    expect(disconnected.status).toBe("DISCONNECTED");

    await expect(
      decryptConnectionCredentialForServer({
        organizationId,
        workspaceId,
        connectionId: partialResult.connectionId,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });
  });
});

async function defaultSandboxTokenRefreshWithRevokedError() {
  return defaultSandboxTokenRefreshHandler({
    providerKey: "avenor-sandbox",
    refreshToken: "invalid_grant_revoked_token",
    grantedScopes: ["sandbox.resources.readonly"],
  });
}
