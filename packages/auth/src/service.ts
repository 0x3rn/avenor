import crypto from "node:crypto";
import { dbQuery, generateId, withTransaction, writeAuditLog } from "@avenor/database";
import { AppError, ERROR_CODES, type WorkspaceRole, type WorkspaceSummary } from "@avenor/types";
import { z } from "zod";
import {
  generateSignedSessionToken,
  hashPassword,
  hashSessionToken,
  slugifyIdentifier,
  verifyPassword,
  verifySignedSessionTokenFormat,
} from "./crypto";

export const SESSION_COOKIE_NAME = "avenor_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export const registerUserInputSchema = z.object({
  name: z.string().trim().min(2, "Full name must be at least 2 characters.").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters long.")
    .max(128, "Password cannot exceed 128 characters."),
  organizationName: z.string().trim().min(2).max(100).optional(),
  workspaceName: z.string().trim().min(2).max(100).optional(),
});

export type RegisterUserInput = z.infer<typeof registerUserInputSchema>;

export const signInInputSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

export type SignInInput = z.infer<typeof signInInputSchema>;

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  activeWorkspaceId: string | null;
  onboardingCompletedAt: string | null;
}

export interface AuthenticatedSessionContext {
  sessionId: string;
  user: AuthenticatedUser;
  activeOrganizationId: string;
  activeWorkspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  expiresAt: string;
}

export interface AuthProvisionResult {
  rawSessionToken: string;
  verificationToken: string;
  context: AuthenticatedSessionContext;
}

function parseZodOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const details: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "input";
      details[key] = details[key] ?? [];
      details[key].push(issue.message);
    }
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: Object.values(details).flat().join(" "),
      details,
    });
  }
  return parsed.data;
}

export async function listUserWorkspaces(
  userId: string,
  connectionString?: string,
): Promise<WorkspaceSummary[]> {
  const pool = connectionString ? undefined : undefined;
  const res = await dbQuery<{
    workspace_id: string;
    organization_id: string;
    organization_name: string;
    workspace_name: string;
    workspace_slug: string;
    default_timezone: string;
    default_currency: string;
    role: WorkspaceRole;
    project_count: string;
    member_count: string;
  }>(
    `SELECT
       w.id AS workspace_id,
       w.organization_id,
       o.name AS organization_name,
       w.name AS workspace_name,
       w.slug AS workspace_slug,
       w.default_timezone,
       w.default_currency,
       wm.role,
       (SELECT COUNT(*)::text FROM logical_projects lp WHERE lp.workspace_id = w.id AND lp.status = 'ACTIVE') AS project_count,
       (SELECT COUNT(*)::text FROM workspace_memberships wm2 WHERE wm2.workspace_id = w.id) AS member_count
     FROM workspace_memberships wm
     INNER JOIN workspaces w ON w.id = wm.workspace_id
     INNER JOIN organizations o ON o.id = w.organization_id
     WHERE wm.user_id = $1
     ORDER BY w.created_at ASC`,
    [userId],
    pool,
  );

  return res.rows.map((r) => ({
    id: r.workspace_id,
    organizationId: r.organization_id,
    organizationName: r.organization_name,
    name: r.workspace_name,
    slug: r.workspace_slug,
    defaultTimezone: r.default_timezone,
    defaultCurrency: r.default_currency,
    role: r.role,
    projectCount: Number(r.project_count),
    memberCount: Number(r.member_count),
  }));
}

/**
 * Registers a new user and atomically provisions their default Organization,
 * OrganizationMembership (OWNER), Workspace, WorkspaceMembership (OWNER),
 * Session, Email Verification token, and AuditLog records inside a single PostgreSQL transaction.
 */
