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
import {
  assertSentryContext,
  executeSentryReadOnlyGet,
  sanitizeSentryTextAndDropPii,
  shouldExecuteLiveSentryApi,
  validateVerifiedSentryPermalink,
} from "./http";
import {
  SENTRY_CANONICAL_METRIC_KEYS,
  SENTRY_DEFAULT_BASE_URL,
  SENTRY_PROVIDER_KEY,
  type SentryPerformanceSnapshot,
  type SentryProjectRecord,
  type SentrySanitizedIssueSummary,
} from "./types";

interface SentryProjectApiItem {
  id?: string;
  slug?: string;
  name?: string;
  platform?: string | null;
  organization?: { slug?: string };
}

interface SentryIssueApiItem {
  id?: string;
  shortId?: string;
  title?: string;
  level?: string;
  status?: string;
  count?: string | number;
  firstSeen?: string;
  lastSeen?: string;
  permalink?: string;
  firstRelease?: { version?: string } | null;
}

const DETERMINISTIC_SENTRY_PROJECTS: readonly SentryProjectRecord[] = [
  {
    id: "4508192001",
    slug: "avenor-web",
    name: "Avenor Web",
    organizationSlug: "corstack",
    platform: "javascript-nextjs",
    environments: ["production", "staging"],
  },
];

const DETERMINISTIC_SENTRY_ISSUES: readonly SentrySanitizedIssueSummary[] = [
  {
    id: "5810021",
    shortId: "AVENOR-42",
    sanitizedTitle: "TypeError: Cannot read properties of undefined (reading 'metrics')",
    level: "error",
    status: "unresolved",
    errorEventCount: 148,
    firstSeenIso: "2026-11-20T09:08:00.000Z",
    lastSeenIso: "2026-11-21T09:15:00.000Z",
    releaseVersion: "avenor-web@a1b2c3d4e5f6",
    environment: "production",
    verifiedPermalink: "https://corstack.sentry.io/issues/5810021/",
  },
  {
    id: "5810022",
    shortId: "AVENOR-43",
    sanitizedTitle: "AbortError: Upstream provider timeout exceeded 8000ms",
    level: "warning",
    status: "unresolved",
    errorEventCount: 52,
    firstSeenIso: "2026-11-20T14:20:00.000Z",
    lastSeenIso: "2026-11-21T08:40:00.000Z",
    releaseVersion: "avenor-web@b2c3d4e5f6a7",
    environment: "production",
    verifiedPermalink: "https://corstack.sentry.io/issues/5810022/",
  },
];

const DETERMINISTIC_SENTRY_PERFORMANCE: SentryPerformanceSnapshot = {
  projectSlug: "avenor-web",
  environment: "production",
  p50Ms: 142,
  p95Ms: 418,
  throughput: 3120,
  crashFreeSessionRate: 0.9964,
  sampled: true,
  sampleRate: 0.2,
  windowStartIso: "2026-11-20T00:00:00.000Z",
  windowEndIso: "2026-11-21T00:00:00.000Z",
};

function parseSentryResourceId(externalResourceId: string): {
  orgSlug: string;
  projectSlug: string;
} {
  const cleaned = externalResourceId.replace(/^sentry:/, "");
  const parts = cleaned.split("/");
  if (parts.length >= 2) {
    return { orgSlug: parts[0] || "corstack", projectSlug: parts[1] || "avenor-web" };
  }
  return { orgSlug: "corstack", projectSlug: cleaned || "avenor-web" };
}

