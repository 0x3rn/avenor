import {
  dbQuery,
  generateId,
  listAuditLogsForWorkspace,
  withTransaction,
  writeAuditLog,
} from "@avenor/database";
import {
  AppError,
  type AuditLogEntry,
  ENVIRONMENT_LABELS,
  ENVIRONMENT_TYPES,
  type EnvironmentType,
  ERROR_CODES,
  type LogicalProjectSummary,
  type ProjectEnvironmentSummary,
  type ProjectStatus,
  type WorkspaceRole,
  type WorkspaceSummary,
} from "@avenor/types";
import { z } from "zod";
import { slugifyIdentifier } from "./crypto";
import { authorizeProjectAccess, authorizeWorkspaceAccess } from "./rbac";
import { type AuthenticatedSessionContext, listUserWorkspaces } from "./service";

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug must contain only lowercase letters, numbers, and single hyphens.",
  )
  .min(2, "Slug must be at least 2 characters.")
  .max(60, "Slug cannot exceed 60 characters.");

function normalizeOptionalDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    return parsed.origin;
  } catch {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message:
        "Primary domain must be a valid hostname or URL (for example, https://app.example.com).",
      details: { primaryDomain: ["Enter a valid hostname or URL."] },
    });
  }
}

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2, "Workspace name must be at least 2 characters.").max(80),
  slug: slugSchema.optional(),
  defaultTimezone: z.string().trim().min(2).max(64).default("UTC"),
  defaultCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO code (e.g., USD, EUR, GBP).")
    .default("USD"),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(2, "Workspace name must be at least 2 characters.").max(80),
  slug: slugSchema.optional(),
  defaultTimezone: z.string().trim().min(2).max(64),
  defaultCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO code (e.g., USD, EUR, GBP)."),
  organizationName: z.string().trim().min(2).max(100).optional(),
});

export const createLogicalProjectSchema = z.object({
  name: z.string().trim().min(2, "Project name must be at least 2 characters.").max(100),
  slug: slugSchema.optional(),
  description: z.string().trim().max(400).optional().nullable(),
  primaryDomain: z.string().trim().max(255).optional().nullable(),
  initialEnvironments: z
    .array(z.enum(ENVIRONMENT_TYPES))
    .min(1, "Select at least one environment.")
    .default(["PRODUCTION"]),
});

export const updateLogicalProjectSchema = z.object({
  name: z.string().trim().min(2, "Project name must be at least 2 characters.").max(100).optional(),
  slug: slugSchema.optional(),
  description: z.string().trim().max(400).optional().nullable(),
  primaryDomain: z.string().trim().max(255).optional().nullable(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});

export const createEnvironmentSchema = z.object({
  environmentType: z.enum(ENVIRONMENT_TYPES),
  name: z.string().trim().min(2).max(60).optional(),
  slug: slugSchema.optional(),
  primaryDomain: z.string().trim().max(255).optional().nullable(),
  isDefault: z.boolean().optional().default(false),
});

export const updateEnvironmentSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  primaryDomain: z.string().trim().max(255).optional().nullable(),
  isDefault: z.boolean().optional(),
});

