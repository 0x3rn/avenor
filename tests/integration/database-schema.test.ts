import "dotenv/config";
import {
  CORE_SCHEMA_TABLES,
  closeAllDatabasePools,
  dbQuery,
  generateId,
  getMigrationStatus,
  inspectDatabaseCatalog,
  listAuditLogsForWorkspace,
  resetTestDatabaseRecords,
  runMigrations,
  validateDatabaseSchemaFiles,
  withTransaction,
  writeAuditLog,
} from "@avenor/database";
import { AppError, ERROR_CODES } from "@avenor/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe("THE-115: PostgreSQL schema, migrations, constraints, transactions, and audit logs", () => {
  beforeAll(async () => {
    await runMigrations({ connectionString: TEST_DB_URL });
    await resetTestDatabaseRecords({ connectionString: TEST_DB_URL });
  });

  afterAll(async () => {
    await resetTestDatabaseRecords({ connectionString: TEST_DB_URL });
    await closeAllDatabasePools();
  });

  it("validates schema files, applies migrations idempotently, and verifies catalog tables, unique constraints, FKs, and indexes", async () => {
    const fileValidation = validateDatabaseSchemaFiles();
    expect(fileValidation.valid).toBe(true);
    expect(fileValidation.verifiedTables).toEqual(CORE_SCHEMA_TABLES);

    // Second migration run must be idempotent
    const secondRun = await runMigrations({ connectionString: TEST_DB_URL });
    expect(secondRun.skipped).toContain("0001_foundation_schema");

    const status = await getMigrationStatus({ connectionString: TEST_DB_URL });
    expect(status.healthy).toBe(true);
    expect(status.missingTables).toHaveLength(0);

    const catalog = await inspectDatabaseCatalog({ connectionString: TEST_DB_URL });
    for (const table of CORE_SCHEMA_TABLES) {
      expect(catalog.tables).toContain(table);
    }
    expect(catalog.uniqueConstraints).toEqual(
      expect.arrayContaining([
        "uq_accounts_provider_account",
        "uq_organization_memberships_org_user",
        "uq_workspaces_org_slug",
        "uq_workspace_memberships_workspace_user",
        "uq_logical_projects_workspace_slug",
        "uq_project_environments_project_slug",
        "uq_project_environments_project_type",
        "uq_connected_resources_conn_external",
        "uq_resource_mappings_project_resource",
      ]),
    );
    expect(catalog.foreignKeys.length).toBeGreaterThanOrEqual(15);
    expect(catalog.indexes).toEqual(
      expect.arrayContaining([
        "idx_logical_projects_workspace_id",
        "idx_project_environments_project_id",
        "idx_audit_logs_organization_created",
        "idx_audit_logs_workspace_created",
      ]),
    );
  });

  it("creates and joins all 14 core entities across Organization -> Workspace -> LogicalProject -> ProjectEnvironment -> ResourceMapping", async () => {
    const userId = generateId("usr");
    const accountId = generateId("acc");
    const sessionId = generateId("ses");
    const verificationId = generateId("ver");
    const orgId = generateId("org");
    const orgMembershipId = generateId("om");
    const workspaceId = generateId("wks");
    const workspaceMembershipId = generateId("wm");
    const projectId = generateId("prj");
    const envId = generateId("env");
    const connId = generateId("con");
    const resId = generateId("res");
    const mapId = generateId("map");

    await withTransaction(
      async (client) => {
        await dbQuery(
          `INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, $3, true)`,
          [userId, "architect@avenor.test", "Avenor Architect"],
          client,
        );
        await dbQuery(
          `INSERT INTO accounts (id, user_id, account_id, provider_id, password_hash)
           VALUES ($1, $2, $3, 'credential', 'scrypt$hashed')`,
          [accountId, userId, userId],
          client,
        );
        await dbQuery(
          `INSERT INTO sessions (id, user_id, token_hash, expires_at)
           VALUES ($1, $2, $3, now() + interval '7 days')`,
          [sessionId, userId, `hash_${sessionId}`],
          client,
        );
        await dbQuery(
          `INSERT INTO verifications (id, identifier, value_hash, purpose, expires_at)
           VALUES ($1, $2, $3, 'EMAIL_VERIFICATION', now() + interval '1 hour')`,
          [verificationId, "architect@avenor.test", "ver_hash_123"],
          client,
        );
        await dbQuery(
          `INSERT INTO organizations (id, name, slug, created_by_user_id)
           VALUES ($1, 'Signal Atlas Labs', 'signal-atlas-labs', $2)`,
          [orgId, userId],
          client,
        );
        await dbQuery(
          `INSERT INTO organization_memberships (id, organization_id, user_id, role)
           VALUES ($1, $2, $3, 'OWNER')`,
          [orgMembershipId, orgId, userId],
          client,
        );
        await dbQuery(
          `INSERT INTO workspaces (id, organization_id, name, slug, default_timezone, default_currency)
           VALUES ($1, $2, 'Core Platform', 'core-platform', 'UTC', 'USD')`,
          [workspaceId, orgId],
          client,
        );
        await dbQuery(
          `INSERT INTO workspace_memberships (id, workspace_id, user_id, role)
           VALUES ($1, $2, $3, 'OWNER')`,
          [workspaceMembershipId, workspaceId, userId],
          client,
        );
        await dbQuery(
          `INSERT INTO logical_projects (id, workspace_id, name, slug, primary_domain, status, created_by_user_id)
           VALUES ($1, $2, 'Avenor Web', 'avenor-web', 'https://avenor.app', 'ACTIVE', $3)`,
          [projectId, workspaceId, userId],
          client,
        );
        await dbQuery(
          `INSERT INTO project_environments (id, project_id, name, slug, environment_type, primary_domain, is_default)
           VALUES ($1, $2, 'Production', 'production', 'PRODUCTION', 'https://avenor.app', true)`,
          [envId, projectId],
          client,
        );
        await dbQuery(
          `INSERT INTO provider_connections (id, workspace_id, provider_key, display_name, status, granted_scopes, created_by_user_id)
           VALUES ($1, $2, 'google-analytics', 'GA4 Read-Only Viewer', 'DISCONNECTED', ARRAY['analytics.readonly'], $3)`,
          [connId, workspaceId, userId],
          client,
        );
        await dbQuery(
          `INSERT INTO connected_resources (id, provider_connection_id, workspace_id, external_resource_id, resource_type, display_name)
           VALUES ($1, $2, $3, 'properties/123456', 'ga4_property', 'Avenor Production Property')`,
          [resId, connId, workspaceId],
          client,
        );
        await dbQuery(
          `INSERT INTO resource_mappings (id, workspace_id, project_id, environment_id, connected_resource_id, mapping_role, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5, 'PRIMARY', $6)`,
          [mapId, workspaceId, projectId, envId, resId, userId],
          client,
        );
        await writeAuditLog(
          {
            organizationId: orgId,
            workspaceId,
            actorUserId: userId,
            action: "project.created",
            entityType: "LogicalProject",
            entityId: projectId,
            summary: "Created Avenor Web logical project and Production environment",
            metadata: {
              projectSlug: "avenor-web",
              clientSecret: "should-be-redacted-automatically",
            },
          },
          client,
        );
      },
      { connectionString: TEST_DB_URL },
    );

    // Verify relational join across Organization -> Workspace -> LogicalProject -> ProjectEnvironment -> ResourceMapping
    const joined = await dbQuery<{
      org_slug: string;
      workspace_slug: string;
      project_slug: string;
      environment_type: string;
      external_resource_id: string;
    }>(
      `SELECT
         o.slug AS org_slug,
         w.slug AS workspace_slug,
         p.slug AS project_slug,
         e.environment_type,
         cr.external_resource_id
       FROM organizations o
       INNER JOIN workspaces w ON w.organization_id = o.id
       INNER JOIN logical_projects p ON p.workspace_id = w.id
       INNER JOIN project_environments e ON e.project_id = p.id
       INNER JOIN resource_mappings rm ON rm.environment_id = e.id
       INNER JOIN connected_resources cr ON cr.id = rm.connected_resource_id
       WHERE o.id = $1`,
      [orgId],
    );

    expect(joined.rows).toHaveLength(1);
    expect(joined.rows[0]).toEqual({
      org_slug: "signal-atlas-labs",
      workspace_slug: "core-platform",
      project_slug: "avenor-web",
      environment_type: "PRODUCTION",
      external_resource_id: "properties/123456",
    });

    // Verify audit log persistence and automatic secret redaction
    const logs = await listAuditLogsForWorkspace(workspaceId);
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("project.created");
    expect(logs[0].actorEmail).toBe("architect@avenor.test");
    expect(logs[0].metadata.projectSlug).toBe("avenor-web");
    expect(logs[0].metadata.clientSecret).toBe("[REDACTED]");
  });

  it("enforces unique constraints, lowercase email check constraints, and foreign key integrity", async () => {
    // 1. Duplicate user email must fail with CONFLICT (409)
    await expect(
      dbQuery(`INSERT INTO users (id, email, name) VALUES ($1, $2, $3)`, [
        generateId("usr"),
        "architect@avenor.test",
        "Duplicate Email User",
      ]),
    ).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
      statusCode: 409,
    });

    // 2. Non-lowercase user email must fail check constraint with VALIDATION_ERROR (400)
    await expect(
      dbQuery(`INSERT INTO users (id, email, name) VALUES ($1, $2, $3)`, [
        generateId("usr"),
        "UpperCase@Avenor.test",
        "Uppercase User",
      ]),
    ).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      statusCode: 400,
    });

    // 3. Invalid foreign key on workspace creation must fail with VALIDATION_ERROR (400)
    await expect(
      dbQuery(
        `INSERT INTO workspaces (id, organization_id, name, slug) VALUES ($1, $2, 'Orphan', 'orphan')`,
        [generateId("wks"), "org_non_existent_id"],
      ),
    ).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      statusCode: 400,
    });
  });

  it("rolls back all writes atomically when a multi-step transaction fails midway", async () => {
    const rollbackOrgId = generateId("org");
    const rollbackSlug = "rollback-atomic-org";

    await expect(
      withTransaction(
        async (client) => {
          await dbQuery(
            `INSERT INTO organizations (id, name, slug) VALUES ($1, 'Rollback Org', $2)`,
            [rollbackOrgId, rollbackSlug],
            client,
          );
          // Trigger an intentional foreign key violation on step 2
          await dbQuery(
            `INSERT INTO workspaces (id, organization_id, name, slug) VALUES ($1, 'org_invalid_fk', 'Bad Workspace', 'bad-wks')`,
            [generateId("wks")],
            client,
          );
        },
        { connectionString: TEST_DB_URL },
      ),
    ).rejects.toBeInstanceOf(AppError);

    // Verify the organization inserted in step 1 was completely rolled back
    const checkOrg = await dbQuery<{ id: string }>(
      `SELECT id FROM organizations WHERE id = $1 OR slug = $2`,
      [rollbackOrgId, rollbackSlug],
    );
    expect(checkOrg.rows).toHaveLength(0);
  });

  it("blocks resetTestDatabaseRecords in production environments", async () => {
    await expect(
      resetTestDatabaseRecords({
        connectionString: TEST_DB_URL,
        rawEnv: { NODE_ENV: "production", APP_ENV: "production" },
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PRODUCTION_SAFETY_VIOLATION,
      statusCode: 403,
    });
  });
});
