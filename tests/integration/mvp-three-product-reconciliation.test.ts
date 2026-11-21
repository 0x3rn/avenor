import "dotenv/config";
import {
  completeOAuthCallback,
  createLogicalProject,
  initiateOAuthAuthorization,
  registerUserWithDefaultOwnership,
  resolveSessionByToken,
} from "@avenor/auth";
import { closeAllDatabasePools, dbQuery, generateId, runMigrations } from "@avenor/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  discoverAndPersistConnectionResources,
  mapResourceToProjectEnvironment,
} from "@/lib/connections";
import { upsertMetricObservationBatch } from "@/lib/metrics";
import { GCP_BILLING_METADATA_SCOPE, GOOGLE_MONITORING_READ_SCOPE } from "@/lib/providers";
import { buildPortfolioReconciliationMatrix } from "@/lib/reports/mvp-reconciliation";

describe("THE-146: Three-Product Portfolio Reconciliation Matrix Integration", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await closeAllDatabasePools();
  });

  it("reconciles GA4, GSC, BigQuery Cloud Billing, and Neon/Firebase Backend metrics across 3 distinct owned logical products with exact agreement, idempotency, and tenant isolation", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const registered = await registerUserWithDefaultOwnership({
      name: "Portfolio Founder",
      email: `mvp.reconcile.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `MVP Org ${suffix}`,
      workspaceName: `MVP Workspace ${suffix}`,
    });
    const session = await resolveSessionByToken(registered.rawSessionToken);
    const workspaceId = registered.context.activeWorkspace.id;
    const organizationId = registered.context.activeOrganizationId;

    const otherReg = await registerUserWithDefaultOwnership({
      name: "Other Portfolio Tenant",
      email: `other.mvp.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Other MVP Org ${suffix}`,
      workspaceName: `Other MVP Workspace ${suffix}`,
    });
    const otherSession = await resolveSessionByToken(otherReg.rawSessionToken);

    // 1. Provision 3 distinct owned logical products
    const [prodAlpha, prodBeta, prodGamma] = await Promise.all([
      createLogicalProject(session, workspaceId, {
        name: "Product Alpha — Marketing & Docs",
        slug: `alpha-${suffix}`,
        primaryDomain: "https://alpha.avenor.test",
        initialEnvironments: ["PRODUCTION"],
      }),
      createLogicalProject(session, workspaceId, {
        name: "Product Beta — Core Web SaaS",
        slug: `beta-${suffix}`,
        primaryDomain: "https://beta.avenor.test",
        initialEnvironments: ["PRODUCTION"],
      }),
      createLogicalProject(session, workspaceId, {
        name: "Product Gamma — Mobile Cloud API",
        slug: `gamma-${suffix}`,
        primaryDomain: "https://gamma.avenor.test",
        initialEnvironments: ["PRODUCTION"],
      }),
    ]);

    const envAlpha = prodAlpha.environments[0];
    const envBeta = prodBeta.environments[0];
    const envGamma = prodGamma.environments[0];
    if (!envAlpha || !envBeta || !envGamma) throw new Error("Expected default environments");

    const redirectUri = "http://localhost:3000/api/connections/oauth/callback";

    // Connect GA4, GSC, GCP Billing, Neon, and Firebase Monitoring
    const connectProvider = async (
      providerKey: string,
      displayName: string,
      authorizeEndpointUrl: string,
      requestedScopes: string[],
    ) => {
      const init = await initiateOAuthAuthorization({
        session,
        workspaceId,
        providerKey,
        authorizeEndpointUrl,
        requestedScopes,
        redirectUri,
      });
      const cb = await completeOAuthCallback({
        session,
        workspaceId,
        providerKey,
        displayName,
        rawStateToken: init.rawStateToken,
        redirectUri,
        authorizationCode: `code_${providerKey}_ok`,
      });
      const discovered = await discoverAndPersistConnectionResources(
        session,
        workspaceId,
        cb.connectionId,
      );
      return { connectionId: cb.connectionId, resources: discovered };
    };

    const ga4 = await connectProvider(
      "ga4",
      "GA4 Portfolio",
      "https://accounts.google.com/o/oauth2/v2/auth",
      ["https://www.googleapis.com/auth/analytics.readonly"],
    );
    const gsc = await connectProvider(
      "gsc",
      "Search Console Portfolio",
      "https://accounts.google.com/o/oauth2/v2/auth",
      ["https://www.googleapis.com/auth/webmasters.readonly"],
    );
    const billing = await connectProvider(
      "gcp-billing",
      "GCP Cloud Billing",
      "https://accounts.google.com/o/oauth2/v2/auth",
      [GCP_BILLING_METADATA_SCOPE, "https://www.googleapis.com/auth/bigquery.readonly"],
    );
    const neon = await connectProvider(
      "neon",
      "Neon Serverless Postgres",
      "https://console.neon.tech/oauth/authorize",
      ["neon.projects.readonly", "neon.consumption.readonly"],
    );
    const firebase = await connectProvider(
      "firebase-monitoring",
      "Firebase Cloud Monitoring",
      "https://accounts.google.com/o/oauth2/v2/auth",
      [GOOGLE_MONITORING_READ_SCOPE],
    );

    const ga4Res = ga4.resources[0];
    const gscRes = gsc.resources[0];
    const billingRes = billing.resources[0];
    const neonRes = neon.resources[0];
    const fbRes = firebase.resources[0];
    if (!ga4Res || !gscRes || !billingRes || !neonRes || !fbRes) {
      throw new Error("Expected discovered resources for all providers");
    }

    // Map across the 3 products
    await Promise.all([
      mapResourceToProjectEnvironment(session, workspaceId, {
        projectId: prodAlpha.id,
        environmentId: envAlpha.id,
        connectedResourceId: ga4Res.id,
        mappingRole: "PRIMARY",
      }),
      mapResourceToProjectEnvironment(session, workspaceId, {
        projectId: prodAlpha.id,
        environmentId: envAlpha.id,
        connectedResourceId: gscRes.id,
        mappingRole: "PRIMARY",
      }),
      mapResourceToProjectEnvironment(session, workspaceId, {
        projectId: prodBeta.id,
        environmentId: envBeta.id,
        connectedResourceId: billingRes.id,
        mappingRole: "PRIMARY",
      }),
      mapResourceToProjectEnvironment(session, workspaceId, {
        projectId: prodBeta.id,
        environmentId: envBeta.id,
        connectedResourceId: neonRes.id,
        mappingRole: "PRIMARY",
      }),
      mapResourceToProjectEnvironment(session, workspaceId, {
        projectId: prodGamma.id,
        environmentId: envGamma.id,
        connectedResourceId: fbRes.id,
        mappingRole: "PRIMARY",
      }),
    ]);

    // Seed normalized observations twice to verify strict idempotency (zero duplicate inflation)
    const batch = [
      // Product Alpha: GA4 sessions = 4200, GSC clicks = 850, impressions = 20000 -> weighted CTR = 0.0425
      {
        organizationId,
        workspaceId,
        projectId: prodAlpha.id,
        environmentId: envAlpha.id,
        providerConnectionId: ga4.connectionId,
        connectedResourceId: ga4Res.id,
        providerKey: "ga4",
        externalResourceId: ga4Res.externalResourceId,
        canonicalMetricKey: "ga4.sessions",
        granularity: "DAILY" as const,
        periodStartDate: "2026-11-19",
        periodEndDate: "2026-11-19",
        reportingTimezone: "UTC",
        numericValue: 2_000,
        completenessState: "COMPLETE" as const,
      },
      {
        organizationId,
        workspaceId,
        projectId: prodAlpha.id,
        environmentId: envAlpha.id,
        providerConnectionId: ga4.connectionId,
        connectedResourceId: ga4Res.id,
        providerKey: "ga4",
        externalResourceId: ga4Res.externalResourceId,
        canonicalMetricKey: "ga4.sessions",
        granularity: "DAILY" as const,
        periodStartDate: "2026-11-20",
        periodEndDate: "2026-11-20",
        reportingTimezone: "UTC",
        numericValue: 2_200,
        completenessState: "COMPLETE" as const,
      },
      {
        organizationId,
        workspaceId,
        projectId: prodAlpha.id,
        environmentId: envAlpha.id,
        providerConnectionId: gsc.connectionId,
        connectedResourceId: gscRes.id,
        providerKey: "gsc",
        externalResourceId: gscRes.externalResourceId,
        canonicalMetricKey: "gsc.clicks",
        granularity: "DAILY" as const,
        periodStartDate: "2026-11-19",
        periodEndDate: "2026-11-19",
        reportingTimezone: "America/Los_Angeles",
        numericValue: 400,
        completenessState: "COMPLETE" as const,
      },
      {
        organizationId,
        workspaceId,
        projectId: prodAlpha.id,
        environmentId: envAlpha.id,
        providerConnectionId: gsc.connectionId,
        connectedResourceId: gscRes.id,
        providerKey: "gsc",
        externalResourceId: gscRes.externalResourceId,
        canonicalMetricKey: "gsc.clicks",
        granularity: "DAILY" as const,
        periodStartDate: "2026-11-20",
        periodEndDate: "2026-11-20",
        reportingTimezone: "America/Los_Angeles",
        numericValue: 450,
        completenessState: "COMPLETE" as const,
      },
      {
        organizationId,
        workspaceId,
        projectId: prodAlpha.id,
        environmentId: envAlpha.id,
        providerConnectionId: gsc.connectionId,
        connectedResourceId: gscRes.id,
        providerKey: "gsc",
        externalResourceId: gscRes.externalResourceId,
        canonicalMetricKey: "gsc.impressions",
        granularity: "DAILY" as const,
        periodStartDate: "2026-11-19",
        periodEndDate: "2026-11-19",
        reportingTimezone: "America/Los_Angeles",
        numericValue: 10_000,
        completenessState: "COMPLETE" as const,
      },
      {
        organizationId,
        workspaceId,
        projectId: prodAlpha.id,
        environmentId: envAlpha.id,
        providerConnectionId: gsc.connectionId,
        connectedResourceId: gscRes.id,
        providerKey: "gsc",
        externalResourceId: gscRes.externalResourceId,
        canonicalMetricKey: "gsc.impressions",
        granularity: "DAILY" as const,
        periodStartDate: "2026-11-20",
        periodEndDate: "2026-11-20",
        reportingTimezone: "America/Los_Angeles",
        numericValue: 10_000,
        completenessState: "COMPLETE" as const,
      },
      // Product Beta: Neon CU-seconds = 95,000, Instantaneous storage = 1.5 GB (latest gauge)
      {
        organizationId,
        workspaceId,
        projectId: prodBeta.id,
        environmentId: envBeta.id,
        providerConnectionId: neon.connectionId,
        connectedResourceId: neonRes.id,
        providerKey: "neon",
        externalResourceId: neonRes.externalResourceId,
        canonicalMetricKey: "neon.compute_unit_seconds",
        granularity: "DAILY" as const,
        periodStartDate: "2026-11-19",
        periodEndDate: "2026-11-19",
        reportingTimezone: "UTC",
        numericValue: 45_000,
        completenessState: "COMPLETE" as const,
      },
      {
        organizationId,
        workspaceId,
        projectId: prodBeta.id,
        environmentId: envBeta.id,
        providerConnectionId: neon.connectionId,
        connectedResourceId: neonRes.id,
        providerKey: "neon",
        externalResourceId: neonRes.externalResourceId,
        canonicalMetricKey: "neon.compute_unit_seconds",
        granularity: "DAILY" as const,
        periodStartDate: "2026-11-20",
        periodEndDate: "2026-11-20",
        reportingTimezone: "UTC",
        numericValue: 50_000,
        completenessState: "COMPLETE" as const,
      },
      {
        organizationId,
        workspaceId,
        projectId: prodBeta.id,
        environmentId: envBeta.id,
        providerConnectionId: neon.connectionId,
        connectedResourceId: neonRes.id,
        providerKey: "neon",
        externalResourceId: neonRes.externalResourceId,
        canonicalMetricKey: "neon.instantaneous_storage_bytes",
        granularity: "DAILY" as const,
        periodStartDate: "2026-11-20",
        periodEndDate: "2026-11-20",
        reportingTimezone: "UTC",
        numericValue: 1_500_000_000,
        completenessState: "COMPLETE" as const,
      },
      // Product Gamma: Firebase Firestore reads = 550,000
      {
        organizationId,
        workspaceId,
        projectId: prodGamma.id,
        environmentId: envGamma.id,
        providerConnectionId: firebase.connectionId,
        connectedResourceId: fbRes.id,
        providerKey: "firebase-monitoring",
        externalResourceId: fbRes.externalResourceId,
        canonicalMetricKey: "firebase.firestore_document_reads",
        granularity: "DAILY" as const,
        periodStartDate: "2026-11-20",
        periodEndDate: "2026-11-20",
        reportingTimezone: "UTC",
        numericValue: 550_000,
        completenessState: "COMPLETE" as const,
      },
    ];

    await upsertMetricObservationBatch(batch);
    // Run a second time to verify idempotency
    const secondSync = await upsertMetricObservationBatch(batch);
    expect(secondSync.insertedCount).toBe(0);

    // Seed Product Beta BigQuery Cloud Billing ledger entry (Gross $140, Credits -$25, Net $115)
    await dbQuery(
      `INSERT INTO billing_cost_ledger_entries (
         id, organization_id, workspace_id, project_id, environment_id, provider_connection_id,
         connected_resource_id, billing_account_id, gcp_project_id, usage_date, invoice_month,
         service_id, service_description, sku_id, sku_description, region, cost_type, currency,
         gross_cost, credits_amount, net_cost, completeness_state
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, '01A2B3-45C6D7-89E0F1', 'avenor-cloud-prod',
                 '2026-11-20', '202611', '6F81-5844-456A', 'Cloud Run', 'SKU-CR-01', 'vCPU Time',
                 'us-central1', 'regular', 'USD', 140.00, -25.00, 115.00, 'COMPLETE')`,
      [
        generateId("bcl"),
        organizationId,
        workspaceId,
        prodBeta.id,
        envBeta.id,
        billing.connectionId,
        billingRes.id,
      ],
    );

    const matrix = await buildPortfolioReconciliationMatrix(session, {
      workspaceId,
      startDate: "2026-11-19",
      endDate: "2026-11-20",
      executionMode: "DETERMINISTIC_FIXTURE_VERIFICATION",
      benchmarks: [
        {
          projectId: prodAlpha.id,
          providerKey: "ga4",
          externalResourceId: ga4Res.externalResourceId,
          metricKey: "ga4.sessions",
          reportingRange: "2026-11-19..2026-11-20",
          sourceTimezone: "UTC",
          unit: "sessions",
          sourceConsoleValue: 4_200,
          expectedTolerancePercent: 0,
          limitationNote: "Exact GA4 Data API session total.",
        },
        {
          projectId: prodAlpha.id,
          providerKey: "gsc",
          externalResourceId: gscRes.externalResourceId,
          metricKey: "gsc.clicks",
          reportingRange: "2026-11-19..2026-11-20",
          sourceTimezone: "America/Los_Angeles",
          unit: "clicks",
          sourceConsoleValue: 850,
          expectedTolerancePercent: 0,
          limitationNote: "GSC clicks are Pacific Time and distinct from GA4 sessions.",
        },
        {
          projectId: prodAlpha.id,
          providerKey: "gsc",
          externalResourceId: gscRes.externalResourceId,
          metricKey: "gsc.ctr",
          reportingRange: "2026-11-19..2026-11-20",
          sourceTimezone: "America/Los_Angeles",
          unit: "ratio",
          sourceConsoleValue: 0.0425,
          expectedTolerancePercent: 0.01,
          limitationNote: "Impression-weighted CTR (850 / 20000).",
        },
        {
          projectId: prodBeta.id,
          providerKey: "gcp-billing",
          externalResourceId: billingRes.externalResourceId,
          metricKey: "gcp_billing.net_cost",
          reportingRange: "2026-11-19..2026-11-20",
          sourceTimezone: "America/Los_Angeles",
          unit: "USD",
          sourceConsoleValue: 115.0,
          expectedTolerancePercent: 0,
          limitationNote: "Net cost after -$25.00 applied credits.",
        },
        {
          projectId: prodBeta.id,
          providerKey: "neon",
          externalResourceId: neonRes.externalResourceId,
          metricKey: "neon.compute_unit_seconds",
          reportingRange: "2026-11-19..2026-11-20",
          sourceTimezone: "UTC",
          unit: "seconds",
          sourceConsoleValue: 95_000,
          expectedTolerancePercent: 0,
          limitationNote: "Allocated CU-seconds (not CPU %).",
        },
        {
          projectId: prodGamma.id,
          providerKey: "firebase-monitoring",
          externalResourceId: fbRes.externalResourceId,
          metricKey: "firebase.firestore_document_reads",
          reportingRange: "2026-11-19..2026-11-20",
          sourceTimezone: "UTC",
          unit: "reads",
          sourceConsoleValue: 550_000,
          expectedTolerancePercent: 0,
          limitationNote: "DELTA sum via Cloud Monitoring monitoring.read.",
        },
      ],
    });

    expect(matrix.productCount).toBe(3);
    expect(matrix.meetsThreeProductMvpThreshold).toBe(true);
    expect(matrix.summary.totalChecks).toBe(6);
    expect(matrix.summary.exactMatchCount).toBe(6);
    expect(matrix.summary.discrepancyCount).toBe(0);
    expect(matrix.portfolioGuardrails.gscClicksNotEquatedToGa4Sessions).toBe(true);

    // Cross-tenant isolation verification
    await expect(
      buildPortfolioReconciliationMatrix(otherSession, {
        workspaceId,
        startDate: "2026-11-19",
        endDate: "2026-11-20",
      }),
    ).rejects.toThrow();
  });
});