export async function registerUserWithDefaultOwnership(
  rawInput: unknown,
  options?: {
    connectionString?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    expiresInSeconds?: number;
  },
): Promise<AuthProvisionResult> {
  const input = parseZodOrThrow(registerUserInputSchema, rawInput);
  const expiresInSeconds = options?.expiresInSeconds ?? SESSION_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
  const { rawToken, tokenHash } = generateSignedSessionToken();
  const rawVerificationToken = `ver_${crypto.randomBytes(20).toString("hex")}`;
  const verificationHash = hashSessionToken(rawVerificationToken);

  const provisioned = await withTransaction(
    async (client) => {
      const existing = await dbQuery<{ id: string }>(
        `SELECT id FROM users WHERE email = $1 LIMIT 1`,
        [input.email],
        client,
      );
      if (existing.rows.length > 0) {
        throw new AppError({
          code: ERROR_CODES.CONFLICT,
          message: "An account with this email address already exists.",
          details: { email: ["An account with this email address already exists."] },
        });
      }

      const userId = generateId("usr");
      const accountId = generateId("acc");
      const orgId = generateId("org");
      const workspaceId = generateId("wks");
      const sessionId = generateId("ses");

      const orgName = input.organizationName?.trim() || `${input.name}'s Organization`;
      const orgSlugSuffix = crypto.randomBytes(3).toString("hex");
      const orgSlug = `${slugifyIdentifier(orgName, "org")}-${orgSlugSuffix}`;

      const workspaceName = input.workspaceName?.trim() || "Primary Workspace";
      const workspaceSlug = slugifyIdentifier(workspaceName, "primary-workspace");

      await dbQuery(
        `INSERT INTO users (id, email, name, email_verified, active_workspace_id)
         VALUES ($1, $2, $3, false, $4)`,
        [userId, input.email, input.name, workspaceId],
        client,
      );

      await dbQuery(
        `INSERT INTO accounts (id, user_id, account_id, provider_id, password_hash)
         VALUES ($1, $2, $3, 'credential', $4)`,
        [accountId, userId, userId, hashPassword(input.password)],
        client,
      );

      await dbQuery(
        `INSERT INTO organizations (id, name, slug, created_by_user_id)
         VALUES ($1, $2, $3, $4)`,
        [orgId, orgName, orgSlug, userId],
        client,
      );

      await dbQuery(
        `INSERT INTO organization_memberships (id, organization_id, user_id, role)
         VALUES ($1, $2, $3, 'OWNER')`,
        [generateId("om"), orgId, userId],
        client,
      );

      await dbQuery(
        `INSERT INTO workspaces (id, organization_id, name, slug, default_timezone, default_currency)
         VALUES ($1, $2, $3, $4, 'UTC', 'USD')`,
        [workspaceId, orgId, workspaceName, workspaceSlug],
        client,
      );

      await dbQuery(
        `INSERT INTO workspace_memberships (id, workspace_id, user_id, role)
         VALUES ($1, $2, $3, 'OWNER')`,
        [generateId("wm"), workspaceId, userId],
        client,
      );

      await dbQuery(
        `INSERT INTO sessions (
           id, user_id, token_hash, active_organization_id, active_workspace_id, ip_address, user_agent, expires_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          sessionId,
          userId,
          tokenHash,
          orgId,
          workspaceId,
          options?.ipAddress ?? null,
          options?.userAgent ?? null,
          expiresAt,
        ],
        client,
      );

      await dbQuery(
        `INSERT INTO verifications (id, identifier, value_hash, purpose, expires_at)
         VALUES ($1, $2, $3, 'EMAIL_VERIFICATION', now() + interval '24 hours')`,
        [generateId("ver"), input.email, verificationHash],
        client,
      );

      await writeAuditLog(
        {
          organizationId: orgId,
          workspaceId,
          actorUserId: userId,
          action: "auth.signup.provisioned",
          entityType: "Workspace",
          entityId: workspaceId,
          summary: `Registered ${input.email} and provisioned default organization "${orgName}" and workspace "${workspaceName}".`,
          metadata: {
            organizationId: orgId,
            organizationSlug: orgSlug,
            workspaceId,
            workspaceSlug,
            role: "OWNER",
          },
          ipAddress: options?.ipAddress ?? null,
          userAgent: options?.userAgent ?? null,
        },
        client,
      );

      const workspaceSummary: WorkspaceSummary = {
        id: workspaceId,
        organizationId: orgId,
        organizationName: orgName,
        name: workspaceName,
        slug: workspaceSlug,
        defaultTimezone: "UTC",
        defaultCurrency: "USD",
        role: "OWNER",
        projectCount: 0,
        memberCount: 1,
      };

      const context: AuthenticatedSessionContext = {
        sessionId,
        user: {
          id: userId,
          email: input.email,
          name: input.name,
          emailVerified: false,
          activeWorkspaceId: workspaceId,
          onboardingCompletedAt: null,
        },
        activeOrganizationId: orgId,
        activeWorkspace: workspaceSummary,
        workspaces: [workspaceSummary],
        expiresAt: expiresAt.toISOString(),
      };

      return context;
    },
    { connectionString: options?.connectionString },
  );

  return {
    rawSessionToken: rawToken,
    verificationToken: rawVerificationToken,
    context: provisioned,
  };
}

export async function authenticateUser(
  rawInput: unknown,
  options?: {
    connectionString?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    expiresInSeconds?: number;
  },
): Promise<{ rawSessionToken: string; context: AuthenticatedSessionContext }> {
  const input = parseZodOrThrow(signInInputSchema, rawInput);
  const expiresInSeconds = options?.expiresInSeconds ?? SESSION_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

  const userRes = await dbQuery<{
    id: string;
    email: string;
    name: string;
    email_verified: boolean;
    active_workspace_id: string | null;
    onboarding_completed_at: Date | null;
    password_hash: string | null;
  }>(
    `SELECT
       u.id,
       u.email,
       u.name,
       u.email_verified,
       u.active_workspace_id,
       u.onboarding_completed_at,
       a.password_hash
     FROM users u
     INNER JOIN accounts a ON a.user_id = u.id AND a.provider_id = 'credential'
     WHERE u.email = $1
     LIMIT 1`,
    [input.email],
  );

  if (userRes.rows.length === 0 || !verifyPassword(input.password, userRes.rows[0].password_hash)) {
    throw new AppError({
      code: ERROR_CODES.UNAUTHENTICATED,
      message: "Invalid email address or password.",
    });
  }

  const userRow = userRes.rows[0];
  const workspaces = await listUserWorkspaces(userRow.id, options?.connectionString);
  if (workspaces.length === 0) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "Your account does not belong to any active workspace.",
    });
  }

  const activeWorkspace =
    workspaces.find((w) => w.id === userRow.active_workspace_id) ?? workspaces[0];
  const { rawToken, tokenHash } = generateSignedSessionToken();
  const sessionId = generateId("ses");

  await withTransaction(
    async (client) => {
      await dbQuery(
        `INSERT INTO sessions (
           id, user_id, token_hash, active_organization_id, active_workspace_id, ip_address, user_agent, expires_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          sessionId,
          userRow.id,
          tokenHash,
          activeWorkspace.organizationId,
          activeWorkspace.id,
          options?.ipAddress ?? null,
          options?.userAgent ?? null,
          expiresAt,
        ],
        client,
      );

      await writeAuditLog(
        {
          organizationId: activeWorkspace.organizationId,
          workspaceId: activeWorkspace.id,
          actorUserId: userRow.id,
          action: "auth.session.created",
          entityType: "Session",
          entityId: sessionId,
          summary: `User ${userRow.email} signed in to workspace "${activeWorkspace.name}".`,
          ipAddress: options?.ipAddress ?? null,
          userAgent: options?.userAgent ?? null,
        },
        client,
      );
    },
    { connectionString: options?.connectionString },
  );

  return {
    rawSessionToken: rawToken,
    context: {
      sessionId,
      user: {
        id: userRow.id,
        email: userRow.email,
        name: userRow.name,
        emailVerified: userRow.email_verified,
        activeWorkspaceId: activeWorkspace.id,
        onboardingCompletedAt: userRow.onboarding_completed_at
          ? new Date(userRow.onboarding_completed_at).toISOString()
          : null,
      },
      activeOrganizationId: activeWorkspace.organizationId,
      activeWorkspace,
      workspaces,
      expiresAt: expiresAt.toISOString(),
    },
  };
}

