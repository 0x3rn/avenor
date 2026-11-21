import { AppError, ERROR_CODES } from "@avenor/types";

export const BACKEND_FEASIBILITY_STATUSES = [
  "SUPPORTED",
  "SUPPORTED_WITH_LIMITATIONS",
  "REQUIRES_CUSTOMER_SETUP",
  "PLAN_GATED",
  "PERMISSION_DENIED",
  "UNAVAILABLE",
  "NOT_VERIFIED",
  "UNSAFE",
] as const;

export type BackendFeasibilityStatus = (typeof BACKEND_FEASIBILITY_STATUSES)[number];

export const BACKEND_PROVIDER_KEYS = ["neon", "supabase", "firebase-monitoring"] as const;
export type BackendProviderKey = (typeof BACKEND_PROVIDER_KEYS)[number];

export const BACKEND_CAPABILITY_DIMENSIONS = [
  "auth_mechanism",
  "least_privilege_readonly",
  "resource_discovery",
  "db_storage_metrics",
  "compute_connection_metrics",
  "request_throughput_metrics",
  "user_count_auth_posture",
  "security_config_posture",
  "audit_log_posture",
  "granularity_retention",
  "freshness_latency",
  "rate_limits_quotas",
  "plan_tier_restrictions",
  "prohibited_high_risk_surfaces",
  "recommended_pilot_suitability",
] as const;

export type BackendCapabilityDimensionKey = (typeof BACKEND_CAPABILITY_DIMENSIONS)[number];

export interface BackendDimensionEvaluation {
  readonly providerKey: BackendProviderKey;
  readonly dimensionKey: BackendCapabilityDimensionKey;
  readonly dimensionLabel: string;
  readonly status: BackendFeasibilityStatus;
  readonly allowsNumericMetric: boolean;
  readonly summary: string;
  readonly apiSurfaceOrEndpoint: string;
  readonly requiredScopeOrTokenType: string;
  readonly unitAndSemanticNotes: string;
  readonly securityGuardrail: string;
}

export interface BackendCredentialSafetyInput {
  readonly providerKey: BackendProviderKey;
  readonly credentialType:
    | "oauth2_access_token"
    | "neon_org_api_key"
    | "neon_personal_api_key"
    | "neon_project_scoped_api_key"
    | "supabase_oauth_token"
    | "supabase_pat"
    | "supabase_service_role_key"
    | "supabase_secret_key"
    | "firebase_admin_sdk_key"
    | "postgres_connection_string";
  readonly rawTokenPreview?: string;
  readonly grantedScopes?: readonly string[];
  readonly methodAllowlistEnforced?: boolean;
}

export interface BackendCredentialSafetyVerdict {
  readonly providerKey: BackendProviderKey;
  readonly accepted: boolean;
  readonly status: BackendFeasibilityStatus;
  readonly intrinsicProviderReadOnly: boolean;
  readonly requiresAdapterMethodAllowlist: boolean;
  readonly rejectionCode: string | null;
  readonly reason: string;
  readonly prohibitedCapabilitiesBlocked: readonly string[];
}

export interface BackendPilotCandidateScore {
  readonly providerKey: BackendProviderKey;
  readonly displayName: string;
  readonly cryptographicReadOnlyScore: number; // 0-100
  readonly metricRichnessScore: number; // 0-100
  readonly zeroDataPlaneIsolationScore: number; // 0-100
  readonly weightedTotalScore: number;
  readonly roleInMilestone06:
    | "PRIMARY_CRYPTOGRAPHIC_PILOT"
    | "SERVERLESS_POSTGRES_CONSUMPTION"
    | "BAAS_CONTROL_PLANE_POSTURE";
  readonly rationale: string;
}

export interface BackendPilotAdr {
  readonly adrId: string;
  readonly title: string;
  readonly status: "ACCEPTED";
  readonly decidedAtIso: string;
  readonly primaryPilotProviderKey: BackendProviderKey;
  readonly candidates: readonly BackendPilotCandidateScore[];
  readonly keyArchitecturalRules: readonly string[];
}

