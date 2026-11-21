import type { BackendCredentialSafetyVerdict } from "../backend-feasibility";

export const SUPABASE_PROVIDER_KEY = "supabase" as const;
export const SUPABASE_API_BASE_URL = "https://api.supabase.com/v1" as const;

export const SUPABASE_CANONICAL_METRIC_KEYS = {
  DB_SIZE_BYTES: "supabase.db_size_bytes",
  STORAGE_SIZE_BYTES: "supabase.storage_size_bytes",
  ACTIVE_CONNECTIONS: "supabase.active_connections",
  API_REQUESTS: "supabase.api_requests",
  AUTH_REQUESTS: "supabase.auth_requests",
  REGISTERED_AUTH_USERS: "supabase.registered_auth_users",
} as const;

export type SupabaseCanonicalMetricKey =
  (typeof SUPABASE_CANONICAL_METRIC_KEYS)[keyof typeof SUPABASE_CANONICAL_METRIC_KEYS];

export type SupabaseProjectLifecycleStatus =
  | "ACTIVE_HEALTHY"
  | "INACTIVE"
  | "COMING_UP"
  | "RESTORING"
  | "UNKNOWN";

export interface SupabaseSubsystemHealth {
  readonly name: "db" | "auth" | "realtime" | "storage" | "rest";
  readonly healthy: boolean;
  readonly status: string;
}

export interface SupabaseSecurityConfigSummary {
  readonly sslEnforced: boolean;
  readonly networkRestrictionsConfigured: boolean;
  readonly mfaTotpEnabled: boolean;
  readonly emailConfirmationEnabled: boolean;
  readonly rlsVerificationStatus: "NOT_VERIFIED" | "CONFIGURED" | "WARNING";
  readonly rlsQualificationNote: string;
}

export interface SupabaseProjectRecord {
  readonly ref: string;
  readonly name: string;
  readonly organizationId: string;
  readonly region: string;
  readonly status: SupabaseProjectLifecycleStatus;
  readonly databaseVersion: string;
  readonly createdAtIso: string;
  readonly services: readonly SupabaseSubsystemHealth[];
  readonly securityConfig: SupabaseSecurityConfigSummary;
}

export interface SupabaseUsageTelemetryWindow {
  readonly timestampIso: string;
  readonly dbSizeBytes: number;
  readonly storageSizeBytes: number;
  readonly activeConnections: number;
  readonly apiRequests: number;
  readonly authRequests: number;
  readonly registeredAuthUsers: number | null;
  readonly registeredAuthUsersSource:
    | "ALLOWLISTED_AGGREGATE_USAGE_COUNTER"
    | "UNAVAILABLE_WITHOUT_RAW_AUTH_USERS_QUERY";
}

export interface SupabaseProjectDiscoveryBundle {
  readonly projects: readonly SupabaseProjectRecord[];
  readonly credentialSafety: BackendCredentialSafetyVerdict;
}
