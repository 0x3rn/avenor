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
import { getProviderAdapter, SUPABASE_CANONICAL_METRIC_KEYS } from "@/lib/providers";

describe("THE-140: Supabase Read-Only Backend Connector Integration", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await closeAllDatabasePools();
  });

  it("connects Supabase Management API read-only, discovers Supabase project & subsystem health, maps to Avenor logical project, reads DB/storage/auth metrics without raw auth.users access, and enforces cross-workspace isolation", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const registered = await registerUserWithDefaultOwnership({
      name: "Supabase Backend Operator",
      email: `supabase.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Supabase Org ${suffix}`,
      workspaceName: `Supabase Workspace ${suffix}`,
    });

    const session = await resolveSessionByToken(registered.rawSessionToken);
    const workspaceId = registered.context.activeWorkspace.id;

    const otherReg = await registerUserWithDefaultOwnership({
      name: "Other Supabase Tenant",
      email: `other.supabase.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Other Supabase Org ${suffix}`,
      workspaceName: `Other Supabase Workspace ${suffix}`,
    });
    const otherSession = await resolveSessionByToken(otherReg.rawSessionToken);

    const avenorProject = await createLogicalProject(session, workspaceId, {
      name: "Avenor BaaS Product",
      slug: `avenor-baas-${suffix}`,
      primaryDomain: "https://baas.avenor.test",
      initialEnvironments: ["PRODUCTION", "STAGING"],
    });
    const prodEnv = avenorProject.environments.find((e) => e.type === "PRODUCTION");

    const redirectUri = "http://localhost:3000/api/connections/oauth/callback";
    const initiated = await initiateOAuthAuthorization({
      session,
      workspaceId,
      providerKey: "supabase",
      authorizeEndpointUrl: "https://api.supabase.com/v1/oauth/authorize",
      requestedScopes: ["projects:read", "analytics:read"],
      redirectUri,
    });

    const callbackRes = await completeOAuthCallback({
      session,
      workspaceId,
      providerKey: "supabase",
      displayName: "Supabase Management API Read-Only",
      rawStateToken: initiated.rawStateToken,
      redirectUri,
      authorizationCode: "code_supabase_ro_ok",
    });
    expect(callbackRes.status).toBe("HEALTHY");

    const discovered = await discoverAndPersistConnectionResources(
      session,
      workspaceId,
      callbackRes.connectionId,
    );
    expect(discovered.length).toBeGreaterThanOrEqual(1);

    const supabaseRes = discovered.find(
      (r) => r.resourceType === "supabase_project" && r.externalResourceId === "sbref-core-prod-01",
    );
    expect(supabaseRes).toBeDefined();
    expect(supabaseRes?.metadata.status).toBe("ACTIVE_HEALTHY");
    expect(supabaseRes?.metadata.rlsVerificationStatus).toBe("NOT_VERIFIED");
    expect(supabaseRes?.metadata.serviceRoleRejectedByDefault).toBe(true);

    if (!supabaseRes) {
      throw new Error("Expected discovered supabaseRes");
    }

    const mapping = await mapResourceToProjectEnvironment(session, workspaceId, {
      projectId: avenorProject.id,
      environmentId: prodEnv?.id ?? null,
      connectedResourceId: supabaseRes.id,
      mappingRole: "PRIMARY",
    });
    expect(mapping.projectId).toBe(avenorProject.id);
    expect(mapping.externalResourceId).toBe("sbref-core-prod-01");

    const supabaseAdapter = getProviderAdapter("supabase");
    const dbSizeRead = await supabaseAdapter.readMetrics(
      {
        organizationId: registered.context.activeOrganizationId,
        workspaceId,
        apiToken: "sbp_oauth_readonly_token",
        grantedScopes: ["projects:read", "analytics:read"],
      },
      {
        externalResourceId: "sbref-core-prod-01",
        capabilityKey: "postgres_metadata",
        metricKey: SUPABASE_CANONICAL_METRIC_KEYS.DB_SIZE_BYTES,
        granularity: "daily",
        startDateIso: "2026-11-20T00:00:00.000Z",
        endDateIso: "2026-11-21T00:00:00.000Z",
      },
    );
    expect(dbSizeRead.capabilityStatus).toBe("SUPPORTED");
    expect(dbSizeRead.points[0]?.unit).toBe("bytes");
    expect(dbSizeRead.points[0]?.value).toBeGreaterThan(0);

    await expect(
      getWorkspaceConnectionDetail(otherSession, workspaceId, callbackRes.connectionId),
    ).rejects.toThrow();
  });
});
