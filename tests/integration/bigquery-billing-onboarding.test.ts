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
import { getWorkspaceConnectionDetail } from "@/lib/connections";
import {
  completeBigQueryBillingExportOnboarding,
  GCP_BIGQUERY_READONLY_SCOPE,
  GCP_BILLING_METADATA_SCOPE,
} from "@/lib/providers";

describe("THE-134: Guided BigQuery Cloud Billing Export Onboarding Integration", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await closeAllDatabasePools();
  });

  it("validates and links a customer's BigQuery Cloud Billing export dataset to their authorized connection and logical project", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const registered = await registerUserWithDefaultOwnership({
      name: "FinOps Onboarding Owner",
      email: `finops.onboard.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `FinOps Onboard Org ${suffix}`,
      workspaceName: `FinOps Onboard Workspace ${suffix}`,
    });

    const session = await resolveSessionByToken(registered.rawSessionToken);
    const workspaceId = registered.context.activeWorkspace.id;

    const project = await createLogicalProject(session, workspaceId, {
      name: "Cloud Native Platform",
      slug: `cloud-native-${suffix}`,
      primaryDomain: "https://platform.avenor.test",
      initialEnvironments: ["PRODUCTION"],
    });
    const prodEnv = project.environments[0];

    const redirectUri = "http://localhost:3000/api/connections/oauth/callback";
    const initiated = await initiateOAuthAuthorization({
      session,
      workspaceId,
      providerKey: "gcp-billing",
      authorizeEndpointUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      requestedScopes: [GCP_BILLING_METADATA_SCOPE, GCP_BIGQUERY_READONLY_SCOPE],
      redirectUri,
    });

    const callbackRes = await completeOAuthCallback({
      session,
      workspaceId,
      providerKey: "gcp-billing",
      displayName: "Google Cloud Billing + BigQuery Export",
      rawStateToken: initiated.rawStateToken,
      redirectUri,
      authorizationCode: "code_bq_export_onboarding_ok",
    });

    const result = await completeBigQueryBillingExportOnboarding(session, {
      workspaceId,
      connectionId: callbackRes.connectionId,
      billingAccountId: "01A2B3-45C6D7-89E0F1",
      datasetProjectId: "avenor-finops-prod",
      datasetId: "cloud_billing_export",
      tableId: "gcp_billing_export_v1_01A2B3_45C6D7_89E0F1",
      projectId: project.id,
      environmentId: prodEnv?.id ?? null,
    });

    expect(result.validation.valid).toBe(true);
    expect(result.validation.exportType).toBe("STANDARD_USAGE_COST");
    expect(result.externalResourceId).toBe(
      "bq-export:avenor-finops-prod.cloud_billing_export.gcp_billing_export_v1_01A2B3_45C6D7_89E0F1",
    );

    const detail = await getWorkspaceConnectionDetail(
      session,
      workspaceId,
      callbackRes.connectionId,
    );
    const exportResource = detail.connectedResources.find(
      (r) => r.externalResourceId === result.externalResourceId,
    );
    expect(exportResource).toBeDefined();
    expect(exportResource?.metadata.hasHistoricalCostAccess).toBe(true);
    expect(exportResource?.metadata.datasetLocation).toBe("US");
  });
});
