import { assertReadOnlyAdapterContract } from "@avenor/types";
import { describe, expect, it, vi } from "vitest";
import {
  assertAllowlistedSentryGetRequest,
  createSentryReadOnlyAdapter,
  getProviderCatalogEntry,
  listSentrySanitizedIssues,
  sanitizeSentryTextAndDropPii,
  SENTRY_CANONICAL_METRIC_KEYS,
} from "@/lib/providers";

describe("THE-151: Sentry read-only error and performance adapter", () => {
  const sentryCatalog = getProviderCatalogEntry("sentry");
  if (!sentryCatalog) throw new Error("Expected sentry catalog entry");

  it("enforces read-only contract, refuses write/admin tokens, and blocks issue mutations and raw event PII endpoints", async () => {
    const adapter = createSentryReadOnlyAdapter(sentryCatalog);
    expect(() => assertReadOnlyAdapterContract(adapter)).not.toThrow();

    expect(() =>
      assertAllowlistedSentryGetRequest(
        "GET",
        "https://sentry.io/api/0/organizations/corstack/projects/",
      ),
    ).not.toThrow();

    // Block issue resolution/deletion (PUT/DELETE)
    expect(() =>
      assertAllowlistedSentryGetRequest("PUT", "https://sentry.io/api/0/issues/12345/"),
    ).toThrow(/prohibited HTTP method/i);
    expect(() =>
      assertAllowlistedSentryGetRequest("DELETE", "https://sentry.io/api/0/issues/12345/"),
    ).toThrow(/prohibited HTTP method/i);

    // Block raw event payload endpoint
    expect(() =>
      assertAllowlistedSentryGetRequest(
        "GET",
        "https://sentry.io/api/0/projects/corstack/avenor-web/events/",
      ),
    ).toThrow(/prohibited or raw-PII endpoint/i);

    // Refuse overly broad write/admin token scopes
    await expect(
      adapter.discoverResources({
        organizationId: "org_1",
        workspaceId: "ws_1",
        apiToken: "sntrys_broad_token",
        grantedScopes: ["org:read", "project:write", "event:admin"],
      }),
    ).rejects.toThrow(/refused overly broad write\/admin token scopes/i);
  });

  it("redacts emails, IPs, cookies, auth headers, and query secrets from issue summaries and gates Free-tier percentiles without fabricating values", async () => {
    const scrubbed = sanitizeSentryTextAndDropPii(
      "AuthError for alice@example.com from 198.51.100.42 with Authorization: Bearer super_secret_token_999 and Cookie: sid=xyz123 at https://app.example.com?token=abc987",
    );
    expect(scrubbed).not.toContain("alice@example.com");
    expect(scrubbed).not.toContain("198.51.100.42");
    expect(scrubbed).not.toContain("super_secret_token_999");
    expect(scrubbed).not.toContain("sid=xyz123");
    expect(scrubbed).not.toContain("abc987");
    expect(scrubbed).toContain("[REDACTED_EMAIL]");
    expect(scrubbed).toContain("[REDACTED_IP]");

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/issues/")) {
        return new Response(
          JSON.stringify([
            {
              id: "9001",
              shortId: "AVENOR-99",
              title: "Error for bob@company.io (ip 203.0.113.5) Cookie: session=secretval",
              level: "error",
              status: "unresolved",
              count: "200",
              firstSeen: "2026-11-20T09:00:00Z",
              lastSeen: "2026-11-21T09:00:00Z",
              permalink: "https://corstack.sentry.io/issues/9001/",
              firstRelease: { version: "avenor@sha123" },
            },
          ]),
          { status: 200 },
        );
      }
      return new Response("Not Found", { status: 404 });
    }) as unknown as typeof fetch;

    const ctx = {
      organizationId: "org_1",
      workspaceId: "ws_1",
      apiToken: "sntrys_ro_token",
      grantedScopes: ["org:read", "project:read", "event:read"],
      providerPlanTier: "pro" as const,
    };

    const issues = await listSentrySanitizedIssues(ctx, "corstack/avenor-web", {
      fetchFn: mockFetch,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.sanitizedTitle).not.toContain("bob@company.io");
    expect(issues[0]?.sanitizedTitle).not.toContain("203.0.113.5");
    expect(issues[0]?.sanitizedTitle).not.toContain("secretval");
    expect(issues[0]?.errorEventCount).toBe(200);
    expect(issues[0]?.verifiedPermalink).toBe("https://corstack.sentry.io/issues/9001/");

    const adapter = createSentryReadOnlyAdapter(sentryCatalog, { fetchFn: mockFetch });
    const eventsResult = await adapter.readMetrics(ctx, {
      externalResourceId: "corstack/avenor-web",
      capabilityKey: "issue_telemetry",
      metricKey: SENTRY_CANONICAL_METRIC_KEYS.ERROR_EVENTS_TOTAL,
      granularity: "daily",
      startDateIso: "2026-11-20T00:00:00.000Z",
      endDateIso: "2026-11-21T00:00:00.000Z",
    });
    expect(eventsResult.points[0]?.value).toBe(200);
    expect(eventsResult.statusExplanation).toMatch(/not unique affected users/i);

    // Free-tier p95 latency returns PLAN_RESTRICTED with value: null
    const freeP95 = await adapter.readMetrics(
      { ...ctx, providerPlanTier: "free" },
      {
        externalResourceId: "corstack/avenor-web",
        capabilityKey: "issue_telemetry",
        metricKey: SENTRY_CANONICAL_METRIC_KEYS.TRANSACTION_P95_MS,
        granularity: "daily",
        startDateIso: "2026-11-20T00:00:00.000Z",
        endDateIso: "2026-11-21T00:00:00.000Z",
      },
    );
    expect(freeP95.capabilityStatus).toBe("PLAN_RESTRICTED");
    expect(freeP95.points[0]?.value).toBeNull();
  });
});
