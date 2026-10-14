import { dbQuery } from "@avenor/database";
import {
  AppError,
  ERROR_CODES,
  roleHasPermission,
  type WorkspacePermission,
  type WorkspaceRole,
} from "@avenor/types";
import type { AuthenticatedSessionContext } from "./service";

export interface AuthorizedWorkspaceAccess {
  session: AuthenticatedSessionContext;
  workspaceId: string;
  organizationId: string;
  role: WorkspaceRole;
}

/**
 * Server-side workspace RBAC & tenant isolation guard.
 * Strictly denies:
 * - Unauthenticated callers (401 UNAUTHENTICATED)
 * - Authenticated callers attempting to access a workspace in another tenant/organization (403 FORBIDDEN)
 * - Members whose role lacks the required permission or role level (403 FORBIDDEN)
 */
export async function authorizeWorkspaceAccess(options: {
  session: AuthenticatedSessionContext | null;
  workspaceId: string;
  requiredPermission?: WorkspacePermission;
  allowedRoles?: readonly WorkspaceRole[];
}): Promise<AuthorizedWorkspaceAccess> {
  const { session, workspaceId, requiredPermission, allowedRoles } = options;
  if (!session) {
    throw new AppError({
      code: ERROR_CODES.UNAUTHENTICATED,
      message: "Authentication required to access workspace resources.",
    });
  }

  const membershipRes = await dbQuery<{
    workspace_id: string;
    organization_id: string;
    role: WorkspaceRole;
  }>(
    `SELECT
       wm.workspace_id,
       w.organization_id,
       wm.role
     FROM workspace_memberships wm
     INNER JOIN workspaces w ON w.id = wm.workspace_id
     WHERE wm.workspace_id = $1 AND wm.user_id = $2
     LIMIT 1`,
    [workspaceId, session.user.id],
  );

  if (membershipRes.rows.length === 0) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "Access denied: you do not have membership in the requested workspace.",
    });
  }

  const { organization_id: organizationId, role } = membershipRes.rows[0];

  if (allowedRoles && !allowedRoles.includes(role)) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: `Access denied: workspace role "${role}" is not permitted for this operation.`,
    });
  }

  if (requiredPermission && !roleHasPermission(role, requiredPermission)) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: `Access denied: workspace role "${role}" lacks permission "${requiredPermission}".`,
    });
  }

  return {
    session,
    workspaceId,
    organizationId,
    role,
  };
}

/**
 * Verifies that a logical project exists AND belongs to a workspace where the caller
 * holds the required permission. Cross-tenant project IDs are rejected with 403 FORBIDDEN.
 */
export async function authorizeProjectAccess(options: {
  session: AuthenticatedSessionContext | null;
  projectId: string;
  expectedWorkspaceId?: string;
  requiredPermission?: WorkspacePermission;
}): Promise<AuthorizedWorkspaceAccess & { projectId: string }> {
  const { session, projectId, expectedWorkspaceId, requiredPermission = "project:read" } = options;
  if (!session) {
    throw new AppError({
      code: ERROR_CODES.UNAUTHENTICATED,
      message: "Authentication required to access logical project resources.",
    });
  }

  const projectRes = await dbQuery<{ id: string; workspace_id: string }>(
    `SELECT id, workspace_id FROM logical_projects WHERE id = $1 LIMIT 1`,
    [projectId],
  );

  if (projectRes.rows.length === 0) {
    throw new AppError({
      code: ERROR_CODES.NOT_FOUND,
      message: "Logical project not found.",
    });
  }

  const project = projectRes.rows[0];
  if (expectedWorkspaceId && project.workspace_id !== expectedWorkspaceId) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "Access denied: project does not belong to the active workspace.",
    });
  }

  const workspaceAccess = await authorizeWorkspaceAccess({
    session,
    workspaceId: project.workspace_id,
    requiredPermission,
  });

  return {
    ...workspaceAccess,
    projectId: project.id,
  };
}
