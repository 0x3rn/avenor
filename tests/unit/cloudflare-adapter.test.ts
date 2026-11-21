import { assertReadOnlyAdapterContract } from "@avenor/types";
import { describe, expect, it, vi } from "vitest";
import {
  assertAllowlistedCloudflareRequest,
  assertReadOnlyCloudflareGraphqlQuery,
  CLOUDFLARE_CANONICAL_METRIC_KEYS,
  computeWeightedCloudflareRatios,
  createCloudflareReadOnlyAdapter,
  getProviderCatalogEntry,
} from "@/lib/providers";

describe("THE-148: Cloudflare read-only GraphQL Zone Analytics adapter", () => {
  const cfCatalog = getProviderCatalogEntry("cloudflare");
  if (!cfCatalog) throw new Error("Expected cloudflare catalog entry");

  it("satisfies read-only adapter contract and blocks DNS, WAF, cache purge, Workers mutations, and GraphQL mutations", () => {
    const adapter = createCloudflareReadOnlyAdapter(cfCatalog);
    expect(() => assertReadOnlyAdapterContract(adapter)).not.toThrow();

    expect(() =>
      assertAllowlistedCloudflareRequest("GET", "https://api.cloudflare.com/client/v4/zones"),
    ).not.toThrow();

    expect(() =>
      assertAllowlistedCloudflareRequest(
        "POST",
        "https://api.cloudflare.com/client/v4/zones/z1/purge_cache",
      ),
    ).toThrow(/prohibited administrative endpoint/i);

    expect(() =>
      assertAllowlistedCloudflareRequest(
        "POST",
        "https://api.cloudflare.com/client/v4/zones/z1/dns_records",
      ),
    ).toThrow(/prohibited administrative endpoint/i);

    expect(() =>
      assertReadOnlyCloudflareGraphqlQuery("mutation { updateFirewallRule(id: 1) { id } }"),
    ).toThrow(/blocked GraphQL mutation/i);
  });

  it("parses mocked Cloudflare GraphQL Analytics groups, computes weighted cache hit ratio & 5xx rate, and reports plan-gated threats without fabricating 0", async () => {
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/client/v4/zones")) {
        return new Response(
          JSON.stringify({
            success: true,
            result: [
              {
                id: "zone_live_1",
                name: "docs.avenor.dev",
                status: "active",
                plan: { name: "Pro Website" },
                account: { id: "acct_1", name: "Avenor Edge" },
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/client/v4/graphql")) {
        return new Response(
          JSON.stringify({
            data: {
              viewer: {
                zones: [
                  {
                    httpRequests1dGroups: [
                      {
                        dimensions: { date: "2026-11-19" },
                        sum: {
                          requests: 100_000,
                          cachedRequests: 75_000,
                          bytes: 2_000_000_000,
                          cachedBytes: 1_500_000_000,
                          threats: 120,
                          responseStatusMap: [
                            { edgeResponseStatus: 200, requests: 99_500 },
                            { edgeResponseStatus: 404, requests: 450 },
                            { edgeResponseStatus: 502, requests: 50 },
                          ],
                        },
                      },
                      {
                        dimensions: { date: "2026-11-20" },
                        sum: {
                          requests: 300_000,
                          cachedRequests: 270_000,
                          bytes: 6_000_000_000,
                          cachedBytes: 5_400_000_000,
                          threats: 180,
                          responseStatusMap: [
                            { edgeResponseStatus: 200, requests: 299_000 },
                            { edgeResponseStatus: 403, requests: 900 },
                            { edgeResponseStatus: 503, requests: 100 },
                          ],
                        },
                      },
                    ],
                  },
                ],
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response("Not Found", { status: 404 });
    }) as unknown as typeof fetch;

    // Weighted cache hit ratio: (75,000 + 270,000) / 400,000 = 0.8625 (NOT unweighted average (0.75+0.90)/2 = 0.825!)
    const weighted = computeWeightedCloudflareRatios([
      {
        dateIso: "2026-11-19T00:00:00Z",
        totalRequests: 100_000,
        cachedRequests: 75_000,
        cacheHitRatio: 0.75,
        totalBytes: 0,
        cachedBytes: 0,
        threatsBlocked: 0,
        http4xxResponses: 0,
        http5xxResponses: 50,
        http5xxErrorRate: 0.0005,
      },
      {
        dateIso: "2026-11-20T00:00:00Z",
        totalRequests: 300_000,
        cachedRequests: 270_000,
        cacheHitRatio: 0.9,
        totalBytes: 0,
        cachedBytes: 0,
        threatsBlocked: 0,
        http4xxResponses: 0,
        http5xxResponses: 100,
        http5xxErrorRate: 0.000333,
      },
    ]);
    expect(weighted.weightedCacheHitRatio).toBe(0.8625);

    const adapter = createCloudflareReadOnlyAdapter(cfCatalog, { fetchFn: mockFetch });
    const ctx = {
      organizationId: "org_1",
      workspaceId: "ws_1",
      apiToken: "cf_live_token_ro",
      grantedScopes: ["zone.analytics:read", "account.analytics:read"],
      providerPlanTier: "pro" as const,
    };

    const zones = await adapter.discoverResources(ctx);
    expect(zones).toHaveLength(1);
    expect(zones[0]?.externalResourceId).toBe("zone_live_1");

    const req5xx = await adapter.readMetrics(ctx, {
      externalResourceId: "zone_live_1",
      capabilityKey: "edge_traffic",
      metricKey: CLOUDFLARE_CANONICAL_METRIC_KEYS.HTTP_5XX_RESPONSES,
      granularity: "daily",
      startDateIso: "2026-11-19T00:00:00.000Z",
      endDateIso: "2026-11-20T00:00:00.000Z",
    });
    expect(req5xx.capabilityStatus).toBe("SUPPORTED");
    expect(req5xx.points.map((p) => p.value)).toEqual([50, 100]);

    // Free-tier plan-gated threats returns PLAN_RESTRICTED with value: null
    const freeThreats = await adapter.readMetrics(
      { ...ctx, providerPlanTier: "free" },
      {
        externalResourceId: "zone_live_1",
        capabilityKey: "edge_traffic",
        metricKey: CLOUDFLARE_CANONICAL_METRIC_KEYS.THREATS_BLOCKED,
        granularity: "daily",
        startDateIso: "2026-11-19T00:00:00.000Z",
        endDateIso: "2026-11-20T00:00:00.000Z",
      },
    );
    expect(freeThreats.capabilityStatus).toBe("PLAN_RESTRICTED");
    expect(freeThreats.points[0]?.value).toBeNull();
  });
});
