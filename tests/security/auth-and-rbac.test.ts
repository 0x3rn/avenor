import "dotenv/config";
import {
  authenticateUser,
  authorizeProjectAccess,
  authorizeWorkspaceAccess,
  registerUserWithDefaultOwnership,
  resolveSessionByToken,
  revokeSessionByToken,
  switchSessionActiveWorkspace,
  verifyEmailToken,
} from "@avenor/auth";
import {
  closeAllDatabasePools,
  dbQuery,
  generateId,
  listAuditLogsForWorkspace,
  resetTestDatabaseRecords,
  runMigrations,
} from "@avenor/database";
import { ERROR_CODES, type WorkspaceRole } from "@avenor/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe("THE-114: Authentication lifecycle, session security, and cross-tenant RBAC isolation", () => {
  beforeAll(async () => {
    await runMigrations({ connectionString: TEST_DB_URL });
    await resetTestDatabaseRecords({ connectionString: TEST_DB_URL });
  });

  afterAll(async () => {
    await resetTestDatabaseRecords({ connectionString: TEST_DB_URL });
    await closeAllDatabasePools();
  });

  it("provisions User, Organization, Workspace, OWNER memberships, Session, Verification, and AuditLog atomically on signup", async () => {
    const signup = await registerUserWithDefaultOwnership(
      {
        name: "Grace Hopper",
        email: "Grace.Hopper@Avenor.Test",
        password: "Compiler-Password-1952!",
        organizationName: "Navy Computing Org",
        workspaceName: "COBOL Core",
      },
      { connectionString: TEST_DB_URL },
    );

    expect(signup.context.user.email).toBe("grace.hopper@avenor.test");
    expect(signup.context.activeWorkspace.name).toBe("COBOL Core");
    expect(signup.context.activeWorkspace.organizationName).toBe("Navy Computing Org");
    expect(signup.context.activeWorkspace.role).toBe("OWNER");
    expect(signup.rawSessionToken).toContain(".");

    // Session resolution succeeds with the issued token
    const resolved = await resolveSessionByToken(signup.rawSessionToken, {
      connectionString: TEST_DB_URL,
    });
    expect(resolved).not.toBeNull();
    expect(resolved?.user.id).toBe(signup.context.user.id);
    expect(resolved?.activeWorkspace.id).toBe(signup.context.activeWorkspace.id);

    // Audit log was written in the same transaction
    const logs = await listAuditLogsForWorkspace(signup.context.activeWorkspace.id);
    expect(logs.some((l) => l.action === "auth.signup.provisioned")).toBe(true);

    // Email verification token succeeds once and rejects replay
    const verifiedOnce = await verifyEmailToken(
      "grace.hopper@avenor.test",
      signup.verificationToken,
    );
    expect(verifiedOnce).toBe(true);
    const verifiedReplay = await verifyEmailToken(
      "grace.hopper@avenor.test",
      signup.verificationToken,
    );
    expect(verifiedReplay).toBe(false);
  });

  it("rejects duplicate email registration, wrong password, unknown email, tampered token, expired session, and revoked session", async () => {
    // 1. Duplicate email -> 409 CONFLICT
    await expect(
      registerUserWithDefaultOwnership(
        {
          name: "Grace Duplicate",
          email: "grace.hopper@avenor.test",
          password: "Another-Password-123!",
        },
        { connectionString: TEST_DB_URL },
      ),
    ).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
      statusCode: 409,
    });

    // 2. Wrong password -> 401 UNAUTHENTICATED
    await expect(
      authenticateUser(
        {
          email: "grace.hopper@avenor.test",
          password: "wrong-password",
        },
        { connectionString: TEST_DB_URL },
      ),
    ).rejects.toMatchObject({
      code: ERROR_CODES.UNAUTHENTICATED,
      statusCode: 401,
    });

    // 3. Unknown email -> 401 UNAUTHENTICATED
    await expect(
      authenticateUser(
        {
          email: "nobody@avenor.test",
          password: "Compiler-Password-1952!",
        },
        { connectionString: TEST_DB_URL },
      ),
    ).rejects.toMatchObject({
      code: ERROR_CODES.UNAUTHENTICATED,
      statusCode: 401,
    });

    // 4. Valid sign-in + sign-out revocation
    const signIn = await authenticateUser(
      {
        email: "grace.hopper@avenor.test",
        password: "Compiler-Password-1952!",
      },
      { connectionString: TEST_DB_URL },
    );
    expect(await resolveSessionByToken(signIn.rawSessionToken)).not.toBeNull();

    // Tampered token signature is rejected
    expect(await resolveSessionByToken(`${signIn.rawSessionToken}tampered`)).toBeNull();

    // Sign-out revokes session immediately
    const revoked = await revokeSessionByToken(signIn.rawSessionToken);
    expect(revoked).toBe(true);
    expect(await resolveSessionByToken(signIn.rawSessionToken)).toBeNull();

    // 5. Expired session is rejected
    const expiredSignIn = await authenticateUser(
      {
        email: "grace.hopper@avenor.test",
        password: "Compiler-Password-1952!",
      },
      { connectionString: TEST_DB_URL, expiresInSeconds: -60 },
    );
    expect(await resolveSessionByToken(expiredSignIn.rawSessionToken)).toBeNull();
  });

  it("enforces cross-tenant isolation (Organization A vs Organization B) and workspace RBAC roles (OWNER, ADMIN, ANALYST, VIEWER)", async () => {
    const tenantA = await registerUserWithDefaultOwnership(
      {
        name: "Tenant A Owner",
        email: "owner-a@tenant-a.test",
        password: "Tenant-A-Secret-Password!",
        organizationName: "Organization Alpha",
        workspaceName: "Alpha Workspace",
      },
      { connectionString: TEST_DB_URL },
    );

    const tenantB = await registerUserWithDefaultOwnership(
      {
        name: "Tenant B Owner",
        email: "owner-b@tenant-b.test",
        password: "Tenant-B-Secret-Password!",
        organizationName: "Organization Beta",
        workspaceName: "Beta Workspace",
      },
      { connectionString: TEST_DB_URL },
    );

    const workspaceAId = tenantA.context.activeWorkspace.id;
    const workspaceBId = tenantB.context.activeWorkspace.id;

    // Create a logical project in Tenant B's workspace
    const projectBId = generateId("prj");
    await dbQuery(
      `INSERT INTO logical_projects (id, workspace_id, name, slug, status, created_by_user_id)
       VALUES ($1, $2, 'Beta Confidential App', 'beta-confidential', 'ACTIVE', $3)`,
      [projectBId, workspaceBId, tenantB.context.user.id],
    );

    // Unauthenticated access -> 401 UNAUTHENTICATED
    await expect(
      authorizeWorkspaceAccess({
        session: null,
        workspaceId: workspaceAId,
        requiredPermission: "workspace:read",
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.UNAUTHENTICATED,
      statusCode: 401,
    });

    // Cross-tenant workspace access (Tenant A Owner accessing Workspace B) -> 403 FORBIDDEN
    await expect(
      authorizeWorkspaceAccess({
        session: tenantA.context,
        workspaceId: workspaceBId,
        requiredPermission: "workspace:read",
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
      statusCode: 403,
    });

    // Cross-tenant workspace switch attempt -> 403 FORBIDDEN
    await expect(
      switchSessionActiveWorkspace(tenantA.context, workspaceBId, {
        connectionString: TEST_DB_URL,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
      statusCode: 403,
    });

    // Cross-tenant project ID access (Tenant A Owner requesting Project B) -> 403 FORBIDDEN
    await expect(
      authorizeProjectAccess({
        session: tenantA.context,
        projectId: projectBId,
        requiredPermission: "project:read",
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
      statusCode: 403,
    });

    // Provision ADMIN, ANALYST, and VIEWER users inside Workspace A
    async function createMemberInWorkspaceA(email: string, role: WorkspaceRole) {
      const registered = await registerUserWithDefaultOwnership(
        {
          name: `${role} Operator`,
          email,
          password: "Role-Test-Password-123!",
        },
        { connectionString: TEST_DB_URL },
      );

      await dbQuery(
        `INSERT INTO organization_memberships (id, organization_id, user_id, role)
         VALUES ($1, $2, $3, $4)`,
        [generateId("om"), tenantA.context.activeOrganizationId, registered.context.user.id, role],
      );
      await dbQuery(
        `INSERT INTO workspace_memberships (id, workspace_id, user_id, role)
         VALUES ($1, $2, $3, $4)`,
        [generateId("wm"), workspaceAId, registered.context.user.id, role],
      );

      const refreshed = await resolveSessionByToken(registered.rawSessionToken, {
        connectionString: TEST_DB_URL,
      });
      if (!refreshed) {
        throw new Error("Expected refreshed session");
      }
      return refreshed;
    }

    const adminSession = await createMemberInWorkspaceA("admin-a@tenant-a.test", "ADMIN");
    const analystSession = await createMemberInWorkspaceA("analyst-a@tenant-a.test", "ANALYST");
    const viewerSession = await createMemberInWorkspaceA("viewer-a@tenant-a.test", "VIEWER");

    // VIEWER can read Workspace A, but CANNOT create projects or update workspace settings
    const viewerRead = await authorizeWorkspaceAccess({
      session: viewerSession,
      workspaceId: workspaceAId,
      requiredPermission: "project:read",
    });
    expect(viewerRead.role).toBe("VIEWER");

    await expect(
      authorizeWorkspaceAccess({
        session: viewerSession,
        workspaceId: workspaceAId,
        requiredPermission: "project:create",
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
      statusCode: 403,
    });

    await expect(
      authorizeWorkspaceAccess({
        session: viewerSession,
        workspaceId: workspaceAId,
        requiredPermission: "report:create",
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
      statusCode: 403,
    });

    // ANALYST can read and create reports, but CANNOT create/archive projects or manage workspace
    const analystReport = await authorizeWorkspaceAccess({
      session: analystSession,
      workspaceId: workspaceAId,
      requiredPermission: "report:create",
    });
    expect(analystReport.role).toBe("ANALYST");

    await expect(
      authorizeWorkspaceAccess({
        session: analystSession,
        workspaceId: workspaceAId,
        requiredPermission: "project:create",
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
      statusCode: 403,
    });

    // ADMIN and OWNER can create projects in Workspace A, and STILL cannot access Workspace B
    const adminCreate = await authorizeWorkspaceAccess({
      session: adminSession,
      workspaceId: workspaceAId,
      requiredPermission: "project:create",
    });
    expect(adminCreate.role).toBe("ADMIN");

    await expect(
      authorizeWorkspaceAccess({
        session: adminSession,
        workspaceId: workspaceBId,
        requiredPermission: "project:read",
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
      statusCode: 403,
    });
  });
});
