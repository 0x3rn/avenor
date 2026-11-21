import crypto from "node:crypto";
import { type AuthenticatedSessionContext, authorizeWorkspaceAccess } from "@avenor/auth";
import { assertServerRuntime } from "@avenor/config";
import { dbQuery, generateId } from "@avenor/database";
import { AppError, ERROR_CODES } from "@avenor/types";
import { z } from "zod";

export type PrivateAccessMode = "open" | "allowlist" | "invite_only";

export interface PrivateAccessGateResult {
  allowed: boolean;
  mode: PrivateAccessMode;
  reason: string;
}

export const ONBOARDING_STEPS = [
  "workspace",
  "project",
  "environments",
  "connections",
  "sync",
  "completed",
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingProgressRecord {
  id: string;
  userId: string;
  organizationId: string;
  workspaceId: string;
  currentStep: OnboardingStepKey;
  completedSteps: readonly OnboardingStepKey[];
  draftProjectId: string | null;
  metadata: Record<string, unknown>;
  completedAtIso: string | null;
  updatedAtIso: string;
}

const privateAccessRequestSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name.").max(120),
  email: z.string().trim().email("Please enter a valid work or personal email address.").max(254),
  productCountHint: z.string().trim().max(60).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

const onboardingProgressPatchSchema = z.object({
  currentStep: z.enum(ONBOARDING_STEPS),
  completedSteps: z.array(z.enum(ONBOARDING_STEPS)).optional(),
  draftProjectId: z.string().trim().min(2).max(120).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  markCompleted: z.boolean().optional(),
});

export function resolvePrivateAccessMode(
  rawEnv: Record<string, string | undefined> = process.env,
): PrivateAccessMode {
  const raw = (rawEnv.AVENOR_PRIVATE_ACCESS_MODE ?? "").trim().toLowerCase();
  if (raw === "allowlist" || raw === "invite_only") {
    return raw;
  }
  return "open";
}

export function parseAllowedSignupEmails(
  rawEnv: Record<string, string | undefined> = process.env,
): ReadonlySet<string> {
  const raw = rawEnv.AVENOR_ALLOWED_SIGNUP_EMAILS ?? "";
  const emails = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 3 && e.includes("@"));
  return new Set(emails);
}

/**
 * Server-side private MVP access gate.
 * When `AVENOR_PRIVATE_ACCESS_MODE` is `allowlist` or `invite_only`, blocks unauthorized
 * public signup attempts unless the normalized email is explicitly allowlisted via
 * `AVENOR_ALLOWED_SIGNUP_EMAILS` or approved in `private_access_requests`.
 */
export async function evaluatePrivateAccessGate(
  email: string,
  options?: {
    rawEnv?: Record<string, string | undefined>;
    checkDatabaseApproval?: boolean;
  },
): Promise<PrivateAccessGateResult> {
  const rawEnv = options?.rawEnv ?? process.env;
  const mode = resolvePrivateAccessMode(rawEnv);
  const normalized = email.trim().toLowerCase();

  if (mode === "open") {
    return {
      allowed: true,
      mode,
      reason: "Registration is open in the current environment configuration.",
    };
  }

  const allowlist = parseAllowedSignupEmails(rawEnv);
  if (allowlist.has(normalized)) {
    return {
      allowed: true,
      mode,
      reason: "Email is explicitly authorized on the private MVP allowlist.",
    };
  }

  if (options?.checkDatabaseApproval !== false) {
    try {
      const approvedRes = await dbQuery<{ id: string }>(
        `SELECT id
         FROM private_access_requests
         WHERE normalized_email = $1
           AND status = 'APPROVED'
         LIMIT 1`,
        [normalized],
      );
      if (approvedRes.rows.length > 0) {
        return {
          allowed: true,
          mode,
          reason: "Email holds an approved private-preview access invitation.",
        };
      }
    } catch {
      // Fall through to strict deny if DB check is unavailable in pure unit tests
    }
  }

  return {
    allowed: false,
    mode,
    reason:
      "Avenor is currently in private preview. Request access from the homepage or sign in with an authorized account.",
  };
}

