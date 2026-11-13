import { PROVIDER_ERROR_CODES, type ReadOnlyProviderContext } from "@avenor/types";
import { describe, expect, it } from "vitest";
import { computeNextRealtimePollDelayMs } from "../../src/lib/hooks/use-ga4-realtime";
import { getProviderCatalogEntry } from "../../src/lib/providers";
import {
  createGa4ReadOnlyAdapter,
  GA4_READONLY_SCOPE,
  GA4_REALTIME_ALLOWED_DIMENSIONS,
  GA4_REALTIME_ALLOWED_METRICS,
  readGa4RealtimeReportBundle,
} from "../../src/lib/providers/google-analytics";

function createRealtimeContext(
  overrides?: Partial<ReadOnlyProviderContext>,
): ReadOnlyProviderContext {
  return {
    organizationId: "org_rt_1",
    workspaceId: "ws_rt_1",
    connectionId: "conn_rt_1",
    accessToken: "ya29.realtime_secret_token_do_not_expose",
    grantedScopes: [GA4_READONLY_SCOPE],
    ...overrides,
  };
}

describe("Milestone 03 — GA4 Realtime Activity Surface (THE-124)", () => {
  it("exposes supported realtime capabilities and strictly rejects unsupported metrics and standard-only dimensions", async () => {
    const ga4Catalog = getProviderCatalogEntry("ga4");
    expect(ga4Catalog).toBeDefined();
    const realtimeCap = ga4Catalog?.capabilities.find(
      (c) => c.capabilityKey === "realtime_activity",
    );
    expect(realtimeCap).toBeDefined();
    expect(realtimeCap?.supportedGranularities).toContain("realtimeSnapshot");

    expect(GA4_REALTIME_ALLOWED_METRICS.has("activeUsers")).toBe(true);
    expect(GA4_REALTIME_ALLOWED_METRICS.has("screenPageViews")).toBe(true);
    expect(GA4_REALTIME_ALLOWED_METRICS.has("eventCount")).toBe(true);
    expect(GA4_REALTIME_ALLOWED_DIMENSIONS.has("minutesAgo")).toBe(true);
    expect(GA4_REALTIME_ALLOWED_DIMENSIONS.has("unifiedScreenName")).toBe(true);

    const ctx = createRealtimeContext();

    // Standard historical dimension "sessionDefaultChannelGroup" is NOT allowed in GA4 Realtime
    await expect(
      readGa4RealtimeReportBundle(ctx, {
        propertyId: "properties/402918401",
        dimensions: ["sessionDefaultChannelGroup"],
      }),
    ).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY,
    });

    // Standard historical metric "sessions" / "engagementRate" is NOT allowed in GA4 Realtime
    await expect(
      readGa4RealtimeReportBundle(ctx, {
        propertyId: "properties/402918401",
        metrics: ["sessions"],
      }),
    ).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY,
    });

    // Adapter readMetrics also rejects incompatible historical dimension before network call
    if (!ga4Catalog) throw new Error("Expected GA4 catalog entry");
    const adapter = createGa4ReadOnlyAdapter(ga4Catalog);
    await expect(
      adapter.readMetrics(ctx, {
        capabilityKey: "realtime_activity",
        externalResourceId: "properties/402918401",
        metricKey: "activeUsers",
        granularity: "realtimeSnapshot",
        startDateIso: new Date().toISOString(),
        endDateIso: new Date().toISOString(),
        dimensions: ["landingPage"],
      }),
    ).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY,
    });
  });

  it("queries POST :runRealtimeReport with explicit rolling 30-minute estimate framing, handles empty/zero vs null cleanly, and falls back to stale cache on 429 rate limit", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    let force429 = false;

    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const body = init?.body
        ? (JSON.parse(String(init.body)) as { dimensions?: Array<{ name: string }> })
        : undefined;
      calls.push({ url, method, body });

      if (force429) {
        return new Response(
          JSON.stringify({
            error: {
              code: 429,
              message: "Quota exceeded for realtime API.",
              status: "RESOURCE_EXHAUSTED",
            },
          }),
          {
            status: 429,
            headers: { "content-type": "application/json", "Retry-After": "42" },
          },
        );
      }

      const firstDim = body?.dimensions?.[0]?.name ?? "";
      if (firstDim === "minutesAgo") {
        return new Response(
          JSON.stringify({
            dimensionHeaders: [{ name: "minutesAgo" }],
            metricHeaders: [
              { name: "activeUsers" },
              { name: "screenPageViews" },
              { name: "eventCount" },
            ],
            rows: [
              {
                dimensionValues: [{ value: "05" }],
                metricValues: [{ value: "21" }, { value: "44" }, { value: "102" }],
              },
              {
                dimensionValues: [{ value: "00" }],
                metricValues: [{ value: "18" }, { value: "35" }, { value: "88" }],
              },
            ],
            totals: [
              {
                dimensionValues: [{ value: "RESERVED_TOTAL" }],
                metricValues: [{ value: "47" }, { value: "120" }, { value: "310" }],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (firstDim === "country") {
        return new Response(
          JSON.stringify({
            metricHeaders: [
              { name: "activeUsers" },
              { name: "screenPageViews" },
              { name: "eventCount" },
            ],
            rows: [
              {
                dimensionValues: [{ value: "United States" }],
                metricValues: [{ value: "29" }, { value: "74" }, { value: "190" }],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (firstDim === "deviceCategory") {
        return new Response(
          JSON.stringify({
            metricHeaders: [
              { name: "activeUsers" },
              { name: "screenPageViews" },
              { name: "eventCount" },
            ],
            rows: [
              {
                dimensionValues: [{ value: "desktop" }],
                metricValues: [{ value: "32" }, { value: "80" }, { value: "220" }],
              },
              {
                dimensionValues: [{ value: "mobile" }],
                metricValues: [{ value: "15" }, { value: "" }, { value: "90" }],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      // unifiedScreenName + platform
      return new Response(
        JSON.stringify({
          metricHeaders: [
            { name: "activeUsers" },
            { name: "screenPageViews" },
            { name: "eventCount" },
          ],
          rows: [
            {
              dimensionValues: [{ value: "Pricing — Avenor" }, { value: "web" }],
              metricValues: [{ value: "19" }, { value: "40" }, { value: "95" }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const ctx = createRealtimeContext({ workspaceId: "ws_rt_live_cache" });
    const first = await readGa4RealtimeReportBundle(
      ctx,
      { propertyId: "402918401" },
      { fetchFn: mockFetch },
    );

    expect(calls.every((c) => c.method === "POST" && c.url.endsWith(":runRealtimeReport"))).toBe(
      true,
    );
    expect(first.windowMinutes).toBe(30);
    expect(first.windowLabel.toLowerCase()).toContain("30 minutes");
    expect(first.windowLabel.toLowerCase()).toContain("estimate");
    expect(first.isEstimateNotice.toLowerCase()).toContain("not exact instant");
    expect(first.activeUsersLast30m).toBe(47);
    expect(first.screenPageViewsLast30m).toBe(120);
    expect(first.eventCountLast30m).toBe(310);
    expect(first.byDevice[1]?.screenPageViews).toBeNull();
    expect(first.rateLimited).toBe(false);
    expect(first.stale).toBe(false);
    expect(calls.length).toBe(4);

    // Repeat call hits 30s tenant cache without issuing extra HTTP calls
    const cached = await readGa4RealtimeReportBundle(
      ctx,
      { propertyId: "402918401" },
      { fetchFn: mockFetch },
    );
    expect(cached.activeUsersLast30m).toBe(47);
    expect(calls.length).toBe(4);

    // Simulate quota exhaustion on forced manual refresh -> serves stale fallback cleanly marked rateLimited & stale
    force429 = true;
    const rateLimitedFallback = await readGa4RealtimeReportBundle(
      ctx,
      { propertyId: "402918401" },
      { fetchFn: mockFetch, bypassCache: true },
    );
    expect(rateLimitedFallback.rateLimited).toBe(true);
    expect(rateLimitedFallback.stale).toBe(true);
    expect(rateLimitedFallback.retryAfterSeconds).toBe(42);
    expect(rateLimitedFallback.activeUsersLast30m).toBe(47);
  });

  it("exposes stale and rate-limited simulation scenarios and pauses client polling when tab is hidden", async () => {
    const staleDemo = await readGa4RealtimeReportBundle(
      createRealtimeContext({
        accessToken: "sbx_ga4_realtime",
        simulationScenario: "stale_data",
      }),
      { propertyId: "properties/402918401" },
    );
    expect(staleDemo.stale).toBe(true);
    expect(staleDemo.freshnessSeconds).toBeGreaterThan(60);

    // Quota-aware polling guard checks
    expect(
      computeNextRealtimePollDelayMs({
        baseIntervalMs: 30_000,
        isHidden: true,
        isRateLimited: false,
      }),
    ).toBeNull();

    expect(
      computeNextRealtimePollDelayMs({
        baseIntervalMs: 30_000,
        isHidden: false,
        isRateLimited: false,
      }),
    ).toBe(30_000);

    expect(
      computeNextRealtimePollDelayMs({
        baseIntervalMs: 30_000,
        isHidden: false,
        isRateLimited: true,
        retryAfterSeconds: 75,
      }),
    ).toBe(75_000);
  });
});