function parseOrThrow<T>(schema: z.ZodType<T>, raw: unknown): T {
  const res = schema.safeParse(raw);
  if (!res.success) {
    const details: Record<string, string[]> = {};
    for (const issue of res.error.issues) {
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
  return res.data;
}

export interface WorkspaceMemberRecord {
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  joinedAt: string;
}

export interface WorkspaceGovernanceDetails {
  workspace: WorkspaceSummary;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  members: WorkspaceMemberRecord[];
  auditLogs: AuditLogEntry[];
}

export async function getWorkspaceGovernanceDetails(
  session: AuthenticatedSessionContext | null,
  workspaceId: string,
): Promise<WorkspaceGovernanceDetails> {
  await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "workspace:read",
  });

  const wsRes = await dbQuery<{
    workspace_id: string;
    workspace_name: string;
    workspace_slug: string;
    default_timezone: string;
    default_currency: string;
    org_id: string;
    org_name: string;
    org_slug: string;
    role: WorkspaceRole;
    project_count: string;
    member_count: string;
  }>(
    `SELECT
       w.id AS workspace_id,
       w.name AS workspace_name,
       w.slug AS workspace_slug,
       w.default_timezone,
       w.default_currency,
       o.id AS org_id,
       o.name AS org_name,
       o.slug AS org_slug,
       wm.role,
       (SELECT COUNT(*)::text FROM logical_projects lp WHERE lp.workspace_id = w.id AND lp.status = 'ACTIVE') AS project_count,
       (SELECT COUNT(*)::text FROM workspace_memberships wm2 WHERE wm2.workspace_id = w.id) AS member_count
     FROM workspaces w
     INNER JOIN organizations o ON o.id = w.organization_id
     INNER JOIN workspace_memberships wm ON wm.workspace_id = w.id AND wm.user_id = $2
     WHERE w.id = $1
     LIMIT 1`,
    [workspaceId, session?.user.id],
  );

  if (wsRes.rows.length === 0) {
    throw new AppError({
      code: ERROR_CODES.NOT_FOUND,
      message: "Workspace not found.",
    });
  }

  const row = wsRes.rows[0];
  const membersRes = await dbQuery<{
    user_id: string;
    name: string;
    email: string;
    role: WorkspaceRole;
    created_at: Date;
  }>(
    `SELECT
       u.id AS user_id,
       u.name,
       u.email,
       wm.role,
       wm.created_at
     FROM workspace_memberships wm
     INNER JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = $1
     ORDER BY wm.created_at ASC`,
    [workspaceId],
  );

  const auditLogs = await listAuditLogsForWorkspace(workspaceId, 20);

  return {
    workspace: {
      id: row.workspace_id,
      organizationId: row.org_id,
      organizationName: row.org_name,
      name: row.workspace_name,
      slug: row.workspace_slug,
      defaultTimezone: row.default_timezone,
      defaultCurrency: row.default_currency,
      role: row.role,
      projectCount: Number(row.project_count),
      memberCount: Number(row.member_count),
    },
    organization: {
      id: row.org_id,
      name: row.org_name,
      slug: row.org_slug,
    },
    members: membersRes.rows.map((m) => ({
      userId: m.user_id,
      name: m.name,
      email: m.email,
      role: m.role,
      joinedAt: new Date(m.created_at).toISOString(),
    })),
    auditLogs,
  };
}

