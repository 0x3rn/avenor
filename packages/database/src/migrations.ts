import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertNonProductionDestructiveAction } from "@avenor/config";
import { AppError, ERROR_CODES } from "@avenor/types";
import { getDatabasePool, withTransaction } from "./client";

export const CORE_SCHEMA_TABLES = [
  "users",
  "accounts",
  "sessions",
  "verifications",
  "organizations",
  "organization_memberships",
  "workspaces",
  "workspace_memberships",
  "logical_projects",
  "project_environments",
  "provider_connections",
  "connected_resources",
  "resource_mappings",
  "audit_logs",
] as const;

export type CoreSchemaTable = (typeof CORE_SCHEMA_TABLES)[number];

export interface MigrationFileDescriptor {
  id: string;
  filename: string;
  absolutePath: string;
  checksum: string;
  sql: string;
}

export function resolveMigrationsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "packages/database/migrations"),
    path.resolve(__dirname, "../migrations"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      return dir;
    }
  }
  throw new AppError({
    code: ERROR_CODES.INTERNAL_ERROR,
    message: "Unable to locate packages/database/migrations directory.",
  });
}

export function resolvePrismaSchemaPath(): string {
  const candidates = [
    path.resolve(process.cwd(), "packages/database/prisma/schema.prisma"),
    path.resolve(__dirname, "../prisma/schema.prisma"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new AppError({
    code: ERROR_CODES.INTERNAL_ERROR,
    message: "Unable to locate packages/database/prisma/schema.prisma.",
  });
}

export function loadMigrationFiles(): MigrationFileDescriptor[] {
  const migrationsDir = resolveMigrationsDir();
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  return files.map((filename) => {
    const absolutePath = path.join(migrationsDir, filename);
    const sql = fs.readFileSync(absolutePath, "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    const id = filename.replace(/\.sql$/, "");
    return {
      id,
      filename,
      absolutePath,
      checksum,
      sql,
    };
  });
}

export function validateDatabaseSchemaFiles(): {
  valid: boolean;
  migrationCount: number;
  verifiedTables: readonly string[];
  prismaSchemaPath: string;
} {
  const migrations = loadMigrationFiles();
  if (migrations.length === 0) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "No SQL migration files found in packages/database/migrations.",
    });
  }

  const combinedSql = migrations.map((m) => m.sql).join("\n");
  const prismaSchemaPath = resolvePrismaSchemaPath();
  const prismaContent = fs.readFileSync(prismaSchemaPath, "utf8");

  for (const table of CORE_SCHEMA_TABLES) {
    if (!combinedSql.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `SQL migrations are missing required table definition: ${table}`,
      });
    }
    if (!prismaContent.includes(`@@map("${table}")`)) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Prisma schema is missing required @@map("${table}") model mapping.`,
      });
    }
  }

  return {
    valid: true,
    migrationCount: migrations.length,
    verifiedTables: CORE_SCHEMA_TABLES,
    prismaSchemaPath,
  };
}

async function ensureMigrationsTable(connectionString?: string): Promise<void> {
  const pool = getDatabasePool(connectionString);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _avenor_migrations (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

export interface MigrationRunResult {
  applied: string[];
  skipped: string[];
  totalMigrations: number;
}

export async function runMigrations(options?: {
  connectionString?: string;
}): Promise<MigrationRunResult> {
  validateDatabaseSchemaFiles();
  await ensureMigrationsTable(options?.connectionString);

  const pool = getDatabasePool(options?.connectionString);
  const existingResult = await pool.query<{ id: string; checksum: string }>(
    "SELECT id, checksum FROM _avenor_migrations ORDER BY id ASC",
  );
  const existingMap = new Map(existingResult.rows.map((r) => [r.id, r.checksum]));

  const migrations = loadMigrationFiles();
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const migration of migrations) {
    const existingChecksum = existingMap.get(migration.id);
    if (existingChecksum) {
      // Still run idempotent IF NOT EXISTS statements to ensure all tables exist
      await withTransaction(
        async (client) => {
          await client.query(migration.sql);
        },
        { connectionString: options?.connectionString },
      );
      skipped.push(migration.id);
      continue;
    }

    await withTransaction(
      async (client) => {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO _avenor_migrations (id, filename, checksum) VALUES ($1, $2, $3)`,
          [migration.id, migration.filename, migration.checksum],
        );
      },
      { connectionString: options?.connectionString },
    );
    applied.push(migration.id);
  }

  return {
    applied,
    skipped,
    totalMigrations: migrations.length,
  };
}