export const BACKEND_FEASIBILITY_MATRIX: readonly BackendDimensionEvaluation[] = [
  // ============================================================================
  // 1. NEON SERVERLESS POSTGRES (Control Plane REST API v2)
  // ============================================================================
  {
    providerKey: "neon",
    dimensionKey: "auth_mechanism",
    dimensionLabel: "Authentication Mechanism",
    status: "SUPPORTED_WITH_LIMITATIONS",
    allowsNumericMetric: false,
    summary:
      "Neon REST API v2 uses Bearer API keys (Personal, Organization, or Project-scoped). Project-scoped keys limit blast radius to one project but are not intrinsically read-only at Neon's API gateway.",
    apiSurfaceOrEndpoint: "https://console.neon.tech/api/v2/*",
    requiredScopeOrTokenType: "Bearer napi_* (Project-scoped or Organization API key)",
    unitAndSemanticNotes: "Control-plane token only; never a Postgres wire-protocol credential.",
    securityGuardrail:
      "Avenor enforces a strict GET-only HTTP client allowlist and path regex so no POST/PATCH/DELETE request can ever be emitted using a Neon API key.",
  },
  {
    providerKey: "neon",
    dimensionKey: "least_privilege_readonly",
    dimensionLabel: "Least-Privilege Read-Only Enforcement",
    status: "SUPPORTED_WITH_LIMITATIONS",
    allowsNumericMetric: false,
    summary:
      "Because Neon API v2 keys carry project/org management capability upstream, read-only posture is enforced by Avenor's adapter contract (GET-only HTTP verb lock + allowlisted discovery/consumption paths) and audited on every call.",
    apiSurfaceOrEndpoint:
      "GET /projects, GET /projects/{project_id}/branches, GET /consumption_history/*",
    requiredScopeOrTokenType:
      "neon.projects.readonly + neon.consumption.readonly (adapter-enforced)",
    unitAndSemanticNotes:
      "Project-scoped API keys are marked NOT_INTRINSICALLY_READ_ONLY in metadata unless verified.",
    securityGuardrail:
      "Any non-GET verb or unallowlisted path (such as /connection_uri or /roles) throws ProviderAdapterError(PERMISSION_DENIED) before network dispatch.",
  },
  {
    providerKey: "neon",
    dimensionKey: "resource_discovery",
    dimensionLabel: "Resource Discovery Endpoints",
    status: "SUPPORTED",
    allowsNumericMetric: false,
    summary:
      "Discovers Neon projects, branches (default/protected/preview), metadata-only database listings, and compute endpoints with autoscaling min/max CU bounds.",
    apiSurfaceOrEndpoint:
      "GET /api/v2/projects/{project_id}, GET /api/v2/projects/{project_id}/branches, GET /api/v2/projects/{project_id}/endpoints",
    requiredScopeOrTokenType: "neon.projects.readonly",
    unitAndSemanticNotes:
      "Captures region_id, pg_version, branch logical_size, and compute CU range.",
    securityGuardrail: "Never calls GET /connection_uri or password reveal endpoints.",
  },
  {
    providerKey: "neon",
    dimensionKey: "db_storage_metrics",
    dimensionLabel: "Database Size & Storage Metrics",
    status: "SUPPORTED",
    allowsNumericMetric: true,
    summary:
      "Exposes both billing-horizon storage consumption (synthetic_storage_size in byte-seconds/bytes-month) and instantaneous branch logical size (logical_size in bytes) as distinct canonical metrics.",
    apiSurfaceOrEndpoint:
      "GET /api/v2/consumption_history/projects & GET /api/v2/projects/{project_id}/branches",
    requiredScopeOrTokenType: "neon.consumption.readonly",
    unitAndSemanticNotes:
      "neon.storage_consumption_bytes_month (bytes_month) vs neon.instantaneous_storage_bytes (bytes). Never conflate cumulative byte-seconds with instantaneous disk footprint.",
    securityGuardrail: "Control-plane metadata only; zero pg_database_size() SQL queries executed.",
  },
  {
    providerKey: "neon",
    dimensionKey: "compute_connection_metrics",
    dimensionLabel: "Compute & Connection Metrics",
    status: "SUPPORTED",
    allowsNumericMetric: true,
    summary:
      "Exposes compute_time_seconds (CU-seconds allocated) and active_time_seconds (wall-clock active seconds before scale-to-zero suspend).",
    apiSurfaceOrEndpoint: "GET /api/v2/consumption_history/projects",
    requiredScopeOrTokenType: "neon.consumption.readonly",
    unitAndSemanticNotes:
      "neon.compute_unit_seconds (seconds) and neon.active_time_seconds (seconds). Never mislabel compute-unit seconds as CPU utilization percentage.",
    securityGuardrail: "Does not inspect pg_stat_activity or active client SQL sessions.",
  },
  {
    providerKey: "neon",
    dimensionKey: "request_throughput_metrics",
    dimensionLabel: "Request / Query / Operation Throughput",
    status: "SUPPORTED_WITH_LIMITATIONS",
    allowsNumericMetric: true,
    summary:
      "Exposes written_data_bytes and data_transfer_bytes from the consumption ledger; per-query SQL throughput (QPS) is unavailable without connecting to Postgres.",
    apiSurfaceOrEndpoint: "GET /api/v2/consumption_history/projects",
    requiredScopeOrTokenType: "neon.consumption.readonly",
    unitAndSemanticNotes: "neon.network_transfer_bytes (bytes) and written_data_bytes (bytes).",
    securityGuardrail:
      "Per-query pg_stat_statements inspection is marked UNAVAILABLE to preserve zero-SQL boundary.",
  },
  {
    providerKey: "neon",
    dimensionKey: "user_count_auth_posture",
    dimensionLabel: "User Count & Auth Activity Posture",
    status: "UNAVAILABLE",
    allowsNumericMetric: false,
    summary:
      "Neon is a serverless Postgres engine without a universal built-in BaaS user directory on the control plane; counting application users would require querying customer tables.",
    apiSurfaceOrEndpoint: "N/A (Prohibited customer SQL plane)",
    requiredScopeOrTokenType: "N/A",
    unitAndSemanticNotes: "Must render UNAVAILABLE; never fabricate 0 registered users for Neon.",
    securityGuardrail:
      "Avenor refuses to connect to customer databases to run SELECT COUNT(*) FROM users.",
  },
  {
    providerKey: "neon",
    dimensionKey: "security_config_posture",
    dimensionLabel: "Security & Configuration Posture",
    status: "SUPPORTED",
    allowsNumericMetric: false,
    summary:
      "Inspects passive control-plane posture: protected default branch setting, IP allowlist configuration presence, compute scale-to-zero suspend timeout, and backup/history retention window.",
    apiSurfaceOrEndpoint:
      "GET /api/v2/projects/{project_id} & GET /api/v2/projects/{project_id}/branches",
    requiredScopeOrTokenType: "neon.projects.readonly",
    unitAndSemanticNotes: "Categorical states: CONFIGURED, NOT_CONFIGURED, WARNING, UNKNOWN.",
    securityGuardrail:
      "Read-only inspection of project settings JSON; never mutates IP allowlists or branch protection.",
  },
  {
    providerKey: "neon",
    dimensionKey: "audit_log_posture",
    dimensionLabel: "Audit Log Availability & PII Safety",
    status: "SUPPORTED_WITH_LIMITATIONS",
    allowsNumericMetric: false,
    summary:
      "Reads recent control-plane operations (branch creation, compute start/suspend) via GET /operations with automatic email/token redaction.",
    apiSurfaceOrEndpoint: "GET /api/v2/projects/{project_id}/operations",
    requiredScopeOrTokenType: "neon.projects.readonly",
    unitAndSemanticNotes: "Control-plane operation status and action category only.",
    securityGuardrail:
      "Sanitizes actor identifiers and strips any query parameters or connection URIs.",
  },
  {
    providerKey: "neon",
    dimensionKey: "granularity_retention",
    dimensionLabel: "Granularity & Historical Retention",
    status: "SUPPORTED",
    allowsNumericMetric: false,
    summary: "Consumption history endpoint supports hourly, daily, and monthly granularities.",
    apiSurfaceOrEndpoint:
      "GET /api/v2/consumption_history/projects?granularity=hourly|daily|monthly",
    requiredScopeOrTokenType: "neon.consumption.readonly",
    unitAndSemanticNotes: "Aligned to UTC interval start/end timestamps.",
    securityGuardrail: "Bounded pagination and window length enforcement.",
  },
  {
    providerKey: "neon",
    dimensionKey: "freshness_latency",
    dimensionLabel: "Freshness & Ingestion Latency",
    status: "SUPPORTED",
    allowsNumericMetric: false,
    summary:
      "Branch/endpoint metadata is real-time (~1m); consumption history ledger lags by 15–60 minutes.",
    apiSurfaceOrEndpoint: "GET /api/v2/consumption_history/projects",
    requiredScopeOrTokenType: "neon.consumption.readonly",
    unitAndSemanticNotes: "expectedLatencyMinutes: 15, freshnessWindowMinutes: 60.",
    securityGuardrail:
      "Honest freshness classification when consumption windows are still accruing.",
  },
  {
    providerKey: "neon",
    dimensionKey: "rate_limits_quotas",
    dimensionLabel: "Rate Limits & Quota Behavior",
    status: "SUPPORTED",
    allowsNumericMetric: false,
    summary:
      "Neon API enforces ~700 requests/minute (~11 req/s) per token with HTTP 429 Retry-After headers.",
    apiSurfaceOrEndpoint: "https://console.neon.tech/api/v2/*",
    requiredScopeOrTokenType: "Bearer napi_*",
    unitAndSemanticNotes:
      "Avenor adapter caps polling to 40 rpm with burst 10 and exponential backoff.",
    securityGuardrail: "Respects Retry-After and isolates 429s without failing sibling providers.",
  },
  {
    providerKey: "neon",
    dimensionKey: "plan_tier_restrictions",
    dimensionLabel: "Plan & Tier Restrictions",
    status: "PLAN_GATED",
    allowsNumericMetric: false,
    summary:
      "Detailed `/consumption_history/projects` endpoints require Neon Launch, Scale, Business, or Enterprise billing plans; Free-tier projects expose branch logical_size and project quotas.",
    apiSurfaceOrEndpoint: "GET /api/v2/consumption_history/projects",
    requiredScopeOrTokenType: "neon.consumption.readonly",
    unitAndSemanticNotes:
      "Free plan returns HTTP 403/404 on consumption_history -> mapped to PLAN_RESTRICTED.",
    securityGuardrail:
      "Never fabricates 0 CU-seconds when a Neon Free plan gates the consumption history API.",
  },
  {
    providerKey: "neon",
    dimensionKey: "prohibited_high_risk_surfaces",
    dimensionLabel: "Prohibited & High-Risk Surfaces",
    status: "UNSAFE",
    allowsNumericMetric: false,
    summary:
      "Direct Postgres connections (postgres://), SQL execution, GET /connection_uri, GET /roles/{role}/reveal_password, and any POST/PATCH/DELETE endpoint are strictly prohibited.",
    apiSurfaceOrEndpoint: "BLOCKED: /connection_uri, /reveal_password, POST/PATCH/DELETE /api/v2/*",
    requiredScopeOrTokenType: "PROHIBITED",
    unitAndSemanticNotes: "Enforced at compile time and runtime HTTP gateway.",
    securityGuardrail: "Immediate rejection with PRODUCTION_SAFETY_VIOLATION / PERMISSION_DENIED.",
  },
  {
    providerKey: "neon",
    dimensionKey: "recommended_pilot_suitability",
    dimensionLabel: "Recommended Milestone 06 Pilot Suitability",
    status: "SUPPORTED_WITH_LIMITATIONS",
    allowsNumericMetric: false,
    summary:
      "Selected as the Serverless Postgres Consumption & Branch Posture Connector (THE-139), paired with Avenor's strict GET-only HTTP allowlist because Neon API keys are not scoped read-only upstream.",
    apiSurfaceOrEndpoint: "https://console.neon.tech/api/v2",
    requiredScopeOrTokenType: "neon.projects.readonly, neon.consumption.readonly",
    unitAndSemanticNotes:
      "Covers CU-seconds, active time, storage byte-months, instantaneous branch bytes, and branch count.",
    securityGuardrail: "Adapter-enforced read-only path and verb lock.",
  },

  // ============================================================================
  // 2. SUPABASE (Management API v1 + Scoped Read OAuth / PAT)
  // ============================================================================
  {
    providerKey: "supabase",
    dimensionKey: "auth_mechanism",
    dimensionLabel: "Authentication Mechanism",
    status: "SUPPORTED",
    allowsNumericMetric: false,
    summary:
      "Supports Supabase OAuth2 Integration Apps with granular read-only scopes (projects:read, analytics:read, organizations:read) or fine-grained read-only Personal Access Tokens.",
    apiSurfaceOrEndpoint: "https://api.supabase.com/v1/*",
    requiredScopeOrTokenType: "OAuth2 Bearer or sbp_* PAT with projects:read, analytics:read",
    unitAndSemanticNotes: "Control-plane token for api.supabase.com only.",
    securityGuardrail:
      "Unconditionally rejects project service_role JWTs, sb_secret_* keys, anon keys, and direct Postgres connection strings.",
  },
  {
    providerKey: "supabase",
    dimensionKey: "least_privilege_readonly",
    dimensionLabel: "Least-Privilege Read-Only Enforcement",
    status: "SUPPORTED",
    allowsNumericMetric: false,
    summary:
      "Supabase OAuth2 apps enforce read-only scopes at api.supabase.com; Avenor further restricts requests to GET-only allowlisted Management API v1 routes.",
    apiSurfaceOrEndpoint: "GET https://api.supabase.com/v1/projects, GET /v1/projects/{ref}/health",
    requiredScopeOrTokenType: "projects:read, analytics:read",
    unitAndSemanticNotes: "Verifies token prefix and rejects any JWT carrying role=service_role.",
    securityGuardrail:
      "Blocks POST /v1/projects/{ref}/database/query and GET /v1/projects/{ref}/api-keys so Avenor can never execute SQL or retrieve a project's service_role key.",
  },
  {
    providerKey: "supabase",
    dimensionKey: "resource_discovery",
    dimensionLabel: "Resource Discovery Endpoints",
    status: "SUPPORTED",
    allowsNumericMetric: false,
    summary:
      "Lists accessible Supabase organizations, projects (ref, name, region, status, database version), and subsystem health status (db, auth, realtime, storage, rest).",
    apiSurfaceOrEndpoint: "GET /v1/projects, GET /v1/organizations, GET /v1/projects/{ref}/health",
    requiredScopeOrTokenType: "projects:read",
    unitAndSemanticNotes:
      "Captures projectRef, region, status (ACTIVE_HEALTHY, INACTIVE), and Postgres engine version.",
    securityGuardrail: "Never fetches project API keys (/api-keys) or pgsodium root keys.",
  },
  {
    providerKey: "supabase",
    dimensionKey: "db_storage_metrics",
    dimensionLabel: "Database Size & Storage Metrics",
    status: "SUPPORTED",
    allowsNumericMetric: true,
    summary:
      "Exposes database disk usage (supabase.db_size_bytes) and object storage usage (supabase.storage_size_bytes) via Management API usage/analytics endpoints.",
    apiSurfaceOrEndpoint:
      "GET /v1/projects/{ref}/analytics/endpoints/usage.api-counts & usage telemetry",
    requiredScopeOrTokenType: "projects:read, analytics:read",
    unitAndSemanticNotes: "supabase.db_size_bytes (bytes) and supabase.storage_size_bytes (bytes).",
    securityGuardrail: "Never lists or downloads customer storage bucket objects.",
  },
  {
    providerKey: "supabase",
    dimensionKey: "compute_connection_metrics",
    dimensionLabel: "Compute & Connection Metrics",
    status: "SUPPORTED",
    allowsNumericMetric: true,
    summary:
      "Exposes aggregate active database connection counts (supabase.active_connections) and connection pool saturation metadata.",
    apiSurfaceOrEndpoint: "GET /v1/projects/{ref}/health & usage telemetry",
    requiredScopeOrTokenType: "projects:read, analytics:read",
    unitAndSemanticNotes: "supabase.active_connections (count, point-in-time/mean gauge).",
    securityGuardrail: "Does not inspect live SQL query text or client IP addresses.",
  },
  {
    providerKey: "supabase",
    dimensionKey: "request_throughput_metrics",
    dimensionLabel: "Request / Query / Operation Throughput",
    status: "SUPPORTED",
    allowsNumericMetric: true,
    summary:
      "Exposes aggregate REST/GraphQL/Storage/Realtime gateway request counts (supabase.api_requests) and Auth gateway request volume (supabase.auth_requests).",
    apiSurfaceOrEndpoint: "GET /v1/projects/{ref}/analytics/endpoints/usage.api-counts",
    requiredScopeOrTokenType: "analytics:read",
    unitAndSemanticNotes:
      "supabase.api_requests (count) and supabase.auth_requests (count). Auth requests represent HTTP traffic to GoTrue, NOT registered user headcount.",
    securityGuardrail:
      "Aggregate request counters only; never inspects HTTP request bodies or headers.",
  },
  {
    providerKey: "supabase",
    dimensionKey: "user_count_auth_posture",
    dimensionLabel: "User Count & Auth Activity Posture",
    status: "SUPPORTED_WITH_LIMITATIONS",
    allowsNumericMetric: true,
    summary:
      "Registered user count (supabase.registered_auth_users) is supported ONLY when exposed by an allowlisted aggregate usage/MAU counter endpoint; if only raw auth.users inspection would be required, Avenor returns UNAVAILABLE / PERMISSION_DENIED rather than querying auth.users or conflating auth_requests with user count.",
    apiSurfaceOrEndpoint: "GET /v1/projects/{ref}/usage (aggregate auth user count when available)",
    requiredScopeOrTokenType: "analytics:read",
    unitAndSemanticNotes:
      "supabase.registered_auth_users (count) is strictly separate from supabase.auth_requests (count).",
    securityGuardrail:
      "Never queries auth.users rows, never uses service_role to call auth.admin.listUsers(), and never reads emails, phone numbers, or user_metadata.",
  },
  {
    providerKey: "supabase",
    dimensionKey: "security_config_posture",
    dimensionLabel: "Security & Configuration Posture",
    status: "SUPPORTED_WITH_LIMITATIONS",
    allowsNumericMetric: false,
    summary:
      "Inspects SSL enforcement, network restrictions, Auth MFA/email confirmation posture, and RLS metadata posture (explicitly qualified as NOT_VERIFIED when table-level pg_class inspection is unavailable via read-only Management API).",
    apiSurfaceOrEndpoint:
      "GET /v1/projects/{ref}/config/database/postgres & GET /v1/projects/{ref}/config/auth",
    requiredScopeOrTokenType: "projects:read",
    unitAndSemanticNotes:
      "Never claims RLS is verified across customer tables unless verified read-only lint metadata is present.",
    securityGuardrail:
      "Read-only config inspection; strips SMTP passwords, OAuth client secrets, and webhook tokens.",
  },
  {
    providerKey: "supabase",
    dimensionKey: "audit_log_posture",
    dimensionLabel: "Audit Log Availability & PII Safety",
    status: "PLAN_GATED",
    allowsNumericMetric: false,
    summary:
      "Organization control-plane audit logs require Supabase Team or Enterprise plans; Avenor redacts actor emails and IP addresses before rendering.",
    apiSurfaceOrEndpoint: "GET /v1/organizations/{slug}/audit-logs (Team/Enterprise)",
    requiredScopeOrTokenType: "organizations:read",
    unitAndSemanticNotes: "Returns PLAN_GATED on Free/Pro tiers with honest UX disclosure.",
    securityGuardrail: "Redacts email addresses, IPs, and bearer tokens from audit payloads.",
  },
  {
    providerKey: "supabase",
    dimensionKey: "granularity_retention",
    dimensionLabel: "Granularity & Historical Retention",
    status: "SUPPORTED",
    allowsNumericMetric: false,
    summary:
      "Supports hourly and daily API usage buckets; retention ranges from 1 day (Free) to 7 days (Pro) and 90 days (Team/Enterprise).",
    apiSurfaceOrEndpoint: "GET /v1/projects/{ref}/analytics/endpoints/usage.api-counts",
    requiredScopeOrTokenType: "analytics:read",
    unitAndSemanticNotes:
      "Avenor persists normalized daily observations in metric_observations for long-term history.",
    securityGuardrail: "Bounded date window queries.",
  },
  {
    providerKey: "supabase",
    dimensionKey: "freshness_latency",
    dimensionLabel: "Freshness & Ingestion Latency",
    status: "SUPPORTED",
    allowsNumericMetric: false,
    summary:
      "Service health is real-time (~1m); usage analytics and storage size counters refresh every 15–60 minutes.",
    apiSurfaceOrEndpoint: "GET /v1/projects/{ref}/health & /analytics/*",
    requiredScopeOrTokenType: "projects:read, analytics:read",
    unitAndSemanticNotes: "expectedLatencyMinutes: 30, freshnessWindowMinutes: 60.",
    securityGuardrail: "Stale cache classification when upstream analytics endpoints lag.",
  },
  {
    providerKey: "supabase",
    dimensionKey: "rate_limits_quotas",
    dimensionLabel: "Rate Limits & Quota Behavior",
    status: "SUPPORTED",
    allowsNumericMetric: false,
    summary: "Supabase Management API enforces ~120 requests/minute per OAuth/PAT token.",
    apiSurfaceOrEndpoint: "https://api.supabase.com/v1/*",
    requiredScopeOrTokenType: "projects:read, analytics:read",
    unitAndSemanticNotes: "Adapter rate limit policy: 60 rpm, burst 15, retry_after_header.",
    securityGuardrail: "Automatic backoff on HTTP 429.",
  },
  {
    providerKey: "supabase",
    dimensionKey: "plan_tier_restrictions",
    dimensionLabel: "Plan & Tier Restrictions",
    status: "SUPPORTED_WITH_LIMITATIONS",
    allowsNumericMetric: false,
    summary:
      "Free tier projects pause after 7 days of inactivity (returning INACTIVE status) and restrict audit logs and extended log retention.",
    apiSurfaceOrEndpoint: "GET /v1/projects/{ref}",
    requiredScopeOrTokenType: "projects:read",
    unitAndSemanticNotes:
      "Paused Free projects surface RESOURCE_UNAVAILABLE / DEGRADED rather than fabricated zeroes.",
    securityGuardrail: "Avenor never triggers POST /v1/projects/{ref}/restore on paused projects.",
  },
  {
    providerKey: "supabase",
    dimensionKey: "prohibited_high_risk_surfaces",
    dimensionLabel: "Prohibited & High-Risk Surfaces",
    status: "UNSAFE",
    allowsNumericMetric: false,
    summary:
      "Supabase service_role JWTs, sb_secret_* keys, POST /v1/projects/{ref}/database/query, GET /v1/projects/{ref}/api-keys, and auth.admin.listUsers() are strictly prohibited.",
    apiSurfaceOrEndpoint:
      "BLOCKED: service_role, sb_secret_*, /database/query, /api-keys, auth.users",
    requiredScopeOrTokenType: "PROHIBITED",
    unitAndSemanticNotes: "Enforced by credential validator and HTTP allowlist.",
    securityGuardrail:
      "Credential validation rejects service_role / sb_secret immediately before vault encryption.",
  },
  {
    providerKey: "supabase",
    dimensionKey: "recommended_pilot_suitability",
    dimensionLabel: "Recommended Milestone 06 Pilot Suitability",
    status: "SUPPORTED",
    allowsNumericMetric: false,
    summary:
      "Selected as the BaaS Control-Plane Health, Storage, Request & Safe Aggregate Auth Posture Connector (THE-140) with strict service_role rejection.",
    apiSurfaceOrEndpoint: "https://api.supabase.com/v1",
    requiredScopeOrTokenType: "projects:read, analytics:read",
    unitAndSemanticNotes:
      "Covers db_size_bytes, storage_size_bytes, active_connections, api_requests, auth_requests, and safe aggregate registered_auth_users.",
    securityGuardrail:
      "Zero RLS bypass, zero SQL query endpoint calls, zero raw auth.users enumeration.",
  },

  // ============================================================================
  // 3. FIREBASE / GOOGLE CLOUD MONITORING (Cloud Monitoring API v3)
  // ============================================================================
  {
    providerKey: "firebase-monitoring",
    dimensionKey: "auth_mechanism",
    dimensionLabel: "Authentication Mechanism",
    status: "SUPPORTED",
    allowsNumericMetric: false,
    summary:
      "Uses Google OAuth 2.0 with cryptographically scoped read-only token (`https://www.googleapis.com/auth/monitoring.read`).",
    apiSurfaceOrEndpoint: "https://monitoring.googleapis.com/v3/projects/{project_id}/*",
    requiredScopeOrTokenType: "https://www.googleapis.com/auth/monitoring.read",
    unitAndSemanticNotes: "Reuses Avenor's existing Google OAuth 2.0 + PKCE vault lifecycle.",
    securityGuardrail:
      "Unconditionally rejects Firebase Admin SDK service-account private keys, firebase-admin auth.listUsers(), and broad cloud-platform scopes.",
  },
  {
    providerKey: "firebase-monitoring",
    dimensionKey: "least_privilege_readonly",
    dimensionLabel: "Least-Privilege Read-Only Enforcement",
    status: "SUPPORTED",
    allowsNumericMetric: false,
    summary:
      "Google's IAM and OAuth gateway cryptographically enforces `monitoring.read` as strictly read-only across metric descriptors and time-series data, with zero access to Firestore documents, Cloud Storage objects, or Firebase Auth user PII.",
    apiSurfaceOrEndpoint:
      "GET /v3/projects/{project}/metricDescriptors, GET /v3/projects/{project}/timeSeries",
    requiredScopeOrTokenType: "https://www.googleapis.com/auth/monitoring.read",
    unitAndSemanticNotes: "100% provider-enforced read-only guarantee at the OAuth scope layer.",
    securityGuardrail:
      "Additionally locked in Avenor's shared Google HTTP client to GET-only paths under https://monitoring.googleapis.com/v3/projects/*.",
  },
  {
    providerKey: "firebase-monitoring",
    dimensionKey: "resource_discovery",
    dimensionLabel: "Resource Discovery Endpoints",
    status: "SUPPORTED",
    allowsNumericMetric: false,
    summary:
      "Discovers accessible Google Cloud / Firebase project IDs and inspects available monitored resource descriptors (`firestore_instance`, `cloud_function`, `gcs_bucket`) and metric descriptors.",
    apiSurfaceOrEndpoint:
      "GET https://monitoring.googleapis.com/v3/projects/{project}/monitoredResourceDescriptors & /metricDescriptors",
    requiredScopeOrTokenType: "https://www.googleapis.com/auth/monitoring.read",
    unitAndSemanticNotes:
      "Verifies which Firebase subsystems (Firestore, Functions, Storage, Rules) emit telemetry.",
    securityGuardrail: "Metadata discovery only; never touches Firestore data APIs.",
  },
  {
    providerKey: "firebase-monitoring",
    dimensionKey: "db_storage_metrics",
    dimensionLabel: "Database Size & Storage Metrics",
    status: "SUPPORTED",
    allowsNumericMetric: true,
    summary:
      "Reads Cloud Storage bucket footprint (`storage.googleapis.com/storage/total_bytes` -> `firebase.storage_bytes`) as a GAUGE time series.",
    apiSurfaceOrEndpoint: "GET https://monitoring.googleapis.com/v3/projects/{project}/timeSeries",
    requiredScopeOrTokenType: "https://www.googleapis.com/auth/monitoring.read",
    unitAndSemanticNotes:
      "firebase.storage_bytes (bytes, GAUGE). Gauge samples must use latest/mean/max aggregation—never summed across sample points.",
    securityGuardrail:
      "Reads byte counters from Cloud Monitoring; zero access to Cloud Storage bucket objects.",
  },
  {
    providerKey: "firebase-monitoring",
    dimensionKey: "compute_connection_metrics",
    dimensionLabel: "Compute & Connection Metrics",
    status: "SUPPORTED",
    allowsNumericMetric: true,
    summary:
      "Reads Firestore active realtime listeners (`firestore.googleapis.com/network/active_connections` -> `firebase.firestore_active_listeners`, GAUGE) and Cloud Functions execution duration (`cloudfunctions.googleapis.com/function/execution_times` -> `firebase.function_execution_time_ms`).",
    apiSurfaceOrEndpoint: "GET https://monitoring.googleapis.com/v3/projects/{project}/timeSeries",
    requiredScopeOrTokenType: "https://www.googleapis.com/auth/monitoring.read",
    unitAndSemanticNotes:
      "Active listeners is a GAUGE metric (latest/mean/max, never summed!). Function execution time converts distribution/nanoseconds to milliseconds.",
    securityGuardrail: "Telemetry-only; cannot invoke, deploy, or update Cloud Functions.",
  },
  {
    providerKey: "firebase-monitoring",
    dimensionKey: "request_throughput_metrics",
    dimensionLabel: "Request / Query / Operation Throughput",
    status: "SUPPORTED",
    allowsNumericMetric: true,
    summary:
      "Reads Firestore document reads (`document/read_count`), writes (`document/write_count`), deletes (`document/delete_count`), and Cloud Functions invocations (`function/execution_count`) and errors (`status != 'ok'`).",
    apiSurfaceOrEndpoint: "GET https://monitoring.googleapis.com/v3/projects/{project}/timeSeries",
    requiredScopeOrTokenType: "https://www.googleapis.com/auth/monitoring.read",
    unitAndSemanticNotes:
      "DELTA metrics sum cleanly across the aligned interval; CUMULATIVE metrics compute non-negative deltas across counter reset windows.",
    securityGuardrail:
      "Counts operations via Cloud Monitoring; never reads Firestore document payloads.",
  },
  {
    providerKey: "firebase-monitoring",
    dimensionKey: "user_count_auth_posture",
    dimensionLabel: "User Count & Auth Activity Posture",
    status: "UNAVAILABLE",
    allowsNumericMetric: false,
    summary:
      "Google Cloud Monitoring `monitoring.read` does not expose a total registered Firebase Auth user headcount descriptor, and enumerating users via Firebase Admin SDK (`auth.listUsers()`) exposes raw emails/phones/UIDs and is prohibited.",
    apiSurfaceOrEndpoint: "N/A (Admin SDK user enumeration prohibited)",
    requiredScopeOrTokenType: "N/A",
    unitAndSemanticNotes:
      "Explicitly classified as UNAVAILABLE for `firebase-monitoring` with zero fabricated 0 values.",
    securityGuardrail:
      "Refuses Firebase Admin SDK credentials and blocks any Identity Toolkit user-listing call.",
  },
  {
    providerKey: "firebase-monitoring",
    dimensionKey: "security_config_posture",
    dimensionLabel: "Security & Configuration Posture",
    status: "SUPPORTED",
    allowsNumericMetric: false,
    summary:
      "Observes passive Firebase Security Rules evaluation counts (`firestore.googleapis.com/rules/evaluation_count` by result ALLOW/DENY/ERROR) via Cloud Monitoring without reading or modifying rule source files.",
    apiSurfaceOrEndpoint: "GET https://monitoring.googleapis.com/v3/projects/{project}/timeSeries",
    requiredScopeOrTokenType: "https://www.googleapis.com/auth/monitoring.read",
    unitAndSemanticNotes:
      "Reports whether security rules are actively evaluating and flags elevated DENY/ERROR spikes as WARNING.",
    securityGuardrail:
      "Passive telemetry only; never claims to verify rule correctness or run a penetration test.",
  },
  {
    providerKey: "firebase-monitoring",
    dimensionKey: "audit_log_posture",
    dimensionLabel: "Audit Log Availability & PII Safety",
    status: "REQUIRES_CUSTOMER_SETUP",
    allowsNumericMetric: false,
    summary:
      "Cloud Audit Logs require separate `logging.read` scope which can contain raw request payloads; Avenor omits raw Cloud Logging ingestion in M06 and relies on sanitized Cloud Monitoring metric labels.",
    apiSurfaceOrEndpoint: "GET https://monitoring.googleapis.com/v3/projects/{project}/timeSeries",
    requiredScopeOrTokenType: "https://www.googleapis.com/auth/monitoring.read",
    unitAndSemanticNotes:
      "Metric labels carry only function_name, region, status, and rule evaluation result.",
    securityGuardrail: "Zero PII enters Cloud Monitoring time-series labels.",
  },
  {
    providerKey: "firebase-monitoring",
    dimensionKey: "granularity_retention",
    dimensionLabel: "Granularity & Historical Retention",
    status: "SUPPORTED",
    allowsNumericMetric: false,
    summary:
      "Cloud Monitoring v3 supports arbitrary alignment periods (`3600s` hourly, `86400s` daily) and retains standard GCP metrics for up to 24 months (6 weeks for some high-cardinality descriptors).",
    apiSurfaceOrEndpoint:
      "GET /v3/projects/{project}/timeSeries?aggregation.alignmentPeriod=86400s",
    requiredScopeOrTokenType: "https://www.googleapis.com/auth/monitoring.read",
    unitAndSemanticNotes:
      "Supports ALIGN_SUM (DELTA), ALIGN_MEAN / ALIGN_MAX / ALIGN_NEXT_OLDER (GAUGE), and ALIGN_DELTA (CUMULATIVE).",
    securityGuardrail: "Requires explicit startTime and endTime bounds on every timeSeries call.",
  },
  {
    providerKey: "firebase-monitoring",
    dimensionKey: "freshness_latency",
    dimensionLabel: "Freshness & Ingestion Latency",
    status: "SUPPORTED",
    allowsNumericMetric: false,
    summary:
      "Firestore and Cloud Functions metrics have a 1–5 minute sampling delay; Cloud Storage total_bytes updates every 5–15 minutes.",
    apiSurfaceOrEndpoint: "GET https://monitoring.googleapis.com/v3/projects/{project}/timeSeries",
    requiredScopeOrTokenType: "https://www.googleapis.com/auth/monitoring.read",
    unitAndSemanticNotes: "expectedLatencyMinutes: 5, freshnessWindowMinutes: 30.",
    securityGuardrail: "Preserves upstream metric point timestamps and alignment period metadata.",
  },
  {
    providerKey: "firebase-monitoring",
    dimensionKey: "rate_limits_quotas",
    dimensionLabel: "Rate Limits & Quota Behavior",
    status: "SUPPORTED",
    allowsNumericMetric: false,
    summary:
      "Cloud Monitoring API v3 allows 1,000 read requests per minute per GCP project. Avenor caps adapter calls to 60 rpm with exponential backoff.",
    apiSurfaceOrEndpoint: "https://monitoring.googleapis.com/v3/*",
    requiredScopeOrTokenType: "https://www.googleapis.com/auth/monitoring.read",
    unitAndSemanticNotes: "Supports nextPageToken pagination on timeSeries.list.",
    securityGuardrail: "Respects Retry-After and quota errors.",
  },
  {
    providerKey: "firebase-monitoring",
    dimensionKey: "plan_tier_restrictions",
    dimensionLabel: "Plan & Tier Restrictions",
    status: "SUPPORTED",
    allowsNumericMetric: false,
    summary:
      "Standard Google Cloud Monitoring metrics for Firestore, Cloud Functions, and Cloud Storage are included free of charge across Firebase Spark (Free) and Blaze (Pay-as-you-go) plans.",
    apiSurfaceOrEndpoint: "GET https://monitoring.googleapis.com/v3/projects/{project}/timeSeries",
    requiredScopeOrTokenType: "https://www.googleapis.com/auth/monitoring.read",
    unitAndSemanticNotes:
      "Available on both Spark and Blaze plans once the underlying service is enabled.",
    securityGuardrail:
      "If a service (e.g., Cloud Functions) has zero deployments, empty timeSeries are handled honestly.",
  },
  {
    providerKey: "firebase-monitoring",
    dimensionKey: "prohibited_high_risk_surfaces",
    dimensionLabel: "Prohibited & High-Risk Surfaces",
    status: "UNSAFE",
    allowsNumericMetric: false,
    summary:
      "Firebase Admin SDK private keys, Identity Toolkit user enumeration (`auth.listUsers`), Firestore document reads (`firestore.googleapis.com/v1/.../documents`), and `cloud-platform` full-access OAuth scope are strictly prohibited.",
    apiSurfaceOrEndpoint:
      "BLOCKED: firebase-admin SDK, identitytoolkit.googleapis.com, firestore.googleapis.com/v1/*/documents",
    requiredScopeOrTokenType: "PROHIBITED",
    unitAndSemanticNotes: "Enforced by Google OAuth scope allowlist and HTTP host/path allowlist.",
    securityGuardrail:
      "Blocks any credential or request outside monitoring.googleapis.com/v3 GET endpoints.",
  },
  {
    providerKey: "firebase-monitoring",
    dimensionKey: "recommended_pilot_suitability",
    dimensionLabel: "Recommended Milestone 06 Pilot Suitability",
    status: "SUPPORTED",
    allowsNumericMetric: false,
    summary:
      "Selected as Avenor's Primary Cryptographically Enforced Read-Only Backend Telemetry Pilot (`THE-138` / `THE-141`) because `monitoring.read` guarantees read-only access at Google's IAM boundary with zero access to customer data or PII.",
    apiSurfaceOrEndpoint: "https://monitoring.googleapis.com/v3",
    requiredScopeOrTokenType: "https://www.googleapis.com/auth/monitoring.read",
    unitAndSemanticNotes:
      "Delivers Firestore reads/writes/deletes/listeners, Cloud Functions invocations/errors/duration, Storage bytes, and Rules evaluation telemetry.",
    securityGuardrail: "Gold-standard OAuth 2.0 least-privilege telemetry isolation.",
  },
] as const;

