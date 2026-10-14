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
      "Read-only property discovery and analytics capability contract via Google OAuth 2.0 (`analytics.readonly`). Full traffic and funnel ingestion arrives in Milestone 03.",
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
          "Reads daily and hourly sessions, engaged sessions, bounce rate, and channel attribution via GA4 Data API.",
        requiredScopes: ["https://www.googleapis.com/auth/analytics.readonly"],
        requiredPermissions: ["Viewer"],
        supportedGranularities: ["hourly", "daily", "weekly", "monthly"],
        supportedDimensions: [
          "sessionDefaultChannelGroup",
          "pagePath",
          "country",
          "deviceCategory",
        ],
        expectedLatencyMinutes: 240,
        freshnessWindowMinutes: 360,
        defaultStatus: "PREVIEW_ONLY",
        rateLimitPolicy: {
          requestsPerMinute: 60,
          burstLimit: 15,
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
    targetMilestone: "M04",
    summary:
      "Read-only verified site discovery and search performance capability contract via `webmasters.readonly`. Full query and page intelligence arrives in Milestone 04.",
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
          "Reads Search Analytics query, landing page, country, and device performance windows.",
        requiredScopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
        requiredPermissions: ["Restricted Viewer"],
        supportedGranularities: ["daily", "weekly", "monthly"],
        supportedDimensions: ["query", "page", "country", "device"],
        expectedLatencyMinutes: 1440,
        freshnessWindowMinutes: 1440,
        defaultStatus: "PREVIEW_ONLY",
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
          "Observes release timestamps, deployment statuses, and workflow pass/fail ratios.",
        requiredScopes: ["repo:status"],
        requiredPermissions: ["Deployments: Read-only", "Actions: Read-only"],
        supportedGranularities: ["hourly", "daily", "weekly"],
        supportedDimensions: ["workflow", "branch", "environment"],
        expectedLatencyMinutes: 5,
        freshnessWindowMinutes: 30,
        defaultStatus: "PREVIEW_ONLY",
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
    availabilityStatus: "planned_milestone",
    targetMilestone: "M06",
    summary:
      "Read-only cloud cost, SKU usage, credit amortization, and currency normalization via BigQuery billing export viewer (`bigquery.readonly`). Scheduled for Milestone 06.",
    readOnlyGuaranteeText:
      "Uses strictly read-only BigQuery dataset viewer and Billing Account viewer permissions. Cannot alter budgets, payment methods, or cloud resources.",
    prohibitedOperationsSummary: [
      "Cannot modify GCP billing accounts, budgets, or payment methods",
      "Cannot provision, resize, or terminate GCP compute or storage resources",
      "Cannot mutate BigQuery billing export tables",
    ],
    resourceTypeLabel: "Billing Export Dataset",
    resourceTypeKey: "gcp_billing_dataset",
    oauthAuthorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    oauthTokenUrl: "https://oauth2.googleapis.com/token",
    defaultScopes: ["https://www.googleapis.com/auth/bigquery.readonly"],
    capabilities: [
      {
        capabilityKey: "billing_cost_export",
        label: "Daily Cost, SKU & Credit Breakdown",
        description:
          "Reads daily gross cost, net cost after credits, service/SKU attribution, and project labels.",
        requiredScopes: ["https://www.googleapis.com/auth/bigquery.readonly"],
        requiredPermissions: ["BigQuery Data Viewer", "Billing Account Viewer"],
        supportedGranularities: ["daily", "monthly"],
        supportedDimensions: ["service", "sku", "project", "region", "currency"],
        expectedLatencyMinutes: 360,
        freshnessWindowMinutes: 720,
        defaultStatus: "PREVIEW_ONLY",
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
    availabilityStatus: "planned_milestone",
    targetMilestone: "M07",
    summary:
      "Read-only project, branch, compute CU-hour, and storage footprint telemetry via scoped Neon API keys. Never connects to user databases or executes SQL. Scheduled for Milestone 07.",
    readOnlyGuaranteeText:
      "Inspects Neon Control Plane consumption and branch metadata only. Never connects to your Postgres database or reads application tables.",
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
        capabilityKey: "postgres_metadata",
        label: "Compute CU-Hours, Storage & Branch Posture",
        description:
          "Reads active compute seconds, synthetic storage size, and branch count from the Neon Consumption API.",
        requiredScopes: ["neon.projects.readonly", "neon.consumption.readonly"],
        requiredPermissions: ["Organization Member (Read-Only API Key)"],
        supportedGranularities: ["hourly", "daily", "monthly"],
        supportedDimensions: ["projectId", "branchId", "region"],
        expectedLatencyMinutes: 15,
        freshnessWindowMinutes: 60,
        defaultStatus: "PREVIEW_ONLY",
        rateLimitPolicy: {
          requestsPerMinute: 40,
          burstLimit: 10,
          retryStrategy: "retry_after_header",
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
    availabilityStatus: "planned_milestone",
    targetMilestone: "M07",
    summary:
      "Read-only project health, database usage, auth MAU count, and edge function invocation telemetry via Management API read scopes. Scheduled for Milestone 07.",
    readOnlyGuaranteeText:
      "Uses Supabase Management API read scopes only (`projects:read`, `analytics:read`). Never reads customer table rows, auth user PII, or storage bucket objects.",
    prohibitedOperationsSummary: [
      "Never executes SQL queries against customer tables or reads Storage objects",
      "Cannot read `auth.users` email addresses or password hashes",
      "Cannot pause, restore, migrate, or reconfigure Supabase projects",
    ],
    resourceTypeLabel: "Supabase Project",
    resourceTypeKey: "supabase_project",
    defaultScopes: ["projects:read", "analytics:read"],
    capabilities: [
      {
        capabilityKey: "postgres_metadata",
        label: "Project Health, Auth Volume & Storage Totals",
        description:
          "Reads high-level database health status, aggregate Auth MAU counts, and storage/bandwidth utilization.",
        requiredScopes: ["projects:read", "analytics:read"],
        requiredPermissions: ["Read-Only Management Token"],
        supportedGranularities: ["daily", "monthly"],
        supportedDimensions: ["projectRef", "region", "service"],
        expectedLatencyMinutes: 30,
        freshnessWindowMinutes: 60,
        defaultStatus: "PREVIEW_ONLY",
        rateLimitPolicy: {
          requestsPerMinute: 60,
          burstLimit: 15,
          retryStrategy: "retry_after_header",
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
    availabilityStatus: "planned_milestone",
    targetMilestone: "M08",
    summary:
      "Read-only project deployment frequency, build duration, preview vs production reliability, and domain status via read-only Vercel access tokens. Scheduled for Milestone 08.",
    readOnlyGuaranteeText:
      "Inspects deployment metadata and domain health only. Cannot trigger redeployments, promote builds, or read Vercel environment variable values.",
    prohibitedOperationsSummary: [
      "Cannot trigger, cancel, promote, or rollback Vercel deployments",
      "Cannot read or modify decrypted environment variables",
      "Cannot alter domains, DNS records, or project settings",
    ],
    resourceTypeLabel: "Vercel Project",
    resourceTypeKey: "vercel_project",
    defaultScopes: ["projects:read", "deployments:read"],
    capabilities: [
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
        defaultStatus: "PREVIEW_ONLY",
        rateLimitPolicy: {
          requestsPerMinute: 100,
          burstLimit: 25,
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
    availabilityStatus: "planned_milestone",
    targetMilestone: "M08",
    summary:
      "Read-only zone request volume, cache hit ratio, bandwidth, HTTP 4xx/5xx edge error rates, and Workers telemetry via Account/Zone Analytics Read tokens. Scheduled for Milestone 08.",
    readOnlyGuaranteeText:
      "Requires only `Zone.Analytics:Read` and `Account.Account Analytics:Read`. Cannot edit DNS records, purge cache, modify WAF rules, or deploy Workers.",
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
          "Reads GraphQL Analytics API totals for requests, cached bandwidth, threats blocked, and status codes.",
        requiredScopes: ["zone.analytics:read"],
        requiredPermissions: ["Zone Analytics: Read"],
        supportedGranularities: ["hourly", "daily"],
        supportedDimensions: ["zoneTag", "statusMap", "cacheStatus", "country"],
        expectedLatencyMinutes: 5,
        freshnessWindowMinutes: 30,
        defaultStatus: "PREVIEW_ONLY",
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
    availabilityStatus: "planned_milestone",
    targetMilestone: "M08",
    summary:
      "Read-only crash-free session rate, unresolved issue spikes, and release regression signals via `project:read` and `event:read` auth tokens. Scheduled for Milestone 08.",
    readOnlyGuaranteeText:
      "Uses `org:read`, `project:read`, and `event:read` scopes only. Cannot resolve/delete issues, mutate alert rules, or upload source maps.",
    prohibitedOperationsSummary: [
      "Cannot resolve, ignore, merge, or delete Sentry issues",
      "Cannot modify alert rules, integrations, or team memberships",
      "Cannot upload or delete release artifacts or source maps",
    ],
    resourceTypeLabel: "Sentry Project",
    resourceTypeKey: "sentry_project",
    defaultScopes: ["org:read", "project:read", "event:read"],
    capabilities: [
      {
        capabilityKey: "issue_telemetry",
        label: "Crash-Free Sessions & Release Regressions",
        description:
          "Reads release health session stability and aggregate issue event velocity per environment.",
        requiredScopes: ["project:read", "event:read"],
        requiredPermissions: ["project:read", "event:read"],
        supportedGranularities: ["hourly", "daily"],
        supportedDimensions: ["environment", "release", "level"],
        expectedLatencyMinutes: 2,
        freshnessWindowMinutes: 15,
        defaultStatus: "PREVIEW_ONLY",
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