export async function resolveSessionByToken(
  rawToken: string | null | undefined,
  options?: { connectionString?: string },
): Promise<AuthenticatedSessionContext | null> {
  if (!rawToken || !verifySignedSessionTokenFormat(rawToken)) {
    return null;
  }

  const tokenHash = hashSessionToken(rawToken);
  const res = await dbQuery<{
    session_id: string;
    user_id: string;
    email: string;
    name: string;
    email_verified: boolean;
    user_active_workspace_id: string | null;
    onboarding_completed_at: Date | null;
    session_active_workspace_id: string | null;
    expires_at: Date;
    revoked_at: Date | null;
  }>(
    `SELECT
       s.id AS session_id,
       s.user_id,
       u.email,
       u.name,
       u.email_verified,
       u.active_workspace_id AS user_active_workspace_id,
       u.onboarding_completed_at,
       s.active_workspace_id AS session_active_workspace_id,
       s.expires_at,
       s.revoked_at
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1
     LIMIT 1`,
    [tokenHash],
  );

  if (res.rows.length === 0) {
    return null;
  }

  const row = res.rows[0];
  if (row.revoked_at !== null || new Date(row.expires_at).getTime() <= Date.now()) {
    return null;
  }

  const workspaces = await listUserWorkspaces(row.user_id, options?.connectionString);
  if (workspaces.length === 0) {
    return null;
  }

  const preferredWorkspaceId = row.session_active_workspace_id ?? row.user_active_workspace_id;
  const activeWorkspace = workspaces.find((w) => w.id === preferredWorkspaceId) ?? workspaces[0];

  return {
    sessionId: row.session_id,
    user: {
      id: row.user_id,
      email: row.email,
      name: row.name,
      emailVerified: row.email_verified,
      activeWorkspaceId: activeWorkspace.id,
      onboardingCompletedAt: row.onboarding_completed_at
        ? new Date(row.onboarding_completed_at).toISOString()
        : null,
    },
    activeOrganizationId: activeWorkspace.organizationId,
    activeWorkspace,
    workspaces,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

export async function revokeSessionByToken(
  rawToken: string | null | undefined,
  _options?: { connectionString?: string },
): Promise<boolean> {
  if (!rawToken || !verifySignedSessionTokenFormat(rawToken)) {
    return false;
  }
  const tokenHash = hashSessionToken(rawToken);

  const sessionRes = await dbQuery<{
    id: string;
    user_id: string;
    active_organization_id: string | null;
    active_workspace_id: string | null;
  }>(
    `UPDATE sessions
     SET revoked_at = now(), updated_at = now()
     WHERE token_hash = $1 AND revoked_at IS NULL
     RETURNING id, user_id, active_organization_id, active_workspace_id`,
    [tokenHash],
  );

  if (sessionRes.rows.length === 0) {
    return false;
  }

  const row = sessionRes.rows[0];
  if (row.active_organization_id) {
    await writeAuditLog({
      organizationId: row.active_organization_id,
      workspaceId: row.active_workspace_id,
      actorUserId: row.user_id,
      action: "auth.session.revoked",
      entityType: "Session",
      entityId: row.id,
      summary: "User signed out and invalidated active session.",
    });
  }

  return true;
}

export async function switchSessionActiveWorkspace(
  session: AuthenticatedSessionContext,
  targetWorkspaceId: string,
  options?: { connectionString?: string },
): Promise<WorkspaceSummary> {
  const target = session.workspaces.find((w) => w.id === targetWorkspaceId);
  if (!target) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "Access denied: you are not a member of the requested workspace.",
    });
  }

  await withTransaction(
    async (client) => {
      await dbQuery(
        `UPDATE sessions
         SET active_workspace_id = $1, active_organization_id = $2, updated_at = now()
         WHERE id = $3`,
        [target.id, target.organizationId, session.sessionId],
        client,
      );
      await dbQuery(
        `UPDATE users
         SET active_workspace_id = $1, updated_at = now()
         WHERE id = $2`,
        [target.id, session.user.id],
        client,
      );
    },
    { connectionString: options?.connectionString },
  );

  return target;
}

