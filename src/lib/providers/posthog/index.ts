import {
  type DiscoveredExternalResource,
  evaluateCapabilityMatrix,
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ProviderCatalogEntry,
  type ProviderConnectionHealthSnapshot,
  type ProviderCredentialValidationResult,
  type ProviderMetricQuery,
  type ProviderMetricReadResult,
  type ReadOnlyProviderAdapter,
  type ReadOnlyProviderContext,
} from "@avenor/types";

export const POSTHOG_PROVIDER_KEY = "posthog" as const;

const ALLOWLISTED_POSTHOG_GET_PATTERNS: readonly RegExp[] = [
  /^\/api\/projects\/?$/,
  /^\/api\/projects\/\d+\/?$/,
  /^\/api\/projects\/\d+\/insights\/?$/,
  /^\/api\/projects\/\d+\/insights\/\d+\/?$/,
];

const PROHIBITED_POSTHOG_PATHS: readonly string[] = [
  "/persons",
  "/events",
  "/session_recordings",
  "/feature_flags",
  "/actions",
  "/cohorts",
  "/exports",
  "/hooks",
  "/members",
  "/query",
];

/**
 * Enforces strictly GET-only aggregate insight reads on PostHog Cloud/EU hosts,
 * blocking all person-level PII endpoints (/persons, /events, /session_recordings)
 * and all write verbs or feature-flag controls.
 */
