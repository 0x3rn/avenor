import crypto from "node:crypto";
import {
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import {
  type AllowedGitHubWebhookEvent,
  GITHUB_PROVIDER_KEY,
  type GitHubNormalizedOutcome,
  type GitHubWorkflowRunConclusion,
  type GitHubWorkflowRunStatus,
  type MinimizedGitHubWebhookEvent,
} from "./types";

const MAX_GITHUB_WEBHOOK_BYTES = 1_048_576; // 1 MiB ceiling

const ALLOWLISTED_GITHUB_GET_PATTERNS: readonly RegExp[] = [
  /^\/installation\/repositories$/,
  /^\/user\/repos$/,
  /^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
  /^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/workflows$/,
  /^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs$/,
  /^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/deployments$/,
  /^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/deployments\/\d+\/statuses$/,
];

const PROHIBITED_GITHUB_PATH_SUBSTRINGS: readonly string[] = [
  "/dispatches",
  "/rerun",
  "/cancel",
  "/contents",
  "/git/blobs",
  "/git/trees",
  "/merges",
  "/pulls",
  "/secrets",
  "/variables",
  "/hooks",
  "/keys",
  "/logs",
  "/artifacts",
  "/branches/",
  "/collaborators",
];

const ALLOWED_WEBHOOK_EVENTS: ReadonlySet<string> = new Set<AllowedGitHubWebhookEvent>([
  "ping",
  "installation",
  "installation_repositories",
  "workflow_run",
  "deployment",
  "deployment_status",
  "check_run",
]);

/**
 * Normalizes GitHub's separate `status` and `conclusion` fields without ever
 * mislabeling a completed failure/cancellation/timeout as "passed".
 */
export function normalizeGitHubWorkflowOutcome(
  status: GitHubWorkflowRunStatus,
  conclusion: GitHubWorkflowRunConclusion,
): GitHubNormalizedOutcome {
  if (
    status === "queued" ||
    status === "waiting" ||
    status === "pending" ||
    status === "requested"
  ) {
    return "queued";
  }
  if (status === "in_progress") {
    return "in_progress";
  }
  if (status === "completed") {
    switch (conclusion) {
      case "success":
        return "passed";
      case "failure":
      case "action_required":
        return "failed";
      case "cancelled":
        return "cancelled";
      case "skipped":
      case "neutral":
      case "stale":
        return "skipped";
      case "timed_out":
        return "timed_out";
      default:
        return "unknown";
    }
  }
  return "unknown";
}

/**
 * Enforces strict GET-only metadata reads on api.github.com.
 * Blocks workflow dispatch/rerun, source code reads (/contents, /git/blobs),
 * secrets, logs, PR merges, and all write verbs.
 */
export function assertAllowlistedGitHubGetRequest(method: string, urlString: string): URL {
  const normalizedMethod = method.trim().toUpperCase();
  if (normalizedMethod !== "GET") {
    throw new ProviderAdapterError({
      providerKey: GITHUB_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message: `GitHub read-only adapter blocked prohibited HTTP method "${normalizedMethod}". Only GET requests are permitted.`,
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new ProviderAdapterError({
      providerKey: GITHUB_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: `Invalid GitHub API URL "${urlString}".`,
    });
  }

  if (parsed.origin !== "https://api.github.com") {
    throw new ProviderAdapterError({
      providerKey: GITHUB_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message: `GitHub read-only adapter blocked untrusted origin "${parsed.origin}".`,
    });
  }

  const lowerPath = parsed.pathname.toLowerCase();
  for (const forbidden of PROHIBITED_GITHUB_PATH_SUBSTRINGS) {
    if (lowerPath.includes(forbidden)) {
      throw new ProviderAdapterError({
        providerKey: GITHUB_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
        message: `GitHub read-only adapter blocked prohibited endpoint "${parsed.pathname}" (${forbidden}).`,
      });
    }
  }

  const allowed = ALLOWLISTED_GITHUB_GET_PATTERNS.some((p) => p.test(parsed.pathname));
  if (!allowed) {
    throw new ProviderAdapterError({
      providerKey: GITHUB_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message: `GitHub read-only adapter blocked unallowlisted GET path "${parsed.pathname}".`,
    });
  }

  return parsed;
}

export function assertGitHubContext(context: ReadOnlyProviderContext): { token: string } {
  if (!context.organizationId || !context.workspaceId) {
    throw new ProviderAdapterError({
      providerKey: GITHUB_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "Workspace and organization context are required for GitHub read-only access.",
    });
  }

  const token = (context.accessToken ?? context.apiToken ?? "").trim();
  if (!token) {
    throw new ProviderAdapterError({
      providerKey: GITHUB_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "Missing GitHub App installation or read-only token.",
    });
  }

  return { token };
}

export function shouldExecuteLiveGitHubApi(
  context: ReadOnlyProviderContext,
  hasInjectedFetch: boolean,
): boolean {
  if (hasInjectedFetch) return true;
  const token = (context.accessToken ?? context.apiToken ?? "").trim();
  return token.startsWith("ghs_") || token.startsWith("github_pat_");
}

export async function executeGitHubReadOnlyGet(options: {
  url: string;
  token: string;
  fetchFn?: typeof fetch;
}): Promise<Response> {
  const parsed = assertAllowlistedGitHubGetRequest("GET", options.url);
  const fetchImpl = options.fetchFn ?? globalThis.fetch;

  const response = await fetchImpl(parsed.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Avenor-ReadOnly-Intelligence/1.0",
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new ProviderAdapterError({
        providerKey: GITHUB_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.CREDENTIAL_EXPIRED,
        message: "GitHub App installation token is invalid or expired (HTTP 401).",
      });
    }
    if (response.status === 403) {
      const remaining = response.headers.get("x-ratelimit-remaining");
      if (remaining === "0") {
        throw new ProviderAdapterError({
          providerKey: GITHUB_PROVIDER_KEY,
          code: PROVIDER_ERROR_CODES.RATE_LIMITED,
          message: "GitHub API primary rate limit exceeded (HTTP 403).",
          retryable: true,
          retryAfterSeconds: 60,
        });
      }
      throw new ProviderAdapterError({
        providerKey: GITHUB_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
        message: `GitHub App installation lacks read access to ${parsed.pathname} (HTTP 403).`,
      });
    }
    if (response.status === 404) {
      throw new ProviderAdapterError({
        providerKey: GITHUB_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.RESOURCE_NOT_FOUND,
        message: `GitHub repository or installation resource was not found or access was revoked (HTTP 404).`,
      });
    }
    if (response.status === 429) {
      throw new ProviderAdapterError({
        providerKey: GITHUB_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.RATE_LIMITED,
        message: "GitHub API secondary rate limit reached (HTTP 429).",
        retryable: true,
        retryAfterSeconds: 60,
      });
    }
    throw new ProviderAdapterError({
      providerKey: GITHUB_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
      message: `GitHub API returned HTTP ${response.status}.`,
      retryable: response.status >= 500,
    });
  }

  return response;
}

/**
 * Constant-time HMAC-SHA256 verification of GitHub's `X-Hub-Signature-256` header
 * over the exact raw request payload bytes.
 */
export function verifyGitHubWebhookSignature(options: {
  rawBody: string | Buffer;
  signatureHeader: string | null | undefined;
  webhookSecret: string;
}): boolean {
  const secret = options.webhookSecret.trim();
  const header = (options.signatureHeader ?? "").trim();
  if (!secret || !header.startsWith("sha256=")) {
    return false;
  }

  const providedHex = header.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/i.test(providedHex)) {
    return false;
  }

  const expectedHex = crypto.createHmac("sha256", secret).update(options.rawBody).digest("hex");

  const providedBuf = Buffer.from(providedHex, "hex");
  const expectedBuf = Buffer.from(expectedHex, "hex");
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Verifies size limits, event allowlist, HMAC signature, and extracts strictly
 * minimized metadata (never persisting source files, secrets, or raw logs).
 */
export function verifyAndMinimizeGitHubWebhook(options: {
  rawBody: string;
  eventHeader: string | null | undefined;
  deliveryIdHeader: string | null | undefined;
  signatureHeader: string | null | undefined;
  webhookSecret: string;
}): MinimizedGitHubWebhookEvent {
  if (Buffer.byteLength(options.rawBody, "utf8") > MAX_GITHUB_WEBHOOK_BYTES) {
    throw new ProviderAdapterError({
      providerKey: GITHUB_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: "GitHub webhook payload exceeded maximum allowed size (1 MiB).",
    });
  }

  const signatureValid = verifyGitHubWebhookSignature({
    rawBody: options.rawBody,
    signatureHeader: options.signatureHeader,
    webhookSecret: options.webhookSecret,
  });
  if (!signatureValid) {
    throw new ProviderAdapterError({
      providerKey: GITHUB_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "GitHub webhook signature verification failed (X-Hub-Signature-256 mismatch).",
    });
  }

  const eventType = (options.eventHeader ?? "").trim();
  if (!ALLOWED_WEBHOOK_EVENTS.has(eventType)) {
    throw new ProviderAdapterError({
      providerKey: GITHUB_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY,
      message: `Unsupported GitHub webhook event type "${eventType || "missing"}".`,
    });
  }

  const deliveryId = (options.deliveryIdHeader ?? "").trim();
  if (!deliveryId) {
    throw new ProviderAdapterError({
      providerKey: GITHUB_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: "Missing required X-GitHub-Delivery header for webhook idempotency.",
    });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(options.rawBody) as Record<string, unknown>;
  } catch {
    throw new ProviderAdapterError({
      providerKey: GITHUB_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: "Malformed JSON payload in GitHub webhook delivery.",
    });
  }

  const installation = payload.installation as { id?: number } | undefined;
  const repository = payload.repository as { id?: number; full_name?: string } | undefined;
  const workflowRun = payload.workflow_run as
    | {
        id?: number;
        run_attempt?: number;
        status?: string;
        conclusion?: string | null;
        head_sha?: string;
        head_branch?: string;
        updated_at?: string;
      }
    | undefined;
  const deployment = payload.deployment as
    | { id?: number; sha?: string; ref?: string; environment?: string; created_at?: string }
    | undefined;
  const deploymentStatus = payload.deployment_status as
    | { state?: string; environment?: string; updated_at?: string }
    | undefined;

  const status = workflowRun?.status ?? deploymentStatus?.state ?? null;
  const conclusion = workflowRun?.conclusion ?? null;
  const outcome = workflowRun
    ? normalizeGitHubWorkflowOutcome(
        (workflowRun.status as GitHubWorkflowRunStatus) ?? "unknown",
        (workflowRun.conclusion as GitHubWorkflowRunConclusion) ?? null,
      )
    : null;

  const externalEventId = workflowRun?.id
    ? `gh_run_${workflowRun.id}_a${workflowRun.run_attempt ?? 1}`
    : deployment?.id
      ? `gh_dpl_${deployment.id}`
      : `gh_delivery_${deliveryId}`;

  return {
    deliveryId,
    eventType: eventType as AllowedGitHubWebhookEvent,
    action: typeof payload.action === "string" ? payload.action : null,
    installationId: typeof installation?.id === "number" ? installation.id : null,
    repositoryId: typeof repository?.id === "number" ? repository.id : null,
    repositoryFullName: typeof repository?.full_name === "string" ? repository.full_name : null,
    commitSha: workflowRun?.head_sha ?? deployment?.sha ?? null,
    branch: workflowRun?.head_branch ?? deployment?.ref ?? null,
    status,
    conclusion,
    outcome,
    environment: deploymentStatus?.environment ?? deployment?.environment ?? null,
    externalEventId,
    occurredAtIso:
      workflowRun?.updated_at ??
      deploymentStatus?.updated_at ??
      deployment?.created_at ??
      new Date().toISOString(),
  };
}
