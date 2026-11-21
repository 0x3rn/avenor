import crypto from "node:crypto";
import { type AuthenticatedSessionContext, authorizeWorkspaceAccess } from "@avenor/auth";
import { dbQuery, generateId } from "@avenor/database";
import { AppError, ERROR_CODES } from "@avenor/types";
import { z } from "zod";
import {
  type ControlledDnsResolver,
  resolveAndPinSafePublicAddress,
  validatePublicTargetUrl,
} from "@/lib/reliability/ssrf";

export type DigestCadence = "DAILY" | "WEEKLY" | "MONTHLY";
export type OutboundChannelType = "SLACK" | "TELEGRAM" | "SIGNED_WEBHOOK";

export interface DigestReportingWindow {
  readonly cadence: DigestCadence;
  readonly timezone: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly windowKey: string;
}

export interface DigestScheduleRecord {
  id: string;
  organizationId: string;
  workspaceId: string;
  name: string;
  cadence: DigestCadence;
  timezone: string;
  projectIds: string[];
  channels: string[];
  recipientUserIds: string[];
  isEnabled: boolean;
  lastRunWindowKey: string | null;
  lastGeneratedAtIso: string | null;
  createdAtIso: string;
}

export interface OutboundWebhookDeliveryOutcome {
  readonly deliveryId: string;
  readonly status:
    | "ACCEPTED_BY_PROVIDER"
    | "RETRYABLE_FAILURE"
    | "PERMANENT_FAILURE"
    | "SSRF_BLOCKED";
  readonly httpStatus: number | null;
  readonly attempts: number;
  readonly signatureHeader: string;
  readonly transportNote: string;
}

function getLocalDateParts(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")?.value ?? date.getUTCFullYear());
  const month = Number(parts.find((p) => p.type === "month")?.value ?? date.getUTCMonth() + 1);
  const day = Number(parts.find((p) => p.type === "day")?.value ?? date.getUTCDate());
  return { year, month, day };
}

