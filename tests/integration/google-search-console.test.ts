import "dotenv/config";
import {
  completeOAuthCallback,
  createLogicalProject,
  decryptConnectionCredentialForServer,
  disconnectProviderConnection,
  initiateOAuthAuthorization,
  refreshConnectionOAuthToken,
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
import {
  GSC_READONLY_SCOPE,
  readSearchAnalyticsReportBundle,
} from "../../src/lib/providers/google-search-console";

describe("Milestone 03 — Search Console Discovery, Refresh & Mapping Integration (THE-125)", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await closeAllDatabasePools();
  });

  it("connects GSC read-only via PKCE OAuth, persists canonical sc-domain & URL-prefix properties, maps cleanly, rotates token, and revokes securely on disconnect", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const owner = await registerUserWithDefaultOwnership({
      name: "GSC Integration Lead",
      email: `gsc-int.${suffix}@avenor.test`,
      password: "StrongGscPassword!2026",
      organizationName: `GSC Org ${suffix}`,
      workspaceName: `GSC Workspace ${suffix}`,
    });
    const session = await resolveSessionByToken(owner.rawSessionToken);
    const workspaceId = owner.context.activeWorkspace.id;

    const project = await createLogicalProject(session, workspaceId, {
      name: "Signal Console Product",
      slug: `signal-console-${suffix}`,
      primaryDomain: "https://avenor.dev",
      initialEnvironments: ["PRODUCTION", "STAGING"],
    });
    const prodEnv = project.environments.find((e) => e.type === "PRODUCTION");
    if (!prodEnv) throw new Error("Expected PRODUCTION environment");

    const redirectUri = "http://localhost:3000/api/connections/oauth/callback";
    const init = await initiateOAuthAuthorization({
      session,
      workspaceId,
      providerKey: "gsc",
      authorizeEndpointUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      requestedScopes: [GSC_READONLY_SCOPE],
      redirectUri,
    });

    const connected = await completeOAuthCallback({
      session,
      workspaceId,
      providerKey: "gsc",
      displayName: "Search Console Production Properties",
      rawStateToken: init.rawStateToken,
      redirectUri,
      authorizationCode: "code_gsc_ok",
      exchangeTokenFn: async () => ({
        accessToken: `sbx_gsc_access_${suffix}`,
        refreshToken: `sbx_gsc_refresh_${suffix}`,
        expiresInSeconds: 3600,
        grantedScopes: [GSC_READONLY_SCOPE],
        externalAccountId: `gsc-acct-${suffix}`,
        externalAccountLabel: "Search Console Verified Account",
      }),
    });
    expect(connected.status).toBe("HEALTHY");

    const discovered = await discoverAndPersistConnectionResources(
      session,
      workspaceId,
      connected.connectionId,
    );
    expect(discovered.length).toBeGreaterThanOrEqual(2);

    const domainProp = discovered.find((r) => r.externalResourceId === "sc-domain:avenor.dev");
    const urlPrefixProp = discovered.find((r) => r.externalResourceId === "https://avenor.dev/");
    expect(domainProp).toBeDefined();
    expect(urlPrefixProp).toBeDefined();
    expect(domainProp?.resourceType).toBe("gsc_site");
    expect(domainProp?.metadata?.propertyKind).toBe("DOMAIN");
    expect(urlPrefixProp?.metadata?.propertyKind).toBe("URL_PREFIX");
    expect(domainProp?.metadata?.permissionLevel).toBe("siteOwner");

    if (!domainProp) throw new Error("Expected canonical domain property");

    // Map canonical domain property to Production environment
    const mapping = await mapResourceToProjectEnvironment(session, workspaceId, {
      connectedResourceId: domainProp.id,
      projectId: project.id,
      environmentId: prodEnv.id,
      mappingRole: "PRIMARY",
    });
    expect(mapping.externalResourceId).toBe("sc-domain:avenor.dev");

    // Verify encrypted token vault -> Search Analytics query report execution
    const initialCred = await decryptConnectionCredentialForServer({
      organizationId: owner.context.activeWorkspace.organizationId,
      workspaceId,
      connectionId: connected.connectionId,
    });
    const searchBundle = await readSearchAnalyticsReportBundle(
      {
        organizationId: owner.context.activeWorkspace.organizationId,
        workspaceId,
        connectionId: connected.connectionId,
        accessToken: initialCred.exposeSecretForServerAdapter().accessToken,
        grantedScopes: [GSC_READONLY_SCOPE],
      },
      {
        siteUrl: mapping.externalResourceId,
        startDate: "2026-10-01",
        endDate: "2026-10-07",
      },
    );
    expect(searchBundle.totals.clicks).toBeGreaterThan(0);
    expect(searchBundle.coverage.reportingTimeZone).toBe("America/Los_Angeles");
    expect(JSON.stringify(searchBundle)).not.toContain(`sbx_gsc_access_${suffix}`);

    // Rotate token via refresh and verify encrypted vault update without plain-text secret exposure
    await refreshConnectionOAuthToken({
      organizationId: owner.context.activeWorkspace.organizationId,
      workspaceId,
      connectionId: connected.connectionId,
      actorUserId: owner.context.user.id,
      refreshFn: async () => ({
        accessToken: `sbx_gsc_rotated_${suffix}`,
        expiresInSeconds: 3600,
        grantedScopes: [GSC_READONLY_SCOPE],
      }),
    });

    const credHandle = await decryptConnectionCredentialForServer({
      organizationId: owner.context.activeWorkspace.organizationId,
      workspaceId,
      connectionId: connected.connectionId,
    });
    expect(credHandle.exposeSecretForServerAdapter().accessToken).toBe(`sbx_gsc_rotated_${suffix}`);

    // Unmapping removes project binding while preserving connection grant
    await unmapResourceFromProject(session, workspaceId, mapping.id);
    const afterUnmap = await getWorkspaceConnectionDetail(
      session,
      workspaceId,
      connected.connectionId,
    );
    expect(afterUnmap.status).toBe("HEALTHY");
    expect(afterUnmap.mappings).toHaveLength(0);

    // Disconnect revokes vaulted credential cleanly
    await disconnectProviderConnection({
      session,
      workspaceId,
      connectionId: connected.connectionId,
    });
    const credStatus = await dbQuery<{ status: string }>(
      `SELECT status FROM provider_credentials WHERE provider_connection_id = $1`,
      [connected.connectionId],
    );
    expect(credStatus.rows[0]?.status).toBe("REVOKED");
    expect(JSON.stringify(afterUnmap.auditLogs)).not.toContain(`sbx_gsc_access_${suffix}`);
  });
});
