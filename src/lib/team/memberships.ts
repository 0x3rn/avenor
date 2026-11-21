import crypto from "node:crypto";
import { type AuthenticatedSessionContext, authorizeWorkspaceAccess } from "@avenor/auth";
import { dbQuery, generateId, withTransaction } from "@avenor/database";
import { AppError, ERROR_CODES, type WorkspaceRole } from "@avenor/types";
import { z } from "zod";
import { sharedReportCache } from "@/lib/reports/cache";

export interface WorkspaceInvitationRecord {
  id: string;
  organizationId: string;
  workspaceId: string;
  invitedEmail: string;
  role: WorkspaceRole;
  projectIds: string[];
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  invitedByUserId: string | null;
  expiresAtIso: string;
  acceptedAtIso: string | null;
  createdAtIso: string;
}

export interface ProjectAccessGrantRecord {
  id: string;
  workspaceId: string;
  userId: string;
  projectId: string;
  accessLevel: "READ" | "WRITE" | "ADMIN";
  createdAtIso: string;
}

export function normalizeCanonicalEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashInvitationToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken.trim()).digest("hex");
}

/**
 * Pure RBAC guard checking whether an actor with `actorRole` may assign or modify `targetRole`.
 * Only an OWNER can invite/promote someone to OWNER or modify another OWNER.
 */
export function assertRoleAssignmentAllowed(
  actorRole: WorkspaceRole,
  targetRole: WorkspaceRole,
): void {
  if (targetRole === "OWNER" && actorRole !== "OWNER") {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "Only a workspace OWNER can assign or promote the OWNER role.",
    });
  }
  if (actorRole !== "OWNER" && actorRole !== "ADMIN") {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: `Role "${actorRole}" is not authorized to manage workspace memberships or invitations.`,
    });
  }
}

const createInvitationSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  email: z.string().email(),
  role: z.enum(["OWNER", "ADMIN", "ANALYST", "VIEWER"]).default("VIEWER"),
  projectIds: z.array(z.string().min(1)).default([]),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

function mapInvitationRow(row: Record<string, unknown>): WorkspaceInvitationRecord {
  const expiresAt = new Date(String(row.expires_at));
  const rawStatus = String(row.status) as WorkspaceInvitationRecord["status"];
  const effectiveStatus =
    rawStatus === "PENDING" && expiresAt.getTime() < Date.now() ? "EXPIRED" : rawStatus;

  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    workspaceId: String(row.workspace_id),
    invitedEmail: String(row.invited_email),
    role: String(row.role) as WorkspaceRole,
    projectIds: Array.isArray(row.project_ids) ? row.project_ids.map(String) : [],
    status: effectiveStatus,
    invitedByUserId: row.invited_by_user_id ? String(row.invited_by_user_id) : null,
    expiresAtIso: expiresAt.toISOString(),
    acceptedAtIso: row.accepted_at ? new Date(String(row.accepted_at)).toISOString() : null,
    createdAtIso: new Date(String(row.created_at)).toISOString(),
  };
}

/**
 * Creates a hashed workspace invitation token (stored ONLY as SHA-256 hash; plaintext returned once).
 */
export async function createWorkspaceInvitation(
  session: AuthenticatedSessionContext | null,
  rawInput: z.input<typeof createInvitationSchema>,
): Promise<{ invitation: WorkspaceInvitationRecord; rawInviteToken: string }> {
  const parsed = createInvitationSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }
  const input = parsed.data;
  const workspaceId = input.workspaceId ?? session?.activeWorkspace.id ?? "";
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "workspace:manage_members",
  });

  assertRoleAssignmentAllowed(access.role, input.role);

  if (input.projectIds.length > 0) {
    const owned = await dbQuery<{ id: string }>(
      `SELECT id FROM logical_projects WHERE workspace_id = $1 AND id = ANY($2::text[])`,
      [workspaceId, input.projectIds],
    );
    if (owned.rows.length !== new Set(input.projectIds).size) {
      throw new AppError({
        code: ERROR_CODES.FORBIDDEN,
        message: "Cannot grant project access for projects outside this workspace.",
      });
    }
  }

  const rawInviteToken = `avinv_${crypto.randomBytes(24).toString("hex")}`;
  const tokenHash = hashInvitationToken(rawInviteToken);
  const expiresAtIso = new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString();
  const id = generateId("winv");
  const normalizedEmail = normalizeCanonicalEmail(input.email);

  const inserted = await dbQuery<Record<string, unknown>>(
    `INSERT INTO workspace_invitations (
      id, organization_id, workspace_id, invited_email, normalized_email, role,
      project_ids, token_hash, status, invited_by_user_id, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8, 'PENDING', $9, $10)
    RETURNING *`,
    [
      id,
      access.organizationId,
      workspaceId,
      input.email.trim(),
      normalizedEmail,
      input.role,
      Array.from(new Set(input.projectIds)),
      tokenHash,
      session?.user.id ?? null,
      expiresAtIso,
    ],
  );

  return {
    invitation: mapInvitationRow(inserted.rows[0] ?? {}),
    rawInviteToken,
  };
}