export interface MigrationStatusReport {
  appliedMigrations: Array<{ id: string; filename: string; checksum: string; appliedAt: string }>;
  pendingMigrations: string[];
  existingTables: string[];
  missingTables: string[];
  healthy: boolean;
}

export async function getMigrationStatus(options?: {
  connectionString?: string;
}): Promise<MigrationStatusReport> {
  await ensureMigrationsTable(options?.connectionString);
  const pool = getDatabasePool(options?.connectionString);

  const appliedRows = await pool.query<{
    id: string;
    filename: string;
    checksum: string;
    applied_at: Date;
  }>("SELECT id, filename, checksum, applied_at FROM _avenor_migrations ORDER BY id ASC");

  const tableRows = await pool.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
     ORDER BY table_name ASC`,
  );

  const existingTableSet = new Set(tableRows.rows.map((r) => r.table_name));
  const appliedIdSet = new Set(appliedRows.rows.map((r) => r.id));
  const allFiles = loadMigrationFiles();

  const pendingMigrations = allFiles.filter((f) => !appliedIdSet.has(f.id)).map((f) => f.id);
  const missingTables = CORE_SCHEMA_TABLES.filter((t) => !existingTableSet.has(t));

  return {
    appliedMigrations: appliedRows.rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      checksum: r.checksum,
      appliedAt: new Date(r.applied_at).toISOString(),
    })),
    pendingMigrations,
    existingTables: Array.from(existingTableSet),
    missingTables,
    healthy: pendingMigrations.length === 0 && missingTables.length === 0,
  };
}

export interface DatabaseCatalogInspection {
  tables: string[];
  uniqueConstraints: string[];
  foreignKeys: string[];
  indexes: string[];
}

export async function inspectDatabaseCatalog(options?: {
  connectionString?: string;
}): Promise<DatabaseCatalogInspection> {
  const pool = getDatabasePool(options?.connectionString);

  const tablesRes = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name ASC`,
  );
  const constraintsRes = await pool.query<{ constraint_name: string; constraint_type: string }>(
    `SELECT constraint_name, constraint_type
     FROM information_schema.table_constraints
     WHERE table_schema = 'public'
     ORDER BY constraint_name ASC`,
  );
  const indexesRes = await pool.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname ASC`,
  );

  return {
    tables: tablesRes.rows.map((r) => r.table_name),
    uniqueConstraints: constraintsRes.rows
      .filter((c) => c.constraint_type === "UNIQUE")
      .map((c) => c.constraint_name),
    foreignKeys: constraintsRes.rows
      .filter((c) => c.constraint_type === "FOREIGN KEY")
      .map((c) => c.constraint_name),
    indexes: indexesRes.rows.map((r) => r.indexname),
  };
}

export async function resetTestDatabaseRecords(options?: {
  connectionString?: string;
  rawEnv?: Record<string, string | undefined>;
}): Promise<void> {
  assertNonProductionDestructiveAction(options?.rawEnv ?? process.env, "resetTestDatabaseRecords");

  const pool = getDatabasePool(options?.connectionString);
  await pool.query(`
    TRUNCATE TABLE
      resource_mappings,
      connected_resources,
      provider_connections,
      project_environments,
      logical_projects,
      workspace_memberships,
      workspaces,
      organization_memberships,
      organizations,
      audit_logs,
      verifications,
      sessions,
      accounts,
      users
    RESTART IDENTITY CASCADE;
  `);
}