export async function createWorkspaceInOrganization(
  session: AuthenticatedSessionContext | null,
  activeWorkspaceId: string,
  rawInput: unknown,
  options?: { connectionString?: string },
): Promise<WorkspaceSummary> {
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId: activeWorkspaceId,
    requiredPermission: "workspace:update",
  });

  const input = parseOrThrow(createWorkspaceSchema, rawInput);
  const slug = input.slug ?? slugifyIdentifier(input.name, "workspace");

  return withTransaction(
    async (client) => {
      const duplicate = await dbQuery<{ id: string }>(
        `SELECT id FROM workspaces WHERE organization_id = $1 AND slug = $2 LIMIT 1`,
        [access.organizationId, slug],
        client,
      );
      if (duplicate.rows.length > 0) {
        throw new AppError({
          code: ERROR_CODES.CONFLICT,
          message: `A workspace with slug "${slug}" already exists in this organization.`,
          details: { slug: [`Slug "${slug}" is already in use in this organization.`] },
        });
      }

      const workspaceId = generateId("wks");
      await dbQuery(
        `INSERT INTO workspaces (id, organization_id, name, slug, default_timezone, default_currency)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          workspaceId,
          access.organizationId,
          input.name,
          slug,
          input.defaultTimezone,
          input.defaultCurrency,
        ],
        client,
      );

      await dbQuery(
        `INSERT INTO workspace_memberships (id, workspace_id, user_id, role)
         VALUES ($1, $2, $3, 'OWNER')`,
        [generateId("wm"), workspaceId, access.session.user.id],
        client,
      );

      await dbQuery(
        `UPDATE sessions SET active_workspace_id = $1, updated_at = now() WHERE id = $2`,
        [workspaceId, access.session.sessionId],
        client,
      );

      await dbQuery(
        `UPDATE users SET active_workspace_id = $1, updated_at = now() WHERE id = $2`,
        [workspaceId, access.session.user.id],
        client,
      );

      await writeAuditLog(
        {
          organizationId: access.organizationId,
          workspaceId,
          actorUserId: access.session.user.id,
          action: "workspace.created",
          entityType: "Workspace",
          entityId: workspaceId,
          summary: `Created workspace "${input.name}" (${slug}).`,
          metadata: {
            slug,
            defaultTimezone: input.defaultTimezone,
            defaultCurrency: input.defaultCurrency,
          },
        },
        client,
      );

      const orgRes = await dbQuery<{ name: string }>(
        `SELECT name FROM organizations WHERE id = $1 LIMIT 1`,
        [access.organizationId],
        client,
      );

      return {
        id: workspaceId,
        organizationId: access.organizationId,
        organizationName: orgRes.rows[0]?.name ?? access.session.activeWorkspace.organizationName,
        name: input.name,
        slug,
        defaultTimezone: input.defaultTimezone,
        defaultCurrency: input.defaultCurrency,
        role: "OWNER",
        projectCount: 0,
        memberCount: 1,
      };
    },
    { connectionString: options?.connectionString },
  );
}

export async function updateWorkspaceSettings(
  session: AuthenticatedSessionContext | null,
  workspaceId: string,
  rawInput: unknown,
  options?: { connectionString?: string },
): Promise<WorkspaceSummary> {
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "workspace:update",
  });

  const input = parseOrThrow(updateWorkspaceSchema, rawInput);
  const nextSlug = input.slug ?? slugifyIdentifier(input.name, "workspace");

  await withTransaction(
    async (client) => {
      const duplicate = await dbQuery<{ id: string }>(
        `SELECT id FROM workspaces WHERE organization_id = $1 AND slug = $2 AND id <> $3 LIMIT 1`,
        [access.organizationId, nextSlug, workspaceId],
        client,
      );
      if (duplicate.rows.length > 0) {
        throw new AppError({
          code: ERROR_CODES.CONFLICT,
          message: `Another workspace in this organization already uses slug "${nextSlug}".`,
          details: { slug: [`Slug "${nextSlug}" is already taken.`] },
        });
      }

      await dbQuery(
        `UPDATE workspaces
         SET name = $1, slug = $2, default_timezone = $3, default_currency = $4, updated_at = now()
         WHERE id = $5`,
        [input.name, nextSlug, input.defaultTimezone, input.defaultCurrency, workspaceId],
        client,
      );

      if (input.organizationName) {
        await dbQuery(
          `UPDATE organizations SET name = $1, updated_at = now() WHERE id = $2`,
          [input.organizationName, access.organizationId],
          client,
        );
      }

      await writeAuditLog(
        {
          organizationId: access.organizationId,
          workspaceId,
          actorUserId: access.session.user.id,
          action: "workspace.updated",
          entityType: "Workspace",
          entityId: workspaceId,
          summary: `Updated workspace settings for "${input.name}".`,
          metadata: {
            name: input.name,
            slug: nextSlug,
            defaultTimezone: input.defaultTimezone,
            defaultCurrency: input.defaultCurrency,
            ...(input.organizationName ? { organizationName: input.organizationName } : {}),
          },
        },
        client,
      );
    },
    { connectionString: options?.connectionString },
  );

  const workspaces = await listUserWorkspaces(access.session.user.id, options?.connectionString);
  const updated = workspaces.find((w) => w.id === workspaceId);
  if (!updated) {
    throw new AppError({
      code: ERROR_CODES.NOT_FOUND,
      message: "Updated workspace could not be loaded.",
    });
  }
  return updated;
}

async function hydrateProjects(
  projectRows: Array<{
    id: string;
    workspace_id: string;
    name: string;
    slug: string;
    description: string | null;
    primary_domain: string | null;
    status: ProjectStatus;
    mapped_resource_count: string;
    created_at: Date;
    updated_at: Date;
  }>,
): Promise<LogicalProjectSummary[]> {
  if (projectRows.length === 0) {
    return [];
  }

  const projectIds = projectRows.map((p) => p.id);
  const envRes = await dbQuery<{
    id: string;
    project_id: string;
    name: string;
    slug: string;
    environment_type: EnvironmentType;
    primary_domain: string | null;
    is_default: boolean;
    mapped_resource_count: string;
    created_at: Date;
  }>(
    `SELECT
       pe.id,
       pe.project_id,
       pe.name,
       pe.slug,
       pe.environment_type,
       pe.primary_domain,
       pe.is_default,
       (SELECT COUNT(*)::text FROM resource_mappings rm WHERE rm.environment_id = pe.id) AS mapped_resource_count,
       pe.created_at
     FROM project_environments pe
     WHERE pe.project_id = ANY($1::text[])
     ORDER BY pe.is_default DESC, pe.created_at ASC`,
    [projectIds],
  );

  const envsByProject = new Map<string, ProjectEnvironmentSummary[]>();
  for (const e of envRes.rows) {
    const list = envsByProject.get(e.project_id) ?? [];
    list.push({
      id: e.id,
      projectId: e.project_id,
      name: e.name,
      slug: e.slug,
      type: e.environment_type,
      primaryDomain: e.primary_domain,
      isDefault: e.is_default,
      mappedResourceCount: Number(e.mapped_resource_count),
      createdAt: new Date(e.created_at).toISOString(),
    });
    envsByProject.set(e.project_id, list);
  }

  return projectRows.map((p) => ({
    id: p.id,
    workspaceId: p.workspace_id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    primaryDomain: p.primary_domain,
    status: p.status,
    environments: envsByProject.get(p.id) ?? [],
    mappedResourceCount: Number(p.mapped_resource_count),
    createdAt: new Date(p.created_at).toISOString(),
    updatedAt: new Date(p.updated_at).toISOString(),
  }));
}

export async function listWorkspaceProjects(
  session: AuthenticatedSessionContext | null,
  workspaceId: string,
  options?: { includeArchived?: boolean; search?: string },
): Promise<LogicalProjectSummary[]> {
  await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "project:read",
  });

  const params: unknown[] = [workspaceId];
  let whereClause = `WHERE lp.workspace_id = $1`;

  if (!options?.includeArchived) {
    whereClause += ` AND lp.status = 'ACTIVE'`;
  }
  if (options?.search?.trim()) {
    params.push(`%${options.search.trim().toLowerCase()}%`);
    whereClause += ` AND (lower(lp.name) LIKE $${params.length} OR lower(lp.slug) LIKE $${params.length} OR lower(COALESCE(lp.primary_domain, '')) LIKE $${params.length})`;
  }

  const res = await dbQuery<{
    id: string;
    workspace_id: string;
    name: string;
    slug: string;
    description: string | null;
    primary_domain: string | null;
    status: ProjectStatus;
    mapped_resource_count: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT
       lp.id,
       lp.workspace_id,
       lp.name,
       lp.slug,
       lp.description,
       lp.primary_domain,
       lp.status,
       (SELECT COUNT(*)::text FROM resource_mappings rm WHERE rm.project_id = lp.id) AS mapped_resource_count,
       lp.created_at,
       lp.updated_at
     FROM logical_projects lp
     ${whereClause}
     ORDER BY lp.status ASC, lp.created_at DESC`,
    params,
  );

  return hydrateProjects(res.rows);
}

export async function getLogicalProjectById(
  session: AuthenticatedSessionContext | null,
  projectId: string,
  expectedWorkspaceId?: string,
): Promise<LogicalProjectSummary> {
  await authorizeProjectAccess({
    session,
    projectId,
    expectedWorkspaceId,
    requiredPermission: "project:read",
  });

  const res = await dbQuery<{
    id: string;
    workspace_id: string;
    name: string;
    slug: string;
    description: string | null;
    primary_domain: string | null;
    status: ProjectStatus;
    mapped_resource_count: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT
       lp.id,
       lp.workspace_id,
       lp.name,
       lp.slug,
       lp.description,
       lp.primary_domain,
       lp.status,
       (SELECT COUNT(*)::text FROM resource_mappings rm WHERE rm.project_id = lp.id) AS mapped_resource_count,
       lp.created_at,
       lp.updated_at
     FROM logical_projects lp
     WHERE lp.id = $1
     LIMIT 1`,
    [projectId],
  );

  const hydrated = await hydrateProjects(res.rows);
  if (hydrated.length === 0) {
    throw new AppError({
      code: ERROR_CODES.NOT_FOUND,
      message: "Logical project not found.",
    });
  }
  return hydrated[0];
}

export async function createLogicalProject(
  session: AuthenticatedSessionContext | null,
  workspaceId: string,
  rawInput: unknown,
  options?: { connectionString?: string },
): Promise<LogicalProjectSummary> {
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "project:create",
  });

  const input = parseOrThrow(createLogicalProjectSchema, rawInput);
  const slug = input.slug ?? slugifyIdentifier(input.name, "project");
  const primaryDomain = normalizeOptionalDomain(input.primaryDomain);
  const uniqueEnvTypes = Array.from(new Set(input.initialEnvironments));

  const projectId = await withTransaction(
    async (client) => {
      const existingSlug = await dbQuery<{ id: string }>(
        `SELECT id FROM logical_projects WHERE workspace_id = $1 AND slug = $2 LIMIT 1`,
        [workspaceId, slug],
        client,
      );
      if (existingSlug.rows.length > 0) {
        throw new AppError({
          code: ERROR_CODES.CONFLICT,
          message: `A logical project with slug "${slug}" already exists in this workspace.`,
          details: { slug: [`Slug "${slug}" is already used in this workspace.`] },
        });
      }

      const newProjectId = generateId("prj");
      await dbQuery(
        `INSERT INTO logical_projects (
           id, workspace_id, name, slug, description, primary_domain, status, created_by_user_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7)`,
        [
          newProjectId,
          workspaceId,
          input.name,
          slug,
          input.description?.trim() || null,
          primaryDomain,
          access.session.user.id,
        ],
        client,
      );

      const defaultType = uniqueEnvTypes.includes("PRODUCTION") ? "PRODUCTION" : uniqueEnvTypes[0];

      for (const envType of uniqueEnvTypes) {
        const envId = generateId("env");
        const envName = ENVIRONMENT_LABELS[envType];
        const envSlug = envType.toLowerCase();
        const isDefault = envType === defaultType;

        await dbQuery(
          `INSERT INTO project_environments (
             id, project_id, name, slug, environment_type, primary_domain, is_default
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            envId,
            newProjectId,
            envName,
            envSlug,
            envType,
            isDefault ? primaryDomain : null,
            isDefault,
          ],
          client,
        );
      }

      await writeAuditLog(
        {
          organizationId: access.organizationId,
          workspaceId,
          actorUserId: access.session.user.id,
          action: "project.created",
          entityType: "LogicalProject",
          entityId: newProjectId,
          summary: `Created logical project "${input.name}" (${slug}) with environments: ${uniqueEnvTypes.join(", ")}.`,
          metadata: {
            projectSlug: slug,
            primaryDomain,
            environments: uniqueEnvTypes,
          },
        },
        client,
      );

      return newProjectId;
    },
    { connectionString: options?.connectionString },
  );

  return getLogicalProjectById(session, projectId, workspaceId);
}

