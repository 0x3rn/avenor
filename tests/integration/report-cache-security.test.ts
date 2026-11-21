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
import { upsertMetricObservation } from "@/lib/metrics";
import { sharedReportCache } from "@/lib/reports/cache";
import {
  getProjectControlCenterOverview,
  getWorkspacePortfolioOverview,
} from "@/lib/reports/portfolio-service";

describe("THE-132: Cross-Tenant Cache Isolation, Automatic Invalidation & Permission Revocation Security Suite", () => {
  let orgAId = "";
  let wksAId = "";
  let prjAId = "";
  let envAId = "";
  let connAId = "";
  let resAId = "";

  let orgBId = "";
  let wksBId = "";
  let prjBId = "";
  let envBId = "";
  let connBId = "";
  let resBId = "";

  let sessionOrgA: AuthenticatedSessionContext | null = null;
  let sessionOrgB: AuthenticatedSessionContext | null = null;
  let removableMemberUserId = "";
  let sessionRemovableMember: AuthenticatedSessionContext | null = null;

  beforeAll(async () => {
    await runMigrations();
    sharedReportCache.clear();

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // 1. Create Organization A + Workspace A + Project A
    const regA = await registerUserWithDefaultOwnership({
      name: "Org A Owner",
      email: `orga.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Org A ${suffix}`,
      workspaceName: `Workspace A ${suffix}`,
    });
    sessionOrgA = await resolveSessionByToken(regA.rawSessionToken);
    orgAId = regA.context.activeOrganizationId;
    wksAId = regA.context.activeWorkspace.id;

    const projA = await createLogicalProject(sessionOrgA, wksAId, {
      name: "Shared Slug Product",
      slug: `shared-product-${suffix}`,
      primaryDomain: "https://orga.avenor.test",
      initialEnvironments: ["PRODUCTION"],
    });
    prjAId = projA.id;
    envAId = projA.environments[0]?.id ?? "";

    // 2. Create Organization B + Workspace B + Project B
    const regB = await registerUserWithDefaultOwnership({
      name: "Org B Owner",
      email: `orgb.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Org B ${suffix}`,
      workspaceName: `Workspace B ${suffix}`,
    });
    sessionOrgB = await resolveSessionByToken(regB.rawSessionToken);
    orgBId = regB.context.activeOrganizationId;
    wksBId = regB.context.activeWorkspace.id;

    const projB = await createLogicalProject(sessionOrgB, wksBId, {
      name: "Shared Slug Product",
      slug: `shared-product-${suffix}`,
      primaryDomain: "https://orgb.avenor.test",
      initialEnvironments: ["PRODUCTION"],
    });
    prjBId = projB.id;
    envBId = projB.environments[0]?.id ?? "";

    // 3. Create a second member in Workspace A to test membership revocation cache safety
    const regMember = await registerUserWithDefaultOwnership({
      name: "Temporary Analyst",
      email: `analyst.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Temp Org ${suffix}`,
      workspaceName: `Temp Workspace ${suffix}`,
    });
    removableMemberUserId = regMember.context.user.id;
    const pool = getDatabasePool();

    await dbQuery(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role)
       VALUES ($1, $2, $3, 'VIEWER')`,
      [generateId("omem"), orgAId, removableMemberUserId],
      pool,
    );
    await dbQuery(
      `INSERT INTO workspace_memberships (id, workspace_id, user_id, role)
       VALUES ($1, $2, $3, 'VIEWER')`,
      [generateId("wmem"), wksAId, removableMemberUserId],
      pool,
    );

    const resolvedMember = await resolveSessionByToken(regMember.rawSessionToken);
    if (resolvedMember) {
      sessionRemovableMember = {
        ...resolvedMember,
        activeOrganizationId: orgAId,
        activeWorkspace: {
          ...resolvedMember.activeWorkspace,
          id: wksAId,
          organizationId: orgAId,
          role: "VIEWER",
        },
      };
    }

    // 4. Seed distinct metric observations for Org A (9,100 sessions) and Org B (320 sessions)
    connAId = generateId("con");
    resAId = generateId("res");
    connBId = generateId("con");
    resBId = generateId("res");

    await dbQuery(
      `INSERT INTO provider_connections (id, workspace_id, provider_key, display_name, status)
       VALUES ($1, $2, 'ga4', 'Org A GA4', 'HEALTHY'),
              ($3, $4, 'ga4', 'Org B GA4', 'HEALTHY')`,
      [connAId, wksAId, connBId, wksBId],
      pool,
    );

    await dbQuery(
      `INSERT INTO connected_resources (id, workspace_id, provider_connection_id, external_resource_id, resource_type, display_name)
       VALUES ($1, $2, $3, 'properties/1111', 'ga4_property', 'Org A GA4 Property'),
              ($4, $5, $6, 'properties/2222', 'ga4_property', 'Org B GA4 Property')`,
      [resAId, wksAId, connAId, resBId, wksBId, connBId],
      pool,
    );

    await dbQuery(
      `INSERT INTO resource_mappings (id, workspace_id, project_id, environment_id, connected_resource_id, mapping_role)
       VALUES ($1, $2, $3, $4, $5, 'PRIMARY'),
              ($6, $7, $8, $9, $10, 'PRIMARY')`,
      [
        generateId("map"),
        wksAId,
        prjAId,
        envAId,
        resAId,
        generateId("map"),
        wksBId,
        prjBId,
        envBId,
        resBId,
      ],
      pool,
    );

    await upsertMetricObservation({
      organizationId: orgAId,
      workspaceId: wksAId,
      projectId: prjAId,
      environmentId: envAId,
      providerConnectionId: connAId,
      connectedResourceId: resAId,
      providerKey: "ga4",
      externalResourceId: "properties/1111",
      canonicalMetricKey: "ga4.sessions",
      granularity: "DAILY",
      periodStartDate: "2026-11-10",
      periodEndDate: "2026-11-10",
      reportingTimezone: "UTC",
      numericValue: 9100,
    });

    await upsertMetricObservation({
      organizationId: orgBId,
      workspaceId: wksBId,
      projectId: prjBId,
      environmentId: envBId,
      providerConnectionId: connBId,
      connectedResourceId: resBId,
      providerKey: "ga4",
      externalResourceId: "properties/2222",
      canonicalMetricKey: "ga4.sessions",
      granularity: "DAILY",
      periodStartDate: "2026-11-10",
      periodEndDate: "2026-11-10",
      reportingTimezone: "UTC",
      numericValue: 320,
    });
  });

  afterAll(async () => {
    sharedReportCache.clear();
    await closeAllDatabasePools();
  });

  it("warms Organization A cache, serves HITs for Org A, and never leaks Org A cached values to Organization B", async () => {
    const queryWindow = {
      preset: "custom",
      startDate: "2026-11-01",
      endDate: "2026-11-15",
      autoHydrateIfEmpty: false,
    };

    const orgAMiss = await getWorkspacePortfolioOverview(sessionOrgA, queryWindow);
    expect(orgAMiss.cacheMetadata?.cacheStatus).toBe("MISS");
    expect(orgAMiss.portfolioMetrics.sessions.value).toBe(9100);

    const orgAHit = await getWorkspacePortfolioOverview(sessionOrgA, queryWindow);
    expect(orgAHit.cacheMetadata?.cacheStatus).toBe("HIT");
    expect(orgAHit.portfolioMetrics.sessions.value).toBe(9100);

    // Organization B requests the identical logical route and date range
    const orgBMiss = await getWorkspacePortfolioOverview(sessionOrgB, queryWindow);
    expect(orgBMiss.cacheMetadata?.cacheStatus).toBe("MISS");
    expect(orgBMiss.portfolioMetrics.sessions.value).toBe(320);
    expect(orgBMiss.workspaceId).toBe(wksBId);
  });

  it("automatically invalidates cached project and portfolio reports when a historical observation is revised", async () => {
    const queryWindow = {
      preset: "custom",
      startDate: "2026-11-01",
      endDate: "2026-11-15",
      autoHydrateIfEmpty: false,
    };

    const projFirst = await getProjectControlCenterOverview(sessionOrgA, prjAId, queryWindow);
    expect(projFirst.metrics.sessions.value).toBe(9100);

    const projCached = await getProjectControlCenterOverview(sessionOrgA, prjAId, queryWindow);
    expect(projCached.cacheMetadata?.cacheStatus).toBe("HIT");

    // Revise 2026-11-10 sessions from 9100 -> 9450
    await upsertMetricObservation({
      organizationId: orgAId,
      workspaceId: wksAId,
      projectId: prjAId,
      environmentId: envAId,
      providerConnectionId: connAId,
      connectedResourceId: resAId,
      providerKey: "ga4",
      externalResourceId: "properties/1111",
      canonicalMetricKey: "ga4.sessions",
      granularity: "DAILY",
      periodStartDate: "2026-11-10",
      periodEndDate: "2026-11-10",
      reportingTimezone: "UTC",
      numericValue: 9450,
      revisionReason: "late_conversion_revision",
    });

    // Next read must be a cache MISS returning the revised value 9450
    const projAfterRevision = await getProjectControlCenterOverview(
      sessionOrgA,
      prjAId,
      queryWindow,
    );
    expect(projAfterRevision.cacheMetadata?.cacheStatus).toBe("MISS");
    expect(projAfterRevision.metrics.sessions.value).toBe(9450);
  });

  it("prevents a user whose workspace membership was removed from receiving a previously warmed cache response", async () => {
    const queryWindow = {
      preset: "custom",
      startDate: "2026-11-01",
      endDate: "2026-11-15",
      autoHydrateIfEmpty: false,
    };

    // Warm cache while member is authorized
    const allowedBeforeRemoval = await getProjectControlCenterOverview(
      sessionRemovableMember,
      prjAId,
      queryWindow,
    );
    expect(allowedBeforeRemoval.metrics.sessions.value).toBe(9450);

    // Revoke membership in PostgreSQL
    await dbQuery(
      `DELETE FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
      [wksAId, removableMemberUserId],
      getDatabasePool(),
    );

    // Even though the VIEWER cache entry is warm in memory, authorizeProjectAccess runs BEFORE cache lookup
    await expect(
      getProjectControlCenterOverview(sessionRemovableMember, prjAId, queryWindow),
    ).rejects.toThrow();
  });
});
