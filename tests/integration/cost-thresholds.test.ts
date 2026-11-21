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
  createCostSpendingThreshold,
  evaluateCostSpendingThresholds,
  listCostSpendingThresholds,
} from "@/lib/billing/thresholds";
import {
  completeBigQueryBillingExportOnboarding,
  GCP_BIGQUERY_READONLY_SCOPE,
  GCP_BILLING_METADATA_SCOPE,
  syncBigQueryBillingCostLedger,
} from "@/lib/providers";

describe("THE-137: User-Owned Spending Thresholds, Alert Deduplication & Currency Safety Integration", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await closeAllDatabasePools();
  });

  it("creates Avenor-owned spending thresholds, triggers alert on first breach, deduplicates repeat evaluations for the same period, and detects currency mismatches", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const registered = await registerUserWithDefaultOwnership({
      name: "FinOps Alert Owner",
      email: `alerts.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `FinOps Alert Org ${suffix}`,
      workspaceName: `FinOps Alert Workspace ${suffix}`,
    });

    const session = await resolveSessionByToken(registered.rawSessionToken);
    const workspaceId = registered.context.activeWorkspace.id;

    const project = await createLogicalProject(session, workspaceId, {
      name: "Guardrail Cloud App",
      slug: `guardrail-cloud-${suffix}`,
      primaryDomain: "https://guardrail.avenor.test",
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
      authorizationCode: "code_bq_thresholds_ok",
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

    // Sync USD costs for 2026-11-10..2026-11-11 ($122.00 net cost in November 2026)
    await syncBigQueryBillingCostLedger(session, {
      workspaceId,
      connectedResourceId: onboarded.connectedResourceId,
      projectId: project.id,
      environmentId: prodEnvId,
      startDate: "2026-11-10",
      endDate: "2026-11-11",
    });

    // 1. Create a USD monthly rule with warning = $80, critical = $100 (so $122 breaches CRITICAL)
    const usdRule = await createCostSpendingThreshold(session, {
      workspaceId,
      projectId: project.id,
      name: "November Production Net Spend Limit",
      metricBasis: "NET_COST",
      periodType: "MONTHLY",
      currency: "USD",
      warningAmount: 80,
      criticalAmount: 100,
    });
    expect(usdRule.id).toMatch(/^cthr_/);

    // 2. Create a EUR rule on the same project to verify CURRENCY_MISMATCH protection
    const eurRule = await createCostSpendingThreshold(session, {
      workspaceId,
      projectId: project.id,
      name: "Euro Rule Against USD Ledger",
      metricBasis: "NET_COST",
      periodType: "MONTHLY",
      currency: "EUR",
      criticalAmount: 50,
    });
    expect(eurRule.currency).toBe("EUR");

    // 3. First evaluation for referenceDate 2026-11-15
    const firstEvals = await evaluateCostSpendingThresholds(session, {
      workspaceId,
      projectId: project.id,
      referenceDate: "2026-11-15",
    });

    const firstUsdEval = firstEvals.find((e) => e.thresholdId === usdRule.id);
    expect(firstUsdEval?.severity).toBe("CRITICAL");
    expect(firstUsdEval?.observedAmount).toBe(122);
    expect(firstUsdEval?.alertTriggered).toBe(true);
    expect(firstUsdEval?.wasDeduplicatedRepeat).toBe(false);

    const firstEurEval = firstEvals.find((e) => e.thresholdId === eurRule.id);
    expect(firstEurEval?.severity).toBe("CURRENCY_MISMATCH");
    expect(firstEurEval?.alertTriggered).toBe(false);

    // 4. Repeat evaluation for the same period (2026-11-16, still MONTHLY:2026-11) -> deduplicated!
    const repeatEvals = await evaluateCostSpendingThresholds(session, {
      workspaceId,
      projectId: project.id,
      referenceDate: "2026-11-16",
    });
    const repeatUsdEval = repeatEvals.find((e) => e.thresholdId === usdRule.id);
    expect(repeatUsdEval?.severity).toBe("CRITICAL");
    expect(repeatUsdEval?.alertTriggered).toBe(false);
    expect(repeatUsdEval?.wasDeduplicatedRepeat).toBe(true);

    const listed = await listCostSpendingThresholds(session, {
      workspaceId,
      projectId: project.id,
    });
    expect(listed.thresholds).toHaveLength(2);
    expect(listed.evaluations).toHaveLength(2);
  });
});