function formatYmd(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Computes a completed, timezone-aware reporting window for DAILY, WEEKLY, or MONTHLY digests
 * (handling leap years, month-end boundaries, and IANA timezones).
 */
export function computeDigestReportingWindow(
  cadence: DigestCadence,
  timezone = "UTC",
  now: Date = new Date(),
): DigestReportingWindow {
  // Validate IANA timezone
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(now);
  } catch {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Invalid IANA timezone "${timezone}".`,
    });
  }

  const local = getLocalDateParts(now, timezone);
  const anchorUtc = new Date(Date.UTC(local.year, local.month - 1, local.day));

  if (cadence === "DAILY") {
    const yesterday = new Date(anchorUtc.getTime() - 86_400_000);
    const ymd = formatYmd(
      yesterday.getUTCFullYear(),
      yesterday.getUTCMonth() + 1,
      yesterday.getUTCDate(),
    );
    return {
      cadence,
      timezone,
      startDate: ymd,
      endDate: ymd,
      windowKey: `DAILY:${ymd}:${timezone}`,
    };
  }

  if (cadence === "WEEKLY") {
    const end = new Date(anchorUtc.getTime() - 86_400_000);
    const start = new Date(anchorUtc.getTime() - 7 * 86_400_000);
    const startDate = formatYmd(
      start.getUTCFullYear(),
      start.getUTCMonth() + 1,
      start.getUTCDate(),
    );
    const endDate = formatYmd(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate());
    return {
      cadence,
      timezone,
      startDate,
      endDate,
      windowKey: `WEEKLY:${startDate}_${endDate}:${timezone}`,
    };
  }

  // MONTHLY: previous full calendar month (handles Feb 28/29 leap years automatically via day 0)
  const prevMonthLast = new Date(Date.UTC(local.year, local.month - 1, 0));
  const prevYear = prevMonthLast.getUTCFullYear();
  const prevMonth = prevMonthLast.getUTCMonth() + 1;
  const lastDay = prevMonthLast.getUTCDate();
  const startDate = formatYmd(prevYear, prevMonth, 1);
  const endDate = formatYmd(prevYear, prevMonth, lastDay);
  return {
    cadence,
    timezone,
    startDate,
    endDate,
    windowKey: `MONTHLY:${prevYear}-${String(prevMonth).padStart(2, "0")}:${timezone}`,
  };
}

/**
 * Timestamped HMAC-SHA256 outbound webhook signature (`t=<unix>,v1=<hex>`).
 * Provides authenticity and integrity (TLS provides confidentiality in transit).
 */
export function signOutboundWebhookPayload(options: {
  rawBody: string;
  timestampSec: number;
  deliveryId: string;
  signingSecret: string;
}): string {
  const canonical = `${options.timestampSec}.${options.deliveryId}.${options.rawBody}`;
  const digest = crypto.createHmac("sha256", options.signingSecret).update(canonical).digest("hex");
  return `t=${options.timestampSec},v1=${digest}`;
}

export function verifyOutboundWebhookSignature(options: {
  rawBody: string;
  deliveryId: string;
  signatureHeader: string;
  signingSecret: string;
  maxClockSkewSeconds?: number;
  nowSec?: number;
}): boolean {
  const parts = Object.fromEntries(
    options.signatureHeader.split(",").map((kv) => {
      const idx = kv.indexOf("=");
      return idx > 0 ? [kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()] : ["", ""];
    }),
  );
  const ts = Number(parts.t);
  const v1 = parts.v1 ?? "";
  if (!Number.isFinite(ts) || !/^[0-9a-f]{64}$/i.test(v1)) {
    return false;
  }
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > (options.maxClockSkewSeconds ?? 300)) {
    return false;
  }
  const expected = signOutboundWebhookPayload({
    rawBody: options.rawBody,
    timestampSec: ts,
    deliveryId: options.deliveryId,
    signingSecret: options.signingSecret,
  });
  const expectedV1 = expected.split("v1=")[1] ?? "";
  const a = Buffer.from(v1, "hex");
  const b = Buffer.from(expectedV1, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Escapes Telegram HTML entities so untrusted metric/project labels cannot inject markup.
 */
export function formatSafeTelegramMessage(options: {
  workspaceName: string;
  windowLabel: string;
  bulletLines: readonly string[];
}): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    `<b>Avenor Digest — ${esc(options.workspaceName)}</b>`,
    `Window: ${esc(options.windowLabel)}`,
    ...options.bulletLines.map((line) => `• ${esc(line)}`),
  ].join("\n");
}

/**
 * Delivers a signed outbound webhook with SSRF/DNS-rebinding protection and bounded retries.
 */
export async function deliverSignedOutboundWebhook(options: {
  targetUrl: string;
  signingSecret: string;
  payload: Record<string, unknown>;
  deliveryId?: string;
  maxAttempts?: number;
  dnsLookupFn?: ControlledDnsResolver;
  fetchFn?: typeof fetch;
}): Promise<OutboundWebhookDeliveryOutcome> {
  const deliveryId = options.deliveryId ?? generateId("whdel");
  const rawBody = JSON.stringify(options.payload);
  const timestampSec = Math.floor(Date.now() / 1000);
  const signatureHeader = signOutboundWebhookPayload({
    rawBody,
    timestampSec,
    deliveryId,
    signingSecret: options.signingSecret,
  });

  try {
    await resolveAndPinSafePublicAddress(options.targetUrl, {
      allowHttp: false,
      dnsLookupFn: options.dnsLookupFn,
    });
  } catch (err) {
    return {
      deliveryId,
      status: "SSRF_BLOCKED",
      httpStatus: null,
      attempts: 0,
      signatureHeader,
      transportNote: err instanceof Error ? err.message : "Blocked by SSRF destination policy.",
    };
  }

  const maxAttempts = Math.min(3, Math.max(1, options.maxAttempts ?? 3));
  const fetchImpl = options.fetchFn ?? globalThis.fetch;
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchImpl(options.targetUrl, {
        method: "POST",
        redirect: "manual",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Avenor-Delivery": deliveryId,
          "X-Avenor-Signature": signatureHeader,
          "User-Agent": "Avenor-Signed-Webhook/1.0",
        },
        body: rawBody,
      });
      lastStatus = res.status;
      if (res.status >= 200 && res.status < 300) {
        return {
          deliveryId,
          status: "ACCEPTED_BY_PROVIDER",
          httpStatus: res.status,
          attempts: attempt,
          signatureHeader,
          transportNote:
            "Destination accepted payload (HTTP 2xx). Transport acceptance does not guarantee human receipt.",
        };
      }
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        return {
          deliveryId,
          status: "PERMANENT_FAILURE",
          httpStatus: res.status,
          attempts: attempt,
          signatureHeader,
          transportNote: `Destination rejected payload permanently (HTTP ${res.status}).`,
        };
      }
    } catch {
      lastStatus = null;
    }
  }

  return {
    deliveryId,
    status: "RETRYABLE_FAILURE",
    httpStatus: lastStatus,
    attempts: maxAttempts,
    signatureHeader,
    transportNote: `Exhausted ${maxAttempts} delivery attempts without 2xx acceptance.`,
  };
}

function encryptChannelSecret(plaintext: string): string {
  const keyMaterial =
    process.env.AVENOR_ENCRYPTION_MASTER_KEY ??
    process.env.BETTER_AUTH_SECRET ??
    "avenor-local-dev-channel-key-material-32bytes";
  const key = crypto.createHash("sha256").update(keyMaterial).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

const createDigestSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  name: z.string().trim().min(2).max(120),
  cadence: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  timezone: z.string().trim().min(2).max(60).default("UTC"),
  projectIds: z.array(z.string().min(1)).default([]),
  channels: z.array(z.enum(["IN_APP", "EMAIL", "SLACK", "TELEGRAM", "SIGNED_WEBHOOK"])).min(1),
  recipientUserIds: z.array(z.string().min(1)).default([]),
});

function mapDigestRow(row: Record<string, unknown>): DigestScheduleRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    cadence: String(row.cadence) as DigestCadence,
    timezone: String(row.timezone),
    projectIds: Array.isArray(row.project_ids) ? row.project_ids.map(String) : [],
    channels: Array.isArray(row.channels) ? row.channels.map(String) : [],
    recipientUserIds: Array.isArray(row.recipient_user_ids)
      ? row.recipient_user_ids.map(String)
      : [],
    isEnabled: Boolean(row.is_enabled),
    lastRunWindowKey: row.last_run_window_key ? String(row.last_run_window_key) : null,
    lastGeneratedAtIso: row.last_generated_at
      ? new Date(String(row.last_generated_at)).toISOString()
      : null,
    createdAtIso: new Date(String(row.created_at)).toISOString(),
  };
}

export async function createDigestSchedule(
  session: AuthenticatedSessionContext | null,
  rawInput: z.input<typeof createDigestSchema>,
): Promise<DigestScheduleRecord> {
  const parsed = createDigestSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }
  const input = parsed.data;
  // Validate IANA timezone
  computeDigestReportingWindow(input.cadence, input.timezone);

  const workspaceId = input.workspaceId ?? session?.activeWorkspace.id ?? "";
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "project:update",
  });

  const recipients =
    input.recipientUserIds.length > 0
      ? input.recipientUserIds
      : session?.user.id
        ? [session.user.id]
        : [];

  const id = generateId("dgst");
  const res = await dbQuery<Record<string, unknown>>(
    `INSERT INTO digest_schedules (
      id, organization_id, workspace_id, created_by_user_id, name, cadence, timezone,
      project_ids, channels, recipient_user_ids, is_enabled
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9::text[], $10::text[], true)
    RETURNING *`,
    [
      id,
      access.organizationId,
      workspaceId,
      session?.user.id ?? null,
      input.name,
      input.cadence,
      input.timezone,
      input.projectIds,
      input.channels,
      recipients,
    ],
  );
  return mapDigestRow(res.rows[0] ?? {});
}

export async function listDigestSchedules(
  session: AuthenticatedSessionContext | null,
  workspaceId?: string,
): Promise<DigestScheduleRecord[]> {
  const targetWs = workspaceId ?? session?.activeWorkspace.id ?? "";
  await authorizeWorkspaceAccess({
    session,
    workspaceId: targetWs,
    requiredPermission: "project:read",
  });
  const res = await dbQuery<Record<string, unknown>>(
    `SELECT * FROM digest_schedules WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [targetWs],
  );
  return res.rows.map(mapDigestRow);
}