export async function updateLogicalProject(
  session: AuthenticatedSessionContext | null,
  projectId: string,
  rawInput: unknown,
  options?: { connectionString?: string; expectedWorkspaceId?: string },
): Promise<LogicalProjectSummary> {
  const input = parseOrThrow(updateLogicalProjectSchema, rawInput);
  const requiredPermission = input.status ? "project:archive" : "project:update";

  const access = await authorizeProjectAccess({
    session,
    projectId,
    expectedWorkspaceId: options?.expectedWorkspaceId,
    requiredPermission,
  });

  await withTransaction(
    async (client) => {
      const currentRes = await dbQuery<{
        name: string;
        slug: string;
        description: string | null;
        primary_domain: string | null;
        status: ProjectStatus;
      }>(
        `SELECT name, slug, description, primary_domain, status
         FROM logical_projects
         WHERE id = $1
         LIMIT 1`,
        [projectId],
        client,
      );

      if (currentRes.rows.length === 0) {
        throw new AppError({
          code: ERROR_CODES.NOT_FOUND,
          message: "Logical project not found.",
        });
      }

      const current = currentRes.rows[0];
      const nextName = input.name ?? current.name;
      const nextSlug = input.slug ?? current.slug;
      const nextDescription =
        input.description !== undefined ? input.description?.trim() || null : current.description;
      const nextDomain =
        input.primaryDomain !== undefined
          ? normalizeOptionalDomain(input.primaryDomain)
          : current.primary_domain;
      const nextStatus = input.status ?? current.status;

      if (nextSlug !== current.slug) {
        const dup = await dbQuery<{ id: string }>(
          `SELECT id FROM logical_projects WHERE workspace_id = $1 AND slug = $2 AND id <> $3 LIMIT 1`,
          [access.workspaceId, nextSlug, projectId],
          client,
        );
        if (dup.rows.length > 0) {
          throw new AppError({
            code: ERROR_CODES.CONFLICT,
            message: `Another project in this workspace already uses slug "${nextSlug}".`,
            details: { slug: [`Slug "${nextSlug}" is already in use.`] },
          });
        }
      }

      await dbQuery(
        `UPDATE logical_projects
         SET name = $1,
             slug = $2,
             description = $3,
             primary_domain = $4,
             status = $5,
             archived_at = CASE WHEN $5 = 'ARCHIVED' THEN COALESCE(archived_at, now()) ELSE NULL END,
             updated_at = now()
         WHERE id = $6`,
        [nextName, nextSlug, nextDescription, nextDomain, nextStatus, projectId],
        client,
      );

      const action =
        input.status === "ARCHIVED"
          ? "project.archived"
          : input.status === "ACTIVE" && current.status === "ARCHIVED"
            ? "project.restored"
            : "project.updated";

      await writeAuditLog(
        {
          organizationId: access.organizationId,
          workspaceId: access.workspaceId,
          actorUserId: access.session.user.id,
          action,
          entityType: "LogicalProject",
          entityId: projectId,
          summary: `Updated logical project "${nextName}" (${nextSlug}) [status: ${nextStatus}].`,
          metadata: {
            name: nextName,
            slug: nextSlug,
            primaryDomain: nextDomain,
            status: nextStatus,
          },
        },
        client,
      );
    },
    { connectionString: options?.connectionString },
  );

  return getLogicalProjectById(session, projectId, access.workspaceId);
}

