import "dotenv/config";
import {
  type AuthenticatedSessionContext,
  createLogicalProject,
  registerUserWithDefaultOwnership,
  resolveSessionByToken,
} from "@avenor/auth";
import {
  closeAllDatabasePools,
  dbQuery,
  generateId,
  getDatabasePool,
  runMigrations,
} from "@avenor/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertMetricObservation, upsertMetricObservationBatch } from "@/lib/metrics";
import { generateProjectReconciliationReport } from "@/lib/reports/reconciliation";

describe("THE-131: PostgreSQL Source Reconciliation, Historical Revisions & Tenant Isolation Integration", () => {
  let orgId = "";
  let wksId = "";
  let prjId = "";
  let envId = "";
  let ga4ConnId = "";
  let gscConnId = "";
  let ga4ResId = "";
  let gscResId = "";

  let ownerSession: AuthenticatedSessionContext | null = null;
  let otherSession: AuthenticatedSessionContext | null = null;

  beforeAll(async () => {
    await runMigrations();

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const registered = await registerUserWithDefaultOwnership({
      name: "Reconciliation Operator",
      email: `reconcile.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Reconcile Org ${suffix}`,
      workspaceName: `Reconcile Workspace ${suffix}`,
    });

    ownerSession = await resolveSessionByToken(registered.rawSessionToken);
    orgId = registered.context.activeOrganizationId;
    wksId = registered.context.activeWorkspace.id;

    const otherReg = await registerUserWithDefaultOwnership({
      name: "Outsider Operator",
      email: `outsider.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Outsider Org ${suffix}`,
      workspaceName: `Outsider Workspace ${suffix}`,
    });
    otherSession = await resolveSessionByToken(otherReg.rawSessionToken);

    const project = await createLogicalProject(ownerSession, wksId, {
      name: "Reconcile Flagship",
      slug: `reconcile-flagship-${suffix}`,
      primaryDomain: "https://reconcile.avenor.test",
      initialEnvironments: ["PRODUCTION"],
    });
    prjId = project.id;
    envId = project.environments[0]?.id ?? "";

    ga4ConnId = generateId("con");
    gscConnId = generateId("con");
    ga4ResId = generateId("res");
    gscResId = generateId("res");

    const pool = getDatabasePool();

    await dbQuery(
      `INSERT INTO provider_connections (id, workspace_id, provider_key, display_name, status)
       VALUES ($1, $2, 'ga4', 'GA4 Europe', 'HEALTHY'),
              ($3, $2, 'gsc', 'GSC Pacific', 'HEALTHY')`,
      [ga4ConnId, wksId, gscConnId],
      pool,
    );

    await dbQuery(
      `INSERT INTO connected_resources (id, workspace_id, provider_connection_id, external_resource_id, resource_type, display_name, metadata)
       VALUES ($1, $2, $3, 'properties/9901', 'ga4_property', 'GA4 Berlin Property', '{"timeZone":"Europe/Berlin"}'::jsonb),
              ($4, $2, $5, 'sc-domain:reconcile.avenor.test', 'gsc_site', 'reconcile.avenor.test', '{"reportingTimezone":"America/Los_Angeles"}'::jsonb)`,
      [ga4ResId, wksId, ga4ConnId, gscResId, gscConnId],
      pool,
    );

    await dbQuery(
      `INSERT INTO resource_mappings (id, workspace_id, project_id, environment_id, connected_resource_id, mapping_role)
       VALUES ($1, $2, $3, $4, $5, 'PRIMARY'),
              ($6, $2, $3, $4, $7, 'PRIMARY')`,
      [generateId("map"), wksId, prjId, envId, ga4ResId, generateId("map"), gscResId],
      pool,
    );

    // Seed prior period (2026-11-02..2026-11-08) and current period (2026-11-09..2026-11-15)
    await upsertMetricObservationBatch([
      {
        organizationId: orgId,
        workspaceId: wksId,
        projectId: prjId,
        environmentId: envId,
        providerConnectionId: ga4ConnId,
        connectedResourceId: ga4ResId,
        providerKey: "ga4",
        externalResourceId: "properties/9901",
        canonicalMetricKey: "ga4.sessions",
        granularity: "DAILY",
        periodStartDate: "2026-11-04",
        periodEndDate: "2026-11-04",
        reportingTimezone: "Europe/Berlin",
        numericValue: 400,
      },
      {
        organizationId: orgId,
        workspaceId: wksId,
        projectId: prjId,
        environmentId: envId,
        providerConnectionId: ga4ConnId,
        connectedResourceId: ga4ResId,
        providerKey: "ga4",
        externalResourceId: "properties/9901",
        canonicalMetricKey: "ga4.sessions",
        granularity: "DAILY",
        periodStartDate: "2026-11-10",
        periodEndDate: "2026-11-10",
        reportingTimezone: "Europe/Berlin",
        numericValue: 500,
        completenessState: "PROVISIONAL",
      },
      {
        organizationId: orgId,
        workspaceId: wksId,
        projectId: prjId,
        environmentId: envId,
        providerConnectionId: gscConnId,
        connectedResourceId: gscResId,
        providerKey: "gsc",
        externalResourceId: "sc-domain:reconcile.avenor.test",
        canonicalMetricKey: "gsc.clicks",
        granularity: "DAILY",
        periodStartDate: "2026-11-10",
        periodEndDate: "2026-11-10",
        reportingTimezone: "America/Los_Angeles",
        dimensions: { searchType: "web" },
        numericValue: 220,
      },
    ]);

    // Simulate historical revision on 2026-11-10 ga4.sessions from 500 -> 540
    await upsertMetricObservation({
      organizationId: orgId,
      workspaceId: wksId,
      projectId: prjId,
      environmentId: envId,
      providerConnectionId: ga4ConnId,
      connectedResourceId: ga4ResId,
      providerKey: "ga4",
      externalResourceId: "properties/9901",
      canonicalMetricKey: "ga4.sessions",
      granularity: "DAILY",
      periodStartDate: "2026-11-10",
      periodEndDate: "2026-11-10",
      reportingTimezone: "Europe/Berlin",
      numericValue: 540,
      completenessState: "COMPLETE",
      revisionReason: "provider_late_attribution_finalized",
    });
  });

  afterAll(async () => {
    await closeAllDatabasePools();
  });

  it("reconciles revised GA4 observations and GSC privacy-thresholded clicks while flagging cross-source timezone divergence", async () => {
    const report = await generateProjectReconciliationReport(ownerSession, prjId, {
      preset: "custom",
      startDate: "2026-11-09",
      endDate: "2026-11-15",
      benchmarks: [
        {
          canonicalMetricKey: "ga4.sessions",
          externalResourceId: "properties/9901",
          periodStartDate: "2026-11-09",
          periodEndDate: "2026-11-15",
          reportingTimezone: "Europe/Berlin",
          expectedValue: 540,
        },
        {
          canonicalMetricKey: "gsc.clicks",
          externalResourceId: "sc-domain:reconcile.avenor.test",
          periodStartDate: "2026-11-09",
          periodEndDate: "2026-11-15",
          reportingTimezone: "America/Los_Angeles",
          expectedValue: 220,
          queryTableSummedClicks: 195,
        },
      ],
    });

    expect(report.timezoneAlignment.isAligned).toBe(false);
    expect(report.timezoneAlignment.timezones).toEqual(["Europe/Berlin", "America/Los_Angeles"]);

    const sessionsComp = report.comparisons.find((c) => c.canonicalMetricKey === "ga4.sessions");
    expect(sessionsComp?.currentValue).toBe(540);
    expect(sessionsComp?.previousValue).toBe(400);
    expect(sessionsComp?.percentDelta).toBe(35);

    const ga4Item = report.reconciliationItems.find((i) => i.canonicalMetricKey === "ga4.sessions");
    expect(ga4Item?.status).toBe("REVISION_SUPERSEDED");
    expect(ga4Item?.revisionCount).toBeGreaterThanOrEqual(2);

    const gscItem = report.reconciliationItems.find((i) => i.canonicalMetricKey === "gsc.clicks");
    expect(gscItem?.status).toBe("RECONCILED_WITH_PRIVACY_THRESHOLD");
    expect(gscItem?.anonymizedClicksGap).toBe(25);
    expect(report.summary.allWithinContract).toBe(true);
  });

  it("rejects incompatible dimension filters and enforces cross-tenant authorization on reconciliation reports", async () => {
    await expect(
      generateProjectReconciliationReport(ownerSession, prjId, {
        canonicalMetricKeys: ["ga4.sessions"],
        dimensionFilters: { query: "illegal-gsc-filter-on-ga4" },
      }),
    ).rejects.toThrow(/Incompatible dimension filter/i);

    await expect(
      generateProjectReconciliationReport(otherSession, prjId, {
        preset: "7d",
      }),
    ).rejects.toThrow();
  });
});
