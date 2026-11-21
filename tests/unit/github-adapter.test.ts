import crypto from "node:crypto";
import { assertReadOnlyAdapterContract } from "@avenor/types";
import { describe, expect, it, vi } from "vitest";
import {
  assertAllowlistedGitHubGetRequest,
  createGitHubReadOnlyAdapter,
  getProviderCatalogEntry,
  GITHUB_CANONICAL_METRIC_KEYS,
  GitHubWebhookDeliveryDedupeCache,
  listGitHubWorkflowRuns,
  normalizeGitHubWorkflowOutcome,
  verifyAndMinimizeGitHubWebhook,
  verifyGitHubWebhookSignature,
} from "@/lib/providers";

describe("THE-150: GitHub App read-only repository, workflow, and signed webhook adapter", () => {
  const ghCatalog = getProviderCatalogEntry("github");
  if (!ghCatalog) throw new Error("Expected github catalog entry");

  it("satisfies read-only contract and blocks workflow dispatch, code contents, secrets, PR merges, and write verbs", () => {
    const adapter = createGitHubReadOnlyAdapter(ghCatalog);
    expect(() => assertReadOnlyAdapterContract(adapter)).not.toThrow();

    expect(() =>
      assertAllowlistedGitHubGetRequest("GET", "https://api.github.com/installation/repositories"),
    ).not.toThrow();
    expect(() =>
      assertAllowlistedGitHubGetRequest(
        "GET",
        "https://api.github.com/repos/corstack/avenor/actions/runs",
      ),
    ).not.toThrow();

    expect(() =>
      assertAllowlistedGitHubGetRequest(
        "POST",
        "https://api.github.com/repos/corstack/avenor/actions/workflows/ci.yml/dispatches",
      ),
    ).toThrow(/prohibited HTTP method/i);
    expect(() =>
      assertAllowlistedGitHubGetRequest(
        "GET",
        "https://api.github.com/repos/corstack/avenor/contents/src/secret.ts",
      ),
    ).toThrow(/prohibited endpoint/i);
    expect(() =>
      assertAllowlistedGitHubGetRequest(
        "GET",
        "https://api.github.com/repos/corstack/avenor/actions/secrets",
      ),
    ).toThrow(/prohibited endpoint/i);
    expect(() =>
      assertAllowlistedGitHubGetRequest(
        "GET",
        "https://api.github.com/repos/corstack/avenor/actions/runs/1/logs",
      ),
    ).toThrow(/prohibited endpoint/i);
  });

  it("distinguishes GitHub workflow status vs conclusion accurately and computes run metrics", async () => {
    // Completed with failure MUST NEVER be labeled passed
    expect(normalizeGitHubWorkflowOutcome("completed", "failure")).toBe("failed");
    expect(normalizeGitHubWorkflowOutcome("completed", "cancelled")).toBe("cancelled");
    expect(normalizeGitHubWorkflowOutcome("completed", "timed_out")).toBe("timed_out");
    expect(normalizeGitHubWorkflowOutcome("completed", "success")).toBe("passed");
    expect(normalizeGitHubWorkflowOutcome("in_progress", null)).toBe("in_progress");

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/installation/repositories")) {
        return new Response(
          JSON.stringify({
            repositories: [
              {
                id: 991122,
                full_name: "corstack/avenor",
                name: "avenor",
                owner: { login: "corstack" },
                private: true,
                visibility: "private",
                default_branch: "main",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/actions/runs")) {
        return new Response(
          JSON.stringify({
            workflow_runs: [
              {
                id: 501,
                run_attempt: 1,
                name: "CI",
                status: "completed",
                conclusion: "failure",
                head_sha: "deadbeef01",
                head_branch: "main",
                event: "push",
                run_started_at: "2026-11-20T10:00:00.000Z",
                updated_at: "2026-11-20T10:02:00.000Z",
              },
              {
                id: 501,
                run_attempt: 2,
                name: "CI",
                status: "completed",
                conclusion: "success",
                head_sha: "deadbeef01",
                head_branch: "main",
                event: "push",
                run_started_at: "2026-11-20T10:05:00.000Z",
                updated_at: "2026-11-20T10:09:00.000Z",
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("Not Found", { status: 404 });
    }) as unknown as typeof fetch;

    const adapter = createGitHubReadOnlyAdapter(ghCatalog, { fetchFn: mockFetch });
    const ctx = {
      organizationId: "org_1",
      workspaceId: "ws_1",
      accessToken: "ghs_install_readonly_token",
      grantedScopes: ["read:user", "repo:status"],
    };

    const repos = await adapter.discoverResources(ctx);
    expect(repos).toHaveLength(1);
    expect(repos[0]?.externalResourceId).toBe("repo:corstack/avenor");
    expect(repos[0]?.metadata?.repositoryId).toBe(991122);

    const runs = await listGitHubWorkflowRuns(ctx, "repo:corstack/avenor", { fetchFn: mockFetch });
    expect(runs).toHaveLength(2);
    expect(runs[0]?.outcome).toBe("failed");
    expect(runs[0]?.runAttempt).toBe(1);
    expect(runs[1]?.outcome).toBe("passed");
    expect(runs[1]?.runAttempt).toBe(2);

    const successRate = await adapter.readMetrics(ctx, {
      externalResourceId: "repo:corstack/avenor",
      capabilityKey: "repository_activity",
      metricKey: GITHUB_CANONICAL_METRIC_KEYS.WORKFLOW_SUCCESS_RATE,
      granularity: "daily",
      startDateIso: "2026-11-20T00:00:00.000Z",
      endDateIso: "2026-11-21T00:00:00.000Z",
    });
    expect(successRate.capabilityStatus).toBe("SUPPORTED");
    expect(successRate.points[0]?.value).toBe(0.5);
  });

  it("verifies X-Hub-Signature-256 in constant time, rejects tampered payloads, and deduplicates webhook replays", () => {
    const secret = "whsec_avenor_test_secret_12345";
    const body = JSON.stringify({
      action: "completed",
      installation: { id: 50120 },
      repository: { id: 991122, full_name: "corstack/avenor" },
      workflow_run: {
        id: 777,
        run_attempt: 1,
        status: "completed",
        conclusion: "failure",
        head_sha: "abc123def456",
        head_branch: "main",
        updated_at: "2026-11-21T12:00:00.000Z",
      },
    });
    const validSig = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;

    expect(
      verifyGitHubWebhookSignature({
        rawBody: body,
        signatureHeader: validSig,
        webhookSecret: secret,
      }),
    ).toBe(true);
    expect(
      verifyGitHubWebhookSignature({
        rawBody: `${body} `, // tampered byte
        signatureHeader: validSig,
        webhookSecret: secret,
      }),
    ).toBe(false);

    const minimized = verifyAndMinimizeGitHubWebhook({
      rawBody: body,
      eventHeader: "workflow_run",
      deliveryIdHeader: "deliv-uuid-001",
      signatureHeader: validSig,
      webhookSecret: secret,
    });
    expect(minimized.outcome).toBe("failed");
    expect(minimized.commitSha).toBe("abc123def456");
    expect(minimized.externalEventId).toBe("gh_run_777_a1");

    // Reject tampered payload
    expect(() =>
      verifyAndMinimizeGitHubWebhook({
        rawBody: body.replace("failure", "success"),
        eventHeader: "workflow_run",
        deliveryIdHeader: "deliv-uuid-002",
        signatureHeader: validSig,
        webhookSecret: secret,
      }),
    ).toThrow(/signature verification failed/i);

    // Reject unsupported event type
    const unsupportedSig = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(() =>
      verifyAndMinimizeGitHubWebhook({
        rawBody: body,
        eventHeader: "push_code_secrets",
        deliveryIdHeader: "deliv-uuid-003",
        signatureHeader: unsupportedSig,
        webhookSecret: secret,
      }),
    ).toThrow(/Unsupported GitHub webhook event/i);

    // Replay deduplication
    const dedupe = new GitHubWebhookDeliveryDedupeCache();
    expect(dedupe.recordIfNew(minimized.deliveryId)).toBe(true);
    expect(dedupe.recordIfNew(minimized.deliveryId)).toBe(false);
  });
});