export async function assertPrivateSignupAllowed(
  email: string,
  options?: {
    rawEnv?: Record<string, string | undefined>;
    checkDatabaseApproval?: boolean;
  },
): Promise<void> {
  const verdict = await evaluatePrivateAccessGate(email, options);
  if (!verdict.allowed) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: verdict.reason,
      details: {
        privateAccessMode: verdict.mode,
      },
    });
  }
}

export function hashRequestSourceIp(rawIp: string | null | undefined): string | null {
  const cleaned = (rawIp ?? "").trim();
  if (!cleaned) {
    return null;
  }
  return crypto.createHash("sha256").update(`avenor-access-req:${cleaned}`).digest("hex");
}

export async function submitPrivateAccessRequest(input: {
  name: string;
  email: string;
  productCountHint?: string | null;
  notes?: string | null;
  sourceIp?: string | null;
}): Promise<{
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  alreadyRequested: boolean;
  confirmationMessage: string;
}> {
  assertServerRuntime("submitPrivateAccessRequest");

  const parsed = privateAccessRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: parsed.error.issues[0]?.message ?? "Invalid private access request payload.",
    });
  }

  const normalizedEmail = parsed.data.email.toLowerCase();
  const ipHash = hashRequestSourceIp(input.sourceIp);

  // Abuse throttling: max 5 requests per IP hash per rolling 60-minute window
  if (ipHash) {
    const rateRes = await dbQuery<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM private_access_requests
       WHERE source_ip_hash = $1
         AND created_at >= now() - interval '60 minutes'`,
      [ipHash],
    );
    if (Number(rateRes.rows[0]?.count ?? 0) >= 5) {
      throw new AppError({
        code: ERROR_CODES.RATE_LIMITED,
        message: "Too many access requests from this network. Please wait before submitting again.",
      });
    }
  }

  const existingRes = await dbQuery<{ id: string; status: "PENDING" | "APPROVED" | "REJECTED" }>(
    `SELECT id, status
     FROM private_access_requests
     WHERE normalized_email = $1
     LIMIT 1`,
    [normalizedEmail],
  );

  if (existingRes.rows[0]) {
    return {
      id: existingRes.rows[0].id,
      status: existingRes.rows[0].status,
      alreadyRequested: true,
      confirmationMessage:
        "Your private preview access request is already on file. We will follow up once your workspace slot is enabled.",
    };
  }

  const id = generateId("par");
  await dbQuery(
    `INSERT INTO private_access_requests (
       id, name, email, normalized_email, product_count_hint, notes, status, source_ip_hash
     ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7)`,
    [
      id,
      parsed.data.name,
      parsed.data.email,
      normalizedEmail,
      parsed.data.productCountHint ?? null,
      parsed.data.notes ?? null,
      ipHash,
    ],
  );

  return {
    id,
    status: "PENDING",
    alreadyRequested: false,
    confirmationMessage:
      "Private preview request recorded securely. You will be notified once access is granted.",
  };
}

export async function getOnboardingProgress(
  session: AuthenticatedSessionContext | null,
  workspaceId?: string,
): Promise<OnboardingProgressRecord> {
  assertServerRuntime("getOnboardingProgress");

  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId: workspaceId ?? session?.activeWorkspace.id ?? "",
    requiredPermission: "workspace:read",
  });
  const actorUserId = session?.user.id ?? "";

  const existing = await dbQuery<{
    id: string;
    user_id: string;
    organization_id: string;
    workspace_id: string;
    current_step: OnboardingStepKey;
    completed_steps: OnboardingStepKey[];
    draft_project_id: string | null;
    metadata: Record<string, unknown> | null;
    completed_at: Date | null;
    updated_at: Date;
  }>(
    `SELECT *
     FROM onboarding_progress
     WHERE user_id = $1 AND workspace_id = $2
     LIMIT 1`,
    [actorUserId, access.workspaceId],
  );

  if (existing.rows[0]) {
    const r = existing.rows[0];
    return {
      id: r.id,
      userId: r.user_id,
      organizationId: r.organization_id,
      workspaceId: r.workspace_id,
      currentStep: r.current_step,
      completedSteps: r.completed_steps ?? ["workspace"],
      draftProjectId: r.draft_project_id,
      metadata: r.metadata ?? {},
      completedAtIso: r.completed_at ? new Date(r.completed_at).toISOString() : null,
      updatedAtIso: new Date(r.updated_at).toISOString(),
    };
  }

  // Initialize deterministic resumable record on first read
  const id = generateId("onb");
  const initialStep: OnboardingStepKey = session?.user.onboardingCompletedAt
    ? "completed"
    : "project";
  const initialCompleted: OnboardingStepKey[] = session?.user.onboardingCompletedAt
    ? ["workspace", "project", "environments", "connections", "sync", "completed"]
    : ["workspace"];

  const inserted = await dbQuery<{
    id: string;
    user_id: string;
    organization_id: string;
    workspace_id: string;
    current_step: OnboardingStepKey;
    completed_steps: OnboardingStepKey[];
    draft_project_id: string | null;
    metadata: Record<string, unknown> | null;
    completed_at: Date | null;
    updated_at: Date;
  }>(
    `INSERT INTO onboarding_progress (
       id, user_id, organization_id, workspace_id, current_step, completed_steps, completed_at
     ) VALUES ($1, $2, $3, $4, $5, $6::text[], $7::timestamptz)
     ON CONFLICT (user_id, workspace_id) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [
      id,
      actorUserId,
      access.organizationId,
      access.workspaceId,
      initialStep,
      initialCompleted,
      session?.user.onboardingCompletedAt ?? null,
    ],
  );

  const row = inserted.rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    currentStep: row.current_step,
    completedSteps: row.completed_steps ?? ["workspace"],
    draftProjectId: row.draft_project_id,
    metadata: row.metadata ?? {},
    completedAtIso: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    updatedAtIso: new Date(row.updated_at).toISOString(),
  };
}

