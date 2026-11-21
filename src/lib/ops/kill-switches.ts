import { dbQuery } from "@avenor/database";
import { AppError, ERROR_CODES } from "@avenor/types";

export const FEATURE_KILL_SWITCH_KEYS = [
  "ai.narratives",
  "exports.global",
  "webhooks.outbound",
  "auth.public_signup",
  "billing.checkout",
  "ingestion.global",
  "provider.google_cloud_billing",
  "provider.cloudflare",
  "provider.vercel",
  "provider.github",
  "provider.sentry",
  "provider.posthog",
] as const;

export type FeatureKillSwitchKey = (typeof FEATURE_KILL_SWITCH_KEYS)[number];

export interface FeatureKillSwitchRecord {
  readonly switchKey: FeatureKillSwitchKey;
  readonly enabled: boolean;
  readonly source: "DEFAULT_ENABLED" | "DATABASE_OVERRIDE" | "ENV_EMERGENCY_OVERRIDE";
  readonly reason: string | null;
  readonly updatedBy: string | null;
  readonly updatedAtIso: string | null;
}

function toEnvOverrideKey(switchKey: FeatureKillSwitchKey): string {
  return `AVENOR_KILL_SWITCH_${switchKey.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase()}`;
}

/**
 * Pure evaluator for feature kill switches.
 * Environment emergency override (`AVENOR_KILL_SWITCH_<KEY>=false`) takes highest precedence
 * so operators can halt a subsystem immediately even during a database incident.
 */
export function evaluateKillSwitchState(
  switchKey: FeatureKillSwitchKey,
  dbRecord?: {
    enabled: boolean;
    reason?: string | null;
    updatedBy?: string | null;
    updatedAtIso?: string | null;
  } | null,
  env: Record<string, string | undefined> = process.env,
): FeatureKillSwitchRecord {
  const envKey = toEnvOverrideKey(switchKey);
  const rawEnv = env[envKey]?.trim().toLowerCase();

  if (rawEnv === "false" || rawEnv === "0" || rawEnv === "off") {
    return {
      switchKey,
      enabled: false,
      source: "ENV_EMERGENCY_OVERRIDE",
      reason: `Disabled via emergency environment variable ${envKey}.`,
      updatedBy: "env_override",
      updatedAtIso: null,
    };
  }

  if (dbRecord) {
    return {
      switchKey,
      enabled: dbRecord.enabled,
      source: "DATABASE_OVERRIDE",
      reason: dbRecord.reason ?? null,
      updatedBy: dbRecord.updatedBy ?? null,
      updatedAtIso: dbRecord.updatedAtIso ?? null,
    };
  }

  return {
    switchKey,
    enabled: true,
    source: "DEFAULT_ENABLED",
    reason: null,
    updatedBy: null,
    updatedAtIso: null,
  };
}

export function assertKillSwitchEnabled(state: FeatureKillSwitchRecord): void {
  if (!state.enabled) {
    throw new AppError({
      code: ERROR_CODES.EXTERNAL_PROVIDER_ERROR,
      statusCode: 503,
      message: `Feature "${state.switchKey}" is temporarily paused by operational kill switch${state.reason ? `: ${state.reason}` : "."}`,
    });
  }
}

export async function listFeatureKillSwitches(): Promise<FeatureKillSwitchRecord[]> {
  const res = await dbQuery<Record<string, unknown>>(
    `SELECT switch_key, enabled, reason, updated_by, updated_at FROM feature_kill_switches`,
  );
  const byKey = new Map(
    res.rows.map((r) => [
      String(r.switch_key),
      {
        enabled: Boolean(r.enabled),
        reason: r.reason ? String(r.reason) : null,
        updatedBy: r.updated_by ? String(r.updated_by) : null,
        updatedAtIso: r.updated_at ? new Date(String(r.updated_at)).toISOString() : null,
      },
    ]),
  );

  return FEATURE_KILL_SWITCH_KEYS.map((key) =>
    evaluateKillSwitchState(key, byKey.get(key) ?? null),
  );
}

export async function setFeatureKillSwitch(input: {
  switchKey: FeatureKillSwitchKey;
  enabled: boolean;
  reason?: string;
  updatedBy: string;
}): Promise<FeatureKillSwitchRecord> {
  const res = await dbQuery<Record<string, unknown>>(
    `INSERT INTO feature_kill_switches (switch_key, enabled, reason, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (switch_key) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       reason = EXCLUDED.reason,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()
     RETURNING switch_key, enabled, reason, updated_by, updated_at`,
    [input.switchKey, input.enabled, input.reason ?? null, input.updatedBy],
  );
  const row = res.rows[0] ?? {};
  return evaluateKillSwitchState(input.switchKey, {
    enabled: Boolean(row.enabled),
    reason: row.reason ? String(row.reason) : null,
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    updatedAtIso: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
  });
}