export async function registerOutboundChannel(
  session: AuthenticatedSessionContext | null,
  input: {
    workspaceId?: string;
    channelType: OutboundChannelType;
    name: string;
    targetUrl: string;
    signingSecret?: string;
  },
): Promise<{ id: string; channelType: OutboundChannelType; name: string }> {
  const workspaceId = input.workspaceId ?? session?.activeWorkspace.id ?? "";
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "workspace:update",
  });

  // Strict HTTPS + SSRF validation before persisting
  const validated = validatePublicTargetUrl(input.targetUrl, { allowHttp: false });

  const id = generateId("owhc");
  const encryptedUrl = encryptChannelSecret(validated.normalizedUrl);
  const encryptedSecret = input.signingSecret ? encryptChannelSecret(input.signingSecret) : null;

  await dbQuery(
    `INSERT INTO outbound_webhook_channels (
      id, organization_id, workspace_id, channel_type, name,
      target_url_encrypted, signing_secret_encrypted, is_enabled, created_by_user_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)`,
    [
      id,
      access.organizationId,
      workspaceId,
      input.channelType,
      input.name.trim(),
      encryptedUrl,
      encryptedSecret,
      session?.user.id ?? null,
    ],
  );

  return { id, channelType: input.channelType, name: input.name.trim() };
}

