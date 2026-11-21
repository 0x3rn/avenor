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
  assertGitHubContext,
  executeGitHubReadOnlyGet,
  normalizeGitHubWorkflowOutcome,
  shouldExecuteLiveGitHubApi,
} from "./http";
import {
  GITHUB_API_BASE_URL,
  GITHUB_CANONICAL_METRIC_KEYS,
  GITHUB_PROVIDER_KEY,
  type GitHubDeploymentRecord,
  type GitHubRepositoryRecord,
  type GitHubWorkflowRunConclusion,
  type GitHubWorkflowRunRecord,
  type GitHubWorkflowRunStatus,
} from "./types";

interface GitHubReposApiResponse {
  repositories?: Array<{
    id?: number;
    full_name?: string;
    name?: string;
    owner?: { login?: string };
    private?: boolean;
    visibility?: string;
    default_branch?: string;
  }>;
}

interface GitHubWorkflowRunsApiResponse {
  workflow_runs?: Array<{
    id?: number;
    run_attempt?: number;
    name?: string;
    status?: string;
    conclusion?: string | null;
    head_sha?: string;
    head_branch?: string;
    event?: string;
    html_url?: string;
    created_at?: string;
    updated_at?: string;
    run_started_at?: string;
  }>;
}

interface GitHubDeploymentsApiResponseItem {
  id?: number;
  environment?: string;
  sha?: string;
  ref?: string;
  created_at?: string;
  updated_at?: string;
}

const DETERMINISTIC_GITHUB_REPOS: readonly GitHubRepositoryRecord[] = [
  {
    repositoryId: 84201901,
    fullName: "corstack/avenor-platform",
    owner: "corstack",
    name: "avenor-platform",
    visibility: "private",
    defaultBranch: "main",
    installationId: 50120,
  },
];

const DETERMINISTIC_GITHUB_WORKFLOW_RUNS: readonly GitHubWorkflowRunRecord[] = [
  {
    runId: 900101,
    runAttempt: 1,
    repositoryFullName: "corstack/avenor-platform",
    workflowName: "CI & Verification",
    status: "completed",
    conclusion: "success",
    outcome: "passed",
    headSha: "a1b2c3d4e5f6",
    headBranch: "main",
    event: "push",
    htmlUrl: "https://github.com/corstack/avenor-platform/actions/runs/900101",
    createdAtIso: "2026-11-20T08:55:00.000Z",
    updatedAtIso: "2026-11-20T08:58:30.000Z",
    durationMs: 210_000,
  },
  {
    runId: 900102,
    runAttempt: 1,
    repositoryFullName: "corstack/avenor-platform",
    workflowName: "CI & Verification",
    status: "completed",
    conclusion: "failure",
    outcome: "failed",
    headSha: "c3d4e5f6a7b8",
    headBranch: "feat/dashboard-polish",
    event: "pull_request",
    htmlUrl: "https://github.com/corstack/avenor-platform/actions/runs/900102",
    createdAtIso: "2026-11-21T07:54:00.000Z",
    updatedAtIso: "2026-11-21T07:57:00.000Z",
    durationMs: 180_000,
  },
  {
    runId: 900102,
    runAttempt: 2,
    repositoryFullName: "corstack/avenor-platform",
    workflowName: "CI & Verification",
    status: "completed",
    conclusion: "success",
    outcome: "passed",
    headSha: "b2c3d4e5f6a7",
    headBranch: "main",
    event: "push",
    htmlUrl: "https://github.com/corstack/avenor-platform/actions/runs/900102/attempts/2",
    createdAtIso: "2026-11-20T15:52:00.000Z",
    updatedAtIso: "2026-11-20T15:56:00.000Z",
    durationMs: 240_000,
  },
];

const DETERMINISTIC_GITHUB_DEPLOYMENTS: readonly GitHubDeploymentRecord[] = [
  {
    deploymentId: 77001,
    repositoryFullName: "corstack/avenor-platform",
    environment: "production",
    sha: "a1b2c3d4e5f6",
    ref: "main",
    state: "success",
    createdAtIso: "2026-11-20T09:00:00.000Z",
    updatedAtIso: "2026-11-20T09:01:12.000Z",
  },
];

function normalizeRepoResourceId(externalResourceId: string): string {
  return externalResourceId.startsWith("repo:")
    ? externalResourceId.slice("repo:".length)
    : externalResourceId;
}