export const BACKEND_PILOT_ADR: BackendPilotAdr = {
  adrId: "ADR-006-BACKEND-PILOT",
  title:
    "Selection of Google Cloud Monitoring (`monitoring.read`) as Primary Cryptographic Read-Only Backend Telemetry Pilot, Paired with Guarded Neon and Supabase Control-Plane Connectors",
  status: "ACCEPTED",
  decidedAtIso: "2026-11-21T12:50:00.000Z",
  primaryPilotProviderKey: "firebase-monitoring",
  candidates: [
    {
      providerKey: "firebase-monitoring",
      displayName: "Firebase / Google Cloud Monitoring (API v3)",
      cryptographicReadOnlyScore: 100,
      metricRichnessScore: 92,
      zeroDataPlaneIsolationScore: 100,
      weightedTotalScore: 97.6,
      roleInMilestone06: "PRIMARY_CRYPTOGRAPHIC_PILOT",
      rationale:
        "Google OAuth scope `https://www.googleapis.com/auth/monitoring.read` is cryptographically enforced by Google IAM as strictly read-only time-series telemetry. It cannot read Firestore documents, Storage objects, or Firebase Auth user PII even if a token were replayed outside Avenor.",
    },
    {
      providerKey: "supabase",
      displayName: "Supabase Management API (v1)",
      cryptographicReadOnlyScore: 88,
      metricRichnessScore: 86,
      zeroDataPlaneIsolationScore: 95,
      weightedTotalScore: 89.8,
      roleInMilestone06: "BAAS_CONTROL_PLANE_POSTURE",
      rationale:
        "Supabase OAuth integration scopes (`projects:read`, `analytics:read`) provide provider-enforced read access on `api.supabase.com`, while Avenor explicitly blocks `service_role` / `sb_secret` keys, `/database/query`, `/api-keys`, and raw `auth.users` enumeration.",
    },
    {
      providerKey: "neon",
      displayName: "Neon Serverless Postgres Control Plane (API v2)",
      cryptographicReadOnlyScore: 72,
      metricRichnessScore: 90,
      zeroDataPlaneIsolationScore: 96,
      weightedTotalScore: 83.4,
      roleInMilestone06: "SERVERLESS_POSTGRES_CONSUMPTION",
      rationale:
        "Neon's `/api/v2/consumption_history` and branch endpoints provide rich serverless Postgres compute (CU-seconds, active time) and storage (`bytes-month` vs instantaneous `bytes`) telemetry without connecting to Postgres, but because Neon API keys (`napi_*`) are not intrinsically read-only upstream, Avenor enforces a strict GET-only HTTP verb and endpoint allowlist.",
    },
  ],
  keyArchitecturalRules: [
    "Never connect directly to customer PostgreSQL databases (`postgres://` / `postgresql://`) or execute SQL against customer tables.",
    "Never accept or store Supabase `service_role` JWTs, `sb_secret_*` keys, or Firebase Admin SDK service-account private keys.",
    "Never enumerate raw user directories (`auth.users` or Firebase `auth.listUsers()`) or conflate Auth API request volume with registered user headcount.",
    "Never sum sampled `GAUGE` time-series points (such as active connections, active listeners, or instantaneous storage bytes); always aggregate gauges via latest, mean, or max.",
    "Never mislabel Neon compute-unit seconds (`neon.compute_unit_seconds`) as CPU utilization percentage, and never conflate cumulative billing-horizon storage (`bytes_month`) with instantaneous branch size (`bytes`).",
  ],
};

