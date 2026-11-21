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
  mapResourceToProjectEnvironment,
} from "@/lib/connections";
import { upsertMetricObservationBatch } from "@/lib/metrics";
import { GOOGLE_MONITORING_READ_SCOPE } from "@/lib/providers";
import {
  getProjectBackendIntelligenceReport,
  getWorkspaceBackendIntelligenceReport,
} from "@/lib/reports/backend-service";

describe("THE-142: Backend Health, DB Growth & User-Count Dashboards Integration", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await closeAllDatabasePools();
  });

  it("aggregates Neon, Supabase, and Firebase canonical observations with GAUGE non-summation, DB growth deltas, function error rates, auth vs visitor semantic separation, and tenant isolation", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const registered = await registerUserWithDefaultOwnership({
      name: "Backend Intelligence Lead",
      email: `backend.dash.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Backend Org ${suffix}`,
      workspaceName: `Backend Workspace ${suffix}`,
    });
    const session = await resolveSessionByToken(registered.rawSessionToken);
    const workspaceId = registered.context.activeWorkspace.id;
    const organizationId = registered.context.activeOrganizationId;

    const otherReg = await registerUserWithDefaultOwnership({
      name: "Other Tenant",
      email: `other.backend.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Other Backend Org ${suffix}`,
      workspaceName: `Other Backend Workspace ${suffix}`,
    });
    const otherSession = await resolveSessionByToken(otherReg.rawSessionToken);

    const project = await createLogicalProject(session, workspaceId, {
      name: "Avenor Unified Backend App",
      slug: `avenor-backend-${suffix}`,
      primaryDomain: "https://app.avenor.test",
      initialEnvironments: ["PRODUCTION", "STAGING"],
    });
    const prodEnv = project.environments.find((e) => e.type === "PRODUCTION");
    if (!prodEnv) throw new Error("Expected production environment");

    const redirectUri = "http://localhost:3000/api/connections/oauth/callback";

    // Connect Neon, Supabase, and Firebase Monitoring
    const neonInit = await initiateOAuthAuthorization({
      session,
      workspaceId,
      providerKey: "neon",
      authorizeEndpointUrl: "https://console.neon.tech/oauth/authorize",
      requestedScopes: ["neon.projects.readonly", "neon.consumption.readonly"],
      redirectUri,
    });
    const neonConn = await completeOAuthCallback({
      session,
      workspaceId,
      providerKey: "neon",
      displayName: "Neon Prod",
      rawStateToken: neonInit.rawStateToken,
      redirectUri,
      authorizationCode: "code_neon_ro_ok",
    });
    const neonDisc = await discoverAndPersistConnectionResources(
      session,
      workspaceId,
      neonConn.connectionId,
    );
    const neonRes = neonDisc[0];
    if (!neonRes) throw new Error("Expected Neon resource");
    await mapResourceToProjectEnvironment(session, workspaceId, {
      projectId: project.id,
      environmentId: prodEnv.id,
      connectedResourceId: neonRes.id,
      mappingRole: "PRIMARY",
    });

    const sbInit = await initiateOAuthAuthorization({
      session,
      workspaceId,
      providerKey: "supabase",
      authorizeEndpointUrl: "https://api.supabase.com/v1/oauth/authorize",
      requestedScopes: ["projects:read", "analytics:read"],
      redirectUri,
    });
    const sbConn = await completeOAuthCallback({
      session,
      workspaceId,
      providerKey: "supabase",
      displayName: "Supabase Prod",
      rawStateToken: sbInit.rawStateToken,
      redirectUri,
      authorizationCode: "code_sb_ro_ok",
    });
    const sbDisc = await discoverAndPersistConnectionResources(
      session,
      workspaceId,
      sbConn.connectionId,
    );
    const sbRes = sbDisc[0];
    if (!sbRes) throw new Error("Expected Supabase resource");
    await mapResourceToProjectEnvironment(session, workspaceId, {
      projectId: project.id,
      environmentId: prodEnv.id,
      connectedResourceId: sbRes.id,
      mappingRole: "PRIMARY",
    });

    const fbInit = await initiateOAuthAuthorization({
      session,
      workspaceId,
      providerKey: "firebase-monitoring",
      authorizeEndpointUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      requestedScopes: [GOOGLE_MONITORING_READ_SCOPE],
      redirectUri,
    });
    const fbConn = await completeOAuthCallback({
      session,
      workspaceId,
      providerKey: "firebase-monitoring",
      displayName: "Firebase Monitoring Prod",
      rawStateToken: fbInit.rawStateToken,
      redirectUri,
      authorizationCode: "code_fb_ro_ok",
    });
    const fbDisc = await discoverAndPersistConnectionResources(
      session,
      workspaceId,
      fbConn.connectionId,
    );
    const fbRes = fbDisc[0];
    if (!fbRes) throw new Error("Expected Firebase resource");
    await mapResourceToProjectEnvironment(session, workspaceId, {
      projectId: project.id,
      environmentId: prodEnv.id,
      connectedResourceId: fbRes.id,
      mappingRole: "PRIMARY",
    });

    // Seed 2 days of canonical observations across Neon, Supabase, and Firebase
    await upsertMetricObservationBatch([
      {
        organizationId,
        workspaceId,
        projectId: project.id,
        environmentId: prodEnv.id,
        providerConnectionId: neonConn.connectionId,
        connectedResourceId: neonRes.id,
        providerKey: "neon",
        externalResourceId: neonRes.externalResourceId,
        canonicalMetricKey: "neon.instantaneous_storage_bytes",
        granularity: "DAILY",
        periodStartDate: "2026-11-19",
        periodEndDate: "2026-11-19",
        reportingTimezone: "UTC",
        numericValue: 1_000_000_000,
        completenessState: "COMPLETE",
      },
      {
        organizationId,
        workspaceId,
        projectId: project.id,
        environmentId: prodEnv.id,
        providerConnectionId: neonConn.connectionId,
        connectedResourceId: neonRes.id,
        providerKey: "neon",
        externalResourceId: neonRes.externalResourceId,
        canonicalMetricKey: "neon.instantaneous_storage_bytes",
        granularity: "DAILY",
        periodStartDate: "2026-11-20",
        periodEndDate: "2026-11-20",
        reportingTimezone: "UTC",
        numericValue: 1_200_000_000,
        completenessState: "COMPLETE",
      },
      {
        organizationId,
        workspaceId,
        projectId: project.id,
        environmentId: prodEnv.id,
        providerConnectionId: neonConn.connectionId,
        connectedResourceId: neonRes.id,
        providerKey: "neon",
        externalResourceId: neonRes.externalResourceId,
        canonicalMetricKey: "neon.compute_unit_seconds",
        granularity: "DAILY",
        periodStartDate: "2026-11-19",
        periodEndDate: "2026-11-19",
        reportingTimezone: "UTC",
        numericValue: 50_000,
        completenessState: "COMPLETE",
      },
      {
        organizationId,
        workspaceId,
        projectId: project.id,
        environmentId: prodEnv.id,
        providerConnectionId: neonConn.connectionId,
        connectedResourceId: neonRes.id,
        providerKey: "neon",
        externalResourceId: neonRes.externalResourceId,
        canonicalMetricKey: "neon.compute_unit_seconds",
        granularity: "DAILY",
        periodStartDate: "2026-11-20",
        periodEndDate: "2026-11-20",
        reportingTimezone: "UTC",
        numericValue: 60_000,
        completenessState: "COMPLETE",
      },
      {
        organizationId,
        workspaceId,
        projectId: project.id,
        environmentId: prodEnv.id,
        providerConnectionId: sbConn.connectionId,
        connectedResourceId: sbRes.id,
        providerKey: "supabase",
        externalResourceId: sbRes.externalResourceId,
        canonicalMetricKey: "supabase.db_size_bytes",
        granularity: "DAILY",
        periodStartDate: "2026-11-19",
        periodEndDate: "2026-11-19",
        reportingTimezone: "UTC",
        numericValue: 800_000_000,
        completenessState: "COMPLETE",
      },
      {
        organizationId,
        workspaceId,
        projectId: project.id,
        environmentId: prodEnv.id,
        providerConnectionId: sbConn.connectionId,
        connectedResourceId: sbRes.id,
        providerKey: "supabase",
        externalResourceId: sbRes.externalResourceId,
        canonicalMetricKey: "supabase.db_size_bytes",
        granularity: "DAILY",
        periodStartDate: "2026-11-20",
        periodEndDate: "2026-11-20",
        reportingTimezone: "UTC",
        numericValue: 880_000_000,
        completenessState: "COMPLETE",
      },
      {
        organizationId,
        workspaceId,
        projectId: project.id,
        environmentId: prodEnv.id,
        providerConnectionId: sbConn.connectionId,
        connectedResourceId: sbRes.id,
        providerKey: "supabase",
        externalResourceId: sbRes.externalResourceId,
        canonicalMetricKey: "supabase.registered_auth_users",
        granularity: "DAILY",
        periodStartDate: "2026-11-19",
        periodEndDate: "2026-11-19",
        reportingTimezone: "UTC",
        numericValue: 4_820,
        completenessState: "COMPLETE",
      },
      {
        organizationId,
        workspaceId,
        projectId: project.id,
        environmentId: prodEnv.id,
        providerConnectionId: sbConn.connectionId,
        connectedResourceId: sbRes.id,
        providerKey: "supabase",
        externalResourceId: sbRes.externalResourceId,
        canonicalMetricKey: "supabase.registered_auth_users",
        granularity: "DAILY",
        periodStartDate: "2026-11-20",
        periodEndDate: "2026-11-20",
        reportingTimezone: "UTC",
        numericValue: 4_865,
        completenessState: "COMPLETE",
      },
      {
        organizationId,
        workspaceId,
        projectId: project.id,
        environmentId: prodEnv.id,
        providerConnectionId: sbConn.connectionId,
        connectedResourceId: sbRes.id,
        providerKey: "supabase",
        externalResourceId: sbRes.externalResourceId,
        canonicalMetricKey: "supabase.auth_requests",
        granularity: "DAILY",
        periodStartDate: "2026-11-19",
        periodEndDate: "2026-11-19",
        reportingTimezone: "UTC",
        numericValue: 19_450,
        completenessState: "COMPLETE",
      },
      {
        organizationId,
        workspaceId,
        projectId: project.id,
        environmentId: prodEnv.id,
        providerConnectionId: sbConn.connectionId,
        connectedResourceId: sbRes.id,
        providerKey: "supabase",
        externalResourceId: sbRes.externalResourceId,
        canonicalMetricKey: "supabase.auth_requests",
        granularity: "DAILY",
        periodStartDate: "2026-11-20",
        periodEndDate: "2026-11-20",
        reportingTimezone: "UTC",
        numericValue: 21_310,
        completenessState: "COMPLETE",
      },
      {
        organizationId,
        workspaceId,
        projectId: project.id,
        environmentId: prodEnv.id,
        providerConnectionId: fbConn.connectionId,
        connectedResourceId: fbRes.id,
        providerKey: "firebase-monitoring",
        externalResourceId: fbRes.externalResourceId,
        canonicalMetricKey: "firebase.function_invocations",
        granularity: "DAILY",
        periodStartDate: "2026-11-19",
        periodEndDate: "2026-11-19",
        reportingTimezone: "UTC",
        numericValue: 10_000,
        completenessState: "COMPLETE",
      },
      {
        organizationId,
        workspaceId,
        projectId: project.id,
        environmentId: prodEnv.id,
        providerConnectionId: fbConn.connectionId,
        connectedResourceId: fbRes.id,
        providerKey: "firebase-monitoring",
        externalResourceId: fbRes.externalResourceId,
        canonicalMetricKey: "firebase.function_invocations",
        granularity: "DAILY",
        periodStartDate: "2026-11-20",
        periodEndDate: "2026-11-20",
        reportingTimezone: "UTC",
        numericValue: 10_000,
        completenessState: "COMPLETE",
      },
      {
        organizationId,
        workspaceId,
        projectId: project.id,
        environmentId: prodEnv.id,
        providerConnectionId: fbConn.connectionId,
        connectedResourceId: fbRes.id,
        providerKey: "firebase-monitoring",
        externalResourceId: fbRes.externalResourceId,
        canonicalMetricKey: "firebase.function_errors",
        granularity: "DAILY",
        periodStartDate: "2026-11-19",
        periodEndDate: "2026-11-19",
        reportingTimezone: "UTC",
        numericValue: 15,
        completenessState: "COMPLETE",
      },
      {
        organizationId,
        workspaceId,
        projectId: project.id,
        environmentId: prodEnv.id,
        providerConnectionId: fbConn.connectionId,
        connectedResourceId: fbRes.id,
        providerKey: "firebase-monitoring",
        externalResourceId: fbRes.externalResourceId,
        canonicalMetricKey: "firebase.function_errors",
        granularity: "DAILY",
        periodStartDate: "2026-11-20",
        periodEndDate: "2026-11-20",
        reportingTimezone: "UTC",
        numericValue: 25,
        completenessState: "COMPLETE",
      },
      {
        organizationId,
        workspaceId,
        projectId: project.id,
        environmentId: prodEnv.id,
        providerConnectionId: fbConn.connectionId,
        connectedResourceId: fbRes.id,
        providerKey: "firebase-monitoring",
        externalResourceId: fbRes.externalResourceId,
        canonicalMetricKey: "firebase.firestore_active_listeners",
        granularity: "DAILY",
        periodStartDate: "2026-11-19",
        periodEndDate: "2026-11-19",
        reportingTimezone: "UTC",
        numericValue: 145,
        completenessState: "COMPLETE",
      },
      {
        organizationId,
        workspaceId,
        projectId: project.id,
        environmentId: prodEnv.id,
        providerConnectionId: fbConn.connectionId,
        connectedResourceId: fbRes.id,
        providerKey: "firebase-monitoring",
        externalResourceId: fbRes.externalResourceId,
        canonicalMetricKey: "firebase.firestore_active_listeners",
        granularity: "DAILY",
        periodStartDate: "2026-11-20",
        periodEndDate: "2026-11-20",
        reportingTimezone: "UTC",
        numericValue: 168,
        completenessState: "COMPLETE",
      },
    ]);

    const projectReport = await getProjectBackendIntelligenceReport(session, project.id, {
      preset: "custom",
      startDate: "2026-11-19",
      endDate: "2026-11-20",
    });

    // Verify GAUGE non-summation vs SUM metrics
    expect(projectReport.neon.instantaneousStorageBytes).toBe(1_200_000_000);
    expect(projectReport.neon.computeUnitSeconds).toBe(110_000);
    expect(projectReport.supabase.dbSizeBytes).toBe(880_000_000);
    expect(projectReport.supabase.registeredAuthUsers).toBe(4_865);
    expect(projectReport.supabase.authRequests).toBe(40_760);
    expect(projectReport.firebase.functionInvocations).toBe(20_000);
    expect(projectReport.firebase.functionErrors).toBe(40);
    expect(projectReport.firebase.functionErrorRatePercent).toBe(0.2);
    expect(projectReport.firebase.firestoreActiveListeners).toBe(168);

    // Verify DB growth calculation
    const neonGrowth = projectReport.storageGrowth.find(
      (s) => s.metricKey === "neon.instantaneous_storage_bytes",
    );
    expect(neonGrowth?.growthBytes).toBe(200_000_000);
    expect(neonGrowth?.growthPercent).toBe(20);

    // Verify Auth vs Visitors semantic panel
    const neonAuth = projectReport.authSemanticsPanel.find(
      (a) => a.key === "neon_registered_users",
    );
    const fbAuth = projectReport.authSemanticsPanel.find(
      (a) => a.key === "firebase_registered_users",
    );
    expect(neonAuth?.status).toBe("UNAVAILABLE");
    expect(neonAuth?.value).toBeNull();
    expect(fbAuth?.status).toBe("UNAVAILABLE");
    expect(fbAuth?.value).toBeNull();

    // Verify workspace rollup
    const workspaceReport = await getWorkspaceBackendIntelligenceReport(session, {
      preset: "custom",
      startDate: "2026-11-19",
      endDate: "2026-11-20",
    });
    expect(workspaceReport.connectedProjectCount).toBe(1);
    expect(workspaceReport.summary.totalNeonComputeUnitSeconds).toBe(110_000);
    expect(workspaceReport.summary.totalSupabaseDbSizeBytes).toBe(880_000_000);

    // Verify cross-tenant isolation
    await expect(
      getProjectBackendIntelligenceReport(otherSession, project.id, {
        preset: "custom",
        startDate: "2026-11-19",
        endDate: "2026-11-20",
      }),
    ).rejects.toThrow();
  });
});