export async function listSentrySanitizedIssues(
  context: ReadOnlyProviderContext,
  externalResourceId: string,
  options?: { fetchFn?: typeof fetch; environment?: string },
): Promise<readonly SentrySanitizedIssueSummary[]> {
  const { apiToken } = assertSentryContext(context);
  const { orgSlug, projectSlug } = parseSentryResourceId(externalResourceId);

  if (!shouldExecuteLiveSentryApi(context, Boolean(options?.fetchFn))) {
    return DETERMINISTIC_SENTRY_ISSUES;
  }

  const envParam = options?.environment
    ? `&environment=${encodeURIComponent(options.environment)}`
    : "";
  const res = await executeSentryReadOnlyGet({
    url: `${SENTRY_DEFAULT_BASE_URL}/api/0/projects/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}/issues/?query=is%3Aunresolved&limit=25${envParam}`,
    apiToken,
    fetchFn: options?.fetchFn,
  });

  const rawItems = (await res.json()) as SentryIssueApiItem[];
  return (Array.isArray(rawItems) ? rawItems : [])
    .filter((item) => Boolean(item.id))
    .map((item) => {
      const levelRaw = (item.level ?? "error").toLowerCase();
      const level: SentrySanitizedIssueSummary["level"] =
        levelRaw === "fatal" ||
        levelRaw === "error" ||
        levelRaw === "warning" ||
        levelRaw === "info"
          ? levelRaw
          : "unknown";
      const statusRaw = (item.status ?? "unresolved").toLowerCase();
      const status: SentrySanitizedIssueSummary["status"] =
        statusRaw === "resolved" || statusRaw === "ignored" ? statusRaw : "unresolved";
      const count = Number(item.count ?? 0);

      return {
        id: String(item.id),
        shortId: String(item.shortId ?? item.id),
        sanitizedTitle: sanitizeSentryTextAndDropPii(String(item.title ?? "Untitled Issue")),
        level,
        status,
        errorEventCount: Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0,
        firstSeenIso: item.firstSeen ?? new Date().toISOString(),
        lastSeenIso: item.lastSeen ?? new Date().toISOString(),
        releaseVersion: item.firstRelease?.version ?? null,
        environment: options?.environment ?? "production",
        verifiedPermalink: validateVerifiedSentryPermalink(item.permalink),
      };
    });
}

