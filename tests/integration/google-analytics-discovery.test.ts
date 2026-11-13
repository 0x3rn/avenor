import "dotenv/config";
import {
  completeOAuthCallback,
  createLogicalProject,
  decryptConnectionCredentialForServer,
  initiateOAuthAuthorization,
  registerUserWithDefaultOwnership,
  resolveSessionByToken,
} from "@avenor/auth";
import { closeAllDatabasePools, dbQuery, runMigrations } from "@avenor/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  discoverAndPersistConnectionResources,
  getWorkspaceConnectionDetail,
  mapResourceToProjectEnvironment,
  unmapResourceFromProject,
} from "../../src/lib/connections";
import { GA4_READONLY_SCOPE } from "../../src/lib/providers/google-analytics";

describe("Milestone 03 — GA4 Discovery Persistence & Project Mapping Integration (THE-122)", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await closeAllDatabasePools();
  });

  it("connects GA4 read-only via PKCE OAuth, persists GA4 property + stream metadata, maps to project environments, and preserves grant on unmap", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const registered = await registerUserWithDefaultOwnership({
      name: "GA4 Integration Lead",
      email: `ga4-int.${suffix}@avenor.test`,
      password: "StrongGa4Password!2026",
      organizationName: `GA4 Org ${suffix}`,
      workspaceName: `GA4 Workspace ${suffix}`,
    });

    const session = await resolveSessionByToken(registered.rawSessionToken);
    expect(session).not.toBeNull();
    const workspaceId = registered.context.activeWorkspace.id;

    const project = await createLogicalProject(session, workspaceId, {
      name: "Signal Storefront",
      slug: `signal-storefront-${suffix}`,
      primaryDomain: "https://storefront.avenor.dev",
      initialEnvironments: ["PRODUCTION", "STAGING"],
    });
    const prodEnv = project.environments.find((e) => e.type === "PRODUCTION");
    expect(prodEnv).toBeDefined();

    const redirectUri = "http://localhost:3000/api/connections/oauth/callback";
    const authInit = await initiateOAuthAuthorization({
      session,
      workspaceId,
      providerKey: "ga4",
      authorizeEndpointUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      requestedScopes: [GA4_READONLY_SCOPE],
      redirectUri,
    });

    const connected = await completeOAuthCallback({
      session,
      workspaceId,
      providerKey: "ga4",
      displayName: "GA4 Storefront Read-Only",
      rawStateToken: authInit.rawStateToken,
      redirectUri,
      authorizationCode: "code_ga4_integration_ok",
      exchangeTokenFn: async () => ({
        accessToken: `sbx_ga4_access_${suffix}`,
        refreshToken: `sbx_ga4_refresh_${suffix}`,
        expiresInSeconds: 3600,
        grantedScopes: [GA4_READONLY_SCOPE],
        externalAccountId: `accounts/ga4_${suffix}`,
        externalAccountLabel: "Signal Analytics Organization",
      }),
    });
    expect(connected.status).toBe("HEALTHY");

    // Verify encrypted token vault retrieval for owning tenant & confirm raw tokens never leak in SQL rows/audit logs
    const credHandle = await decryptConnectionCredentialForServer({
      organizationId: registered.context.activeWorkspace.organizationId,
      workspaceId,
      connectionId: connected.connectionId,
    });
    expect(credHandle.exposeSecretForServerAdapter().accessToken).toBe(`sbx_ga4_access_${suffix}`);

    const rawDbCred = await dbQuery<{ ciphertext_base64: string }>(
      `SELECT ciphertext_base64 FROM provider_credentials WHERE provider_connection_id = $1`,
      [connected.connectionId],
    );
    expect(rawDbCred.rows).toHaveLength(1);
    expect(rawDbCred.rows[0]?.ciphertext_base64).not.toContain(`sbx_ga4_access_${suffix}`);
    expect(rawDbCred.rows[0]?.ciphertext_base64).not.toContain(`sbx_ga4_refresh_${suffix}`);

    // Discover & persist GA4 properties and child web data streams
    const discovered = await discoverAndPersistConnectionResources(
      session,
      workspaceId,
      connected.connectionId,
    );
    expect(discovered.length).toBeGreaterThanOrEqual(2);

    const primaryProperty = discovered.find((r) => r.externalResourceId === "properties/402918401");
    expect(primaryProperty).toBeDefined();
    if (!primaryProperty || !prodEnv) {
      throw new Error("Expected primaryProperty and prodEnv");
    }
    expect(primaryProperty.resourceType).toBe("ga4_property");
    expect(primaryProperty.metadata?.timeZone).toBe("America/New_York");
    expect(primaryProperty.metadata?.currencyCode).toBe("USD");
    expect(typeof primaryProperty.metadata?.dataStreamsJson).toBe("string");
    const parsedStreams = JSON.parse(String(primaryProperty.metadata?.dataStreamsJson)) as Array<{
      measurementId?: string | null;
    }>;
    expect(parsedStreams.length).toBeGreaterThan(0);

    // Map GA4 property to Production environment
    const mapping = await mapResourceToProjectEnvironment(session, workspaceId, {
      connectedResourceId: primaryProperty.id,
      projectId: project.id,
      environmentId: prodEnv.id,
      mappingRole: "PRIMARY",
    });
    expect(mapping.externalResourceId).toBe("properties/402918401");
    expect(mapping.providerKey).toBe("ga4");

    // Unmapping removes project mapping while keeping OAuth grant & discovered resources intact
    await unmapResourceFromProject(session, workspaceId, mapping.id);
    const detailAfterUnmap = await getWorkspaceConnectionDetail(
      session,
      workspaceId,
      connected.connectionId,
    );
    expect(detailAfterUnmap.status).toBe("HEALTHY");
    expect(detailAfterUnmap.mappings).toHaveLength(0);
    expect(detailAfterUnmap.connectedResources.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(detailAfterUnmap.auditLogs)).not.toContain(`sbx_ga4_access_${suffix}`);
  });
});
