import "dotenv/config";
import { assertNonProductionDestructiveAction, validateServerEnv } from "@avenor/config";
import {
  closeAllDatabasePools,
  generateId,
  getMigrationStatus,
  runMigrations,
  validateDatabaseSchemaFiles,
  withTransaction,
  writeAuditLog,
} from "@avenor/database";

const command = process.argv[2] ?? "status";

async function main(): Promise<void> {
  const validCommands = ["validate", "migrate", "status", "seed"];
  if (!validCommands.includes(command)) {
    console.error(`Unknown db command "${command}". Expected one of: ${validCommands.join(", ")}`);
    process.exit(1);
  }

  const fallbackEnv: Record<string, string | undefined> = {
    ...process.env,
    DATABASE_URL:
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@localhost:5432/avenor_dev?sslmode=require",
    BETTER_AUTH_SECRET:
      process.env.BETTER_AUTH_SECRET ?? "dev-only-secret-do-not-use-in-production-0123456789abcdef",
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    ENCRYPTION_MASTER_KEY:
      process.env.ENCRYPTION_MASTER_KEY ??
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME ?? "Avenor",
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  };

  const env = validateServerEnv(fallbackEnv);

  if (command === "validate") {
    const schemaCheck = validateDatabaseSchemaFiles();
    console.log(
      JSON.stringify({
        ok: true,
        command: "validate",
        environment: env.APP_ENV ?? env.NODE_ENV,
        migrationCount: schemaCheck.migrationCount,
        verifiedTableCount: schemaCheck.verifiedTables.length,
        verifiedTables: schemaCheck.verifiedTables,
      }),
    );
    return;
  }

  if (command === "migrate") {
    const primaryResult = await runMigrations({ connectionString: env.DATABASE_URL });
    let testResult = null;
    if (env.TEST_DATABASE_URL && env.TEST_DATABASE_URL !== env.DATABASE_URL) {
      testResult = await runMigrations({ connectionString: env.TEST_DATABASE_URL });
    }
    console.log(
      JSON.stringify({
        ok: true,
        command: "migrate",
        primaryDatabase: primaryResult,
        ...(testResult ? { testDatabase: testResult } : {}),
      }),
    );
    return;
  }

  if (command === "status") {
    const status = await getMigrationStatus({ connectionString: env.DATABASE_URL });
    console.log(
      JSON.stringify({
        ok: status.healthy,
        command: "status",
        ...status,
      }),
    );
    if (!status.healthy) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === "seed") {
    assertNonProductionDestructiveAction(process.env, "db:seed");
    await runMigrations({ connectionString: env.DATABASE_URL });

    const seeded = await withTransaction(
      async (client) => {
        const existingUser = await client.query<{ id: string }>(
          `SELECT id FROM users WHERE email = $1 LIMIT 1`,
          ["founder@avenor.local"],
        );
        if (existingUser.rows.length > 0) {
          return { skipped: true, userId: existingUser.rows[0].id };
        }

        const userId = generateId("usr");
        const orgId = generateId("org");
        const workspaceId = generateId("wks");
        const projectId = generateId("prj");
        const prodEnvId = generateId("env");

        await client.query(
          `INSERT INTO users (id, email, name, email_verified, active_workspace_id)
           VALUES ($1, $2, $3, true, $4)`,
          [userId, "founder@avenor.local", "Avenor Local Operator", workspaceId],
        );
        await client.query(
          `INSERT INTO organizations (id, name, slug, created_by_user_id)
           VALUES ($1, $2, $3, $4)`,
          [orgId, "Avenor Demo Organization", "avenor-demo-org", userId],
        );
        await client.query(
          `INSERT INTO organization_memberships (id, organization_id, user_id, role)
           VALUES ($1, $2, $3, 'OWNER')`,
          [generateId("om"), orgId, userId],
        );
        await client.query(
          `INSERT INTO workspaces (id, organization_id, name, slug, default_timezone, default_currency)
           VALUES ($1, $2, $3, $4, 'UTC', 'USD')`,
          [workspaceId, orgId, "Core Product Workspace", "core-product"],
        );
        await client.query(
          `INSERT INTO workspace_memberships (id, workspace_id, user_id, role)
           VALUES ($1, $2, $3, 'OWNER')`,
          [generateId("wm"), workspaceId, userId],
        );
        await client.query(
          `INSERT INTO logical_projects (id, workspace_id, name, slug, description, primary_domain, status, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7)`,
          [
            projectId,
            workspaceId,
            "Avenor Web Platform",
            "avenor-web",
            "Primary customer-facing web application",
            "https://avenor.example.com",
            userId,
          ],
        );
        await client.query(
          `INSERT INTO project_environments (id, project_id, name, slug, environment_type, primary_domain, is_default)
           VALUES ($1, $2, 'Production', 'production', 'PRODUCTION', 'https://avenor.example.com', true)`,
          [prodEnvId, projectId],
        );

        await writeAuditLog(
          {
            organizationId: orgId,
            workspaceId,
            actorUserId: userId,
            action: "seed.workspace.provisioned",
            entityType: "Workspace",
            entityId: workspaceId,
            summary: "Seeded structural ownership hierarchy (no fabricated external metrics).",
            metadata: { projectId, environmentId: prodEnvId },
          },
          client,
        );

        return { skipped: false, userId, orgId, workspaceId, projectId };
      },
      { connectionString: env.DATABASE_URL },
    );

    console.log(JSON.stringify({ ok: true, command: "seed", ...seeded }));
  }
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(async () => {
    await closeAllDatabasePools();
  });
