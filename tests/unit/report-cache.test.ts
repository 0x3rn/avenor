import { describe, expect, it } from "vitest";
import {
  buildAuthenticatedReportResponseHeaders,
  buildTenantReportCacheKey,
  classifyReportDataFreshness,
  executeResilientMultiSourcePartitions,
  resolveReportCachePolicy,
  TenantScopedReportCache,
} from "@/lib/reports/cache";

describe("THE-132: Metric Caching, Honest Freshness Classification & Multi-Source Outage Resilience", () => {
  it("constructs tenant-and-role-scoped cache keys and rejects missing tenant identifiers", () => {
    expect(() =>
      buildTenantReportCacheKey({
        organizationId: "",
        workspaceId: "wks_1",
        role: "OWNER",
        surface: "portfolio_overview",
        startDate: "2026-11-01",
        endDate: "2026-11-15",
      }),
    ).toThrow(/requires non-empty organizationId and workspaceId/i);

    const keyOrgA = buildTenantReportCacheKey({
      organizationId: "org_a",
      workspaceId: "wks_a",
      projectId: "prj_1",
      role: "OWNER",
      surface: "project_control_center",
      startDate: "2026-11-01",
      endDate: "2026-11-15",
      filters: { environmentType: "PRODUCTION", preset: "14d" },
    });

    const keyOrgB = buildTenantReportCacheKey({
      organizationId: "org_b",
      workspaceId: "wks_b",
      projectId: "prj_1",
      role: "OWNER",
      surface: "project_control_center",
      startDate: "2026-11-01",
      endDate: "2026-11-15",
      filters: { preset: "14d", environmentType: "PRODUCTION" },
    });

    expect(keyOrgA.fullKey).not.toBe(keyOrgB.fullKey);
    expect(keyOrgA.keyHash).not.toBe(keyOrgB.keyHash);
  });

  it("assigns differentiated TTL policies for historical, recent, intraday, health, and realtime tiers", () => {
    const historical = resolveReportCachePolicy({
      endDate: "2026-10-31",
      todayDate: "2026-11-16",
      yesterdayDate: "2026-11-15",
    });
    expect(historical.tier).toBe("finalized_historical");
    expect(historical.freshTtlMs).toBe(15 * 60_000);

    const recent = resolveReportCachePolicy({
      endDate: "2026-11-15",
      todayDate: "2026-11-16",
      yesterdayDate: "2026-11-15",
    });
    expect(recent.tier).toBe("recent_standard");
    expect(recent.freshTtlMs).toBe(5 * 60_000);

    const intraday = resolveReportCachePolicy({
      endDate: "2026-11-16",
      todayDate: "2026-11-16",
      yesterdayDate: "2026-11-15",
    });
    expect(intraday.tier).toBe("intraday_provisional");
    expect(intraday.freshTtlMs).toBe(60_000);
  });

  it("handles cache hit, miss, stampede coalescing, stale fallback on transient error, and surgical tenant invalidation", async () => {
    const cache = new TenantScopedReportCache(50);
    const keyA = {
      organizationId: "org_a",
      workspaceId: "wks_a",
      projectId: "prj_a",
      role: "OWNER" as const,
      surface: "project_control_center" as const,
      startDate: "2026-11-01",
      endDate: "2026-11-15",
    };
    const keyB = {
      ...keyA,
      organizationId: "org_b",
      workspaceId: "wks_b",
    };

    let loaderCalls = 0;
    // Concurrent stampede test: 5 parallel calls coalesce into 1 loader execution
    const parallelResults = await Promise.all(
      Array.from({ length: 5 }, () =>
        cache.getOrLoad(
          keyA,
          async () => {
            loaderCalls += 1;
            await new Promise((r) => setTimeout(r, 15));
            return { sessions: 1250 };
          },
          { nowMs: 1_000_000 },
        ),
      ),
    );

    expect(loaderCalls).toBe(1);
    expect(parallelResults[0]?.value.sessions).toBe(1250);
    expect(parallelResults.some((r) => r.metadata.cacheStatus === "COALESCED_HIT")).toBe(true);

    // Subsequent call within fresh window is a fast HIT
    const hitRes = await cache.getOrLoad(
      keyA,
      async () => {
        loaderCalls += 1;
        return { sessions: 9999 };
      },
      { nowMs: 1_010_000 },
    );
    expect(hitRes.metadata.cacheStatus).toBe("HIT");
    expect(hitRes.value.sessions).toBe(1250);
    expect(loaderCalls).toBe(1);

    // Populate Tenant B
    await cache.getOrLoad(keyB, async () => ({ sessions: 400 }), { nowMs: 1_000_000 });

    // Advance past fresh TTL (15m = 900_000ms for finalized_historical) but within stale fallback window (60m = 3_600_000ms) and simulate loader outage
    const staleFallbackRes = await cache.getOrLoad<{ sessions: number }>(
      keyA,
      async () => {
        throw new Error("Transient database connection timeout");
      },
      { nowMs: 2_000_000 },
    );
    expect(staleFallbackRes.metadata.cacheStatus).toBe("STALE_FALLBACK");
    expect(staleFallbackRes.value.sessions).toBe(1250);

    // Invalidate Tenant A project -> Tenant B must remain untouched
    cache.invalidateProject("org_a", "wks_a", "prj_a");
    expect(cache.get(keyA, { allowStale: true, nowMs: 2_000_000 })).toBeNull();
    expect(cache.get<{ sessions: number }>(keyB, { nowMs: 1_010_000 })?.value.sessions).toBe(400);
  });

  it("classifies data freshness honestly without labeling historical database observations as Live", () => {
    const fixedNow = new Date("2026-11-16T12:00:00.000Z");

    const fresh = classifyReportDataFreshness({
      lastSuccessfulSyncIso: "2026-11-16T11:45:00.000Z",
      completenessState: "COMPLETE",
      now: fixedNow,
    });
    expect(fresh.state).toBe("FRESH");
    expect(fresh.badgeLabel).toBe("Collected 15m ago");

    const provisional = classifyReportDataFreshness({
      lastSuccessfulSyncIso: "2026-11-16T11:45:00.000Z",
      completenessState: "PROVISIONAL",
      now: fixedNow,
    });
    expect(provisional.state).toBe("INCOMPLETE");
    expect(provisional.uxState).toBe("partial_coverage");

    const stale = classifyReportDataFreshness({
      lastSuccessfulSyncIso: "2026-11-15T12:00:00.000Z",
      completenessState: "COMPLETE",
      freshnessWindowMinutes: 360,
      now: fixedNow,
    });
    expect(stale.state).toBe("STALE");
    expect(stale.uxState).toBe("stale_cached");

    const revoked = classifyReportDataFreshness({
      lastSuccessfulSyncIso: "2026-11-16T11:00:00.000Z",
      connectionStatus: "REVOKED",
      now: fixedNow,
    });
    expect(revoked.state).toBe("PERMISSION_DENIED");
    expect(revoked.uxState).toBe("permission_insufficient");
  });

  it("isolates partial source outages so a Search Console failure never blocks GA4 reporting", async () => {
    const outcome = await executeResilientMultiSourcePartitions({
      ga4: {
        sourceKey: "ga4",
        displayName: "Google Analytics 4",
        lastSyncedAtIso: "2026-11-16T11:30:00.000Z",
        fallbackValue: { sessions: null },
        execute: async () => ({ sessions: 4820 }),
      },
      gsc: {
        sourceKey: "gsc",
        displayName: "Google Search Console",
        lastSyncedAtIso: "2026-11-16T08:00:00.000Z",
        fallbackValue: { clicks: null },
        execute: async () => {
          throw new Error("Search Console 503 Service Unavailable (Bearer ya29.secret_token)");
        },
      },
    });

    expect(outcome.hasDegradedSource).toBe(true);
    expect(outcome.results.ga4.sessions).toBe(4820);
    expect(outcome.results.gsc.clicks).toBeNull();
    // Ensure OAuth tokens in provider error strings are redacted
    expect(outcome.warnings[0]).not.toContain("ya29.secret_token");
    expect(outcome.warnings[0]).toContain("[REDACTED");

    const headers = buildAuthenticatedReportResponseHeaders();
    expect(headers["Cache-Control"]).toContain("private, no-store");
  });
});