export async function verifyEmailToken(
  email: string,
  rawVerificationToken: string,
): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();
  const valueHash = hashSessionToken(rawVerificationToken.trim());

  const res = await dbQuery<{ id: string }>(
    `UPDATE verifications
     SET consumed_at = now()
     WHERE identifier = $1
       AND value_hash = $2
       AND purpose = 'EMAIL_VERIFICATION'
       AND consumed_at IS NULL
       AND expires_at > now()
     RETURNING id`,
    [normalizedEmail, valueHash],
  );

  if (res.rows.length === 0) {
    return false;
  }

  await dbQuery(`UPDATE users SET email_verified = true, updated_at = now() WHERE email = $1`, [
    normalizedEmail,
  ]);
  return true;
}

export async function createPasswordResetRequest(email: string): Promise<{ requested: boolean }> {
  const normalizedEmail = email.trim().toLowerCase();
  const userRes = await dbQuery<{ id: string }>(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [
    normalizedEmail,
  ]);

  if (userRes.rows.length > 0) {
    const rawToken = `rst_${crypto.randomBytes(20).toString("hex")}`;
    await dbQuery(
      `INSERT INTO verifications (id, identifier, value_hash, purpose, expires_at)
       VALUES ($1, $2, $3, 'PASSWORD_RESET', now() + interval '1 hour')`,
      [generateId("ver"), normalizedEmail, hashSessionToken(rawToken)],
    );
  }

  return { requested: true };
}
