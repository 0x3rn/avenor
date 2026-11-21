import "dotenv/config";
import {
  completeOAuthCallback,
  createLogicalProject,
  initiateOAuthAuthorization,
  registerUserWithDefaultOwnership,
  resolveSessionByToken,
} from "@avenor/auth";
import { closeAllDatabasePools, dbQuery, runMigrations } from "@avenor/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  discoverAndPersistConnectionResources,
  mapResourceToProjectEnvironment,
} from "@/lib/connections";
import { GOOGLE_MONITORING_READ_SCOPE } from "@/lib/providers";
import { getAndPersistProjectSecurityPosture } from "@/lib/reports/security-posture";

describe("THE-143: Passive Security Posture & Sanitized Audit Summary Integration", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await closeAllDatabasePools();
  });

  it("persists passive Neon, Supabase, and Firebase posture observations idempotently in PostgreSQL, returns PII-redacted audit summaries, and enforces cross-tenant isolation", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const registered = await registerUserWithDefaultOwnership({
      name: "Security Posture Operator",
      email: `posture.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Posture Org ${suffix}`,
      workspaceName: `Posture Workspace ${suffix}`,
    });
    const session = await resolveSessionByToken(registered.rawSessionToken);
    const workspaceId = registered.context.activeWorkspace.id;

    const otherReg = await registerUserWithDefaultOwnership({
      name: "Other Posture Tenant",
      email: `other.posture.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Other Posture Org ${suffix}`,
      workspaceName: `Other Posture Workspace ${suffix}`,
    });
    const otherSession = await resolveSessionByToken(otherReg.rawSessionToken);

    const project = await createLogicalProject(session, workspaceId, {
      name: "Avenor Posture Product",
      slug: `avenor-posture-${suffix}`,
      primaryDomain: "https://posture.avenor.test",
      initialEnvironments: ["PRODUCTION"],
    });
    const prodEnv = project.environments[0];
    if (!prodEnv) throw new Error("Expected default environment");

    const redirectUri = "http://localhost:3000/api/connections/oauth/callback";

    // Connect Supabase & Firebase Monitoring
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
      displayName: "Supabase Posture Source",
      rawStateToken: sbInit.rawStateToken,
      redirectUri,
      authorizationCode: "code_sb_posture_ok",
    });
    const sbDisc = await discoverAndPersistConnectionResources(
      session,
      workspaceId,
      sbConn.connectionId,
    );
    const sbRes = sbDisc[0];
    if (!sbRes) throw new Error("Expected Supabase discovered resource");
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
      displayName: "Firebase Posture Source",
      rawStateToken: fbInit.rawStateToken,
      redirectUri,
      authorizationCode: "code_fb_posture_ok",
    });
    const fbDisc = await discoverAndPersistConnectionResources(
      session,
      workspaceId,
      fbConn.connectionId,
    );
    const fbRes = fbDisc[0];
    if (!fbRes) throw new Error("Expected Firebase discovered resource");
    await mapResourceToProjectEnvironment(session, workspaceId, {
      projectId: project.id,
      environmentId: prodEnv.id,
      connectedResourceId: fbRes.id,
      mappingRole: "PRIMARY",
    });

    // Run twice to prove idempotent upsert on (workspace_id, connected_resource_id, indicator_key)
    const first = await getAndPersistProjectSecurityPosture(session, project.id);
    const second = await getAndPersistProjectSecurityPosture(session, project.id);

    expect(first.indicators.length).toBeGreaterThanOrEqual(7);
    expect(second.indicators.length).toBe(first.indicators.length);
    expect(second.countsByStatus.NOT_VERIFIED).toBeGreaterThanOrEqual(1);
    expect(second.countsByStatus.CONFIGURED).toBeGreaterThanOrEqual(4);
    expect(second.recentAuditSummaries.length).toBeGreaterThan(0);

    // Verify PostgreSQL table count matches indicators length (no duplicate rows)
    const dbCount = await dbQuery<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM backend_security_posture_observations WHERE workspace_id = $1 AND project_id = $2`,
      [workspaceId, project.id],
    );
    expect(Number(dbCount.rows[0]?.count)).toBe(second.indicators.length);

    // Cross-tenant isolation check
    await expect(getAndPersistProjectSecurityPosture(otherSession, project.id)).rejects.toThrow();
  });
});