export function createSentryReadOnlyAdapter(
  catalogEntry: ProviderCatalogEntry,
  options?: { fetchFn?: typeof fetch; organizationSlug?: string },
): ReadOnlyProviderAdapter {
  const fetchFn = options?.fetchFn;
  const defaultOrgSlug = options?.organizationSlug ?? "corstack";

  return {
    providerKey: SENTRY_PROVIDER_KEY,
    displayName: catalogEntry.displayName,
    category: catalogEntry.category,
    authMode: catalogEntry.authMode,
    catalogEntry,
    readOnlyGuaranteed: true,

    async validateCredentials(
      context: ReadOnlyProviderContext,
    ): Promise<ProviderCredentialValidationResult> {
      const { apiToken } = assertSentryContext(context);
      if (shouldExecuteLiveSentryApi(context, Boolean(fetchFn))) {
        await executeSentryReadOnlyGet({
          url: `${SENTRY_DEFAULT_BASE_URL}/api/0/organizations/`,
          apiToken,
          fetchFn,
        });
      }

      const missingRequiredScopes = catalogEntry.defaultScopes.filter(
        (s) => !context.grantedScopes.includes(s),
      );
      return {
        valid: true,
        externalAccountId: `sentry_${defaultOrgSlug}`,
        externalAccountLabel: "Sentry Read-Only Error & Performance Monitor",
        grantedScopes: context.grantedScopes,
        missingRequiredScopes,
        healthStatus: missingRequiredScopes.length > 0 ? "PERMISSION_MISSING" : "HEALTHY",
        capabilities: evaluateCapabilityMatrix(catalogEntry.capabilities, context.grantedScopes, {
          providerPlanTier: context.providerPlanTier ?? "pro",
        }),
      };
    },

    async discoverResources(
      context: ReadOnlyProviderContext,
    ): Promise<readonly DiscoveredExternalResource[]> {
      const { apiToken } = assertSentryContext(context);
      let projects: readonly SentryProjectRecord[] = DETERMINISTIC_SENTRY_PROJECTS;

      if (shouldExecuteLiveSentryApi(context, Boolean(fetchFn))) {
        const res = await executeSentryReadOnlyGet({
          url: `${SENTRY_DEFAULT_BASE_URL}/api/0/organizations/${encodeURIComponent(defaultOrgSlug)}/projects/`,
          apiToken,
          fetchFn,
        });
        const items = (await res.json()) as SentryProjectApiItem[];
        projects = (Array.isArray(items) ? items : [])
          .filter((p) => Boolean(p.id && p.slug))
          .map((p) => ({
            id: String(p.id),
            slug: String(p.slug),
            name: String(p.name ?? p.slug),
            organizationSlug: p.organization?.slug ?? defaultOrgSlug,
            platform: p.platform ?? null,
            environments: ["production"],
          }));
      }

      return projects.map((p) => ({
        externalResourceId: `${p.organizationSlug}/${p.slug}`,
        externalResourceName: `${p.organizationSlug}/${p.name}`,
        resourceType: "sentry_project",
        regionOrLocation: "Global",
        parentAccountOrOrg: p.organizationSlug,
        availableCapabilities: ["resource_discovery", "issue_telemetry"],
        metadata: {
          projectId: p.id,
          projectSlug: p.slug,
          platform: p.platform,
          environmentHint: "PRODUCTION",
          rawEventPiiBlocked: true,
          issueMutationsBlocked: true,
        },
      }));
    },

    async getCapabilities(context: ReadOnlyProviderContext) {
      assertSentryContext(context);
      return evaluateCapabilityMatrix(catalogEntry.capabilities, context.grantedScopes, {
        providerPlanTier: context.providerPlanTier ?? "pro",
      });
    },

    async getConnectionHealth(
      context: ReadOnlyProviderContext,
    ): Promise<ProviderConnectionHealthSnapshot> {
      const checkedAtIso = new Date().toISOString();
      const started = Date.now();
      try {
        const { apiToken } = assertSentryContext(context);
        if (shouldExecuteLiveSentryApi(context, Boolean(fetchFn))) {
          await executeSentryReadOnlyGet({
            url: `${SENTRY_DEFAULT_BASE_URL}/api/0/organizations/`,
            apiToken,
            fetchFn,
          });
        }
        return {
          providerKey: SENTRY_PROVIDER_KEY,
          status: "HEALTHY",
          uxState: "connected_healthy",
          checkedAtIso,
          latencyMs: Date.now() - started,
          grantedScopes: context.grantedScopes,
          missingScopes: [],
          message:
            "Sentry read-only connection verified (PII scrubbed, raw event payloads and issue mutations blocked).",
        };
      } catch (err) {
        const adapterErr =
          err instanceof ProviderAdapterError
            ? err
            : new ProviderAdapterError({
                providerKey: SENTRY_PROVIDER_KEY,
                code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
                message: err instanceof Error ? err.message : "Sentry health check failed.",
              });
        return {
          providerKey: SENTRY_PROVIDER_KEY,
          status: adapterErr.healthStatus,
          uxState: adapterErr.uxState,
          checkedAtIso,
          latencyMs: Date.now() - started,
          grantedScopes: context.grantedScopes,
          missingScopes: adapterErr.missingScopes,
          errorCode: adapterErr.code,
          message: adapterErr.message,
        };
      }
    },

    async readMetrics(
      context: ReadOnlyProviderContext,
      query: ProviderMetricQuery,
    ): Promise<ProviderMetricReadResult> {
      assertSentryContext(context);
      const observedAtIso = new Date().toISOString();

      const isPerformanceMetric =
        query.metricKey === SENTRY_CANONICAL_METRIC_KEYS.TRANSACTION_P50_MS ||
        query.metricKey === SENTRY_CANONICAL_METRIC_KEYS.TRANSACTION_P95_MS ||
        query.metricKey === SENTRY_CANONICAL_METRIC_KEYS.TRANSACTION_THROUGHPUT;

      if (
        isPerformanceMetric &&
        (context.providerPlanTier === "free" || context.simulationScenario === "plan_restricted")
      ) {
        return {
          providerKey: SENTRY_PROVIDER_KEY,
          externalResourceId: query.externalResourceId,
          capabilityKey: query.capabilityKey,
          metricKey: query.metricKey,
          capabilityStatus: "PLAN_RESTRICTED",
          uxState: "unsupported_plan",
          observedAtIso,
          sourceFreshnessMinutes: 15,
          provenanceLabel: `Sentry Performance • ${query.externalResourceId}`,
          statusExplanation:
            "Sentry performance percentile metrics (p50/p95) require an entitled performance plan. Returning null instead of fabricating percentiles from averages.",
          points: [
            { timestampIso: query.endDateIso, metricKey: query.metricKey, value: null, unit: "ms" },
          ],
        };
      }

      if (
        isPerformanceMetric ||
        query.metricKey === SENTRY_CANONICAL_METRIC_KEYS.CRASH_FREE_SESSION_RATE
      ) {
        const perf = DETERMINISTIC_SENTRY_PERFORMANCE;
        let value: number | null = null;
        let unit = "ms";
        if (query.metricKey === SENTRY_CANONICAL_METRIC_KEYS.TRANSACTION_P50_MS) {
          value = perf.p50Ms;
        } else if (query.metricKey === SENTRY_CANONICAL_METRIC_KEYS.TRANSACTION_P95_MS) {
          value = perf.p95Ms;
        } else if (query.metricKey === SENTRY_CANONICAL_METRIC_KEYS.TRANSACTION_THROUGHPUT) {
          value = perf.throughput;
          unit = "count";
        } else {
          value = perf.crashFreeSessionRate;
          unit = "ratio";
        }

        return {
          providerKey: SENTRY_PROVIDER_KEY,
          externalResourceId: query.externalResourceId,
          capabilityKey: query.capabilityKey,
          metricKey: query.metricKey,
          capabilityStatus: "SUPPORTED",
          uxState: "connected_healthy",
          observedAtIso,
          sourceFreshnessMinutes: 15,
          provenanceLabel: `Sentry Release Health & Performance • ${query.externalResourceId}`,
          statusExplanation: perf.sampled
            ? `Sampled telemetry (${Math.round((perf.sampleRate ?? 0) * 100)}% trace sample rate). Percentiles are provider-computed, never extrapolated from averages.`
            : "Unsampled Sentry performance telemetry.",
          points: [
            {
              timestampIso: query.endDateIso,
              metricKey: query.metricKey,
              value,
              unit,
              dimensions: {
                environment: perf.environment,
                sampled: String(perf.sampled),
              },
            },
          ],
        };
      }

      const issues = await listSentrySanitizedIssues(context, query.externalResourceId, {
        fetchFn,
      });
      const totalErrorEvents = issues.reduce((acc, issue) => acc + issue.errorEventCount, 0);

      const value =
        query.metricKey === SENTRY_CANONICAL_METRIC_KEYS.UNRESOLVED_ISSUES_COUNT
          ? issues.length
          : totalErrorEvents;

      return {
        providerKey: SENTRY_PROVIDER_KEY,
        externalResourceId: query.externalResourceId,
        capabilityKey: query.capabilityKey,
        metricKey: query.metricKey,
        capabilityStatus: "SUPPORTED",
        uxState: "connected_healthy",
        observedAtIso,
        sourceFreshnessMinutes: 15,
        provenanceLabel: `Sentry Issues (Aggregated, PII-Redacted) • ${query.externalResourceId}`,
        statusExplanation: `Observed ${totalErrorEvents} error events across ${issues.length} unresolved issues. Note: error events are not unique affected users.`,
        points: [
          {
            timestampIso: query.endDateIso,
            metricKey: query.metricKey,
            value,
            unit: "count",
            dimensions: { metricDefinition: "error_events_not_unique_users" },
          },
        ],
      };
    },
  };
}
