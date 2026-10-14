import "dotenv/config";
import {
  completeOAuthCallback,
  createLogicalProject,
  initiateOAuthAuthorization,
  registerUserWithDefaultOwnership,
  resolveSessionByToken,
} from "@avenor/auth";
import { closeAllDatabasePools, runMigrations } from "@avenor/database";
import { ERROR_CODES } from "@avenor/types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConnectionsConsole } from "../../src/components/connections/connections-console";
import {
  discoverAndPersistConnectionResources,
  getWorkspaceConnectionDetail,
  listWorkspaceConnections,
  mapResourceToProjectEnvironment,
  unmapResourceFromProject,
  validateConnectionHealth,
} from "../../src/lib/connections";
import { PROVIDER_CATALOG } from "../../src/lib/providers";

describe("Milestone 02 — Provider Catalog, Connection Wizard & Resource Mapping Integration (THE-120)", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await closeAllDatabasePools();
  });

  it("executes the end-to-end 7-step connection wizard workflow: authorize -> callback -> discover resources -> map to project & environment -> validate health -> unmap without losing grant", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const registered = await registerUserWithDefaultOwnership({
      name: "Wizard Operator",
      email: `wizard.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Wizard Org ${suffix}`,
      workspaceName: `Wizard Workspace ${suffix}`,
    });

    const session = await resolveSessionByToken(registered.rawSessionToken);
    expect(session).not.toBeNull();
    const workspaceId = registered.context.activeWorkspace.id;

    // Create two logical projects to test mapping and cross-project environment validation
    const projectAlpha = await createLogicalProject(session, workspaceId, {
      name: "Alpha Commerce",
      slug: `alpha-commerce-${suffix}`,
      primaryDomain: "https://alpha.avenor.test",
      initialEnvironments: ["PRODUCTION", "STAGING", "DEVELOPMENT"],
    });

    const projectBeta = await createLogicalProject(session, workspaceId, {
      name: "Beta Docs",
      slug: `beta-docs-${suffix}`,
      primaryDomain: "https://beta.avenor.test",
      initialEnvironments: ["PRODUCTION"],
    });

    const prodEnv = projectAlpha.environments.find((e) => e.type === "PRODUCTION");
    const stagingEnv = projectAlpha.environments.find((e) => e.type === "STAGING");
    const betaProdEnv = projectBeta.environments[0];
    expect(prodEnv).toBeDefined();
    expect(stagingEnv).toBeDefined();
    expect(betaProdEnv).toBeDefined();

    // Step 1-3: Initiate OAuth & complete callback for avenor-sandbox
    const redirectUri = "http://localhost:3000/api/connections/oauth/callback";
    const initiated = await initiateOAuthAuthorization({
      session,
      workspaceId,
      providerKey: "avenor-sandbox",
      authorizeEndpointUrl: "/api/connections/oauth/sandbox-authorize",
      requestedScopes: ["sandbox.resources.readonly", "sandbox.metrics.readonly"],
      redirectUri,
    });

    const callbackRes = await completeOAuthCallback({
      session,
      workspaceId,
      providerKey: "avenor-sandbox",
      displayName: "Alpha Sandbox Telemetry",
      rawStateToken: initiated.rawStateToken,
      redirectUri,
      authorizationCode: "code_sandbox_wizard_ok",
    });
    expect(callbackRes.status).toBe("HEALTHY");

    // Step 4: Discover and persist external resources
    const discovered = await discoverAndPersistConnectionResources(
      session,
      workspaceId,
      callbackRes.connectionId,
    );
    expect(discovered.length).toBe(3);
    const prodStream = discovered.find((r) => r.externalResourceId === "sbx_stream_prod_web");
    const stgStream = discovered.find((r) => r.externalResourceId === "sbx_stream_stg_web");
    expect(prodStream).toBeDefined();
    expect(stgStream).toBeDefined();

    // Step 5: Map prodStream -> Alpha Commerce (PRODUCTION) and stgStream -> Alpha Commerce (STAGING)
    const prodMapping = await mapResourceToProjectEnvironment(session, workspaceId, {
      connectedResourceId: prodStream?.id,
      projectId: projectAlpha.id,
      environmentId: prodEnv?.id,
      mappingRole: "PRIMARY",
    });
    expect(prodMapping.projectId).toBe(projectAlpha.id);
    expect(prodMapping.environmentType).toBe("PRODUCTION");
    expect(prodMapping.externalResourceId).toBe("sbx_stream_prod_web");

    const stgMapping = await mapResourceToProjectEnvironment(session, workspaceId, {
      connectedResourceId: stgStream?.id,
      projectId: projectAlpha.id,
      environmentId: stagingEnv?.id,
      mappingRole: "SECONDARY",
    });
    expect(stgMapping.environmentType).toBe("STAGING");

    // Reject duplicate mapping of same resource to same project
    await expect(
      mapResourceToProjectEnvironment(session, workspaceId, {
        connectedResourceId: prodStream?.id,
        projectId: projectAlpha.id,
        environmentId: prodEnv?.id,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });

    // Reject cross-project environment mismatch (using Beta's environmentId with Alpha's projectId)
    await expect(
      mapResourceToProjectEnvironment(session, workspaceId, {
        connectedResourceId: discovered[2]?.id,
        projectId: projectAlpha.id,
        environmentId: betaProdEnv?.id,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });

    // Step 6: Validate connection health
    const health = await validateConnectionHealth(session, workspaceId, callbackRes.connectionId);
    expect(health.status).toBe("HEALTHY");
    expect(health.uxState).toBe("connected_healthy");

    // Inspect full connection detail & audit trail
    const detail = await getWorkspaceConnectionDetail(
      session,
      workspaceId,
      callbackRes.connectionId,
    );
    expect(detail.connectedResources.length).toBe(3);
    expect(detail.mappings.length).toBe(2);
    expect(detail.credentialSummary?.status).toBe("ACTIVE");
    expect(detail.auditLogs.some((a) => a.action === "connection.resources_discovered")).toBe(true);
    expect(detail.auditLogs.some((a) => a.action === "connection.resource_mapped")).toBe(true);
    expect(detail.auditLogs.some((a) => a.action === "connection.health_validated")).toBe(true);

    // Unmap stgMapping and verify connection remains HEALTHY with 1 remaining mapping
    const unmapped = await unmapResourceFromProject(session, workspaceId, stgMapping.id);
    expect(unmapped.unmappedId).toBe(stgMapping.id);

    const { connections } = await listWorkspaceConnections(session, workspaceId);
    const updatedConn = connections.find((c) => c.id === callbackRes.connectionId);
    expect(updatedConn?.status).toBe("HEALTHY");
    expect(updatedConn?.mappings.length).toBe(1);
    expect(updatedConn?.mappings[0]?.id).toBe(prodMapping.id);
  });

  it("renders ConnectionsConsole with truthful availability badges and hides management controls for VIEWER/ANALYST roles", () => {
    const ownerMarkup = renderToStaticMarkup(
      createElement(ConnectionsConsole, {
        workspaceId: "ws_demo",
        workspaceName: "Core Product",
        userRole: "OWNER",
        canManageConnections: true,
        catalog: PROVIDER_CATALOG,
        initialConnections: [],
        projects: [],
      }),
    );

    expect(ownerMarkup).toContain("Signal Atlas Read-Only Provider Catalog");
    expect(ownerMarkup).toContain("Active in Sandbox (M02)");
    expect(ownerMarkup).toContain("Planned • M06");
    expect(ownerMarkup).toContain("Connect Provider");

    const viewerMarkup = renderToStaticMarkup(
      createElement(ConnectionsConsole, {
        workspaceId: "ws_demo",
        workspaceName: "Core Product",
        userRole: "VIEWER",
        canManageConnections: false,
        catalog: PROVIDER_CATALOG,
        initialConnections: [],
        projects: [],
      }),
    );

    expect(viewerMarkup).toContain("Read-only observer mode — management actions hidden.");
    expect(viewerMarkup).toContain("Read-Only Role (VIEWER)");
    expect(viewerMarkup).not.toContain("Connect Provider");
  });
});
