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
import { upsertMetricObservationBatch } from "@/lib/metrics";
import {
  getProjectControlCenterOverview,
  getWorkspacePortfolioOverview,
} from "@/lib/reports/portfolio-service";

describe("THE-130: Portfolio Overview & Project Control Center Integration", () => {
  let orgId = "";
  let wksId = "";
  let otherWksId = "";
  let prjSingleId = "";
  let envSingleId = "";
  let prjMultiId = "";
  let envMultiId = "";
  let ga4ConnId = "";
  let gscConnId = "";
  let ga4Res1Id = "";
  let ga4Res2Id = "";
  let gscRes1Id = "";

  let ownerSession: AuthenticatedSessionContext | null = null;

  beforeAll(async () => {
    await runMigrations();

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const registered = await registerUserWithDefaultOwnership({
      name: "Control Center Founder",
      email: `founder.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Avenor Control Org ${suffix}`,
      workspaceName: `Avenor Portfolio Workspace ${suffix}`,
    });

    ownerSession = await resolveSessionByToken(registered.rawSessionToken);
    expect(ownerSession).not.toBeNull();

    orgId = registered.context.activeOrganizationId;
    wksId = registered.context.activeWorkspace.id;

    const otherRegistered = await registerUserWithDefaultOwnership({
      name: "Other Tenant",
      email: `other.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Other Org ${suffix}`,
      workspaceName: `Other Workspace ${suffix}`,
    });
    otherWksId = otherRegistered.context.activeWorkspace.id;

    const projectSingle = await createLogicalProject(ownerSession, wksId, {
      name: "Atlas Cloud",
      slug: `atlas-cloud-${suffix}`,
      primaryDomain: "https://atlas.avenor.test",
      initialEnvironments: ["PRODUCTION"],
    });
    prjSingleId = projectSingle.id;
    envSingleId = projectSingle.environments[0]?.id ?? "";

    const projectMulti = await createLogicalProject(ownerSession, wksId, {
      name: "Nexus Suite",
      slug: `nexus-suite-${suffix}`,
      primaryDomain: "https://nexus.avenor.test",
      initialEnvironments: ["PRODUCTION"],
    });
    prjMultiId = projectMulti.id;
    envMultiId = projectMulti.environments[0]?.id ?? "";

    ga4ConnId = generateId("con");
    gscConnId = generateId("con");
    ga4Res1Id = generateId("res");
    ga4Res2Id = generateId("res");
    gscRes1Id = generateId("res");

    const pool = getDatabasePool();

    await dbQuery(
      `INSERT INTO provider_connections (id, workspace_id, provider_key, display_name, status)
       VALUES ($1, $2, 'ga4', 'Google Analytics 4', 'HEALTHY'),
              ($3, $2, 'gsc', 'Google Search Console', 'HEALTHY')`,
      [ga4ConnId, wksId, gscConnId],
      pool,
    );

    await dbQuery(
      `INSERT INTO connected_resources (id, workspace_id, provider_connection_id, external_resource_id, resource_type, display_name)
       VALUES ($1, $2, $3, 'properties/1001', 'ga4_property', 'Atlas GA4'),
              ($4, $2, $3, 'properties/1002', 'ga4_property', 'Nexus Web GA4'),
              ($5, $2, $6, 'sc-domain:atlas.avenor.test', 'gsc_site', 'atlas.avenor.test')`,
      [ga4Res1Id, wksId, ga4ConnId, ga4Res2Id, gscRes1Id, gscConnId],
      pool,
    );

    // Map 1 GA4 + 1 GSC to Atlas Cloud; map 2 GA4 properties to Nexus Suite to verify non-additive user protection
    await dbQuery(
      `INSERT INTO resource_mappings (id, workspace_id, project_id, environment_id, connected_resource_id, mapping_role)
       VALUES ($1, $2, $3, $4, $5, 'PRIMARY'),
              ($6, $2, $3, $4, $7, 'PRIMARY'),
              ($8, $2, $9, $10, $5, 'PRIMARY'),
              ($11, $2, $9, $10, $12, 'SECONDARY')`,
      [
        generateId("map"),
        wksId,
        prjSingleId,
        envSingleId,
        ga4Res1Id,
        generateId("map"),
        gscRes1Id,
        generateId("map"),
        prjMultiId,
        envMultiId,
        generateId("map"),
        ga4Res2Id,
      ],
      pool,
    );

    await upsertMetricObservationBatch([
      {
        organizationId: orgId,
        workspaceId: wksId,
        projectId: prjSingleId,
        environmentId: envSingleId,
        providerConnectionId: ga4ConnId,
        connectedResourceId: ga4Res1Id,
        providerKey: "ga4",
        externalResourceId: "properties/1001",
        canonicalMetricKey: "ga4.sessions",
        granularity: "DAILY",
        periodStartDate: "2026-11-10",
        periodEndDate: "2026-11-10",
        reportingTimezone: "UTC",
        numericValue: 450,
      },
      {
        organizationId: orgId,
        workspaceId: wksId,
        projectId: prjSingleId,
        environmentId: envSingleId,
        providerConnectionId: ga4ConnId,
        connectedResourceId: ga4Res1Id,
        providerKey: "ga4",
        externalResourceId: "properties/1001",
        canonicalMetricKey: "ga4.engaged_sessions",
        granularity: "DAILY",
        periodStartDate: "2026-11-10",
        periodEndDate: "2026-11-10",
        reportingTimezone: "UTC",
        numericValue: 315,
      },
      {
        organizationId: orgId,
        workspaceId: wksId,
        projectId: prjSingleId,
        environmentId: envSingleId,
        providerConnectionId: ga4ConnId,
        connectedResourceId: ga4Res1Id,
        providerKey: "ga4",
        externalResourceId: "properties/1001",
        canonicalMetricKey: "ga4.active_users",
        granularity: "WINDOW_TOTAL",
        periodStartDate: "2026-11-01",
        periodEndDate: "2026-11-15",
        reportingTimezone: "UTC",
        numericValue: 1200,
      },
      {
        organizationId: orgId,
        workspaceId: wksId,
        projectId: prjMultiId,
        environmentId: envMultiId,
        providerConnectionId: ga4ConnId,
        connectedResourceId: ga4Res1Id,
        providerKey: "ga4",
        externalResourceId: "properties/1001",
        canonicalMetricKey: "ga4.active_users",
        granularity: "WINDOW_TOTAL",
        periodStartDate: "2026-11-01",
        periodEndDate: "2026-11-15",
        reportingTimezone: "UTC",
        numericValue: 1200,
      },
      {
        organizationId: orgId,
        workspaceId: wksId,
        projectId: prjMultiId,
        environmentId: envMultiId,
        providerConnectionId: ga4ConnId,
        connectedResourceId: ga4Res2Id,
        providerKey: "ga4",
        externalResourceId: "properties/1002",
        canonicalMetricKey: "ga4.active_users",
        granularity: "WINDOW_TOTAL",
        periodStartDate: "2026-11-01",
        periodEndDate: "2026-11-15",
        reportingTimezone: "UTC",
        numericValue: 850,
      },
      {
        organizationId: orgId,
        workspaceId: wksId,
        projectId: prjSingleId,
        environmentId: envSingleId,
        providerConnectionId: gscConnId,
        connectedResourceId: gscRes1Id,
        providerKey: "gsc",
        externalResourceId: "sc-domain:atlas.avenor.test",
        canonicalMetricKey: "gsc.clicks",
        granularity: "DAILY",
        periodStartDate: "2026-11-10",
        periodEndDate: "2026-11-10",
        reportingTimezone: "America/Los_Angeles",
        dimensions: { searchType: "web" },
        numericValue: 180,
      },
      {
        organizationId: orgId,
        workspaceId: wksId,
        projectId: prjSingleId,
        environmentId: envSingleId,
        providerConnectionId: gscConnId,
        connectedResourceId: gscRes1Id,
        providerKey: "gsc",
        externalResourceId: "sc-domain:atlas.avenor.test",
        canonicalMetricKey: "gsc.impressions",
        granularity: "DAILY",
        periodStartDate: "2026-11-10",
        periodEndDate: "2026-11-10",
        reportingTimezone: "America/Los_Angeles",
        dimensions: { searchType: "web" },
        numericValue: 3600,
      },
      {
        organizationId: orgId,
        workspaceId: wksId,
        projectId: prjSingleId,
        environmentId: envSingleId,
        providerConnectionId: gscConnId,
        connectedResourceId: gscRes1Id,
        providerKey: "gsc",
        externalResourceId: "sc-domain:atlas.avenor.test",
        canonicalMetricKey: "gsc.average_position",
        granularity: "DAILY",
        periodStartDate: "2026-11-10",
        periodEndDate: "2026-11-10",
        reportingTimezone: "America/Los_Angeles",
        dimensions: { searchType: "web" },
        numericValue: 6.5,
      },
    ]);
  });

  afterAll(async () => {
    await closeAllDatabasePools();
  });

  it("computes workspace portfolio overview with derived CTR/engagement rates and non-additive active user protection", async () => {
    const portfolio = await getWorkspacePortfolioOverview(ownerSession, {
      preset: "custom",
      startDate: "2026-11-01",
      endDate: "2026-11-15",
      autoHydrateIfEmpty: false,
    });

    expect(portfolio.workspaceId).toBe(wksId);
    expect(portfolio.summaryCounts.activeProjectCount).toBe(2);
    expect(portfolio.portfolioMetrics.sessions.value).toBe(450);
    expect(portfolio.portfolioMetrics.engagedSessions.value).toBe(315);
    expect(portfolio.portfolioMetrics.engagementRate.value).toBeCloseTo(0.7, 4);
    expect(portfolio.portfolioMetrics.gscClicks.value).toBe(180);
    expect(portfolio.portfolioMetrics.gscImpressions.value).toBe(3600);
    expect(portfolio.portfolioMetrics.gscCtr.value).toBeCloseTo(0.05, 4);
    expect(portfolio.portfolioMetrics.gscAveragePosition.value).toBeCloseTo(6.5, 4);
    // Two distinct GA4 properties are mapped in the workspace -> portfolio activeUsers is protected from false cross-property sum
    expect(portfolio.portfolioMetrics.activeUsers.value).toBeNull();
    expect(portfolio.nonAdditiveNotices.length).toBeGreaterThan(0);
  });

  it("refuses to add active_users across multiple mapped GA4 properties in ProjectControlCenterOverview", async () => {
    const multiProjectOverview = await getProjectControlCenterOverview(ownerSession, prjMultiId, {
      preset: "custom",
      startDate: "2026-11-01",
      endDate: "2026-11-15",
      autoHydrateIfEmpty: false,
    });

    expect(multiProjectOverview.hasOverlappingGa4Properties).toBe(true);
    expect(multiProjectOverview.metrics.activeUsers.value).toBeNull();
    expect(multiProjectOverview.overlapWarnings.length).toBeGreaterThan(0);
  });

  it("enforces cross-tenant workspace isolation on portfolio overview queries", async () => {
    await expect(
      getWorkspacePortfolioOverview(ownerSession, {
        workspaceId: otherWksId,
        autoHydrateIfEmpty: false,
      }),
    ).rejects.toThrow();
  });
});