export async function createProjectEnvironment(
  session: AuthenticatedSessionContext | null,
  projectId: string,
  rawInput: unknown,
  options?: { connectionString?: string; expectedWorkspaceId?: string },
): Promise<ProjectEnvironmentSummary> {
  const access = await authorizeProjectAccess({
    session,
    projectId,
    expectedWorkspaceId: options?.expectedWorkspaceId,
    requiredPermission: "environment:create",
  });

  const input = parseOrThrow(createEnvironmentSchema, rawInput);
  const envName = input.name?.trim() || ENVIRONMENT_LABELS[input.environmentType];
  const envSlug = input.slug ?? slugifyIdentifier(envName, input.environmentType.toLowerCase());
  const primaryDomain = normalizeOptionalDomain(input.primaryDomain);

  return withTransaction(
    async (client) => {
      const existing = await dbQuery<{ id: string }>(
        `SELECT id FROM project_environments
         WHERE project_id = $1 AND (environment_type = $2 OR slug = $3)
         LIMIT 1`,
        [projectId, input.environmentType, envSlug],
        client,
      );

      if (existing.rows.length > 0) {
        throw new AppError({
          code: ERROR_CODES.CONFLICT,
          message: `This project already has a ${ENVIRONMENT_LABELS[input.environmentType]} environment or "${envSlug}" slug.`,
          details: {
            environmentType: [
              `Environment ${ENVIRONMENT_LABELS[input.environmentType]} already exists for this project.`,
            ],
          },
        });
      }

      if (input.isDefault) {
        await dbQuery(
          `UPDATE project_environments SET is_default = false, updated_at = now() WHERE project_id = $1`,
          [projectId],
          client,
        );
      }

      const envId = generateId("env");
      const inserted = await dbQuery<{ created_at: Date }>(
        `INSERT INTO project_environments (
           id, project_id, name, slug, environment_type, primary_domain, is_default
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING created_at`,
        [envId, projectId, envName, envSlug, input.environmentType, primaryDomain, input.isDefault],
        client,
      );

      await writeAuditLog(
        {
          organizationId: access.organizationId,
          workspaceId: access.workspaceId,
          actorUserId: access.session.user.id,
          action: "environment.created",
          entityType: "ProjectEnvironment",
          entityId: envId,
          summary: `Added ${envName} (${input.environmentType}) environment to project.`,
          metadata: {
            projectId,
            environmentType: input.environmentType,
            slug: envSlug,
            primaryDomain,
            isDefault: input.isDefault,
          },
        },
        client,
      );

      return {
        id: envId,
        projectId,
        name: envName,
        slug: envSlug,
        type: input.environmentType,
        primaryDomain,
        isDefault: input.isDefault,
        mappedResourceCount: 0,
        createdAt: new Date(inserted.rows[0].created_at).toISOString(),
      };
    },
    { connectionString: options?.connectionString },
  );
}

