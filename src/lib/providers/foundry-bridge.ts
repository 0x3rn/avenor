import { AppError, ERROR_CODES } from "@avenor/types";
import { z } from "zod";

export interface FoundryOneBridgeConfig {
  readonly enabled: boolean;
  readonly baseUrl: string | null;
  readonly bridgeToken: string | null;
  readonly isolatedFromAvenorAuth: true;
  readonly readOnlyOnly: true;
}

const ALLOWLISTED_FOUNDRY_GET_PATHS: readonly RegExp[] = [
  /^\/v1\/telemetry\/health$/,
  /^\/v1\/telemetry\/aggregates$/,
];

const PROHIBITED_FOUNDRY_PATHS: readonly string[] = [
  "/admin",
  "/sql",
  "/deploy",
  "/mutate",
  "/users",
  "/sessions",
  "/secrets",
  "/credentials",
  "/billing",
  "/databases",
];

/**
 * Strictly aggregate-only schema for optional Foundry One telemetry.
 * Rejects unknown keys (.strict()) so raw end-user PII, rows, or tokens can never pass through.
 */
export const foundryOneAggregateSnapshotSchema = z
  .object({
    serviceName: z.string().min(1).max(100),
    environment: z.enum(["PRODUCTION", "STAGING", "DEVELOPMENT"]),
    windowStartIso: z.string().datetime(),
    windowEndIso: z.string().datetime(),
    requestCount: z.number().int().min(0),
    error5xxCount: z.number().int().min(0),
    p95LatencyMs: z.number().min(0),
    activeComputeUnits: z.number().min(0).optional(),
  })
  .strict();

export type FoundryOneAggregateSnapshot = z.infer<typeof foundryOneAggregateSnapshotSchema>;

/**
 * Resolves the optional Foundry One read-only metrics bridge configuration.
 * Disabled by default; enforces strict credential isolation so Avenor's auth or
 * encryption secrets can never be reused as a Foundry bridge credential.
 */
export function resolveFoundryOneBridgeConfig(
  env: Record<string, string | undefined> = process.env,
): FoundryOneBridgeConfig {
  const enabled = env.FOUNDRY_ONE_BRIDGE_ENABLED?.trim().toLowerCase() === "true";
  const baseUrl = env.FOUNDRY_ONE_METRICS_BRIDGE_URL?.trim() || null;
  const bridgeToken = env.FOUNDRY_ONE_METRICS_BRIDGE_TOKEN?.trim() || null;

  if (!enabled) {
    return {
      enabled: false,
      baseUrl: null,
      bridgeToken: null,
      isolatedFromAvenorAuth: true,
      readOnlyOnly: true,
    };
  }

  if (!baseUrl || !bridgeToken) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message:
        "FOUNDRY_ONE_BRIDGE_ENABLED=true requires dedicated FOUNDRY_ONE_METRICS_BRIDGE_URL and FOUNDRY_ONE_METRICS_BRIDGE_TOKEN.",
    });
  }

  // Enforce strict credential separation from Avenor auth/vault secrets
  const forbiddenSharedSecrets = [
    env.BETTER_AUTH_SECRET,
    env.AVENOR_ENCRYPTION_MASTER_KEY,
    env.AVENOR_JOB_SIGNING_SECRET,
    env.LEMON_SQUEEZY_API_KEY,
  ].filter((v): v is string => Boolean(v && v.trim().length > 0));

  if (forbiddenSharedSecrets.includes(bridgeToken)) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message:
        "Credential isolation violation: Foundry One bridge token must NEVER share Avenor auth, encryption, or billing secrets.",
    });
  }

  return {
    enabled: true,
    baseUrl,
    bridgeToken,
    isolatedFromAvenorAuth: true,
    readOnlyOnly: true,
  };
}

/**
 * Verifies any outbound Foundry One bridge call is strictly HTTPS GET on the
 * two aggregate-only telemetry endpoints, with zero admin/deploy/SQL access.
 */
export function assertAllowlistedFoundryBridgeRequest(
  method: string,
  urlString: string,
  env: Record<string, string | undefined> = process.env,
): URL {
  const cfg = resolveFoundryOneBridgeConfig(env);
  if (!cfg.enabled) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "Optional Foundry One metrics bridge is disabled by default.",
    });
  }

  const normalizedMethod = method.trim().toUpperCase();
  if (normalizedMethod !== "GET") {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: `Foundry One bridge blocked prohibited HTTP method "${normalizedMethod}". Only read-only GET requests are permitted.`,
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Invalid Foundry One bridge URL "${urlString}".`,
    });
  }

  if (parsed.protocol !== "https:") {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "Foundry One metrics bridge requires HTTPS.",
    });
  }

  const lowerPath = parsed.pathname.toLowerCase();
  for (const forbidden of PROHIBITED_FOUNDRY_PATHS) {
    if (lowerPath.includes(forbidden)) {
      throw new AppError({
        code: ERROR_CODES.FORBIDDEN,
        message: `Foundry One bridge blocked control/sensitive path "${parsed.pathname}".`,
      });
    }
  }

  if (!ALLOWLISTED_FOUNDRY_GET_PATHS.some((pattern) => pattern.test(parsed.pathname))) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: `Foundry One bridge path "${parsed.pathname}" is not in the aggregate telemetry allowlist.`,
    });
  }

  return parsed;
}

export function validateFoundryOneAggregatePayload(raw: unknown): FoundryOneAggregateSnapshot {
  const parsed = foundryOneAggregateSnapshotSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Rejected non-aggregate or malformed Foundry One payload: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    });
  }
  return parsed.data;
}