/**
 * Atomically redeems an invitation token inside a PostgreSQL transaction (`FOR UPDATE`),
 * verifying email identity match, expiry, pending status, and preventing replay or race conditions.
 */
export async function acceptWorkspaceInvitation(
  session: AuthenticatedSessionContext | null,
  rawInviteToken: string,
): Promise<{
  workspaceId: string;
  organizationId: string;
  role: WorkspaceRole;
  grantedProjectIds: string[];
}> {
  if (!session) {
    throw new AppError({
      code: ERROR_CODES.UNAUTHENTICATED,
      message: "You must be signed in to accept a workspace invitation.",
    });
  }

  const tokenHash = hashInvitationToken(rawInviteToken);
  const callerEmail = normalizeCanonicalEmail(session.user.email);

  return withTransaction(async (client) => {
    const res = await client.query<Record<string, unknown>>(
      `SELECT * FROM workspace_invitations WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash],
    );
    const row = res.rows[0];
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.NOT_FOUND,
        message: "Invitation token is invalid.",
      });
    }

    const status = String(row.status);
    if (status !== "PENDING") {
      throw new AppError({
        code: ERROR_CODES.CONFLICT,
        message: `Invitation cannot be accepted (current status: ${status}).`,
      });
    }

    const expiresAt = new Date(String(row.expires_at));
    if (expiresAt.getTime() < Date.now()) {
      await client.query(`UPDATE workspace_invitations SET status = 'EXPIRED' WHERE id = $1`, [
        String(row.id),
      ]);
      throw new AppError({
        code: ERROR_CODES.FORBIDDEN,
        message: "Invitation token has expired.",
      });
    }

    if (String(row.normalized_email) !== callerEmail) {
      throw new AppError({
        code: ERROR_CODES.FORBIDDEN,
        message:
          "This invitation was issued to a different email address and cannot be redeemed by your account.",
      });
    }

    const orgId = String(row.organization_id);
    const wsId = String(row.workspace_id);
    const role = String(row.role) as WorkspaceRole;
    const projectIds = Array.isArray(row.project_ids) ? row.project_ids.map(String) : [];

    await client.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, user_id) DO NOTHING`,
      [generateId("omem"), orgId, session.user.id, role],
    );

    await client.query(
      `INSERT INTO workspace_memberships (id, workspace_id, user_id, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [generateId("wmem"), wsId, session.user.id, role],
    );

    for (const projectId of projectIds) {
      const accessLevel =
        role === "OWNER" || role === "ADMIN" ? "ADMIN" : role === "ANALYST" ? "WRITE" : "READ";
      await client.query(
        `INSERT INTO project_access_grants (id, organization_id, workspace_id, user_id, project_id, access_level, granted_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (workspace_id, user_id, project_id) DO UPDATE SET access_level = EXCLUDED.access_level`,
        [
          generateId("pgrt"),
          orgId,
          wsId,
          session.user.id,
          projectId,
          accessLevel,
          row.invited_by_user_id ? String(row.invited_by_user_id) : null,
        ],
      );
    }

    await client.query(
      `UPDATE workspace_invitations
       SET status = 'ACCEPTED', accepted_by_user_id = $1, accepted_at = now()
       WHERE id = $2`,
      [session.user.id, String(row.id)],
    );

    return {
      workspaceId: wsId,
      organizationId: orgId,
      role,
      grantedProjectIds: projectIds,
    };
  });
}

export async function revokeWorkspaceInvitation(
  session: AuthenticatedSessionContext | null,
  invitationId: string,
): Promise<{ revoked: true; invitationId: string }> {
  const found = await dbQuery<{ workspace_id: string }>(
    `SELECT workspace_id FROM workspace_invitations WHERE id = $1`,
    [invitationId],
  );
  const row = found.rows[0];
  if (!row) {
    throw new AppError({ code: ERROR_CODES.NOT_FOUND, message: "Invitation not found." });
  }
  await authorizeWorkspaceAccess({
    session,
    workspaceId: row.workspace_id,
    requiredPermission: "workspace:manage_members",
  });

  await dbQuery(
    `UPDATE workspace_invitations SET status = 'REVOKED', revoked_at = now() WHERE id = $1 AND status = 'PENDING'`,
    [invitationId],
  );
  return { revoked: true, invitationId };
}

export async function listWorkspaceInvitations(
  session: AuthenticatedSessionContext | null,
  workspaceId?: string,
): Promise<WorkspaceInvitationRecord[]> {
  const targetWs = workspaceId ?? session?.activeWorkspace.id ?? "";
  await authorizeWorkspaceAccess({
    session,
    workspaceId: targetWs,
    requiredPermission: "workspace:read",
  });
  const res = await dbQuery<Record<string, unknown>>(
    `SELECT * FROM workspace_invitations WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [targetWs],
  );
  return res.rows.map(mapInvitationRow);
}

/**
 * Updates a workspace member's role with strict Last-Owner Protection so a workspace
 * can never be left without an OWNER.
 */
export async function updateWorkspaceMemberRole(
  session: AuthenticatedSessionContext | null,
  input: { workspaceId?: string; targetUserId: string; newRole: WorkspaceRole },
): Promise<{ workspaceId: string; userId: string; role: WorkspaceRole }> {
  const workspaceId = input.workspaceId ?? session?.activeWorkspace.id ?? "";
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "workspace:manage_members",
  });
  assertRoleAssignmentAllowed(access.role, input.newRole);

  return withTransaction(async (client) => {
    const memberRes = await client.query<{ role: string }>(
      `SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE`,
      [workspaceId, input.targetUserId],
    );
    const current = memberRes.rows[0];
    if (!current) {
      throw new AppError({ code: ERROR_CODES.NOT_FOUND, message: "Workspace member not found." });
    }
    if (current.role === "OWNER" && access.role !== "OWNER") {
      throw new AppError({
        code: ERROR_CODES.FORBIDDEN,
        message: "Only an OWNER can change another OWNER's role.",
      });
    }
    if (current.role === "OWNER" && input.newRole !== "OWNER") {
      const ownersRes = await client.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM workspace_memberships WHERE workspace_id = $1 AND role = 'OWNER'`,
        [workspaceId],
      );
      if (Number(ownersRes.rows[0]?.cnt ?? 0) <= 1) {
        throw new AppError({
          code: ERROR_CODES.CONFLICT,
          message:
            "Cannot demote the sole remaining OWNER of a workspace. Transfer ownership first.",
        });
      }
    }

    await client.query(
      `UPDATE workspace_memberships SET role = $1 WHERE workspace_id = $2 AND user_id = $3`,
      [input.newRole, workspaceId, input.targetUserId],
    );
    sharedReportCache.invalidateWorkspace(access.organizationId, workspaceId);
    return { workspaceId, userId: input.targetUserId, role: input.newRole };
  });
}

/**
 * Removes a workspace member with strict Last-Owner Protection and immediate cache invalidation.
 */
export async function removeWorkspaceMember(
  session: AuthenticatedSessionContext | null,
  input: { workspaceId?: string; targetUserId: string },
): Promise<{ removed: true; workspaceId: string; userId: string }> {
  const workspaceId = input.workspaceId ?? session?.activeWorkspace.id ?? "";
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "workspace:manage_members",
  });

  return withTransaction(async (client) => {
    const memberRes = await client.query<{ role: string }>(
      `SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE`,
      [workspaceId, input.targetUserId],
    );
    const current = memberRes.rows[0];
    if (!current) {
      throw new AppError({ code: ERROR_CODES.NOT_FOUND, message: "Workspace member not found." });
    }
    if (current.role === "OWNER") {
      if (access.role !== "OWNER") {
        throw new AppError({
          code: ERROR_CODES.FORBIDDEN,
          message: "Only an OWNER can remove an OWNER.",
        });
      }
      const ownersRes = await client.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM workspace_memberships WHERE workspace_id = $1 AND role = 'OWNER'`,
        [workspaceId],
      );
      if (Number(ownersRes.rows[0]?.cnt ?? 0) <= 1) {
        throw new AppError({
          code: ERROR_CODES.CONFLICT,
          message: "Cannot remove the sole remaining OWNER of a workspace.",
        });
      }
    }

    await client.query(
      `DELETE FROM project_access_grants WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, input.targetUserId],
    );
    await client.query(
      `DELETE FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, input.targetUserId],
    );
    sharedReportCache.invalidateWorkspace(access.organizationId, workspaceId);
    return { removed: true, workspaceId, userId: input.targetUserId };
  });
}

export async function listProjectAccessGrants(
  session: AuthenticatedSessionContext | null,
  workspaceId?: string,
): Promise<ProjectAccessGrantRecord[]> {
  const targetWs = workspaceId ?? session?.activeWorkspace.id ?? "";
  await authorizeWorkspaceAccess({
    session,
    workspaceId: targetWs,
    requiredPermission: "workspace:read",
  });
  const res = await dbQuery<Record<string, unknown>>(
    `SELECT * FROM project_access_grants WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [targetWs],
  );
  return res.rows.map((r) => ({
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    userId: String(r.user_id),
    projectId: String(r.project_id),
    accessLevel: String(r.access_level) as "READ" | "WRITE" | "ADMIN",
    createdAtIso: new Date(String(r.created_at)).toISOString(),
  }));
}