export async function updateProjectEnvironment(
  session: AuthenticatedSessionContext | null,
  projectId: string,
  environmentId: string,
  rawInput: unknown,
  options?: { connectionString?: string; expectedWorkspaceId?: string },
): Promise<ProjectEnvironmentSummary> {
  const access = await authorizeProjectAccess({
    session,
    projectId,
    expectedWorkspaceId: options?.expectedWorkspaceId,
    requiredPermission: "environment:update",
  });

  const input = parseOrThrow(updateEnvironmentSchema, rawInput);

  return withTransaction(
    async (client) => {
      const currentRes = await dbQuery<{
        id: string;
        name: string;
        slug: string;
        environment_type: EnvironmentType;
        primary_domain: string | null;
        is_default: boolean;
        created_at: Date;
      }>(
        `SELECT id, name, slug, environment_type, primary_domain, is_default, created_at
         FROM project_environments
         WHERE id = $1 AND project_id = $2
         LIMIT 1`,
        [environmentId, projectId],
        client,
      );

      if (currentRes.rows.length === 0) {
        throw new AppError({
          code: ERROR_CODES.NOT_FOUND,
          message: "Project environment not found.",
        });
      }

      const current = currentRes.rows[0];
      const nextName = input.name?.trim() || current.name;
      const nextDomain =
        input.primaryDomain !== undefined
          ? normalizeOptionalDomain(input.primaryDomain)
          : current.primary_domain;
      const nextDefault = input.isDefault ?? current.is_default;

      if (nextDefault && !current.is_default) {
        await dbQuery(
          `UPDATE project_environments SET is_default = false, updated_at = now() WHERE project_id = $1`,
          [projectId],
          client,
        );
      }

      await dbQuery(
        `UPDATE project_environments
         SET name = $1, primary_domain = $2, is_default = $3, updated_at = now()
         WHERE id = $4 AND project_id = $5`,
        [nextName, nextDomain, nextDefault, environmentId, projectId],
        client,
      );

      await writeAuditLog(
        {
          organizationId: access.organizationId,
          workspaceId: access.workspaceId,
          actorUserId: access.session.user.id,
          action: "environment.updated",
          entityType: "ProjectEnvironment",
          entityId: environmentId,
          summary: `Updated environment "${nextName}" (${current.environment_type}).`,
          metadata: {
            projectId,
            environmentId,
            name: nextName,
            primaryDomain: nextDomain,
            isDefault: nextDefault,
          },
        },
        client,
      );

      return {
        id: current.id,
        projectId,
        name: nextName,
        slug: current.slug,
        type: current.environment_type,
        primaryDomain: nextDomain,
        isDefault: nextDefault,
        mappedResourceCount: 0,
        createdAt: new Date(current.created_at).toISOString(),
      };
    },
    { connectionString: options?.connectionString },
  );
}

export async function completeUserOnboarding(
  session: AuthenticatedSessionContext | null,
  workspaceId: string,
  options?: { connectionString?: string },
): Promise<{ completedAt: string }> {
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "workspace:read",
  });

  const nowIso = new Date().toISOString();
  await withTransaction(
    async (client) => {
      await dbQuery(
        `UPDATE users SET onboarding_completed_at = COALESCE(onboarding_completed_at, now()), updated_at = now() WHERE id = $1`,
        [access.session.user.id],
        client,
      );

      await writeAuditLog(
        {
          organizationId: access.organizationId,
          workspaceId: access.workspaceId,
          actorUserId: access.session.user.id,
          action: "onboarding.completed",
          entityType: "User",
          entityId: access.session.user.id,
          summary: `Completed guided Signal Atlas onboarding in workspace "${access.session.activeWorkspace.name}".`,
        },
        client,
      );
    },
    { connectionString: options?.connectionString },
  );

  return { completedAt: nowIso };
}