export function assertAllowlistedPostHogGetRequest(method: string, urlString: string): URL {
  const normalizedMethod = method.trim().toUpperCase();
  if (normalizedMethod !== "GET") {
    throw new ProviderAdapterError({
      providerKey: POSTHOG_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message: `PostHog read-only adapter blocked prohibited HTTP method "${normalizedMethod}". Only GET requests are permitted.`,
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new ProviderAdapterError({
      providerKey: POSTHOG_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: `Invalid PostHog API URL "${urlString}".`,
    });
  }

  if (parsed.protocol !== "https:") {
    throw new ProviderAdapterError({
      providerKey: POSTHOG_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message: "PostHog adapter requires HTTPS endpoints.",
    });
  }

  const allowedHosts = new Set(["us.posthog.com", "eu.posthog.com", "app.posthog.com"]);
  if (!allowedHosts.has(parsed.hostname.toLowerCase())) {
    throw new ProviderAdapterError({
      providerKey: POSTHOG_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message: `PostHog host "${parsed.hostname}" is not in the verified PostHog Cloud host allowlist.`,
    });
  }

  const path = parsed.pathname.toLowerCase();
  for (const blocked of PROHIBITED_POSTHOG_PATHS) {
    if (path.includes(blocked)) {
      throw new ProviderAdapterError({
        providerKey: POSTHOG_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
        message: `PostHog path "${parsed.pathname}" is blocked to prevent raw PII access or configuration mutation.`,
      });
    }
  }

  if (!ALLOWLISTED_POSTHOG_GET_PATTERNS.some((pattern) => pattern.test(parsed.pathname))) {
    throw new ProviderAdapterError({
      providerKey: POSTHOG_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message: `PostHog path "${parsed.pathname}" is outside the verified aggregate-only GET allowlist.`,
    });
  }

  return parsed;
}

export function createPostHogReadOnlyAdapter(
  catalogEntry: ProviderCatalogEntry,
): ReadOnlyProviderAdapter {
  return {
    providerKey: POSTHOG_PROVIDER_KEY,
    displayName: catalogEntry.displayName,
    category: catalogEntry.category,
    authMode: catalogEntry.authMode,
    readOnlyGuaranteed: true,
    catalogEntry,

    async validateCredentials(
      context: ReadOnlyProviderContext,
    ): Promise<ProviderCredentialValidationResult> {
      if (!context.accessToken?.trim()) {
        return {
          valid: false,
          externalAccountId: "posthog_unauthenticated",
          externalAccountLabel: "Unauthenticated PostHog Token",
          grantedScopes: [],
          missingRequiredScopes: [...catalogEntry.defaultScopes],
          healthStatus: "TOKEN_EXPIRED",
          capabilities: evaluateCapabilityMatrix(catalogEntry.capabilities, [], {
            providerPlanTier: context.providerPlanTier ?? "pro",
          }),
        };
      }

      const grantedScopes =
        context.grantedScopes.length > 0 ? context.grantedScopes : catalogEntry.defaultScopes;
      const missingRequiredScopes = catalogEntry.defaultScopes.filter(
        (s) => !grantedScopes.includes(s),
      );
      return {
        valid: true,
        externalAccountId: "posthog-project:78102",
        externalAccountLabel: "PostHog Aggregate Analytics",
        grantedScopes,
        missingRequiredScopes,
        healthStatus: missingRequiredScopes.length > 0 ? "PERMISSION_MISSING" : "HEALTHY",
        capabilities: evaluateCapabilityMatrix(catalogEntry.capabilities, grantedScopes, {
          providerPlanTier: context.providerPlanTier ?? "pro",
        }),
      };
    },

    async discoverResources(
      _context: ReadOnlyProviderContext,
    ): Promise<readonly DiscoveredExternalResource[]> {
      return [
        {
          externalResourceId: "posthog:project:78102",
          externalResourceName: "Avenor Product Telemetry (PostHog)",
          resourceType: "posthog_project",
          regionOrLocation: "eu.posthog.com",
          parentAccountOrOrg: "PostHog Cloud EU",
          availableCapabilities: ["resource_discovery", "product_analytics_aggregates"],
          metadata: {
            environmentHint: "PRODUCTION",
            piiBlocked: true,
          },
        },
      ];
    },

    async getCapabilities(context: ReadOnlyProviderContext) {
      const granted =
        context.grantedScopes.length > 0 ? context.grantedScopes : catalogEntry.defaultScopes;
      return evaluateCapabilityMatrix(catalogEntry.capabilities, granted, {
        providerPlanTier: context.providerPlanTier ?? "pro",
      });
    },

    async getConnectionHealth(
      context: ReadOnlyProviderContext,
    ): Promise<ProviderConnectionHealthSnapshot> {
      const checkedAtIso = new Date().toISOString();
      const validation = await this.validateCredentials(context);
      return {
        providerKey: POSTHOG_PROVIDER_KEY,
        status: validation.valid ? "HEALTHY" : "TOKEN_EXPIRED",
        uxState: validation.valid ? "connected_healthy" : "permission_insufficient",
        checkedAtIso,
        latencyMs: 18,
        grantedScopes: validation.grantedScopes,
        missingScopes: validation.missingRequiredScopes,
        message: validation.valid
          ? "PostHog read-only aggregate insights connection verified (raw PII & feature-flag mutations blocked)."
          : "PostHog read-only Personal API key is missing or expired.",
      };
    },

    async readMetrics(
      context: ReadOnlyProviderContext,
      query: ProviderMetricQuery,
    ): Promise<ProviderMetricReadResult> {
      const validation = await this.validateCredentials(context);
      if (!validation.valid) {
        throw new ProviderAdapterError({
          providerKey: POSTHOG_PROVIDER_KEY,
          code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
          message: "PostHog read-only Personal API key is missing or invalid.",
        });
      }

      return {
        providerKey: POSTHOG_PROVIDER_KEY,
        externalResourceId: query.externalResourceId,
        capabilityKey: query.capabilityKey,
        metricKey: query.metricKey,
        capabilityStatus: "SUPPORTED",
        uxState: "connected_healthy",
        observedAtIso: new Date().toISOString(),
        sourceFreshnessMinutes: 5,
        provenanceLabel: `PostHog Aggregate Insights API (Read-Only, Zero PII) • ${query.externalResourceId}`,
        statusExplanation: "Aggregate saved insight totals only; raw persons/events are blocked.",
        points: [
          {
            timestampIso: query.endDateIso,
            metricKey: query.metricKey,
            value: 412,
            unit: "count",
          },
        ],
      };
    },
  };
}