export async function upsertOnboardingProgress(
  session: AuthenticatedSessionContext | null,
  input: {
    workspaceId?: string;
    currentStep: OnboardingStepKey;
    completedSteps?: OnboardingStepKey[];
    draftProjectId?: string | null;
    metadata?: Record<string, unknown>;
    markCompleted?: boolean;
  },
): Promise<OnboardingProgressRecord> {
  assertServerRuntime("upsertOnboardingProgress");

  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId: input.workspaceId ?? session?.activeWorkspace.id ?? "",
    requiredPermission: "workspace:read",
  });
  const actorUserId = session?.user.id ?? "";

  const parsed = onboardingProgressPatchSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: parsed.error.issues[0]?.message ?? "Invalid onboarding progress update.",
    });
  }

  const current = await getOnboardingProgress(session, access.workspaceId);
  const mergedSteps = Array.from(
    new Set<OnboardingStepKey>([
      ...current.completedSteps,
      ...(parsed.data.completedSteps ?? []),
      ...(parsed.data.markCompleted ? (["completed"] as OnboardingStepKey[]) : []),
    ]),
  );

  const completedAtIso =
    parsed.data.markCompleted || parsed.data.currentStep === "completed"
      ? (current.completedAtIso ?? new Date().toISOString())
      : current.completedAtIso;

  const updated = await dbQuery<{
    id: string;
    user_id: string;
    organization_id: string;
    workspace_id: string;
    current_step: OnboardingStepKey;
    completed_steps: OnboardingStepKey[];
    draft_project_id: string | null;
    metadata: Record<string, unknown> | null;
    completed_at: Date | null;
    updated_at: Date;
  }>(
    `UPDATE onboarding_progress
     SET current_step = $3,
         completed_steps = $4::text[],
         draft_project_id = COALESCE($5, draft_project_id),
         metadata = metadata || $6::jsonb,
         completed_at = COALESCE($7::timestamptz, completed_at),
         updated_at = now()
     WHERE user_id = $1 AND workspace_id = $2
     RETURNING *`,
    [
      actorUserId,
      access.workspaceId,
      parsed.data.currentStep,
      mergedSteps,
      parsed.data.draftProjectId ?? null,
      JSON.stringify(parsed.data.metadata ?? {}),
      completedAtIso,
    ],
  );

  const row = updated.rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    currentStep: row.current_step,
    completedSteps: row.completed_steps ?? mergedSteps,
    draftProjectId: row.draft_project_id,
    metadata: row.metadata ?? {},
    completedAtIso: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    updatedAtIso: new Date(row.updated_at).toISOString(),
  };
}