export async function listGitHubWorkflowRuns(
  context: ReadOnlyProviderContext,
  externalResourceId: string,
  options?: { fetchFn?: typeof fetch },
): Promise<readonly GitHubWorkflowRunRecord[]> {
  const { token } = assertGitHubContext(context);
  const fullName = normalizeRepoResourceId(externalResourceId);

  if (!shouldExecuteLiveGitHubApi(context, Boolean(options?.fetchFn))) {
    return DETERMINISTIC_GITHUB_WORKFLOW_RUNS.filter((r) => r.repositoryFullName === fullName);
  }

  const res = await executeGitHubReadOnlyGet({
    url: `${GITHUB_API_BASE_URL}/repos/${fullName}/actions/runs?per_page=50`,
    token,
    fetchFn: options?.fetchFn,
  });
  const payload = (await res.json()) as GitHubWorkflowRunsApiResponse;

  return (payload.workflow_runs ?? [])
    .filter((r) => typeof r.id === "number")
    .map((r) => {
      const status = (r.status ?? "unknown") as GitHubWorkflowRunStatus;
      const conclusion = (r.conclusion ?? null) as GitHubWorkflowRunConclusion;
      const started = r.run_started_at ?? r.created_at ?? new Date().toISOString();
      const updated = r.updated_at ?? started;
      const startMs = Date.parse(started);
      const endMs = Date.parse(updated);
      const durationMs =
        status === "completed" &&
        Number.isFinite(startMs) &&
        Number.isFinite(endMs) &&
        endMs >= startMs
          ? endMs - startMs
          : null;

      return {
        runId: Number(r.id),
        runAttempt: typeof r.run_attempt === "number" ? r.run_attempt : 1,
        repositoryFullName: fullName,
        workflowName: r.name ?? "Workflow",
        status,
        conclusion,
        outcome: normalizeGitHubWorkflowOutcome(status, conclusion),
        headSha: r.head_sha ?? "",
        headBranch: r.head_branch ?? "",
        event: r.event ?? "push",
        htmlUrl: r.html_url ?? `https://github.com/${fullName}/actions/runs/${r.id}`,
        createdAtIso: r.created_at ?? started,
        updatedAtIso: updated,
        durationMs,
      };
    });
}

export async function listGitHubDeployments(
  context: ReadOnlyProviderContext,
  externalResourceId: string,
  options?: { fetchFn?: typeof fetch },
): Promise<readonly GitHubDeploymentRecord[]> {
  const { token } = assertGitHubContext(context);
  const fullName = normalizeRepoResourceId(externalResourceId);

  if (!shouldExecuteLiveGitHubApi(context, Boolean(options?.fetchFn))) {
    return DETERMINISTIC_GITHUB_DEPLOYMENTS.filter((d) => d.repositoryFullName === fullName);
  }

  const res = await executeGitHubReadOnlyGet({
    url: `${GITHUB_API_BASE_URL}/repos/${fullName}/deployments?per_page=30`,
    token,
    fetchFn: options?.fetchFn,
  });
  const items = (await res.json()) as GitHubDeploymentsApiResponseItem[];

  return (Array.isArray(items) ? items : [])
    .filter((d) => typeof d.id === "number")
    .map((d) => ({
      deploymentId: Number(d.id),
      repositoryFullName: fullName,
      environment: d.environment ?? "production",
      sha: d.sha ?? "",
      ref: d.ref ?? "",
      state: "unknown",
      createdAtIso: d.created_at ?? new Date().toISOString(),
      updatedAtIso: d.updated_at ?? d.created_at ?? new Date().toISOString(),
    }));
}

/**
 * In-memory idempotency guard for GitHub webhook deliveries (`X-GitHub-Delivery`),
 * complemented by database-level uniqueness in `github_webhook_deliveries`.
 */
export class GitHubWebhookDeliveryDedupeCache {
  private readonly seen = new Set<string>();
  private readonly maxEntries: number;

  constructor(maxEntries = 10_000) {
    this.maxEntries = maxEntries;
  }

  public recordIfNew(deliveryId: string): boolean {
    if (this.seen.has(deliveryId)) {
      return false;
    }
    if (this.seen.size >= this.maxEntries) {
      const oldest = this.seen.values().next().value;
      if (oldest) this.seen.delete(oldest);
    }
    this.seen.add(deliveryId);
    return true;
  }

  public clear(): void {
    this.seen.clear();
  }
}

