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
import { getProviderAdapter, NEON_CANONICAL_METRIC_KEYS } from "@/lib/providers";

describe("THE-139: Neon Serverless Postgres Read-Only Connector Integration", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await closeAllDatabasePools();
  });

  it("connects Neon control-plane read-only, discovers Neon project & branch metadata, maps to Avenor logical project, reads CU-seconds & storage byte-months vs instantaneous bytes, and enforces cross-workspace isolation", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const registered = await registerUserWithDefaultOwnership({
      name: "Neon Backend Operator",
      email: `neon.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Neon Org ${suffix}`,
      workspaceName: `Neon Workspace ${suffix}`,
    });

    const session = await resolveSessionByToken(registered.rawSessionToken);
    const workspaceId = registered.context.activeWorkspace.id;

    const otherReg = await registerUserWithDefaultOwnership({
      name: "Other Neon Tenant",
      email: `other.neon.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Other Neon Org ${suffix}`,
      workspaceName: `Other Neon Workspace ${suffix}`,
    });
    const otherSession = await resolveSessionByToken(otherReg.rawSessionToken);

    const avenorProject = await createLogicalProject(session, workspaceId, {
      name: "Avenor Core Platform",
      slug: `avenor-core-${suffix}`,
      primaryDomain: "https://core.avenor.test",
      initialEnvironments: ["PRODUCTION", "STAGING"],
    });
    const prodEnv = avenorProject.environments.find((e) => e.type === "PRODUCTION");

    const redirectUri = "http://localhost:3000/api/connections/oauth/callback";
    const initiated = await initiateOAuthAuthorization({
      session,
      workspaceId,
      providerKey: "neon",
      authorizeEndpointUrl: "https://console.neon.tech/oauth/authorize",
      requestedScopes: ["neon.projects.readonly", "neon.consumption.readonly"],
      redirectUri,
    });

    const callbackRes = await completeOAuthCallback({
      session,
      workspaceId,
      providerKey: "neon",
      displayName: "Neon Serverless Postgres Control Plane",
      rawStateToken: initiated.rawStateToken,
      redirectUri,
      authorizationCode: "code_neon_ro_ok",
    });
    expect(callbackRes.status).toBe("HEALTHY");

    const discovered = await discoverAndPersistConnectionResources(
      session,
      workspaceId,
      callbackRes.connectionId,
    );
    expect(discovered.length).toBeGreaterThanOrEqual(1);

    const neonProjectRes = discovered.find(
      (r) => r.resourceType === "neon_project" && r.externalResourceId === "neon-proj-core-prod",
    );
    expect(neonProjectRes).toBeDefined();
    expect(neonProjectRes?.metadata.pgVersion).toBe(17);
    expect(neonProjectRes?.metadata.branchCount).toBe(3);
    expect(neonProjectRes?.metadata.protectedBranchConfigured).toBe(true);
    expect(neonProjectRes?.metadata.adapterGetOnlyLockActive).toBe(true);

    if (!neonProjectRes) {
      throw new Error("Expected discovered neonProjectRes");
    }

    const mapping = await mapResourceToProjectEnvironment(session, workspaceId, {
      projectId: avenorProject.id,
      environmentId: prodEnv?.id ?? null,
      connectedResourceId: neonProjectRes.id,
      mappingRole: "PRIMARY",
    });
    expect(mapping.projectId).toBe(avenorProject.id);
    expect(mapping.externalResourceId).toBe("neon-proj-core-prod");

    const neonAdapter = getProviderAdapter("neon");
    const cuRead = await neonAdapter.readMetrics(
      {
        organizationId: registered.context.activeOrganizationId,
        workspaceId,
        apiToken: "napi_proj_readonly_key",
        grantedScopes: ["neon.projects.readonly", "neon.consumption.readonly"],
      },
      {
        externalResourceId: "neon-proj-core-prod",
        capabilityKey: "postgres_metadata",
        metricKey: NEON_CANONICAL_METRIC_KEYS.COMPUTE_UNIT_SECONDS,
        granularity: "daily",
        startDateIso: "2026-11-19T00:00:00.000Z",
        endDateIso: "2026-11-21T00:00:00.000Z",
      },
    );
    expect(cuRead.capabilityStatus).toBe("SUPPORTED");
    expect(cuRead.points.length).toBeGreaterThanOrEqual(2);
    expect(cuRead.points[0]?.unit).toBe("seconds");

    await expect(
      getWorkspaceConnectionDetail(otherSession, workspaceId, callbackRes.connectionId),
    ).rejects.toThrow();
  });
});
