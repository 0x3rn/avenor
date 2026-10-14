import "dotenv/config";
import {
  completeUserOnboarding,
  createLogicalProject,
  createProjectEnvironment,
  createWorkspaceInOrganization,
  getLogicalProjectById,
  getWorkspaceGovernanceDetails,
  listWorkspaceProjects,
  registerUserWithDefaultOwnership,
  resolveSessionByToken,
  updateLogicalProject,
  updateProjectEnvironment,
  updateWorkspaceSettings,
} from "@avenor/auth";
import { closeAllDatabasePools, resetTestDatabaseRecords, runMigrations } from "@avenor/database";
import { ERROR_CODES } from "@avenor/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe("THE-113: Organizations, workspaces, logical projects, environments, and audit trail", () => {
  beforeAll(async () => {
    await runMigrations({ connectionString: TEST_DB_URL });
    await resetTestDatabaseRecords({ connectionString: TEST_DB_URL });
  });

  afterAll(async () => {
    await resetTestDatabaseRecords({ connectionString: TEST_DB_URL });
    await closeAllDatabasePools();
  });

  it("creates logical projects with default Production environment, adds Staging/Development environments, and updates/archives projects", async () => {
    const owner = await registerUserWithDefaultOwnership(
      {
        name: "Linus Operator",
        email: "linus@avenor.test",
        password: "Kernel-Password-1991!",
        organizationName: "Kernel Systems",
        workspaceName: "Platform Workspace",
      },
      { connectionString: TEST_DB_URL },
    );

    const workspaceId = owner.context.activeWorkspace.id;

    // 1. Create a logical project with default PRODUCTION environment
    const project = await createLogicalProject(
      owner.context,
      workspaceId,
      {
        name: "Avenor Marketing Website",
        slug: "avenor-marketing",
        description: "Public marketing and documentation website",
        primaryDomain: "avenor.app",
        initialEnvironments: ["PRODUCTION"],
      },
      { connectionString: TEST_DB_URL },
    );

    expect(project.name).toBe("Avenor Marketing Website");
    expect(project.slug).toBe("avenor-marketing");
    expect(project.primaryDomain).toBe("https://avenor.app");
    expect(project.status).toBe("ACTIVE");
    expect(project.environments).toHaveLength(1);
    expect(project.environments[0].type).toBe("PRODUCTION");
    expect(project.environments[0].isDefault).toBe(true);
    expect(project.environments[0].primaryDomain).toBe("https://avenor.app");

    // 2. Add STAGING and DEVELOPMENT environments
    const stagingEnv = await createProjectEnvironment(
      owner.context,
      project.id,
      {
        environmentType: "STAGING",
        primaryDomain: "https://staging.avenor.app",
        isDefault: false,
      },
      { connectionString: TEST_DB_URL },
    );
    expect(stagingEnv.type).toBe("STAGING");
    expect(stagingEnv.slug).toBe("staging");
    expect(stagingEnv.primaryDomain).toBe("https://staging.avenor.app");

    const devEnv = await createProjectEnvironment(
      owner.context,
      project.id,
      {
        environmentType: "DEVELOPMENT",
        primaryDomain: "http://localhost:3000",
        isDefault: false,
      },
      { connectionString: TEST_DB_URL },
    );
    expect(devEnv.type).toBe("DEVELOPMENT");

    // Duplicate environment type within the same project must fail with 409 CONFLICT
    await expect(
      createProjectEnvironment(
        owner.context,
        project.id,
        { environmentType: "STAGING" },
        { connectionString: TEST_DB_URL },
      ),
    ).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
      statusCode: 409,
    });

    // 3. Update environment metadata and default flag
    const updatedStaging = await updateProjectEnvironment(
      owner.context,
      project.id,
      stagingEnv.id,
      {
        name: "Pre-Production Staging",
        primaryDomain: "https://preprod.avenor.app",
        isDefault: true,
      },
      { connectionString: TEST_DB_URL },
    );
    expect(updatedStaging.name).toBe("Pre-Production Staging");
    expect(updatedStaging.isDefault).toBe(true);

    // Reload project to verify only updatedStaging is now default
    const reloaded = await getLogicalProjectById(owner.context, project.id, workspaceId);
    expect(reloaded.environments).toHaveLength(3);
    const defaultEnvs = reloaded.environments.filter((e) => e.isDefault);
    expect(defaultEnvs).toHaveLength(1);
    expect(defaultEnvs[0].id).toBe(stagingEnv.id);

    // 4. Update project details, archive, and restore
    const updatedProject = await updateLogicalProject(
      owner.context,
      project.id,
      {
        name: "Avenor Global Website",
        description: "Updated product description",
      },
      { connectionString: TEST_DB_URL },
    );
    expect(updatedProject.name).toBe("Avenor Global Website");

    const archivedProject = await updateLogicalProject(
      owner.context,
      project.id,
      { status: "ARCHIVED" },
      { connectionString: TEST_DB_URL },
    );
    expect(archivedProject.status).toBe("ARCHIVED");

    const activeList = await listWorkspaceProjects(owner.context, workspaceId);
    expect(activeList).toHaveLength(0);

    const allList = await listWorkspaceProjects(owner.context, workspaceId, {
      includeArchived: true,
    });
    expect(allList).toHaveLength(1);
    expect(allList[0].status).toBe("ARCHIVED");

    // Restore to ACTIVE
    const restoredProject = await updateLogicalProject(
      owner.context,
      project.id,
      { status: "ACTIVE" },
      { connectionString: TEST_DB_URL },
    );
    expect(restoredProject.status).toBe("ACTIVE");
  });

  it("supports multiple workspaces per organization, allows identical project slugs across different workspaces, and isolates workspace data", async () => {
    const owner = await registerUserWithDefaultOwnership(
      {
        name: "Margaret Hamilton",
        email: "margaret@apollo.test",
        password: "Apollo-Guidance-1969!",
        organizationName: "Apollo Flight Systems",
        workspaceName: "Command Module Workspace",
      },
      { connectionString: TEST_DB_URL },
    );

    const workspace1Id = owner.context.activeWorkspace.id;

    // Create project "telemetry-engine" in Workspace 1
    const proj1 = await createLogicalProject(
      owner.context,
      workspace1Id,
      {
        name: "Telemetry Engine",
        slug: "telemetry-engine",
        initialEnvironments: ["PRODUCTION", "STAGING"],
      },
      { connectionString: TEST_DB_URL },
    );
    expect(proj1.slug).toBe("telemetry-engine");

    // Duplicate project slug in the SAME workspace must fail with 409 CONFLICT
    await expect(
      createLogicalProject(
        owner.context,
        workspace1Id,
        {
          name: "Duplicate Telemetry",
          slug: "telemetry-engine",
        },
        { connectionString: TEST_DB_URL },
      ),
    ).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
      statusCode: 409,
    });

    // Create a second workspace in the same organization
    const workspace2 = await createWorkspaceInOrganization(
      owner.context,
      workspace1Id,
      {
        name: "Lunar Module Workspace",
        slug: "lunar-module",
        defaultTimezone: "America/New_York",
        defaultCurrency: "USD",
      },
      { connectionString: TEST_DB_URL },
    );
    expect(workspace2.slug).toBe("lunar-module");

    // Refresh session after creating workspace2
    const refreshedSession = await resolveSessionByToken(owner.rawSessionToken, {
      connectionString: TEST_DB_URL,
    });
    expect(refreshedSession?.workspaces).toHaveLength(2);
    expect(refreshedSession?.activeWorkspace.id).toBe(workspace2.id);

    // Creating a project with the SAME slug "telemetry-engine" in Workspace 2 succeeds cleanly!
    const proj2 = await createLogicalProject(
      refreshedSession,
      workspace2.id,
      {
        name: "Telemetry Engine (Lunar)",
        slug: "telemetry-engine",
        initialEnvironments: ["PRODUCTION"],
      },
      { connectionString: TEST_DB_URL },
    );
    expect(proj2.slug).toBe("telemetry-engine");
    expect(proj2.id).not.toBe(proj1.id);

    // Listing projects in Workspace 1 only returns Workspace 1's project
    const ws1Projects = await listWorkspaceProjects(refreshedSession, workspace1Id);
    expect(ws1Projects).toHaveLength(1);
    expect(ws1Projects[0].id).toBe(proj1.id);

    // Requesting proj1 while asserting expectedWorkspaceId = workspace2.id must fail with 403 FORBIDDEN
    await expect(
      getLogicalProjectById(refreshedSession, proj1.id, workspace2.id),
    ).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
      statusCode: 403,
    });

    // Update workspace settings and complete onboarding
    const updatedWs2 = await updateWorkspaceSettings(
      refreshedSession,
      workspace2.id,
      {
        name: "Lunar Excursion Workspace",
        slug: "lunar-excursion",
        defaultTimezone: "UTC",
        defaultCurrency: "EUR",
        organizationName: "Apollo Guidance Organization",
      },
      { connectionString: TEST_DB_URL },
    );
    expect(updatedWs2.name).toBe("Lunar Excursion Workspace");
    expect(updatedWs2.defaultCurrency).toBe("EUR");
    expect(updatedWs2.organizationName).toBe("Apollo Guidance Organization");

    const onboardingRes = await completeUserOnboarding(refreshedSession, workspace2.id, {
      connectionString: TEST_DB_URL,
    });
    expect(onboardingRes.completedAt).toBeDefined();

    // Verify governance details and audit trail
    const governance = await getWorkspaceGovernanceDetails(refreshedSession, workspace2.id);
    expect(governance.members).toHaveLength(1);
    expect(governance.members[0].role).toBe("OWNER");
    expect(governance.auditLogs.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "workspace.created",
        "project.created",
        "workspace.updated",
        "onboarding.completed",
      ]),
    );
  });
});
