import { assertReadOnlyAdapterContract } from "@avenor/types";
import { describe, expect, it, vi } from "vitest";
import {
  assertAllowlistedVercelGetRequest,
  createVercelReadOnlyAdapter,
  getProviderCatalogEntry,
  parseVercelFocusChargesNdjson,
  VERCEL_CANONICAL_METRIC_KEYS,
} from "@/lib/providers";

describe("THE-149: Vercel read-only projects, deployments, and FOCUS billing adapter", () => {
  const vercelCatalog = getProviderCatalogEntry("vercel");
  if (!vercelCatalog) throw new Error("Expected vercel catalog entry");

  it("satisfies read-only contract and blocks non-GET verbs, env/secrets reads, promote, rollback, and untrusted origins", () => {
    const adapter = createVercelReadOnlyAdapter(vercelCatalog);
    expect(() => assertReadOnlyAdapterContract(adapter)).not.toThrow();

    expect(() =>
      assertAllowlistedVercelGetRequest("GET", "https://api.vercel.com/v9/projects"),
    ).not.toThrow();
    expect(() =>
      assertAllowlistedVercelGetRequest(
        "GET",
        "https://api.vercel.com/v6/deployments?projectId=prj_1",
      ),
    ).not.toThrow();
    expect(() =>
      assertAllowlistedVercelGetRequest("GET", "https://api.vercel.com/v1/billing/charges"),
    ).not.toThrow();

    expect(() =>
      assertAllowlistedVercelGetRequest("POST", "https://api.vercel.com/v13/deployments"),
    ).toThrow(/prohibited HTTP method/i);
    expect(() =>
      assertAllowlistedVercelGetRequest("DELETE", "https://api.vercel.com/v9/projects/prj_1"),
    ).toThrow(/prohibited HTTP method/i);
    expect(() =>
      assertAllowlistedVercelGetRequest("GET", "https://api.vercel.com/v9/projects/prj_1/env"),
    ).toThrow(/prohibited endpoint/i);
    expect(() =>
      assertAllowlistedVercelGetRequest("GET", "https://api.vercel.com/v9/projects/prj_1/secrets"),
    ).toThrow(/prohibited endpoint/i);
    expect(() =>
      assertAllowlistedVercelGetRequest("GET", "https://api.vercel.com/v10/projects/prj_1/promote"),
    ).toThrow(/prohibited endpoint/i);
    expect(() =>
      assertAllowlistedVercelGetRequest("GET", "https://api.vercel.com/v9/projects/prj_1/rollback"),
    ).toThrow(/prohibited endpoint/i);
    expect(() =>
      assertAllowlistedVercelGetRequest("GET", "https://evil.example.com/v9/projects"),
    ).toThrow(/untrusted origin/i);
  });

  it("discovers projects, computes deployment success rate & build duration, and parses FOCUS NDJSON charges safely", async () => {
    const ndjson = [
      JSON.stringify({
        ServiceName: "Fluid Compute",
        ChargeCategory: "Usage",
        BillingCurrency: "USD",
        BilledCost: 12.4,
        EffectiveCost: 12.4,
        ConsumedQuantity: 1500,
        ConsumedUnit: "GB-Hours",
        ChargePeriodStart: "2026-11-19T00:00:00Z",
        ChargePeriodEnd: "2026-11-20T00:00:00Z",
      }),
      JSON.stringify({
        ServiceName: "Fast Data Transfer",
        ChargeCategory: "Usage",
        BillingCurrency: "USD",
        BilledCost: 5.1,
        EffectiveCost: 5.1,
        ConsumedQuantity: 34,
        ConsumedUnit: "GB",
        ChargePeriodStart: "2026-11-19T00:00:00Z",
        ChargePeriodEnd: "2026-11-20T00:00:00Z",
      }),
    ].join("\n");

    const parsed = parseVercelFocusChargesNdjson(ndjson);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.serviceName).toBe("Fluid Compute");
    expect(parsed[1]?.billedCost).toBe(5.1);

    expect(() => parseVercelFocusChargesNdjson("{invalid-json")).toThrow(/Malformed NDJSON/i);

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v9/projects")) {
        return new Response(
          JSON.stringify({
            projects: [
              {
                id: "prj_live_avenor",
                name: "avenor-web",
                framework: "nextjs",
                accountId: "team_avenor",
                updatedAt: 1763683200000,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/v6/deployments")) {
        return new Response(
          JSON.stringify({
            deployments: [
              {
                uid: "dpl_a",
                name: "avenor-web",
                target: "production",
                readyState: "READY",
                created: 1763600000000,
                buildingAt: 1763600010000,
                ready: 1763600070000, // 60_000ms
                meta: { githubCommitSha: "aaa111", githubCommitRef: "main" },
              },
              {
                uid: "dpl_b",
                name: "avenor-web",
                target: "production",
                readyState: "READY",
                created: 1763610000000,
                buildingAt: 1763610005000,
                ready: 1763610085000, // 80_000ms
                meta: { githubCommitSha: "bbb222", githubCommitRef: "main" },
              },
              {
                uid: "dpl_c",
                name: "avenor-web",
                target: "preview",
                readyState: "ERROR",
                created: 1763620000000,
                meta: { githubCommitSha: "ccc333", githubCommitRef: "feat/x" },
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/v1/billing/charges")) {
        return new Response(ndjson, { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    }) as unknown as typeof fetch;

    const adapter = createVercelReadOnlyAdapter(vercelCatalog, { fetchFn: mockFetch });
    const ctx = {
      organizationId: "org_1",
      workspaceId: "ws_1",
      apiToken: "vcl_live_readonly_token",
      grantedScopes: ["projects:read", "deployments:read"],
      providerPlanTier: "pro" as const,
    };

    const projects = await adapter.discoverResources(ctx);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.externalResourceId).toBe("prj_live_avenor");
    expect(projects[0]?.metadata?.envVarReadsBlocked).toBe(true);

    const successRate = await adapter.readMetrics(ctx, {
      externalResourceId: "prj_live_avenor",
      capabilityKey: "deployment_reliability",
      metricKey: VERCEL_CANONICAL_METRIC_KEYS.DEPLOYMENT_SUCCESS_RATE,
      granularity: "daily",
      startDateIso: "2026-11-19T00:00:00.000Z",
      endDateIso: "2026-11-20T00:00:00.000Z",
    });
    expect(successRate.capabilityStatus).toBe("SUPPORTED");
    expect(successRate.points[0]?.value).toBe(0.6667);

    const meanBuild = await adapter.readMetrics(ctx, {
      externalResourceId: "prj_live_avenor",
      capabilityKey: "deployment_reliability",
      metricKey: VERCEL_CANONICAL_METRIC_KEYS.MEAN_BUILD_DURATION_MS,
      granularity: "daily",
      startDateIso: "2026-11-19T00:00:00.000Z",
      endDateIso: "2026-11-20T00:00:00.000Z",
    });
    expect(meanBuild.points[0]?.value).toBe(70_000);

    const billed = await adapter.readMetrics(ctx, {
      externalResourceId: "prj_live_avenor",
      capabilityKey: "billing_focus_charges",
      metricKey: VERCEL_CANONICAL_METRIC_KEYS.BILLED_COST,
      granularity: "daily",
      startDateIso: "2026-11-19T00:00:00.000Z",
      endDateIso: "2026-11-20T00:00:00.000Z",
    });
    expect(billed.capabilityStatus).toBe("SUPPORTED");
    expect(billed.points[0]?.value).toBe(17.5);
    expect(billed.points[0]?.unit).toBe("USD");

    // Free-tier billing returns PLAN_RESTRICTED with value: null (never fabricates 0)
    const freeBilled = await adapter.readMetrics(
      { ...ctx, providerPlanTier: "free" },
      {
        externalResourceId: "prj_live_avenor",
        capabilityKey: "billing_focus_charges",
        metricKey: VERCEL_CANONICAL_METRIC_KEYS.BILLED_COST,
        granularity: "daily",
        startDateIso: "2026-11-19T00:00:00.000Z",
        endDateIso: "2026-11-20T00:00:00.000Z",
      },
    );
    expect(freeBilled.capabilityStatus).toBe("PLAN_RESTRICTED");
    expect(freeBilled.points[0]?.value).toBeNull();
  });
});
