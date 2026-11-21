export const GITHUB_PROVIDER_KEY = "github" as const;
export const GITHUB_API_BASE_URL = "https://api.github.com" as const;

export const GITHUB_CANONICAL_METRIC_KEYS = {
  WORKFLOW_RUNS_TOTAL: "github.workflow_runs_total",
  WORKFLOW_RUNS_SUCCEEDED: "github.workflow_runs_succeeded",
  WORKFLOW_RUNS_FAILED: "github.workflow_runs_failed",
  WORKFLOW_SUCCESS_RATE: "github.workflow_success_rate",
  MEAN_WORKFLOW_DURATION_MS: "github.mean_workflow_duration_ms",
  DEPLOYMENTS_TOTAL: "github.deployments_total",
} as const;

export type GitHubCanonicalMetricKey =
  (typeof GITHUB_CANONICAL_METRIC_KEYS)[keyof typeof GITHUB_CANONICAL_METRIC_KEYS];

export type GitHubWorkflowRunStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "waiting"
  | "pending"
  | "requested"
  | "unknown";

export type GitHubWorkflowRunConclusion =
  | "success"
  | "failure"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "neutral"
  | "action_required"
  | "stale"
  | null;

export type GitHubNormalizedOutcome =
  | "passed"
  | "failed"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "in_progress"
  | "queued"
  | "unknown";

export interface GitHubRepositoryRecord {
  readonly repositoryId: number;
  readonly fullName: string;
  readonly owner: string;
  readonly name: string;
  readonly visibility: "public" | "private" | "internal";
  readonly defaultBranch: string;
  readonly installationId: number | null;
}

export interface GitHubWorkflowRunRecord {
  readonly runId: number;
  readonly runAttempt: number;
  readonly repositoryFullName: string;
  readonly workflowName: string;
  readonly status: GitHubWorkflowRunStatus;
  readonly conclusion: GitHubWorkflowRunConclusion;
  readonly outcome: GitHubNormalizedOutcome;
  readonly headSha: string;
  readonly headBranch: string;
  readonly event: string;
  readonly htmlUrl: string;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
  readonly durationMs: number | null;
}

export interface GitHubDeploymentRecord {
  readonly deploymentId: number;
  readonly repositoryFullName: string;
  readonly environment: string;
  readonly sha: string;
  readonly ref: string;
  readonly state:
    | "success"
    | "failure"
    | "error"
    | "in_progress"
    | "queued"
    | "pending"
    | "inactive"
    | "unknown";
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
}

export type AllowedGitHubWebhookEvent =
  | "ping"
  | "installation"
  | "installation_repositories"
  | "workflow_run"
  | "deployment"
  | "deployment_status"
  | "check_run";

export interface MinimizedGitHubWebhookEvent {
  readonly deliveryId: string;
  readonly eventType: AllowedGitHubWebhookEvent;
  readonly action: string | null;
  readonly installationId: number | null;
  readonly repositoryId: number | null;
  readonly repositoryFullName: string | null;
  readonly commitSha: string | null;
  readonly branch: string | null;
  readonly status: string | null;
  readonly conclusion: string | null;
  readonly outcome: GitHubNormalizedOutcome | null;
  readonly environment: string | null;
  readonly externalEventId: string;
  readonly occurredAtIso: string;
}
