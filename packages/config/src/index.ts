import { AppError, ERROR_CODES } from "@avenor/types";
import { z } from "zod";

export const APP_ENVIRONMENTS = ["development", "test", "production"] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

const postgresUrlSchema = z
  .string()
  .min(1, "Database connection URL is required.")
  .refine(
    (val) => val.startsWith("postgres://") || val.startsWith("postgresql://"),
    "Database connection URL must start with postgres:// or postgresql://.",
  );

export const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default("Avenor"),
  NEXT_PUBLIC_APP_URL: z
    .string()
    .url("NEXT_PUBLIC_APP_URL must be a valid URL.")
    .default("http://localhost:3000"),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_ENV: z.enum(["development", "test", "production"]).optional(),
    DATABASE_URL: postgresUrlSchema,
    DIRECT_DATABASE_URL: postgresUrlSchema.optional(),
    TEST_DATABASE_URL: postgresUrlSchema.optional(),
    BETTER_AUTH_SECRET: z
      .string()
      .min(
        32,
        "BETTER_AUTH_SECRET must be at least 32 characters long for cryptographic session security.",
      ),
    BETTER_AUTH_URL: z
      .string()
      .url("BETTER_AUTH_URL must be a valid URL.")
      .default("http://localhost:3000"),
    ENCRYPTION_MASTER_KEY: z
      .string()
      .regex(
        /^[0-9a-fA-F]{64}$/,
        "ENCRYPTION_MASTER_KEY must be a 64-character hexadecimal string (256-bit key).",
      ),
    NEXT_PUBLIC_APP_NAME: z.string().min(1).default("Avenor"),
    NEXT_PUBLIC_APP_URL: z
      .string()
      .url("NEXT_PUBLIC_APP_URL must be a valid URL.")
      .default("http://localhost:3000"),
  })
  .superRefine((env, ctx) => {
    const effectiveEnv = env.APP_ENV ?? env.NODE_ENV;
    if (effectiveEnv === "production") {
      const lowerSecret = env.BETTER_AUTH_SECRET.toLowerCase();
      if (
        lowerSecret.includes("dev-only") ||
        lowerSecret.includes("placeholder") ||
        lowerSecret.includes("replace-with") ||
        lowerSecret.includes("changeme")
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["BETTER_AUTH_SECRET"],
          message:
            "Production environment cannot use a development or placeholder BETTER_AUTH_SECRET.",
        });
      }
      if (/^0+$/.test(env.ENCRYPTION_MASTER_KEY) || /^a+$/i.test(env.ENCRYPTION_MASTER_KEY)) {
        ctx.addIssue({
          code: "custom",
          path: ["ENCRYPTION_MASTER_KEY"],
          message:
            "Production environment cannot use a trivial all-zero or repeating ENCRYPTION_MASTER_KEY.",
        });
      }
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function assertServerRuntime(callerName = "server configuration"): void {
  if (typeof window !== "undefined") {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: `Security boundary violation: ${callerName} cannot be accessed in a browser runtime.`,
    });
  }
}

export function validateClientEnv(
  rawEnv: Record<string, string | undefined> = process.env,
): ClientEnv {
  const result = clientEnvSchema.safeParse({
    NEXT_PUBLIC_APP_NAME: rawEnv.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_APP_URL: rawEnv.NEXT_PUBLIC_APP_URL,
  });

  if (!result.success) {
    const details: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "clientEnv";
      details[key] = details[key] ?? [];
      details[key].push(issue.message);
    }
    const summary = Object.entries(details)
      .map(([k, v]) => `[${k}] ${v.join("; ")}`)
      .join(" | ");
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Invalid client environment configuration — ${summary}`,
      details,
    });
  }

  return result.data;
}

export function validateServerEnv(
  rawEnv: Record<string, string | undefined> = process.env,
): ServerEnv {
  assertServerRuntime("validateServerEnv");

  const result = serverEnvSchema.safeParse({
    NODE_ENV: rawEnv.NODE_ENV,
    APP_ENV: rawEnv.APP_ENV,
    DATABASE_URL: rawEnv.DATABASE_URL,
    DIRECT_DATABASE_URL: rawEnv.DIRECT_DATABASE_URL,
    TEST_DATABASE_URL: rawEnv.TEST_DATABASE_URL,
    BETTER_AUTH_SECRET: rawEnv.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: rawEnv.BETTER_AUTH_URL,
    ENCRYPTION_MASTER_KEY: rawEnv.ENCRYPTION_MASTER_KEY,
    NEXT_PUBLIC_APP_NAME: rawEnv.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_APP_URL: rawEnv.NEXT_PUBLIC_APP_URL,
  });

  if (!result.success) {
    const details: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "serverEnv";
      details[key] = details[key] ?? [];
      details[key].push(issue.message);
    }
    const summary = Object.entries(details)
      .map(([k, v]) => `[${k}] ${v.join("; ")}`)
      .join(" | ");
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Invalid server environment configuration — ${summary}`,
      details,
    });
  }

  return result.data;
}

export function assertNonProductionDestructiveAction(
  rawEnv: Record<string, string | undefined>,
  actionDescription: string,
): void {
  const nodeEnv = rawEnv.NODE_ENV ?? "development";
  const appEnv = rawEnv.APP_ENV ?? nodeEnv;

  if (nodeEnv === "production" || appEnv === "production") {
    throw new AppError({
      code: ERROR_CODES.PRODUCTION_SAFETY_VIOLATION,
      message: `Blocked destructive operation "${actionDescription}" in production environment.`,
    });
  }
}
