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
import { GCP_BILLING_METADATA_SCOPE } from "@/lib/providers";

describe("THE-133: Google Cloud Billing Account & Linked Project Discovery Integration", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await closeAllDatabasePools();
  });

  it("connects Google Cloud Billing read-only, discovers billing accounts & linked GCP projects, maps to Avenor logical project without conflating IDs, and enforces cross-workspace isolation", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const registered = await registerUserWithDefaultOwnership({
      name: "Cloud Billing Operator",
      email: `billing.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Billing Org ${suffix}`,
      workspaceName: `Billing Workspace ${suffix}`,
    });

    const session = await resolveSessionByToken(registered.rawSessionToken);
    const workspaceId = registered.context.activeWorkspace.id;

    const otherReg = await registerUserWithDefaultOwnership({
      name: "Other Billing Tenant",
      email: `other.billing.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Other Billing Org ${suffix}`,
      workspaceName: `Other Billing Workspace ${suffix}`,
    });
    const otherSession = await resolveSessionByToken(otherReg.rawSessionToken);

    const avenorProject = await createLogicalProject(session, workspaceId, {
      name: "Avenor Flagship Product",
      slug: `avenor-flagship-${suffix}`,
      primaryDomain: "https://flagship.avenor.test",
      initialEnvironments: ["PRODUCTION", "STAGING"],
    });
    const prodEnv = avenorProject.environments.find((e) => e.type === "PRODUCTION");

    const redirectUri = "http://localhost:3000/api/connections/oauth/callback";
    const initiated = await initiateOAuthAuthorization({
      session,
      workspaceId,
      providerKey: "gcp-billing",
      authorizeEndpointUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      requestedScopes: [GCP_BILLING_METADATA_SCOPE],
      redirectUri,
    });

    const callbackRes = await completeOAuthCallback({
      session,
      workspaceId,
      providerKey: "gcp-billing",
      displayName: "Google Cloud Billing Metadata",
      rawStateToken: initiated.rawStateToken,
      redirectUri,
      authorizationCode: "code_gcp_billing_ro_ok",
    });
    expect(callbackRes.status).toBe("HEALTHY");

    const discovered = await discoverAndPersistConnectionResources(
      session,
      workspaceId,
      callbackRes.connectionId,
    );
    expect(discovered.length).toBeGreaterThanOrEqual(3);

    const billingAccountRes = discovered.find((r) => r.resourceType === "gcp_billing_account");
    const gcpProjectRes = discovered.find(
      (r) =>
        r.resourceType === "gcp_billing_project" &&
        r.externalResourceId === "gcp-project:avenor-cloud-prod",
    );

    expect(billingAccountRes).toBeDefined();
    expect(gcpProjectRes).toBeDefined();
    expect(gcpProjectRes?.metadata.gcpProjectId).toBe("avenor-cloud-prod");
    expect(gcpProjectRes?.metadata.billingAccountId).toBe("01A2B3-45C6D7-89E0F1");
    expect(gcpProjectRes?.metadata.hasHistoricalCostAccess).toBe(false);

    if (!gcpProjectRes) throw new Error("Expected discovered gcpProjectRes");

    // Map GCP project resource to Avenor logical project environment
    const mapping = await mapResourceToProjectEnvironment(session, workspaceId, {
      projectId: avenorProject.id,
      environmentId: prodEnv?.id ?? null,
      connectedResourceId: gcpProjectRes.id,
      mappingRole: "PRIMARY",
    });

    expect(mapping.projectId).toBe(avenorProject.id);
    expect(mapping.externalResourceId).toBe("gcp-project:avenor-cloud-prod");
    expect(mapping.projectId).not.toBe("avenor-cloud-prod");

    // Cross-workspace isolation check
    await expect(
      getWorkspaceConnectionDetail(otherSession, workspaceId, callbackRes.connectionId),
    ).rejects.toThrow();
  });
});