function decodeJwtPayloadUnsafe(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) {
    return null;
  }
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const json = Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Evaluates whether a backend provider credential is safe to accept under Avenor's
 * strictly read-only external provider contract.
 */
export function evaluateBackendCredentialSafety(
  input: BackendCredentialSafetyInput,
): BackendCredentialSafetyVerdict {
  const raw = (input.rawTokenPreview ?? "").trim();

  // 1. Universal rejection: Direct Postgres connection strings
  if (input.credentialType === "postgres_connection_string" || /^postgres(?:ql)?:\/\//i.test(raw)) {
    return {
      providerKey: input.providerKey,
      accepted: false,
      status: "UNSAFE",
      intrinsicProviderReadOnly: false,
      requiresAdapterMethodAllowlist: true,
      rejectionCode: "PROHIBITED_DIRECT_DATABASE_CONNECTION_STRING",
      reason:
        "Avenor never connects directly to customer PostgreSQL databases via wire-protocol connection strings (`postgres://` or `postgresql://`). Use a control-plane API token or OAuth connection instead.",
      prohibitedCapabilitiesBlocked: [
        "direct_sql_execution",
        "table_row_inspection",
        "schema_mutation",
      ],
    };
  }

  // 2. Neon credential evaluation
  if (input.providerKey === "neon") {
    if (
      input.credentialType !== "neon_org_api_key" &&
      input.credentialType !== "neon_personal_api_key" &&
      input.credentialType !== "neon_project_scoped_api_key"
    ) {
      return {
        providerKey: "neon",
        accepted: false,
        status: "UNSAFE",
        intrinsicProviderReadOnly: false,
        requiresAdapterMethodAllowlist: true,
        rejectionCode: "INVALID_NEON_CREDENTIAL_TYPE",
        reason: `Unsupported credential type "${input.credentialType}" for Neon control-plane connector.`,
        prohibitedCapabilitiesBlocked: ["direct_sql_execution"],
      };
    }

    if (input.methodAllowlistEnforced === false) {
      return {
        providerKey: "neon",
        accepted: false,
        status: "UNSAFE",
        intrinsicProviderReadOnly: false,
        requiresAdapterMethodAllowlist: true,
        rejectionCode: "NEON_KEY_REQUIRES_GET_ONLY_ADAPTER_LOCK",
        reason:
          "Neon API keys (including project-scoped keys) are not intrinsically read-only at Neon's API gateway and cannot be used without Avenor's GET-only endpoint allowlist enabled.",
        prohibitedCapabilitiesBlocked: [
          "branch_creation_or_deletion",
          "compute_endpoint_mutation",
          "connection_uri_or_password_retrieval",
        ],
      };
    }

    return {
      providerKey: "neon",
      accepted: true,
      status: "SUPPORTED_WITH_LIMITATIONS",
      intrinsicProviderReadOnly: false,
      requiresAdapterMethodAllowlist: true,
      rejectionCode: null,
      reason:
        input.credentialType === "neon_project_scoped_api_key"
          ? "Neon project-scoped API key accepted with limitation: key is scoped to a single project but not intrinsically read-only upstream; Avenor's GET-only control-plane allowlist enforces read-only behavior and blocks /connection_uri and /reveal_password."
          : "Neon control-plane API key accepted under Avenor's GET-only HTTP allowlist (`console.neon.tech/api/v2`).",
      prohibitedCapabilitiesBlocked: [
        "direct_sql_execution",
        "connection_uri_retrieval",
        "role_password_reveal",
        "branch_or_endpoint_mutation",
      ],
    };
  }

  // 3. Supabase credential evaluation
  if (input.providerKey === "supabase") {
    if (
      input.credentialType === "supabase_service_role_key" ||
      input.credentialType === "supabase_secret_key" ||
      /^sb_secret_/i.test(raw) ||
      /service_role/i.test(raw)
    ) {
      return {
        providerKey: "supabase",
        accepted: false,
        status: "UNSAFE",
        intrinsicProviderReadOnly: false,
        requiresAdapterMethodAllowlist: true,
        rejectionCode: "PROHIBITED_SUPABASE_SERVICE_ROLE_OR_SECRET_KEY",
        reason:
          "Supabase `service_role` JWTs and `sb_secret_*` keys bypass Row Level Security (RLS) and grant full read/write access to customer tables and `auth.users`. Avenor strictly refuses to accept or store them.",
        prohibitedCapabilitiesBlocked: [
          "rls_bypass",
          "customer_table_read_write",
          "raw_auth_users_pii_enumeration",
          "storage_bucket_object_access",
        ],
      };
    }

    const jwtPayload = decodeJwtPayloadUnsafe(raw);
    if (
      jwtPayload &&
      (jwtPayload.role === "service_role" || jwtPayload.role === "supabase_admin")
    ) {
      return {
        providerKey: "supabase",
        accepted: false,
        status: "UNSAFE",
        intrinsicProviderReadOnly: false,
        requiresAdapterMethodAllowlist: true,
        rejectionCode: "PROHIBITED_SUPABASE_SERVICE_ROLE_JWT_CLAIM",
        reason:
          "Decoded JWT contains `role: service_role` or `supabase_admin`, which bypasses Row Level Security. Avenor refuses this credential.",
        prohibitedCapabilitiesBlocked: ["rls_bypass", "raw_auth_users_pii_enumeration"],
      };
    }

    const scopes = input.grantedScopes ?? [];
    const hasWriteScope = scopes.some((scope) => /:write$|:admin$|:create$|:delete$/i.test(scope));
    if (hasWriteScope) {
      return {
        providerKey: "supabase",
        accepted: false,
        status: "UNSAFE",
        intrinsicProviderReadOnly: false,
        requiresAdapterMethodAllowlist: true,
        rejectionCode: "PROHIBITED_SUPABASE_WRITE_SCOPE",
        reason: `Supabase credential includes mutating scope(s) (${scopes.join(", ")}). Only read scopes (projects:read, analytics:read, organizations:read) are permitted.`,
        prohibitedCapabilitiesBlocked: ["project_mutation", "sql_query_execution"],
      };
    }

    return {
      providerKey: "supabase",
      accepted: true,
      status: "SUPPORTED",
      intrinsicProviderReadOnly: input.credentialType === "supabase_oauth_token",
      requiresAdapterMethodAllowlist: true,
      rejectionCode: null,
      reason:
        "Supabase Management API read credential accepted. Avenor enforces GET-only access to `api.supabase.com/v1` and blocks `/database/query` and `/api-keys`.",
      prohibitedCapabilitiesBlocked: [
        "management_api_sql_execution",
        "project_api_key_retrieval",
        "raw_auth_users_pii_enumeration",
      ],
    };
  }

  // 4. Firebase / Google Cloud Monitoring credential evaluation
  if (
    input.credentialType === "firebase_admin_sdk_key" ||
    raw.includes('"private_key"') ||
    raw.includes("BEGIN PRIVATE KEY") ||
    raw.includes("firebase-adminsdk")
  ) {
    return {
      providerKey: "firebase-monitoring",
      accepted: false,
      status: "UNSAFE",
      intrinsicProviderReadOnly: false,
      requiresAdapterMethodAllowlist: true,
      rejectionCode: "PROHIBITED_FIREBASE_ADMIN_SDK_CREDENTIAL",
      reason:
        "Firebase Admin SDK service-account credentials grant administrative access to Firestore data, Cloud Storage objects, and Firebase Auth user PII (`auth.listUsers()`). Avenor strictly refuses Firebase Admin SDK credentials.",
      prohibitedCapabilitiesBlocked: [
        "firebase_auth_user_pii_enumeration",
        "firestore_document_data_access",
        "cloud_storage_object_access",
      ],
    };
  }

  const grantedScopes = input.grantedScopes ?? [];
  const hasBroadCloudPlatformScope = grantedScopes.some(
    (scope) =>
      scope === "https://www.googleapis.com/auth/cloud-platform" ||
      scope === "https://www.googleapis.com/auth/firebase" ||
      scope === "https://www.googleapis.com/auth/datastore",
  );
  if (hasBroadCloudPlatformScope) {
    return {
      providerKey: "firebase-monitoring",
      accepted: false,
      status: "UNSAFE",
      intrinsicProviderReadOnly: false,
      requiresAdapterMethodAllowlist: true,
      rejectionCode: "PROHIBITED_BROAD_GCP_OR_FIREBASE_SCOPE",
      reason:
        "Credential carries broad mutating/data-plane Google Cloud scopes (`cloud-platform`, `firebase`, or `datastore`). Only `https://www.googleapis.com/auth/monitoring.read` (and optional `cloudplatformprojects.readonly`) is permitted.",
      prohibitedCapabilitiesBlocked: [
        "gcp_resource_mutation",
        "firestore_document_data_access",
        "firebase_auth_user_pii_enumeration",
      ],
    };
  }

  const hasMonitoringRead = grantedScopes.includes(
    "https://www.googleapis.com/auth/monitoring.read",
  );
  if (!hasMonitoringRead) {
    return {
      providerKey: "firebase-monitoring",
      accepted: false,
      status: "PERMISSION_DENIED",
      intrinsicProviderReadOnly: true,
      requiresAdapterMethodAllowlist: true,
      rejectionCode: "MISSING_MONITORING_READ_SCOPE",
      reason:
        "Missing required Google OAuth scope `https://www.googleapis.com/auth/monitoring.read` for read-only Cloud Monitoring telemetry.",
      prohibitedCapabilitiesBlocked: [],
    };
  }

  return {
    providerKey: "firebase-monitoring",
    accepted: true,
    status: "SUPPORTED",
    intrinsicProviderReadOnly: true,
    requiresAdapterMethodAllowlist: true,
    rejectionCode: null,
    reason:
      "Google OAuth token with `https://www.googleapis.com/auth/monitoring.read` verified. Cryptographically enforced read-only telemetry access confirmed.",
    prohibitedCapabilitiesBlocked: [
      "firebase_auth_user_pii_enumeration",
      "firestore_document_data_access",
      "cloud_storage_object_access",
    ],
  };
}