export const sharedGitHubWebhookDedupe = new GitHubWebhookDeliveryDedupeCache();

export function createGitHubReadOnlyAdapter(
  catalogEntry: ProviderCatalogEntry,
  options?: { fetchFn?: typeof fetch },
): ReadOnlyProviderAdapter {
  const fetchFn = options?.fetchFn;

  return {
    providerKey: GITHUB_PROVIDER_KEY,
    displayName: catalogEntry.displayName,
    category: catalogEntry.category,
    authMode: catalogEntry.authMode,
    catalogEntry,
    readOnlyGuaranteed: true,

    async validateCredentials(
      context: ReadOnlyProviderContext,
    ): Promise<ProviderCredentialValidationResult> {
      const { token } = assertGitHubContext(context);
      if (shouldExecuteLiveGitHubApi(context, Boolean(fetchFn))) {
        await executeGitHubReadOnlyGet({
          url: `${GITHUB_API_BASE_URL}/installation/repositories?per_page=1`,
          token,
          fetchFn,
        });
      }

      const missingRequiredScopes = catalogEntry.defaultScopes.filter(
        (s) => !context.grantedScopes.includes(s),
      );
      return {
        valid: true,
        externalAccountId: `gh_install_${context.workspaceId.slice(0, 8)}`,
        externalAccountLabel: "GitHub App Read-Only Installation",
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
      const { token } = assertGitHubContext(context);
      let repos: readonly GitHubRepositoryRecord[] = DETERMINISTIC_GITHUB_REPOS;

      if (shouldExecuteLiveGitHubApi(context, Boolean(fetchFn))) {
        const res = await executeGitHubReadOnlyGet({
          url: `${GITHUB_API_BASE_URL}/installation/repositories?per_page=50`,
          token,
          fetchFn,
        });
        const payload = (await res.json()) as GitHubReposApiResponse;
        repos = (payload.repositories ?? [])
          .filter((r) => typeof r.id === "number" && Boolean(r.full_name))
          .map((r) => {
            const fullName = String(r.full_name);
            const [owner = "", name = fullName] = fullName.split("/");
            return {
              repositoryId: Number(r.id),
              fullName,
              owner: r.owner?.login ?? owner,
              name: r.name ?? name,
              visibility:
                r.visibility === "public" || r.visibility === "internal"
                  ? r.visibility
                  : r.private
                    ? "private"
                    : "public",
              defaultBranch: r.default_branch ?? "main",
              installationId: null,
            };
          });
      }

      return repos.map((repo) => ({
        externalResourceId: `repo:${repo.fullName}`,
        externalResourceName: repo.fullName,
        resourceType: "github_repository",
        regionOrLocation: "Global",
        parentAccountOrOrg: repo.owner,
        availableCapabilities: ["resource_discovery", "repository_activity"],
        metadata: {
          repositoryId: repo.repositoryId,
          defaultBranch: repo.defaultBranch,
          visibility: repo.visibility,
          environmentHint: "PRODUCTION",
          sourceCodeReadBlocked: true,
          workflowDispatchBlocked: true,
        },
      }));
    },

    async getCapabilities(context: ReadOnlyProviderContext) {
      assertGitHubContext(context);
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
        const { token } = assertGitHubContext(context);
        if (shouldExecuteLiveGitHubApi(context, Boolean(fetchFn))) {
          await executeGitHubReadOnlyGet({
            url: `${GITHUB_API_BASE_URL}/installation/repositories?per_page=1`,
            token,
            fetchFn,
          });
        }
        return {
          providerKey: GITHUB_PROVIDER_KEY,
          status: "HEALTHY",
          uxState: "connected_healthy",
          checkedAtIso,
          latencyMs: Date.now() - started,
          grantedScopes: context.grantedScopes,
          missingScopes: [],
          message:
            "GitHub App read-only installation verified (workflow dispatch, code contents, and PR mutations blocked).",
        };
      } catch (err) {
        const adapterErr =
          err instanceof ProviderAdapterError
            ? err
            : new ProviderAdapterError({
                providerKey: GITHUB_PROVIDER_KEY,
                code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
                message: err instanceof Error ? err.message : "GitHub health check failed.",
              });
        return {
          providerKey: GITHUB_PROVIDER_KEY,
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
      assertGitHubContext(context);
      const observedAtIso = new Date().toISOString();

      const capabilities = evaluateCapabilityMatrix(
        catalogEntry.capabilities,
        context.grantedScopes,
        { providerPlanTier: context.providerPlanTier ?? "pro" },
      );
      const cap = capabilities.find((c) => c.capabilityKey === query.capabilityKey);
      if (!cap) {
        throw new ProviderAdapterError({
          providerKey: GITHUB_PROVIDER_KEY,
          code: PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY,
          message: `Capability "${query.capabilityKey}" is not supported by GitHub.`,
        });
      }
      if (!cap.allowsNumericMetric) {
        return {
          providerKey: GITHUB_PROVIDER_KEY,
          externalResourceId: query.externalResourceId,
          capabilityKey: query.capabilityKey,
          metricKey: query.metricKey,
          capabilityStatus: cap.status,
          uxState: cap.uxState,
          observedAtIso,
          sourceFreshnessMinutes: cap.freshnessWindowMinutes,
          provenanceLabel: `GitHub App • ${query.externalResourceId}`,
          statusExplanation: cap.statusExplanation,
          points: [
            {
              timestampIso: query.endDateIso,
              metricKey: query.metricKey,
              value: null,
              unit: "count",
            },
          ],
        };
      }

      if (query.metricKey === GITHUB_CANONICAL_METRIC_KEYS.DEPLOYMENTS_TOTAL) {
        const deployments = await listGitHubDeployments(context, query.externalResourceId, {
          fetchFn,
        });
        return {
          providerKey: GITHUB_PROVIDER_KEY,
          externalResourceId: query.externalResourceId,
          capabilityKey: query.capabilityKey,
          metricKey: query.metricKey,
          capabilityStatus: "SUPPORTED",
          uxState: "connected_healthy",
          observedAtIso,
          sourceFreshnessMinutes: 5,
          provenanceLabel: `GitHub Deployments • ${query.externalResourceId}`,
          statusExplanation: `Observed ${deployments.length} repository deployment metadata record(s).`,
          points: [
            {
              timestampIso: query.endDateIso,
              metricKey: query.metricKey,
              value: deployments.length,
              unit: "count",
            },
          ],
        };
      }

      const runs = await listGitHubWorkflowRuns(context, query.externalResourceId, { fetchFn });
      const passed = runs.filter((r) => r.outcome === "passed");
      const failed = runs.filter((r) => r.outcome === "failed" || r.outcome === "timed_out");
      const decided = passed.length + failed.length;
      const durations = runs.map((r) => r.durationMs).filter((d): d is number => d !== null);
      const meanDurationMs =
        durations.length > 0
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
          : null;

      let value: number | null = runs.length;
      let unit = "count";
      switch (query.metricKey) {
        case GITHUB_CANONICAL_METRIC_KEYS.WORKFLOW_RUNS_TOTAL:
          value = runs.length;
          break;
        case GITHUB_CANONICAL_METRIC_KEYS.WORKFLOW_RUNS_SUCCEEDED:
          value = passed.length;
          break;
        case GITHUB_CANONICAL_METRIC_KEYS.WORKFLOW_RUNS_FAILED:
          value = failed.length;
          break;
        case GITHUB_CANONICAL_METRIC_KEYS.WORKFLOW_SUCCESS_RATE:
          value = decided > 0 ? Math.round((passed.length / decided) * 10_000) / 10_000 : null;
          unit = "ratio";
          break;
        case GITHUB_CANONICAL_METRIC_KEYS.MEAN_WORKFLOW_DURATION_MS:
          value = meanDurationMs;
          unit = "ms";
          break;
        default:
          value = runs.length;
          break;
      }

      return {
        providerKey: GITHUB_PROVIDER_KEY,
        externalResourceId: query.externalResourceId,
        capabilityKey: query.capabilityKey,
        metricKey: query.metricKey,
        capabilityStatus: "SUPPORTED",
        uxState: "connected_healthy",
        observedAtIso,
        sourceFreshnessMinutes: 5,
        provenanceLabel: `GitHub Actions • ${query.externalResourceId}`,
        statusExplanation: `Observed ${runs.length} workflow run attempt(s) (${passed.length} passed, ${failed.length} failed/timed out).`,
        points: [
          {
            timestampIso: query.endDateIso,
            metricKey: query.metricKey,
            value,
            unit,
            dimensions: { repository: normalizeRepoResourceId(query.externalResourceId) },
          },
        ],
      };
    },
  };
}