/**
 * Generates a digest at most once per reporting window (`last_run_window_key`),
 * re-validating active workspace memberships at send time so removed members are excluded.
 */
export async function runDigestScheduleIdempotently(
  session: AuthenticatedSessionContext | null,
  scheduleId: string,
  options?: { now?: Date },
): Promise<{
  scheduleId: string;
  window: DigestReportingWindow;
  deduplicated: boolean;
  authorizedRecipientCount: number;
  excludedRecipientCount: number;
}> {
  const found = await dbQuery<Record<string, unknown>>(
    `SELECT * FROM digest_schedules WHERE id = $1`,
    [scheduleId],
  );
  const row = found.rows[0];
  if (!row) {
    throw new AppError({ code: ERROR_CODES.NOT_FOUND, message: "Digest schedule not found." });
  }
  const schedule = mapDigestRow(row);
  await authorizeWorkspaceAccess({
    session,
    workspaceId: schedule.workspaceId,
    requiredPermission: "project:read",
  });

  const window = computeDigestReportingWindow(schedule.cadence, schedule.timezone, options?.now);
  if (schedule.lastRunWindowKey === window.windowKey) {
    return {
      scheduleId: schedule.id,
      window,
      deduplicated: true,
      authorizedRecipientCount: 0,
      excludedRecipientCount: 0,
    };
  }

  // Recheck active workspace membership at send time!
  const activeMembers = await dbQuery<{ user_id: string }>(
    `SELECT user_id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = ANY($2::text[])`,
    [schedule.workspaceId, schedule.recipientUserIds],
  );
  const activeSet = new Set(activeMembers.rows.map((r) => r.user_id));
  const authorizedRecipientCount = schedule.recipientUserIds.filter((u) => activeSet.has(u)).length;
  const excludedRecipientCount = schedule.recipientUserIds.length - authorizedRecipientCount;

  await dbQuery(
    `UPDATE digest_schedules
     SET last_run_window_key = $1, last_generated_at = now(), updated_at = now()
     WHERE id = $2`,
    [window.windowKey, schedule.id],
  );

  return {
    scheduleId: schedule.id,
    window,
    deduplicated: false,
    authorizedRecipientCount,
    excludedRecipientCount,
  };
}
