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
import { upsertMetricObservation } from "@/lib/metrics";
import {
  completeBigQueryBillingExportOnboarding,
  GCP_BIGQUERY_READONLY_SCOPE,
  GCP_BILLING_METADATA_SCOPE,
  persistBillingCostLedgerBatch,
  syncBigQueryBillingCostLedger,
} from "@/lib/providers";
import {
  getProjectCostIntelligenceReport,
  getWorkspaceCostIntelligenceReport,
} from "@/lib/reports/cost-service";

describe("THE-136: Cost Dashboard, Cost-per-1k-Sessions Efficiency & Multi-Currency Guardrail Integration", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await closeAllDatabasePools();
  });

  it("computes project and workspace cost reports, derives cost-per-1k-sessions with GA4 observations, and enforces multi-currency guardrails", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const registered = await registerUserWithDefaultOwnership({
      name: "Cost Dashboard Lead",
      email: `cost.dash.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Cost Dash Org ${suffix}`,
      workspaceName: `Cost Dash Workspace ${suffix}`,
    });

    const session = await resolveSessionByToken(registered.rawSessionToken);
    const orgId = registered.context.activeOrganizationId;
    const workspaceId = registered.context.activeWorkspace.id;

    const project = await createLogicalProject(session, workspaceId, {
      name: "Core Revenue App",
      slug: `core-revenue-${suffix}`,
      primaryDomain: "https://revenue.avenor.test",
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
      authorizationCode: "code_bq_cost_dashboard_ok",
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

    // Sync USD costs for 2026-11-10..2026-11-11 (2 days × ($36 + $25) = $122.00 net, $141.00 gross, -$19.00 credits)
    await syncBigQueryBillingCostLedger(session, {
      workspaceId,
      connectedResourceId: onboarded.connectedResourceId,
      projectId: project.id,
      environmentId: prodEnvId,
      startDate: "2026-11-10",
      endDate: "2026-11-11",
    });

    // Seed 12,200 GA4 sessions for the same project and date window -> $122 / 12.2k = $10.00 per 1k sessions
    await upsertMetricObservation({
      organizationId: orgId,
      workspaceId,
      projectId: project.id,
      environmentId: prodEnvId,
      providerConnectionId: callbackRes.connectionId,
      connectedResourceId: onboarded.connectedResourceId,
      providerKey: "ga4",
      externalResourceId: "properties/5501",
      canonicalMetricKey: "ga4.sessions",
      granularity: "DAILY",
      periodStartDate: "2026-11-10",
      periodEndDate: "2026-11-10",
      reportingTimezone: "UTC",
      numericValue: 12_200,
    });

    const report = await getProjectCostIntelligenceReport(session, project.id, {
      preset: "custom",
      startDate: "2026-11-01",
      endDate: "2026-11-15",
      bypassCache: true,
    });

    expect(report.isMixedCurrency).toBe(false);
    expect(report.primaryCurrency).toBe("USD");
    expect(report.totals.grossCost).toBe(141);
    expect(report.totals.creditsAmount).toBe(-19);
    expect(report.totals.netCost).toBe(122);
    expect(report.efficiency.available).toBe(true);
    expect(report.efficiency.costPer1kSessions).toBeCloseTo(10.0, 4);
    expect(report.serviceBreakdown).toHaveLength(2);

    // Add EUR row -> verify mixed-currency protection
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
          grossCost: 80.0,
          creditsAmount: -10.0,
          netCost: 70.0,
          usageAmount: 100_000,
          usageUnit: "vCPU-seconds",
          completenessState: "PROVISIONAL",
          exportTimeIso: "2026-11-12T23:55:00.000Z",
        },
      ],
    );

    const mixedReport = await getProjectCostIntelligenceReport(session, project.id, {
      preset: "custom",
      startDate: "2026-11-01",
      endDate: "2026-11-15",
      bypassCache: true,
    });
    expect(mixedReport.isMixedCurrency).toBe(true);
    expect(mixedReport.totals.netCost).toBeNull();
    expect(mixedReport.currencyBuckets).toHaveLength(2);

    // Filtering by USD restores single-currency totals
    const filteredUsd = await getProjectCostIntelligenceReport(session, project.id, {
      preset: "custom",
      startDate: "2026-11-01",
      endDate: "2026-11-15",
      currencyFilter: "USD",
      bypassCache: true,
    });
    expect(filteredUsd.isMixedCurrency).toBe(false);
    expect(filteredUsd.totals.netCost).toBe(122);

    const workspaceCost = await getWorkspaceCostIntelligenceReport(session, {
      preset: "custom",
      startDate: "2026-11-01",
      endDate: "2026-11-15",
      currencyFilter: "USD",
      bypassCache: true,
    });
    expect(workspaceCost.totals.netCost).toBe(122);
    expect(workspaceCost.projectCosts[0]?.netCost).toBe(122);
  });
});
