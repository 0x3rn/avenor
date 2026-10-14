import "dotenv/config";
import {
  completeOAuthCallback,
  createLogicalProject,
  decryptConnectionCredentialForServer,
  disconnectProviderConnection,
  initiateOAuthAuthorization,
  registerUserWithDefaultOwnership,
  resolveSessionByToken,
} from "@avenor/auth";
import { closeAllDatabasePools, dbQuery, generateId, runMigrations } from "@avenor/database";
import {
  assertReadOnlyAdapterContract,
  ERROR_CODES,
  FORBIDDEN_PROVIDER_MUTATION_METHODS,
} from "@avenor/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTrustedJobContext,
  discoverAndPersistConnectionResources,
  getWorkspaceConnectionDetail,
  listWorkspaceConnections,
  mapResourceToProjectEnvironment,
  runTrustedBackgroundHealthChecks,
  unmapResourceFromProject,
  validateConnectionHealth,
  verifyTrustedJobContext,
} from "../../src/lib/connections";
import { getProviderAdapter } from "../../src/lib/providers";

const CALLBACK_URI = "http://localhost:3000/api/connections/oauth/callback";

describe("Milestone 02 — Connection Health, Audit Trail, RBAC, Background Job & Cross-Tenant Threat Suite (THE-121)", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await closeAllDatabasePools();
  });

  it("enforces cross-tenant isolation across connection listing, detail inspection, discovery, mapping, unmapping, health validation, vault decryption, and disconnect", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const tenantA = await registerUserWithDefaultOwnership({
      name: "Tenant A Owner",
      email: `sec-tenant-a-${suffix}@avenor.test`,
      password: "TenantASecurePassword!123",
      organizationName: `Sec Org A ${suffix}`,
      workspaceName: `Sec Workspace A ${suffix}`,
    });

    const tenantB = await registerUserWithDefaultOwnership({
      name: "Tenant B Owner",
      email: `sec-tenant-b-${suffix}@avenor.test`,
      password: "TenantBSecurePassword!123",
      organizationName: `Sec Org B ${suffix}`,
      workspaceName: `Sec Workspace B ${suffix}`,
    });

    const [sessionA, sessionB] = await Promise.all([
      resolveSessionByToken(tenantA.rawSessionToken),
      resolveSessionByToken(tenantB.rawSessionToken),
    ]);
    const wsA = tenantA.context.activeWorkspace.id;
    const wsB = tenantB.context.activeWorkspace.id;
    const orgB = tenantB.context.activeWorkspace.organizationId;

    const [projectA, projectB] = await Promise.all([
      createLogicalProject(sessionA, wsA, {
        name: "Tenant A Flagship",
        slug: `tenant-a-flagship-${suffix}`,
        initialEnvironments: ["PRODUCTION", "STAGING"],
      }),
      createLogicalProject(sessionB, wsB, {
        name: "Tenant B Flagship",
        slug: `tenant-b-flagship-${suffix}`,
        initialEnvironments: ["PRODUCTION"],
      }),
    ]);

    // Connect avenor-sandbox in Tenant A
    const initA = await initiateOAuthAuthorization({
      session: sessionA,
      workspaceId: wsA,
      providerKey: "avenor-sandbox",
      authorizeEndpointUrl: "/api/connections/oauth/sandbox-authorize",
      requestedScopes: ["sandbox.resources.readonly", "sandbox.metrics.readonly"],
      redirectUri: CALLBACK_URI,
    });

    const connectedA = await completeOAuthCallback({
      session: sessionA,
      workspaceId: wsA,
      providerKey: "avenor-sandbox",
      rawStateToken: initA.rawStateToken,
      redirectUri: CALLBACK_URI,
      authorizationCode: "code_sec_tenant_a",
    });

    const resourcesA = await discoverAndPersistConnectionResources(
      sessionA,
      wsA,
      connectedA.connectionId,
    );
    expect(resourcesA.length).toBeGreaterThan(0);

    const mappingA = await mapResourceToProjectEnvironment(sessionA, wsA, {
      connectedResourceId: resourcesA[0]?.id,
      projectId: projectA.id,
      environmentId: projectA.environments[0]?.id,
    });

    // 1–8. Verify cross-tenant isolation across list, detail, discovery, mapping, unmapping, health, vault decryption, and disconnect
    await Promise.all([
      expect(listWorkspaceConnections(sessionB, wsA)).rejects.toMatchObject({
        code: ERROR_CODES.FORBIDDEN,
      }),
      expect(
        getWorkspaceConnectionDetail(sessionB, wsA, connectedA.connectionId),
      ).rejects.toMatchObject({
        code: ERROR_CODES.FORBIDDEN,
      }),
      expect(
        getWorkspaceConnectionDetail(sessionB, wsB, connectedA.connectionId),
      ).rejects.toMatchObject({
        code: ERROR_CODES.NOT_FOUND,
      }),
      expect(
        discoverAndPersistConnectionResources(sessionB, wsB, connectedA.connectionId),
      ).rejects.toMatchObject({
        code: ERROR_CODES.FORBIDDEN,
      }),
      expect(
        mapResourceToProjectEnvironment(sessionB, wsB, {
          connectedResourceId: resourcesA[0]?.id,
          projectId: projectB.id,
        }),
      ).rejects.toMatchObject({
        code: ERROR_CODES.FORBIDDEN,
      }),
      expect(
        mapResourceToProjectEnvironment(sessionA, wsA, {
          connectedResourceId: resourcesA[1]?.id,
          projectId: projectB.id,
        }),
      ).rejects.toMatchObject({
        code: ERROR_CODES.FORBIDDEN,
      }),
      expect(unmapResourceFromProject(sessionB, wsB, mappingA.id)).rejects.toMatchObject({
        code: ERROR_CODES.FORBIDDEN,
      }),
      expect(
        validateConnectionHealth(sessionB, wsB, connectedA.connectionId),
      ).rejects.toMatchObject({
        code: ERROR_CODES.FORBIDDEN,
      }),
      expect(
        decryptConnectionCredentialForServer({
          organizationId: orgB,
          workspaceId: wsB,
          connectionId: connectedA.connectionId,
        }),
      ).rejects.toMatchObject({
        code: ERROR_CODES.FORBIDDEN,
      }),
      expect(
        decryptConnectionCredentialForServer({
          organizationId: orgB,
          workspaceId: wsA,
          connectionId: connectedA.connectionId,
        }),
      ).rejects.toMatchObject({
        code: ERROR_CODES.FORBIDDEN,
      }),
      expect(
        disconnectProviderConnection({
          session: sessionB,
          workspaceId: wsB,
          connectionId: connectedA.connectionId,
        }),
      ).rejects.toMatchObject({
        code: ERROR_CODES.FORBIDDEN,
      }),
    ]);
  });

  it("enforces RBAC for VIEWER and ANALYST roles: permits connection:read without leaking secrets, blocks all connection:manage mutations", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const owner = await registerUserWithDefaultOwnership({
      name: "RBAC Owner",
      email: `rbac-owner-${suffix}@avenor.test`,
      password: "RbacOwnerSecurePassword!123",
      organizationName: `RBAC Org ${suffix}`,
      workspaceName: `RBAC Workspace ${suffix}`,
    });

    const analystUser = await registerUserWithDefaultOwnership({
      name: "RBAC Analyst",
      email: `rbac-analyst-${suffix}@avenor.test`,
      password: "RbacAnalystSecurePassword!123",
      organizationName: `Analyst Personal Org ${suffix}`,
      workspaceName: `Analyst Personal WS ${suffix}`,
    });

    const viewerUser = await registerUserWithDefaultOwnership({
      name: "RBAC Viewer",
      email: `rbac-viewer-${suffix}@avenor.test`,
      password: "RbacViewerSecurePassword!123",
      organizationName: `Viewer Personal Org ${suffix}`,
      workspaceName: `Viewer Personal WS ${suffix}`,
    });

    const workspaceId = owner.context.activeWorkspace.id;
    const organizationId = owner.context.activeWorkspace.organizationId;

    // Grant ANALYST and VIEWER memberships in owner's workspace
    await dbQuery(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role)
       VALUES ($1, $2, $3, 'ANALYST'), ($4, $2, $5, 'VIEWER')`,
      [
        generateId("om"),
        organizationId,
        analystUser.context.user.id,
        generateId("om"),
        viewerUser.context.user.id,
      ],
    );
    await dbQuery(
      `INSERT INTO workspace_memberships (id, workspace_id, user_id, role)
       VALUES ($1, $2, $3, 'ANALYST'), ($4, $2, $5, 'VIEWER')`,
      [
        generateId("wm"),
        workspaceId,
        analystUser.context.user.id,
        generateId("wm"),
        viewerUser.context.user.id,
      ],
    );

    const ownerSession = await resolveSessionByToken(owner.rawSessionToken);
    const analystSession = await resolveSessionByToken(analystUser.rawSessionToken);
    const viewerSession = await resolveSessionByToken(viewerUser.rawSessionToken);

    const project = await createLogicalProject(ownerSession, workspaceId, {
      name: "RBAC Product",
      slug: `rbac-product-${suffix}`,
      initialEnvironments: ["PRODUCTION"],
    });

    const init = await initiateOAuthAuthorization({
      session: ownerSession,
      workspaceId,
      providerKey: "avenor-sandbox",
      authorizeEndpointUrl: "/api/connections/oauth/sandbox-authorize",
      requestedScopes: ["sandbox.resources.readonly", "sandbox.metrics.readonly"],
      redirectUri: CALLBACK_URI,
    });

    const connected = await completeOAuthCallback({
      session: ownerSession,
      workspaceId,
      providerKey: "avenor-sandbox",
      rawStateToken: init.rawStateToken,
      redirectUri: CALLBACK_URI,
      authorizationCode: "code_rbac_ok",
    });

    const resources = await discoverAndPersistConnectionResources(
      ownerSession,
      workspaceId,
      connected.connectionId,
    );

    const mapping = await mapResourceToProjectEnvironment(ownerSession, workspaceId, {
      connectedResourceId: resources[0]?.id,
      projectId: project.id,
    });

    // ANALYST and VIEWER can read connections, with canManageConnections = false and zero secret exposure
    for (const readonlySession of [analystSession, viewerSession]) {
      const listRes = await listWorkspaceConnections(readonlySession, workspaceId);
      expect(listRes.canManageConnections).toBe(false);
      expect(listRes.connections.length).toBe(1);
      const serialized = JSON.stringify(listRes);
      expect(serialized).not.toContain("avn_ro_access_");
      expect(serialized).not.toContain("avn_ro_refresh_");
      expect(serialized).not.toContain("ciphertext");

      const detailRes = await getWorkspaceConnectionDetail(
        readonlySession,
        workspaceId,
        connected.connectionId,
      );
      expect(detailRes.id).toBe(connected.connectionId);
      expect(JSON.stringify(detailRes)).not.toContain("avn_ro_access_");

      // ANALYST and VIEWER are blocked from all connection management mutations
      await expect(
        initiateOAuthAuthorization({
          session: readonlySession,
          workspaceId,
          providerKey: "ga4",
          authorizeEndpointUrl: "https://accounts.google.com/o/oauth2/v2/auth",
          requestedScopes: ["https://www.googleapis.com/auth/analytics.readonly"],
          redirectUri: CALLBACK_URI,
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });

      await expect(
        discoverAndPersistConnectionResources(readonlySession, workspaceId, connected.connectionId),
      ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });

      await expect(
        mapResourceToProjectEnvironment(readonlySession, workspaceId, {
          connectedResourceId: resources[1]?.id,
          projectId: project.id,
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });

      await expect(
        unmapResourceFromProject(readonlySession, workspaceId, mapping.id),
      ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });

      await expect(
        validateConnectionHealth(readonlySession, workspaceId, connected.connectionId),
      ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });

      await expect(
        disconnectProviderConnection({
          session: readonlySession,
          workspaceId,
          connectionId: connected.connectionId,
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    }
  });

  it("verifies all normalized health states, trusted background job signature & workspace scoping, read-only adapter mutation prohibition, and audit log sanitization", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const owner = await registerUserWithDefaultOwnership({
      name: "Health & Audit Owner",
      email: `health-owner-${suffix}@avenor.test`,
      password: "HealthOwnerSecurePassword!123",
      organizationName: `Health Org ${suffix}`,
      workspaceName: `Health Workspace ${suffix}`,
    });

    const otherTenant = await registerUserWithDefaultOwnership({
      name: "Other Tenant",
      email: `other-tenant-${suffix}@avenor.test`,
      password: "OtherTenantSecurePassword!123",
      organizationName: `Other Org ${suffix}`,
      workspaceName: `Other Workspace ${suffix}`,
    });

    const session = await resolveSessionByToken(owner.rawSessionToken);
    const workspaceId = owner.context.activeWorkspace.id;
    const organizationId = owner.context.activeWorkspace.organizationId;
    const otherWorkspaceId = otherTenant.context.activeWorkspace.id;

    // 1. Verify read-only adapter contract rejects every forbidden mutation method
    const validAdapter = getProviderAdapter("avenor-sandbox");
    for (const forbiddenMethod of FORBIDDEN_PROVIDER_MUTATION_METHODS) {
      const tampered = {
        ...validAdapter,
        [forbiddenMethod]: () => Promise.resolve(),
      };
      expect(() => assertReadOnlyAdapterContract(tampered)).toThrowError(/strictly read-only/i);
    }

    // 2. Connect avenor-sandbox
    const init = await initiateOAuthAuthorization({
      session,
      workspaceId,
      providerKey: "avenor-sandbox",
      authorizeEndpointUrl: "/api/connections/oauth/sandbox-authorize",
      requestedScopes: ["sandbox.resources.readonly", "sandbox.metrics.readonly"],
      redirectUri: CALLBACK_URI,
    });

    const connected = await completeOAuthCallback({
      session,
      workspaceId,
      providerKey: "avenor-sandbox",
      rawStateToken: init.rawStateToken,
      redirectUri: CALLBACK_URI,
      authorizationCode: "code_health_states",
    });

    // 3. Exercise all normalized health transitions via validateConnectionHealth
    const scenarios = [
      {
        scenario: "healthy" as const,
        expectedStatus: "HEALTHY",
        expectedUx: "connected_healthy",
      },
      {
        scenario: "missing_scope" as const,
        expectedStatus: "PERMISSION_MISSING",
        expectedUx: "permission_insufficient",
      },
      {
        scenario: "rate_limited" as const,
        expectedStatus: "RATE_LIMITED",
        expectedUx: "rate_limited",
      },
      {
        scenario: "expired_token" as const,
        expectedStatus: "TOKEN_EXPIRED",
        expectedUx: "permission_insufficient",
      },
      {
        scenario: "provider_unavailable" as const,
        expectedStatus: "PROVIDER_UNAVAILABLE",
        expectedUx: "provider_error",
      },
      {
        scenario: "stale_data" as const,
        expectedStatus: "STALE",
        expectedUx: "stale_cached",
      },
      {
        scenario: "malformed_response" as const,
        expectedStatus: "DEGRADED",
        expectedUx: "provider_error",
      },
      {
        scenario: "healthy" as const,
        expectedStatus: "HEALTHY",
        expectedUx: "connected_healthy",
      },
    ];

    for (const item of scenarios) {
      const snapshot = await validateConnectionHealth(
        session,
        workspaceId,
        connected.connectionId,
        { simulationScenario: item.scenario },
      );
      expect(snapshot.status).toBe(item.expectedStatus);
      expect(snapshot.uxState).toBe(item.expectedUx);
    }

    // 4. Trusted background job verification & negative security tests
    const jobSecret = "test_trusted_job_signing_secret_32bytes";
    const validJobCtx = createTrustedJobContext({
      organizationId,
      workspaceId,
      jobSecret,
    });

    // Rejects missing job context
    expect(() => verifyTrustedJobContext(null, workspaceId, { jobSecret })).toThrowError(
      /missing job context/i,
    );

    // Rejects forged signature
    expect(() =>
      verifyTrustedJobContext({ ...validJobCtx, signature: "0".repeat(64) }, workspaceId, {
        jobSecret,
      }),
    ).toThrowError(/signature verification failed/i);

    // Rejects expired job token
    const expiredJobCtx = createTrustedJobContext({
      organizationId,
      workspaceId,
      jobSecret,
      issuedAt: new Date(Date.now() - 15 * 60 * 1000),
    });
    expect(() => verifyTrustedJobContext(expiredJobCtx, workspaceId, { jobSecret })).toThrowError(
      /expired/i,
    );

    // Rejects cross-workspace replay (Job token signed for workspaceId used against otherWorkspaceId)
    await expect(
      runTrustedBackgroundHealthChecks(validJobCtx, otherWorkspaceId, { jobSecret }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });

    // Executes valid trusted background health check strictly inside workspaceId
    const bgResult = await runTrustedBackgroundHealthChecks(validJobCtx, workspaceId, {
      jobSecret,
    });
    expect(bgResult.checkedCount).toBe(1);
    expect(bgResult.results[0]?.status).toBe("HEALTHY");

    // 5. Inspect audit trail and verify zero raw secrets are persisted in audit_logs
    const detail = await getWorkspaceConnectionDetail(session, workspaceId, connected.connectionId);
    expect(
      detail.auditLogs.some((log) => log.action === "connection.background_health_checked"),
    ).toBe(true);
    expect(detail.auditLogs.some((log) => log.action === "connection.health_validated")).toBe(true);

    const rawAuditText = JSON.stringify(detail.auditLogs);
    expect(rawAuditText).not.toContain("avn_ro_access_");
    expect(rawAuditText).not.toContain("avn_ro_refresh_");
    expect(rawAuditText).not.toContain("code_verifier");
  });
});
