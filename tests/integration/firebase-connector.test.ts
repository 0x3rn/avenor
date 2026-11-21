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
import {
  FIREBASE_CANONICAL_METRIC_KEYS,
  GOOGLE_MONITORING_READ_SCOPE,
  getProviderAdapter,
} from "@/lib/providers";

describe("THE-141: Firebase / Google Cloud Monitoring Read-Only Connector Integration", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await closeAllDatabasePools();
  });

  it("connects Firebase/GCP Cloud Monitoring read-only via monitoring.read, discovers monitored Firebase project, maps to Avenor logical project, reads Firestore/Functions/Storage telemetry, and enforces cross-workspace isolation", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const registered = await registerUserWithDefaultOwnership({
      name: "Firebase Telemetry Operator",
      email: `firebase.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Firebase Org ${suffix}`,
      workspaceName: `Firebase Workspace ${suffix}`,
    });

    const session = await resolveSessionByToken(registered.rawSessionToken);
    const workspaceId = registered.context.activeWorkspace.id;

    const otherReg = await registerUserWithDefaultOwnership({
      name: "Other Firebase Tenant",
      email: `other.firebase.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Other Firebase Org ${suffix}`,
      workspaceName: `Other Firebase Workspace ${suffix}`,
    });
    const otherSession = await resolveSessionByToken(otherReg.rawSessionToken);

    const avenorProject = await createLogicalProject(session, workspaceId, {
      name: "Avenor Mobile & Cloud Product",
      slug: `avenor-firebase-${suffix}`,
      primaryDomain: "https://mobile.avenor.test",
      initialEnvironments: ["PRODUCTION", "STAGING"],
    });
    const prodEnv = avenorProject.environments.find((e) => e.type === "PRODUCTION");

    const redirectUri = "http://localhost:3000/api/connections/oauth/callback";
    const initiated = await initiateOAuthAuthorization({
      session,
      workspaceId,
      providerKey: "firebase-monitoring",
      authorizeEndpointUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      requestedScopes: [GOOGLE_MONITORING_READ_SCOPE],
      redirectUri,
    });

    const callbackRes = await completeOAuthCallback({
      session,
      workspaceId,
      providerKey: "firebase-monitoring",
      displayName: "Firebase / Cloud Monitoring (monitoring.read)",
      rawStateToken: initiated.rawStateToken,
      redirectUri,
      authorizationCode: "code_firebase_monitoring_ro_ok",
    });
    expect(callbackRes.status).toBe("HEALTHY");

    const discovered = await discoverAndPersistConnectionResources(
      session,
      workspaceId,
      callbackRes.connectionId,
    );
    expect(discovered.length).toBeGreaterThanOrEqual(1);

    const firebaseRes = discovered.find(
      (r) =>
        r.resourceType === "firebase_gcp_project" &&
        r.externalResourceId === "firebase-project:avenor-cloud-prod",
    );
    expect(firebaseRes).toBeDefined();
    expect(firebaseRes?.metadata.adminSdkRejectedByDefault).toBe(true);
    expect(firebaseRes?.metadata.intrinsicProviderReadOnly).toBe(true);

    if (!firebaseRes) {
      throw new Error("Expected discovered firebaseRes");
    }

    const mapping = await mapResourceToProjectEnvironment(session, workspaceId, {
      projectId: avenorProject.id,
      environmentId: prodEnv?.id ?? null,
      connectedResourceId: firebaseRes.id,
      mappingRole: "PRIMARY",
    });
    expect(mapping.projectId).toBe(avenorProject.id);
    expect(mapping.externalResourceId).toBe("firebase-project:avenor-cloud-prod");

    const firebaseAdapter = getProviderAdapter("firebase-monitoring");
    const readsRes = await firebaseAdapter.readMetrics(
      {
        organizationId: registered.context.activeOrganizationId,
        workspaceId,
        accessToken: "sbx_firebase_monitoring_readonly",
        grantedScopes: [GOOGLE_MONITORING_READ_SCOPE],
      },
      {
        externalResourceId: "firebase-project:avenor-cloud-prod",
        capabilityKey: "firebase_telemetry",
        metricKey: FIREBASE_CANONICAL_METRIC_KEYS.FIRESTORE_DOCUMENT_READS,
        granularity: "daily",
        startDateIso: "2026-11-19T00:00:00.000Z",
        endDateIso: "2026-11-21T00:00:00.000Z",
      },
    );
    expect(readsRes.capabilityStatus).toBe("SUPPORTED");
    expect(readsRes.points).toHaveLength(2);
    expect(readsRes.points[0]?.value).toBe(284_500);

    await expect(
      getWorkspaceConnectionDetail(otherSession, workspaceId, callbackRes.connectionId),
    ).rejects.toThrow();
  });
});
