import "dotenv/config";
import {
  completeOAuthCallback,
  createLogicalProject,
  initiateOAuthAuthorization,
  registerUserWithDefaultOwnership,
  resolveSessionByToken,
} from "@avenor/auth";
import { closeAllDatabasePools, dbQuery, getDatabasePool, runMigrations } from "@avenor/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aggregateMetricObservations, queryMetricObservations } from "@/lib/metrics";
import {
  completeBigQueryBillingExportOnboarding,
  GCP_BIGQUERY_READONLY_SCOPE,
  GCP_BILLING_METADATA_SCOPE,
  persistBillingCostLedgerBatch,
  syncBigQueryBillingCostLedger,
} from "@/lib/providers";

describe("THE-135: BigQuery Cost Ledger Persistence, Revisions & Multi-Currency Safety Integration", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await closeAllDatabasePools();
  });

  it("syncs BigQuery billing export costs idempotently, updates late credit revisions without double-counting, and blocks mixed-currency summation", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const registered = await registerUserWithDefaultOwnership({
      name: "Cost Ledger Architect",
      email: `ledger.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Cost Ledger Org ${suffix}`,
      workspaceName: `Cost Ledger Workspace ${suffix}`,
    });

    const session = await resolveSessionByToken(registered.rawSessionToken);
    const orgId = registered.context.activeOrganizationId;
    const workspaceId = registered.context.activeWorkspace.id;

    const project = await createLogicalProject(session, workspaceId, {
      name: "FinOps Cloud App",
      slug: `finops-cloud-${suffix}`,
      primaryDomain: "https://finops.avenor.test",
      initialEnvironments: ["PRODUCTION"],
    });
    const prodEnvId = project.environments[0]?.id ?? null;

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
      displayName: "Google Cloud Billing Export",
      rawStateToken: initiated.rawStateToken,
      redirectUri,
      authorizationCode: "code_bq_cost_ledger_ok",
    });

    const onboarded = await completeBigQueryBillingExportOnboarding(session, {
      workspaceId,
      connectionId: callbackRes.connectionId,
      billingAccountId: "01A2B3-45C6D7-89E0F1",
      datasetProjectId: "avenor-finops-prod",
      datasetId: "cloud_billing_export",
      tableId: "gcp_billing_export_v1_01A2B3_45C6D7_89E0F1",
      projectId: project.id,
      environmentId: prodEnvId,
    });

    // 1. Execute initial cost sync for 2026-11-10..2026-11-11
    const firstSync = await syncBigQueryBillingCostLedger(session, {
      workspaceId,
      connectedResourceId: onboarded.connectedResourceId,
      projectId: project.id,
      environmentId: prodEnvId,
      startDate: "2026-11-10",
      endDate: "2026-11-11",
    });

    expect(firstSync.ledgerRowCount).toBe(4);
    expect(firstSync.observationsInserted).toBeGreaterThan(0);

    // 2. Re-running identical sync must be 100% idempotent (0 new inserts, 0 updates)
    const repeatSync = await syncBigQueryBillingCostLedger(session, {
      workspaceId,
      connectedResourceId: onboarded.connectedResourceId,
      projectId: project.id,
      environmentId: prodEnvId,
      startDate: "2026-11-10",
      endDate: "2026-11-11",
    });
    expect(repeatSync.observationsInserted).toBe(0);
    expect(repeatSync.observationsUpdated).toBe(0);
    expect(repeatSync.observationsUnchanged).toBeGreaterThan(0);

    const ledgerCountRes = await dbQuery<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM billing_cost_ledger_entries WHERE workspace_id = $1`,
      [workspaceId],
      getDatabasePool(),
    );
    expect(Number(ledgerCountRes.rows[0]?.cnt)).toBe(4);

    // 3. Simulate late promotional credit arriving for 2026-11-10 Cloud Run (-6.50 -> -12.50, netCost 36.00 -> 30.00)
    const revisedBatch = await persistBillingCostLedgerBatch(
      {
        organizationId: orgId,
        workspaceId,
        projectId: project.id,
        environmentId: prodEnvId,
        providerConnectionId: callbackRes.connectionId,
        connectedResourceId: onboarded.connectedResourceId,
        externalResourceId: onboarded.externalResourceId,
      },
      [
        {
          billingAccountId: "01A2B3-45C6D7-89E0F1",
          gcpProjectId: "avenor-cloud-prod",
          usageDate: "2026-11-10",
          invoiceMonth: "202611",
          serviceId: "6F81-5844-456A",
          serviceDescription: "Cloud Run",
          skuId: "D97E-32A1-8102",
          skuDescription: "CPU Allocation Time",
          region: "us-central1",
          costType: "regular",
          currency: "USD",
          currencyConversionRate: 1,
          grossCost: 42.5,
          creditsAmount: -12.5,
          netCost: 30.0,
          usageAmount: 180_000,
          usageUnit: "vCPU-seconds",
          completenessState: "COMPLETE",
          exportTimeIso: "2026-11-12T04:00:00.000Z",
        },
        {
          billingAccountId: "01A2B3-45C6D7-89E0F1",
          gcpProjectId: "avenor-cloud-prod",
          usageDate: "2026-11-10",
          invoiceMonth: "202611",
          serviceId: "9662-B51E-5089",
          serviceDescription: "Cloud SQL",
          skuId: "A104-99B2-44C1",
          skuDescription: "Postgres Enterprise vCPU",
          region: "us-central1",
          costType: "regular",
          currency: "USD",
          currencyConversionRate: 1,
          grossCost: 28.0,
          creditsAmount: -3.0,
          netCost: 25.0,
          usageAmount: 86_400,
          usageUnit: "seconds",
          completenessState: "COMPLETE",
          exportTimeIso: "2026-11-12T04:00:00.000Z",
        },
      ],
    );
    expect(revisedBatch.observationsUpdated).toBeGreaterThan(0);

    // 4. Add a EUR row and verify aggregateMetricObservations rejects cross-currency summation
    await persistBillingCostLedgerBatch(
      {
        organizationId: orgId,
        workspaceId,
        projectId: project.id,
        environmentId: prodEnvId,
        providerConnectionId: callbackRes.connectionId,
        connectedResourceId: onboarded.connectedResourceId,
        externalResourceId: onboarded.externalResourceId,
      },
      [
        {
          billingAccountId: "02F9E8-76D5C4-32B1A0",
          gcpProjectId: "avenor-eu-prod",
          usageDate: "2026-11-12",
          invoiceMonth: "202611",
          serviceId: "6F81-5844-456A",
          serviceDescription: "Cloud Run",
          skuId: "D97E-32A1-8102",
          skuDescription: "CPU Allocation Time",
          region: "europe-west1",
          costType: "regular",
          currency: "EUR",
          currencyConversionRate: 0.92,
          grossCost: 50.0,
          creditsAmount: 0,
          netCost: 50.0,
          usageAmount: 100_000,
          usageUnit: "vCPU-seconds",
          completenessState: "PROVISIONAL",
          exportTimeIso: "2026-11-12T23:55:00.000Z",
        },
      ],
    );

    const storedObs = await queryMetricObservations({
      organizationId: orgId,
      workspaceId,
      projectId: project.id,
      canonicalMetricKeys: ["gcp_billing.net_cost"],
    });
    const summaryObs = storedObs.filter((o) => Object.keys(o.dimensions).length === 0);
    const mixedAgg = aggregateMetricObservations({
      canonicalMetricKey: "gcp_billing.net_cost",
      observations: summaryObs,
    });
    expect(mixedAgg.status).toBe("mixed_currency_rejected");
    expect(mixedAgg.value).toBeNull();
  });
});
