import "dotenv/config";
import {
  completeOAuthCallback,
  createLogicalProject,
  initiateOAuthAuthorization,
  registerUserWithDefaultOwnership,
  resolveSessionByToken,
} from "@avenor/auth";
import { closeAllDatabasePools, runMigrations } from "@avenor/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  discoverAndPersistConnectionResources,
  getWorkspaceConnectionDetail,
  mapResourceToProjectEnvironment,
} from "@/lib/connections";
import { CLOUDFLARE_CANONICAL_METRIC_KEYS, getProviderAdapter } from "@/lib/providers";

describe("THE-148: Cloudflare Read-Only Zone Analytics Integration", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await closeAllDatabasePools();
  });

  it("connects Cloudflare read-only, discovers zones, maps to logical project, reads GraphQL analytics metrics, and enforces cross-tenant isolation", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const reg = await registerUserWithDefaultOwnership({
      name: "Edge Operator",
      email: `cf.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `CF Org ${suffix}`,
      workspaceName: `CF Workspace ${suffix}`,
    });
    const session = await resolveSessionByToken(reg.rawSessionToken);
    const workspaceId = reg.context.activeWorkspace.id;

    const otherReg = await registerUserWithDefaultOwnership({
      name: "Other Edge Tenant",
      email: `other.cf.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Other CF Org ${suffix}`,
      workspaceName: `Other CF Workspace ${suffix}`,
    });
    const otherSession = await resolveSessionByToken(otherReg.rawSessionToken);

    const project = await createLogicalProject(session, workspaceId, {
      name: "Avenor Edge App",
      slug: `cf-app-${suffix}`,
      primaryDomain: "https://avenor.corstack.dev",
      initialEnvironments: ["PRODUCTION"],
    });
    const prodEnv = project.environments[0];
    if (!prodEnv) throw new Error("Expected default env");

    const redirectUri = "http://localhost:3000/api/connections/oauth/callback";
    const init = await initiateOAuthAuthorization({
      session,
      workspaceId,
      providerKey: "cloudflare",
      authorizeEndpointUrl: "https://dash.cloudflare.com/oauth2/auth",
      requestedScopes: ["zone.analytics:read", "account.analytics:read"],
      redirectUri,
    });
    const cb = await completeOAuthCallback({
      session,
      workspaceId,
      providerKey: "cloudflare",
      displayName: "Cloudflare Edge Analytics",
      rawStateToken: init.rawStateToken,
      redirectUri,
      authorizationCode: "code_cf_ro_ok",
    });

    const discovered = await discoverAndPersistConnectionResources(
      session,
      workspaceId,
      cb.connectionId,
    );
    expect(discovered).toHaveLength(1);
    const zone = discovered[0];
    if (!zone) throw new Error("Expected discovered zone");
    expect(zone.metadata.dnsAndWafMutationsBlocked).toBe(true);

    const mapping = await mapResourceToProjectEnvironment(session, workspaceId, {
      projectId: project.id,
      environmentId: prodEnv.id,
      connectedResourceId: zone.id,
      mappingRole: "PRIMARY",
    });
    expect(mapping.externalResourceId).toBe("cf_zone_avenor_prod_01");

    const adapter = getProviderAdapter("cloudflare");
    const reads = await adapter.readMetrics(
      {
        organizationId: reg.context.activeOrganizationId,
        workspaceId,
        apiToken: "cf_ro_sandbox_token",
        grantedScopes: ["zone.analytics:read", "account.analytics:read"],
      },
      {
        externalResourceId: "cf_zone_avenor_prod_01",
        capabilityKey: "edge_traffic",
        metricKey: CLOUDFLARE_CANONICAL_METRIC_KEYS.EDGE_REQUESTS,
        granularity: "daily",
        startDateIso: "2026-11-19T00:00:00.000Z",
        endDateIso: "2026-11-20T00:00:00.000Z",
      },
    );
    expect(reads.capabilityStatus).toBe("SUPPORTED");
    expect(reads.points[0]?.value).toBe(185_000);

    await expect(
      getWorkspaceConnectionDetail(otherSession, workspaceId, cb.connectionId),
    ).rejects.toThrow();
  });
});
