import type { ProviderCatalogEntry } from "@avenor/types";

export const PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = [
  {
    providerKey: "avenor-sandbox",
    displayName: "Avenor Read-Only Sandbox",
    shortName: "Sandbox",
    category: "sandbox",
    authMode: "sandbox",
    availabilityStatus: "active_sandbox",
    targetMilestone: "M02",
    summary:
      "Deterministic read-only OAuth 2.0 + PKCE verification provider for testing resource discovery, capability inspection, environment mapping, and health transitions.",
    readOnlyGuaranteeText:
      "Uses scoped read-only sandbox grants (`sandbox.resources.readonly`, `sandbox.metrics.readonly`). Cannot create, mutate, or delete any external resource.",
    prohibitedOperationsSummary: [
      "Cannot create, modify, or delete sandbox properties or environments",
      "Cannot execute write queries or trigger administrative actions",
      "Cannot alter billing, access policies, or team permissions",
    ],
    resourceTypeLabel: "Sandbox Telemetry Stream",
    resourceTypeKey: "sandbox_stream",
    oauthAuthorizeUrl: "/api/connections/oauth/sandbox-authorize",
    oauthTokenUrl: "https://sandbox.avenor.internal/oauth/token",
    oauthRevokeUrl: "https://sandbox.avenor.internal/oauth/revoke",
    defaultScopes: ["sandbox.resources.readonly", "sandbox.metrics.readonly"],
    capabilities: [
      {
        capabilityKey: "resource_discovery",
        label: "Stream & Property Discovery",
        description:
          "Lists available read-only telemetry streams and environment metadata for project mapping.",
        requiredScopes: ["sandbox.resources.readonly"],
        requiredPermissions: ["Viewer"],
        supportedGranularities: ["daily", "hourly"],
        supportedDimensions: ["environment", "region", "surface"],
        expectedLatencyMinutes: 1,
        freshnessWindowMinutes: 15,
        rateLimitPolicy: {
          requestsPerMinute: 120,
          burstLimit: 30,
          retryStrategy: "exponential_backoff",
        },
      },
      {
        capabilityKey: "analytics_sessions",
        label: "Session & Acquisition Observation",
        description:
          "Reads aggregated session, active user, and acquisition channel series without raw PII.",
        requiredScopes: ["sandbox.metrics.readonly"],
        requiredPermissions: ["Viewer", "Metrics Reader"],
        supportedGranularities: ["hourly", "daily", "weekly", "monthly"],
        supportedDimensions: ["channel", "country", "deviceCategory"],
        expectedLatencyMinutes: 5,
        freshnessWindowMinutes: 30,
        rateLimitPolicy: {
          requestsPerMinute: 60,
          burstLimit: 15,
          retryStrategy: "retry_after_header",
        },
      },
      {
        capabilityKey: "enterprise_audit_stream",
        label: "Enterprise High-Frequency Stream",
        description: "Sub-minute telemetry stream available only on enterprise provider tiers.",
        requiredScopes: ["sandbox.metrics.readonly"],
        requiredPermissions: ["Enterprise Viewer"],
        supportedGranularities: ["realtimeSnapshot", "hourly"],
        supportedDimensions: ["region", "edgePop"],
        expectedLatencyMinutes: 1,
        freshnessWindowMinutes: 5,
        requiresPaidProviderPlan: true,
        rateLimitPolicy: {
          requestsPerMinute: 30,
          burstLimit: 10,
          retryStrategy: "retry_after_header",
        },
      },
      {
        capabilityKey: "raw_sql_inspection",
        label: "Raw User Table Row Inspection",
        description:
          "Direct inspection of application database rows is prohibited by Avenor's privacy and read-only boundary.",
        requiredScopes: ["sandbox.resources.readonly"],
        requiredPermissions: ["Not Applicable"],
        supportedGranularities: ["daily"],
        supportedDimensions: [],
        expectedLatencyMinutes: 0,
        freshnessWindowMinutes: 0,
        defaultStatus: "UNSUPPORTED_BY_PROVIDER",
        rateLimitPolicy: {
          requestsPerMinute: 0,
          burstLimit: 0,
          retryStrategy: "exponential_backoff",
        },
      },
    ],
  },
  {
    providerKey: "ga4",
    displayName: "Google Analytics 4",
    shortName: "GA4",
    category: "analytics",
    authMode: "oauth2",
    availabilityStatus: "oauth_framework_ready",
    targetMilestone: "M03",
    summary:
      "Read-only GA4 Admin API property discovery and Data API standard reporting via Google OAuth 2.0 (`analytics.readonly`), preserving property timezone, thresholding, and sampling metadata.",
    readOnlyGuaranteeText:
      "Requests only `https://www.googleapis.com/auth/analytics.readonly`. Avenor cannot create or edit GA4 properties, data streams, conversion events, or user access.",
    prohibitedOperationsSummary: [
      "Cannot create, edit, or delete GA4 properties or web data streams",
      "Cannot modify conversion events, audiences, or retention settings",
      "Cannot manage Google Analytics IAM roles or property users",
    ],
    resourceTypeLabel: "GA4 Property",
    resourceTypeKey: "ga4_property",
    oauthAuthorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    oauthTokenUrl: "https://oauth2.googleapis.com/token",
    oauthRevokeUrl: "https://oauth2.googleapis.com/revoke",
    defaultScopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    capabilities: [
      {
        capabilityKey: "resource_discovery",
        label: "GA4 Account & Property Discovery",
        description:
          "Enumerates accessible GA4 accounts, properties, and web data streams via Admin API read endpoints.",
        requiredScopes: ["https://www.googleapis.com/auth/analytics.readonly"],
        requiredPermissions: ["Viewer"],
        supportedGranularities: ["daily"],
        supportedDimensions: ["propertyId", "timeZone", "currencyCode"],
        expectedLatencyMinutes: 5,
        freshnessWindowMinutes: 60,
        rateLimitPolicy: {
          requestsPerMinute: 60,
          burstLimit: 20,
          retryStrategy: "exponential_backoff",
        },
      },
      {
        capabilityKey: "analytics_sessions",
        label: "Sessions, Users & Acquisition Series",
        description:
          "Reads daily and hourly sessions, engaged sessions, active users, engagement rate, average session duration, key events, and channel/landing-page attribution via GA4 Data API.",
        requiredScopes: ["https://www.googleapis.com/auth/analytics.readonly"],
        requiredPermissions: ["Viewer"],
        supportedGranularities: ["hourly", "daily", "weekly", "monthly"],
        supportedDimensions: [
          "date",
          "sessionDefaultChannelGroup",
          "sessionSourceMedium",
          "landingPage",
          "pagePath",
          "pageTitle",
          "country",
          "city",
          "deviceCategory",
          "platform",
          "eventName",
        ],
        expectedLatencyMinutes: 240,
        freshnessWindowMinutes: 360,
        rateLimitPolicy: {
          requestsPerMinute: 60,
          burstLimit: 15,
          retryStrategy: "retry_after_header",
        },
      },
      {
        capabilityKey: "realtime_activity",
        label: "Realtime Active Users (30-Min Estimate)",
        description:
          "Reads estimated active users, pageviews, and events over the rolling 30-minute window via GA4 Data API runRealtimeReport using only realtime-compatible dimensions.",
        requiredScopes: ["https://www.googleapis.com/auth/analytics.readonly"],
        requiredPermissions: ["Viewer"],
        supportedGranularities: ["realtimeSnapshot"],
        supportedDimensions: [
          "minutesAgo",
          "country",
          "deviceCategory",
          "unifiedScreenName",
          "platform",
        ],
        expectedLatencyMinutes: 1,
        freshnessWindowMinutes: 1,
        rateLimitPolicy: {
          requestsPerMinute: 30,
          burstLimit: 5,
          retryStrategy: "retry_after_header",
        },
      },
    ],
  },
  {
    providerKey: "gsc",
    displayName: "Google Search Console",
    shortName: "Search Console",
    category: "search",
    authMode: "oauth2",
    availabilityStatus: "oauth_framework_ready",
    targetMilestone: "M03",
    summary:
      "Read-only verified site discovery (Domain sc-domain: & URL-prefix properties) and search performance contract via `webmasters.readonly`.",
    readOnlyGuaranteeText:
      "Requests only `https://www.googleapis.com/auth/webmasters.readonly`. Avenor cannot submit sitemaps, request URL removals, or alter site verification ownership.",
    prohibitedOperationsSummary: [
      "Cannot submit or delete XML sitemaps",
      "Cannot request URL removals or recrawls",
      "Cannot add or remove verified property owners",
    ],
    resourceTypeLabel: "Verified Search Property",
    resourceTypeKey: "gsc_site",
    oauthAuthorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    oauthTokenUrl: "https://oauth2.googleapis.com/token",
    oauthRevokeUrl: "https://oauth2.googleapis.com/revoke",
    defaultScopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
    capabilities: [
      {
        capabilityKey: "resource_discovery",
        label: "Verified Site & Domain Property Discovery",
        description:
          "Lists domain and URL-prefix properties where the user holds read-only viewer access.",
        requiredScopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
        requiredPermissions: ["Restricted Viewer / Full Viewer"],
        supportedGranularities: ["daily"],
        supportedDimensions: ["siteUrl", "permissionLevel"],
        expectedLatencyMinutes: 5,
        freshnessWindowMinutes: 60,
        rateLimitPolicy: {
          requestsPerMinute: 60,
          burstLimit: 20,
          retryStrategy: "exponential_backoff",
        },
      },
      {
        capabilityKey: "search_queries",
        label: "Organic Clicks, Impressions, CTR & Position",
        description:
          "Reads Search Analytics clicks, impressions, weighted CTR, and impression-weighted average position across date, query, page, country, device, and searchAppearance in Pacific Time.",
        requiredScopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
        requiredPermissions: ["Restricted Viewer"],
        supportedGranularities: ["daily", "weekly", "monthly"],
        supportedDimensions: ["date", "query", "page", "country", "device", "searchAppearance"],
        expectedLatencyMinutes: 2880,
        freshnessWindowMinutes: 4320,
        rateLimitPolicy: {
          requestsPerMinute: 120,
          burstLimit: 30,
          retryStrategy: "exponential_backoff",
        },
      },
    ],
  },
  {
    providerKey: "github",
    displayName: "GitHub",
    shortName: "GitHub",
    category: "delivery_reliability",
    authMode: "oauth2",
    availabilityStatus: "oauth_framework_ready",
    targetMilestone: "M08",
    summary:
      "Read-only repository, release, and workflow run metadata discovery via fine-grained read scopes (`repo:status`, `read:org`). Full delivery correlation arrives in Milestone 08.",
    readOnlyGuaranteeText:
      "Uses read-only repository metadata and deployment status scopes. Avenor never clones private source code, pushes commits, merges PRs, or triggers GitHub Actions.",
    prohibitedOperationsSummary: [
      "Cannot read or clone private source code contents",
      "Cannot push commits, merge pull requests, or edit branches",
      "Cannot trigger, cancel, or modify GitHub Actions workflows",
    ],
    resourceTypeLabel: "GitHub Repository",
    resourceTypeKey: "github_repository",
    oauthAuthorizeUrl: "https://github.com/login/oauth/authorize",
    oauthTokenUrl: "https://github.com/login/oauth/access_token",
    defaultScopes: ["read:user", "repo:status", "public_repo"],
    capabilities: [
      {
        capabilityKey: "resource_discovery",
        label: "Repository & Deployment Environment Discovery",
        description:
          "Lists accessible repositories and deployment environment names for release correlation.",
        requiredScopes: ["read:user", "repo:status"],
        requiredPermissions: ["Repository Metadata: Read-only"],
        supportedGranularities: ["daily"],
        supportedDimensions: ["repository", "defaultBranch", "visibility"],
        expectedLatencyMinutes: 2,
        freshnessWindowMinutes: 30,
        rateLimitPolicy: {
          requestsPerMinute: 80,
          burstLimit: 25,
          retryStrategy: "retry_after_header",
        },
      },
      {
        capabilityKey: "repository_activity",
        label: "Release & Workflow Run Cadence",
        description:
          "Observes release timestamps, deployment statuses, and workflow pass/fail ratios (distinguishing status vs conclusion and run attempts).",
        requiredScopes: ["repo:status"],
        requiredPermissions: ["Deployments: Read-only", "Actions: Read-only"],
        supportedGranularities: ["hourly", "daily", "weekly"],
        supportedDimensions: ["workflow", "branch", "environment"],
        expectedLatencyMinutes: 5,
        freshnessWindowMinutes: 30,
        rateLimitPolicy: {
          requestsPerMinute: 80,
          burstLimit: 25,
          retryStrategy: "retry_after_header",
        },
      },
    ],
  },
  {
    providerKey: "gcp-billing",
    displayName: "Google Cloud Billing",
    shortName: "Cloud Billing",
    category: "cloud_billing",
    authMode: "oauth2",
    availabilityStatus: "oauth_framework_ready",
    targetMilestone: "M05",
    summary:
      "Read-only Google Cloud Billing account and linked project discovery (`cloud-billing.readonly`), plus customer-authorized BigQuery billing export cost reporting (`bigquery.readonly`).",
    readOnlyGuaranteeText:
      "Requests only `https://www.googleapis.com/auth/cloud-billing.readonly` for account/project metadata discovery and `https://www.googleapis.com/auth/bigquery.readonly` when a BigQuery billing export dataset is linked. Never modifies billing accounts, budgets, export settings, or cloud resources.",
    prohibitedOperationsSummary: [
      "Cannot create, modify, or delete GCP billing accounts, budgets, or payment methods",
      "Cannot enable or modify BigQuery billing export configurations or IAM bindings",
      "Cannot mutate BigQuery billing export tables or run DDL/DML statements",
    ],
    resourceTypeLabel: "Billing Account & Linked GCP Project",
    resourceTypeKey: "gcp_billing_project",
    oauthAuthorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    oauthTokenUrl: "https://oauth2.googleapis.com/token",
    oauthRevokeUrl: "https://oauth2.googleapis.com/revoke",
    defaultScopes: ["https://www.googleapis.com/auth/cloud-billing.readonly"],
    capabilities: [
      {
        capabilityKey: "resource_discovery",
        label: "Billing Account & Linked GCP Project Discovery (Metadata Only)",
        description:
          "Discovers accessible Google Cloud Billing accounts, account status, currency, and linked Google Cloud project associations via Cloud Billing API v1. Does not provide historical cost series without a BigQuery export.",
        requiredScopes: ["https://www.googleapis.com/auth/cloud-billing.readonly"],
        requiredPermissions: ["Billing Account Viewer (roles/billing.viewer)"],
        supportedGranularities: ["daily"],
        supportedDimensions: ["billingAccountId", "gcpProjectId", "currencyCode"],
        expectedLatencyMinutes: 5,
        freshnessWindowMinutes: 60,
        rateLimitPolicy: {
          requestsPerMinute: 60,
          burstLimit: 15,
          retryStrategy: "exponential_backoff",
        },
      },
      {
        capabilityKey: "billing_cost_export",
        label: "Daily Cost, SKU & Credit Breakdown (BigQuery Export)",
        description:
          "Reads daily gross cost, net cost after credits, service/SKU attribution, and project labels from a customer-configured BigQuery Cloud Billing export.",
        requiredScopes: ["https://www.googleapis.com/auth/bigquery.readonly"],
        requiredPermissions: [
          "BigQuery Data Viewer (roles/bigquery.dataViewer)",
          "BigQuery Job User (roles/bigquery.jobUser)",
        ],
        supportedGranularities: ["daily", "monthly"],
        supportedDimensions: ["service", "sku", "project", "region", "currency", "invoiceMonth"],
        expectedLatencyMinutes: 360,
        freshnessWindowMinutes: 720,
        rateLimitPolicy: {
          requestsPerMinute: 30,
          burstLimit: 10,
          retryStrategy: "exponential_backoff",
        },
      },
    ],
  },
  {
    providerKey: "neon",
    displayName: "Neon Serverless Postgres",
    shortName: "Neon",
    category: "database_backend",
    authMode: "api_token",
    availabilityStatus: "oauth_framework_ready",
    targetMilestone: "M06",
    summary:
      "Read-only project, branch, compute CU-seconds, active time, and storage footprint telemetry via Neon Control Plane API v2 (`console.neon.tech/api/v2`) with GET-only endpoint lock. Never connects to user databases or executes SQL.",
    readOnlyGuaranteeText:
      "Inspects Neon Control Plane consumption and branch metadata only under a strict GET-only HTTP allowlist. Never connects to your Postgres database, never retrieves connection URIs or passwords, and never reads application tables.",
    prohibitedOperationsSummary: [
      "Never opens a Postgres connection to customer databases or executes SQL",
      "Cannot create, reset, or delete Neon branches or compute endpoints",
      "Cannot read database roles, connection strings, or application rows",
    ],
    resourceTypeLabel: "Neon Project",
    resourceTypeKey: "neon_project",
    defaultScopes: ["neon.projects.readonly", "neon.consumption.readonly"],
    capabilities: [
      {
        capabilityKey: "resource_discovery",
        label: "Project, Branch, Database & Compute Endpoint Discovery",
        description:
          "Discovers Neon projects, branches (PRODUCTION/STAGING/DEVELOPMENT), metadata-only database listings, and compute autoscaling bounds without retrieving connection URIs.",
        requiredScopes: ["neon.projects.readonly"],
        requiredPermissions: [
          "Organization or Project Control Plane Key (Adapter GET-Only Locked)",
        ],
        supportedGranularities: ["daily"],
        supportedDimensions: ["projectId", "branchId", "region", "environmentHint"],
        expectedLatencyMinutes: 5,
        freshnessWindowMinutes: 30,
        rateLimitPolicy: {
          requestsPerMinute: 40,
          burstLimit: 10,
          retryStrategy: "retry_after_header",
        },
      },
      {
        capabilityKey: "postgres_metadata",
        label: "Compute CU-Seconds, Active Time & Storage Footprint",
        description:
          "Reads compute-unit seconds (CU-seconds), active compute seconds, billing-horizon storage consumption (bytes-month), instantaneous branch logical size (bytes), and network transfer from the Neon Consumption API v2.",
        requiredScopes: ["neon.projects.readonly", "neon.consumption.readonly"],
        requiredPermissions: [
          "Organization or Project Control Plane Key (Launch/Scale/Business for consumption_history)",
        ],
        supportedGranularities: ["hourly", "daily", "monthly"],
        supportedDimensions: ["projectId", "branchId", "region"],
        expectedLatencyMinutes: 15,
        freshnessWindowMinutes: 60,
        requiresPaidProviderPlan: true,
        rateLimitPolicy: {
          requestsPerMinute: 40,
          burstLimit: 10,
          retryStrategy: "retry_after_header",
        },
      },
      {
        capabilityKey: "user_count_posture",
        label: "Application Registered User Directory Count",
        description:
          "Neon is a serverless PostgreSQL engine without a control-plane application user directory; querying customer SQL tables for user counts is prohibited.",
        requiredScopes: ["neon.projects.readonly"],
        requiredPermissions: ["Not Applicable (Zero-SQL Boundary)"],
        supportedGranularities: ["daily"],
        supportedDimensions: [],
        expectedLatencyMinutes: 0,
        freshnessWindowMinutes: 0,
        defaultStatus: "UNSUPPORTED_BY_PROVIDER",
        rateLimitPolicy: {
          requestsPerMinute: 0,
          burstLimit: 0,
          retryStrategy: "exponential_backoff",
        },
      },
    ],
  },
  {
    providerKey: "supabase",
    displayName: "Supabase",
    shortName: "Supabase",
    category: "database_backend",
    authMode: "api_token",
    availabilityStatus: "oauth_framework_ready",
    targetMilestone: "M06",
    summary:
      "Read-only project health, database & storage usage, active connections, API/Auth request traffic, and safe aggregate Auth user count telemetry via Management API v1 read scopes (`projects:read`, `analytics:read`). Rejects `service_role` and `sb_secret` keys.",
    readOnlyGuaranteeText:
      "Uses Supabase Management API read scopes only (`projects:read`, `analytics:read`). Unconditionally rejects `service_role` JWTs and `sb_secret` keys, blocks `/database/query` and `/api-keys`, and never reads customer table rows, `auth.users` PII, or storage bucket objects.",
    prohibitedOperationsSummary: [
      "Never accepts `service_role` or `sb_secret` keys and never executes SQL queries against customer tables",
      "Cannot read `auth.users` email addresses, phone numbers, or password hashes",
      "Cannot pause, restore, migrate, or reconfigure Supabase projects",
    ],
    resourceTypeLabel: "Supabase Project",
    resourceTypeKey: "supabase_project",
    defaultScopes: ["projects:read", "analytics:read"],
    capabilities: [
      {
        capabilityKey: "resource_discovery",
        label: "Project, Service Health & Security Posture Discovery",
        description:
          "Discovers accessible Supabase projects, subsystem health (db, auth, rest, storage, realtime), and passive SSL/MFA/network posture via Management API v1.",
        requiredScopes: ["projects:read"],
        requiredPermissions: ["Read-Only Management Token (projects:read)"],
        supportedGranularities: ["daily"],
        supportedDimensions: ["projectRef", "region", "status"],
        expectedLatencyMinutes: 5,
        freshnessWindowMinutes: 30,
        rateLimitPolicy: {
          requestsPerMinute: 60,
          burstLimit: 15,
          retryStrategy: "retry_after_header",
        },
      },
      {
        capabilityKey: "postgres_metadata",
        label: "Database Size, Storage Footprint, Connections & Request Volume",
        description:
          "Reads database size bytes, object storage size bytes, active connections, API gateway request volume, and GoTrue Auth HTTP request volume (`supabase.auth_requests`).",
        requiredScopes: ["projects:read", "analytics:read"],
        requiredPermissions: ["Read-Only Management Token (projects:read, analytics:read)"],
        supportedGranularities: ["hourly", "daily", "monthly"],
        supportedDimensions: ["projectRef", "region", "service"],
        expectedLatencyMinutes: 30,
        freshnessWindowMinutes: 60,
        rateLimitPolicy: {
          requestsPerMinute: 60,
          burstLimit: 15,
          retryStrategy: "retry_after_header",
        },
      },
      {
        capabilityKey: "user_count_posture",
        label: "Aggregate Registered Auth User Count (Zero-PII Counter)",
        description:
          "Reads aggregate registered Auth user count (`supabase.registered_auth_users`) only when exposed by an allowlisted aggregate usage counter endpoint, strictly separate from `supabase.auth_requests` and without querying raw `auth.users` rows.",
        requiredScopes: ["projects:read", "analytics:read"],
        requiredPermissions: ["Read-Only Management Token (analytics:read)"],
        supportedGranularities: ["daily", "monthly"],
        supportedDimensions: ["projectRef", "region"],
        expectedLatencyMinutes: 30,
        freshnessWindowMinutes: 60,
        rateLimitPolicy: {
          requestsPerMinute: 60,
          burstLimit: 15,
          retryStrategy: "retry_after_header",
        },
      },
    ],
  },
  {
    providerKey: "firebase-monitoring",
    displayName: "Firebase / Google Cloud Monitoring",
    shortName: "Firebase",
    category: "database_backend",
    authMode: "oauth2",
    availabilityStatus: "oauth_framework_ready",
    targetMilestone: "M06",
    summary:
      "Read-only Firestore operations, realtime listeners, Cloud Functions invocations/errors/latency, Cloud Storage bytes, and passive Security Rules telemetry via Google Cloud Monitoring API v3 (`monitoring.read`). Refuses Firebase Admin SDK credentials.",
    readOnlyGuaranteeText:
      "Requests only `https://www.googleapis.com/auth/monitoring.read` via Google OAuth 2.0. Cryptographically enforced as read-only time-series telemetry by Google IAM; never accepts Firebase Admin SDK keys and cannot read Firestore documents, Storage objects, or Firebase Auth user PII.",
    prohibitedOperationsSummary: [
      "Never accepts Firebase Admin SDK service-account keys or calls `auth.listUsers()`",
      "Cannot read, write, or delete Firestore documents or Cloud Storage bucket objects",
      "Cannot deploy, invoke, or alter Cloud Functions or Security Rules",
    ],
    resourceTypeLabel: "Firebase / GCP Monitored Project",
    resourceTypeKey: "firebase_gcp_project",
    oauthAuthorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    oauthTokenUrl: "https://oauth2.googleapis.com/token",
    oauthRevokeUrl: "https://oauth2.googleapis.com/revoke",
    defaultScopes: ["https://www.googleapis.com/auth/monitoring.read"],
    capabilities: [
      {
        capabilityKey: "resource_discovery",
        label: "Monitored Resource & Metric Descriptor Discovery",
        description:
          "Discovers enabled Firebase/GCP telemetry surfaces (`firestore_instance`, `cloud_function`, `gcs_bucket`, Security Rules evaluations) via Cloud Monitoring API v3 GET descriptors.",
        requiredScopes: ["https://www.googleapis.com/auth/monitoring.read"],
        requiredPermissions: ["Monitoring Viewer (roles/monitoring.viewer)"],
        supportedGranularities: ["daily"],
        supportedDimensions: ["gcpProjectId", "region"],
        expectedLatencyMinutes: 5,
        freshnessWindowMinutes: 30,
        rateLimitPolicy: {
          requestsPerMinute: 60,
          burstLimit: 15,
          retryStrategy: "exponential_backoff",
        },
      },
      {
        capabilityKey: "firebase_telemetry",
        label: "Firestore, Functions, Storage & Rules Telemetry",
        description:
          "Reads GAUGE, DELTA, and CUMULATIVE time series for Firestore reads/writes/deletes/listeners, Cloud Functions invocations/errors/duration, Cloud Storage bytes, and Rules evaluations.",
        requiredScopes: ["https://www.googleapis.com/auth/monitoring.read"],
        requiredPermissions: ["Monitoring Viewer (roles/monitoring.viewer)"],
        supportedGranularities: ["hourly", "daily", "monthly"],
        supportedDimensions: ["gcpProjectId", "metricKind", "rollupStrategy"],
        expectedLatencyMinutes: 5,
        freshnessWindowMinutes: 30,
        rateLimitPolicy: {
          requestsPerMinute: 60,
          burstLimit: 15,
          retryStrategy: "exponential_backoff",
        },
      },
      {
        capabilityKey: "user_count_posture",
        label: "Firebase Auth Registered User Directory Count",
        description:
          "Cloud Monitoring `monitoring.read` does not expose a registered user headcount descriptor, and enumerating users with Firebase Admin SDK (`auth.listUsers()`) exposes PII and is prohibited.",
        requiredScopes: ["https://www.googleapis.com/auth/monitoring.read"],
        requiredPermissions: ["Not Applicable (Admin SDK Prohibited)"],
        supportedGranularities: ["daily"],
        supportedDimensions: [],
        expectedLatencyMinutes: 0,
        freshnessWindowMinutes: 0,
        defaultStatus: "UNSUPPORTED_BY_PROVIDER",
        rateLimitPolicy: {
          requestsPerMinute: 0,
          burstLimit: 0,
          retryStrategy: "exponential_backoff",
        },
      },
    ],
  },
  {
    providerKey: "vercel",
    displayName: "Vercel",
    shortName: "Vercel",
    category: "hosting_edge",
    authMode: "api_token",
    availabilityStatus: "oauth_framework_ready",
    targetMilestone: "M08",
    summary:
      "Read-only project discovery, deployment success rate, build duration, preview vs production reliability, and FOCUS 1.3 billing charges via read-only Vercel access tokens.",
    readOnlyGuaranteeText:
      "Inspects deployment metadata, project domains, and FOCUS billing charges under a strict GET-only allowlist. Cannot trigger redeployments, promote/rollback builds, or read Vercel environment variable values.",
    prohibitedOperationsSummary: [
      "Cannot trigger, cancel, promote, or rollback Vercel deployments",
      "Cannot read or modify decrypted environment variables or secrets",
      "Cannot alter domains, DNS records, webhooks, or project settings",
    ],
    resourceTypeLabel: "Vercel Project",
    resourceTypeKey: "vercel_project",
    defaultScopes: ["projects:read", "deployments:read"],
    capabilities: [
      {
        capabilityKey: "resource_discovery",
        label: "Vercel Project & Domain Discovery",
        description:
          "Discovers accessible Vercel projects, frameworks, and domain bindings via GET-only endpoints.",
        requiredScopes: ["projects:read"],
        requiredPermissions: ["Viewer / Read-Only Token"],
        supportedGranularities: ["daily"],
        supportedDimensions: ["projectId", "framework", "accountId"],
        expectedLatencyMinutes: 2,
        freshnessWindowMinutes: 30,
        rateLimitPolicy: {
          requestsPerMinute: 100,
          burstLimit: 25,
          retryStrategy: "retry_after_header",
        },
      },
      {
        capabilityKey: "deployment_reliability",
        label: "Deployment Success Rate & Build Duration",
        description:
          "Reads production and preview deployment states, build durations, and error rates.",
        requiredScopes: ["projects:read", "deployments:read"],
        requiredPermissions: ["Viewer / Read-Only Token"],
        supportedGranularities: ["hourly", "daily", "weekly"],
        supportedDimensions: ["target", "branch", "region"],
        expectedLatencyMinutes: 5,
        freshnessWindowMinutes: 30,
        rateLimitPolicy: {
          requestsPerMinute: 100,
          burstLimit: 25,
          retryStrategy: "retry_after_header",
        },
      },
      {
        capabilityKey: "billing_focus_charges",
        label: "FOCUS 1.3 Streaming NDJSON Billing Charges",
        description:
          "Reads Pro/Enterprise billing charges from GET /v1/billing/charges without summing heterogeneous currencies.",
        requiredScopes: ["projects:read"],
        requiredPermissions: ["Billing Viewer (Pro/Enterprise)"],
        supportedGranularities: ["daily", "monthly"],
        supportedDimensions: ["serviceName", "chargeCategory", "billingCurrency"],
        expectedLatencyMinutes: 60,
        freshnessWindowMinutes: 120,
        requiresPaidProviderPlan: true,
        rateLimitPolicy: {
          requestsPerMinute: 30,
          burstLimit: 10,
          retryStrategy: "retry_after_header",
        },
      },
    ],
  },
  {
    providerKey: "cloudflare",
    displayName: "Cloudflare",
    shortName: "Cloudflare",
    category: "hosting_edge",
    authMode: "api_token",
    availabilityStatus: "oauth_framework_ready",
    targetMilestone: "M08",
    summary:
      "Read-only zone request volume, cache hit ratio, bandwidth, HTTP 4xx/5xx edge error rates, and security telemetry via Cloudflare GraphQL Analytics (`Zone.Analytics:Read`).",
    readOnlyGuaranteeText:
      "Requires only `Zone.Analytics:Read` and `Account.Account Analytics:Read`. Blocks DNS edits, cache purges, WAF/ruleset mutations, GraphQL mutations, and Workers deployments.",
    prohibitedOperationsSummary: [
      "Cannot create, edit, or delete Cloudflare DNS records",
      "Cannot purge edge cache or modify WAF / Page Rules",
      "Cannot deploy or update Cloudflare Workers scripts or KV bindings",
    ],
    resourceTypeLabel: "Cloudflare Zone / Worker",
    resourceTypeKey: "cloudflare_zone",
    defaultScopes: ["zone.analytics:read", "account.analytics:read"],
    capabilities: [
      {
        capabilityKey: "edge_traffic",
        label: "Edge Requests, Cache Hit Ratio & 5xx Errors",
        description:
          "Reads GraphQL Analytics API totals for requests, weighted cache hit ratio, bandwidth, threats blocked, and 4xx/5xx status codes.",
        requiredScopes: ["zone.analytics:read"],
        requiredPermissions: ["Zone Analytics: Read"],
        supportedGranularities: ["hourly", "daily"],
        supportedDimensions: ["zoneTag", "statusMap", "cacheStatus", "country"],
        expectedLatencyMinutes: 5,
        freshnessWindowMinutes: 30,
        rateLimitPolicy: {
          requestsPerMinute: 120,
          burstLimit: 30,
          retryStrategy: "retry_after_header",
        },
      },
    ],
  },
  {
    providerKey: "sentry",
    displayName: "Sentry",
    shortName: "Sentry",
    category: "delivery_reliability",
    authMode: "api_token",
    availabilityStatus: "oauth_framework_ready",
    targetMilestone: "M08",
    summary:
      "Read-only crash-free session rate, PII-sanitized unresolved issue summaries, and performance percentiles (p50/p95) via `org:read`, `project:read`, and `event:read` auth tokens.",
    readOnlyGuaranteeText:
      "Uses `org:read`, `project:read`, and `event:read` scopes only; refuses write/admin tokens, blocks raw event PII endpoints, and scrubs emails/IPs/cookies/auth headers before persistence.",
    prohibitedOperationsSummary: [
      "Cannot resolve, ignore, merge, assign, or delete Sentry issues",
      "Cannot modify alert rules, integrations, or team memberships",
      "Cannot upload or delete release artifacts or source maps, or store raw event PII",
    ],
    resourceTypeLabel: "Sentry Project",
    resourceTypeKey: "sentry_project",
    defaultScopes: ["org:read", "project:read", "event:read"],
    capabilities: [
      {
        capabilityKey: "resource_discovery",
        label: "Sentry Organization & Project Discovery",
        description:
          "Discovers accessible Sentry projects and environments via GET-only endpoints.",
        requiredScopes: ["org:read", "project:read"],
        requiredPermissions: ["org:read", "project:read"],
        supportedGranularities: ["daily"],
        supportedDimensions: ["organizationSlug", "projectSlug", "platform"],
        expectedLatencyMinutes: 2,
        freshnessWindowMinutes: 15,
        rateLimitPolicy: {
          requestsPerMinute: 100,
          burstLimit: 25,
          retryStrategy: "retry_after_header",
        },
      },
      {
        capabilityKey: "issue_telemetry",
        label: "Crash-Free Sessions, PII-Safe Issues & Performance Percentiles",
        description:
          "Reads release health session stability, aggregate issue error event velocity (distinct from unique affected users), and provider-computed p50/p95 latency.",
        requiredScopes: ["project:read", "event:read"],
        requiredPermissions: ["project:read", "event:read"],
        supportedGranularities: ["hourly", "daily"],
        supportedDimensions: ["environment", "release", "level"],
        expectedLatencyMinutes: 2,
        freshnessWindowMinutes: 15,
        rateLimitPolicy: {
          requestsPerMinute: 100,
          burstLimit: 25,
          retryStrategy: "retry_after_header",
        },
      },
    ],
  },
] as const;

export function getProviderCatalogEntry(providerKey: string): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find((entry) => entry.providerKey === providerKey);
}

export function listProviderCatalogEntries(options?: {
  category?: string;
  search?: string;
  availabilityStatus?: string;
}): ProviderCatalogEntry[] {
  const category = options?.category?.trim();
  const search = options?.search?.trim().toLowerCase();
  const availability = options?.availabilityStatus?.trim();

  return PROVIDER_CATALOG.filter((entry) => {
    if (category && category !== "all" && entry.category !== category) {
      return false;
    }
    if (availability && availability !== "all" && entry.availabilityStatus !== availability) {
      return false;
    }
    if (search) {
      const haystack = [
        entry.providerKey,
        entry.displayName,
        entry.shortName,
        entry.summary,
        entry.resourceTypeLabel,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) {
        return false;
      }
    }
    return true;
  });
}
