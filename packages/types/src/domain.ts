export const WORKSPACE_ROLES = ["OWNER", "ADMIN", "ANALYST", "VIEWER"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const WORKSPACE_PERMISSIONS = [
  "workspace:read",
  "workspace:update",
  "workspace:manage_members",
  "project:read",
  "project:create",
  "project:update",
  "project:archive",
  "environment:read",
  "environment:create",
  "environment:update",
  "connection:read",
  "connection:manage",
  "report:read",
  "report:create",
  "audit:read",
] as const;

export type WorkspacePermission = (typeof WORKSPACE_PERMISSIONS)[number];

export const ROLE_PERMISSION_MATRIX: Record<WorkspaceRole, readonly WorkspacePermission[]> = {
  OWNER: WORKSPACE_PERMISSIONS,
  ADMIN: WORKSPACE_PERMISSIONS,
  ANALYST: [
    "workspace:read",
    "project:read",
    "environment:read",
    "connection:read",
    "report:read",
    "report:create",
    "audit:read",
  ],
  VIEWER: ["workspace:read", "project:read", "environment:read", "connection:read", "report:read"],
};

export function roleHasPermission(role: WorkspaceRole, permission: WorkspacePermission): boolean {
  return ROLE_PERMISSION_MATRIX[role].includes(permission);
}

export const ENVIRONMENT_TYPES = ["PRODUCTION", "STAGING", "DEVELOPMENT"] as const;
export type EnvironmentType = (typeof ENVIRONMENT_TYPES)[number];

export const ENVIRONMENT_LABELS: Record<EnvironmentType, string> = {
  PRODUCTION: "Production",
  STAGING: "Staging",
  DEVELOPMENT: "Development",
};

export const PROJECT_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const CONNECTION_HEALTH_STATUSES = [
  "HEALTHY",
  "SYNCING",
  "STALE",
  "WARNING",
  "FAILED",
  "DISCONNECTED",
] as const;
export type ConnectionHealthStatus = (typeof CONNECTION_HEALTH_STATUSES)[number];

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface WorkspaceSummary {
  id: string;
  organizationId: string;
  organizationName: string;
  name: string;
  slug: string;
  defaultTimezone: string;
  defaultCurrency: string;
  role: WorkspaceRole;
  projectCount: number;
  memberCount: number;
}

export interface ProjectEnvironmentSummary {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  type: EnvironmentType;
  primaryDomain: string | null;
  isDefault: boolean;
  mappedResourceCount: number;
  createdAt: string;
}

export interface LogicalProjectSummary {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description: string | null;
  primaryDomain: string | null;
  status: ProjectStatus;
  environments: ProjectEnvironmentSummary[];
  mappedResourceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  actorUserId: string | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}
