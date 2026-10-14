import crypto from "node:crypto";
import { assertServerRuntime } from "@avenor/config";
import { AppError, ERROR_CODES } from "@avenor/types";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

export type Queryable = Pool | PoolClient;

const globalPools = globalThis as unknown as {
  __avenorPgPools?: Map<string, Pool>;
};

function getPoolMap(): Map<string, Pool> {
  if (!globalPools.__avenorPgPools) {
    globalPools.__avenorPgPools = new Map<string, Pool>();
  }
  return globalPools.__avenorPgPools;
}

export function resolveDatabaseUrl(explicitUrl?: string): string {
  assertServerRuntime("resolveDatabaseUrl");
  const resolved =
    explicitUrl ??
    (process.env.NODE_ENV === "test" && process.env.TEST_DATABASE_URL
      ? process.env.TEST_DATABASE_URL
      : process.env.DATABASE_URL);

  if (!resolved) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "DATABASE_URL is not configured in the server environment.",
    });
  }
  return resolved.replace(/sslmode=require\b/g, "sslmode=verify-full");
}

export function getDatabasePool(explicitUrl?: string): Pool {
  assertServerRuntime("getDatabasePool");
  const connectionString = resolveDatabaseUrl(explicitUrl);
  const pools = getPoolMap();
  const existing = pools.get(connectionString);
  if (existing) {
    return existing;
  }

  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  });

  pools.set(connectionString, pool);
  return pool;
}

export async function closeAllDatabasePools(): Promise<void> {
  const pools = getPoolMap();
  for (const [key, pool] of pools.entries()) {
    await pool.end();
    pools.delete(key);
  }
}

export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

interface PostgresErrorLike {
  code?: string;
  constraint?: string;
  detail?: string;
  table?: string;
  message?: string;
}

export function mapDatabaseError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err;
  }

  const pgErr = err as PostgresErrorLike;
  if (pgErr && typeof pgErr.code === "string") {
    // 23505 = unique_violation
    if (pgErr.code === "23505") {
      return new AppError({
        code: ERROR_CODES.CONFLICT,
        message: `Unique constraint violation${pgErr.constraint ? ` (${pgErr.constraint})` : ""}.`,
        details: pgErr.constraint ? { constraint: pgErr.constraint } : undefined,
        cause: err,
      });
    }
    // 23503 = foreign_key_violation
    if (pgErr.code === "23503") {
      return new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Foreign key integrity violation${pgErr.constraint ? ` (${pgErr.constraint})` : ""}.`,
        details: pgErr.constraint ? { constraint: pgErr.constraint } : undefined,
        cause: err,
      });
    }
    // 23514 = check_violation, 23502 = not_null_violation
    if (pgErr.code === "23514" || pgErr.code === "23502") {
      return new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Database check or non-null constraint violation${pgErr.constraint ? ` (${pgErr.constraint})` : ""}.`,
        details: pgErr.constraint ? { constraint: pgErr.constraint } : undefined,
        cause: err,
      });
    }
  }

  return new AppError({
    code: ERROR_CODES.INTERNAL_ERROR,
    message: err instanceof Error ? err.message : "Database operation failed.",
    cause: err,
  });
}

export async function dbQuery<R extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  executor?: Queryable,
): Promise<QueryResult<R>> {
  const target = executor ?? getDatabasePool();
  try {
    return await target.query<R>(sql, params);
  } catch (err) {
    throw mapDatabaseError(err);
  }
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  options?: { connectionString?: string },
): Promise<T> {
  const pool = getDatabasePool(options?.connectionString);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve primary transaction error
    }
    throw mapDatabaseError(err);
  } finally {
    client.release();
  }
}