export function assertSafeBackendCredential(
  input: BackendCredentialSafetyInput,
): BackendCredentialSafetyVerdict {
  const verdict = evaluateBackendCredentialSafety(input);
  if (!verdict.accepted) {
    throw new AppError({
      code:
        verdict.status === "UNSAFE"
          ? ERROR_CODES.PRODUCTION_SAFETY_VIOLATION
          : ERROR_CODES.FORBIDDEN,
      message: verdict.reason,
      details: {
        providerKey: verdict.providerKey,
        status: verdict.status,
        rejectionCode: verdict.rejectionCode ?? "REJECTED",
        prohibitedCapabilitiesBlocked: [...verdict.prohibitedCapabilitiesBlocked],
      },
    });
  }
  return verdict;
}

export function getBackendProviderFeasibilityMatrix(
  providerKey?: BackendProviderKey,
): readonly BackendDimensionEvaluation[] {
  if (!providerKey) {
    return BACKEND_FEASIBILITY_MATRIX;
  }
  return BACKEND_FEASIBILITY_MATRIX.filter((row) => row.providerKey === providerKey);
}

export function getBackendDimensionEvaluation(
  providerKey: BackendProviderKey,
  dimensionKey: BackendCapabilityDimensionKey,
): BackendDimensionEvaluation {
  const match = BACKEND_FEASIBILITY_MATRIX.find(
    (row) => row.providerKey === providerKey && row.dimensionKey === dimensionKey,
  );
  if (!match) {
    throw new AppError({
      code: ERROR_CODES.NOT_FOUND,
      message: `Missing backend feasibility matrix entry for provider="${providerKey}" dimension="${dimensionKey}".`,
    });
  }
  return match;
}
