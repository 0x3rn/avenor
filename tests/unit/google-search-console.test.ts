import {
  ERROR_CODES,
  FORBIDDEN_PROVIDER_MUTATION_METHODS,
  PROVIDER_ERROR_CODES,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import { describe, expect, it } from "vitest";
import { getProviderCatalogEntry } from "../../src/lib/providers";
import {
  buildGa4VsGscReconciliation,
  computeWeightedSearchTotalsFromRows,
  createGscReadOnlyAdapter,
  discoverSearchConsoleSites,
  GSC_READONLY_SCOPE,
  GSC_REPORTING_TIMEZONE,
  inspectSearchConsoleSite,
  mapGscSitesToDiscoveryItems,
  normalizeCanonicalGscSiteUrl,
  paginatedSearchAnalyticsQuery,
  readSearchAnalyticsReportBundle,
  validateSearchAnalyticsInput,
} from "../../src/lib/providers/google-search-console";
import { readGa4StandardReportBundle } from "../../src/lib/providers/google-analytics";

function createGscContext(overrides?: Partial<ReadOnlyProviderContext>): ReadOnlyProviderContext {
  return {
    organizationId: "org_gsc_1",
    workspaceId: "ws_gsc_1",
    connectionId: "conn_gsc_1",
    accessToken: "ya29.gsc_secret_token_do_not_expose",
    grantedScopes: [GSC_READONLY_SCOPE],
    ...overrides,
  };
}

describe("Milestone 03 — Google Search Console Verified Property Discovery (THE-125)", () => {
  it("enforces strictly read-only webmasters.readonly adapter contract with zero mutations", async () => {
    const gscCatalog = getProviderCatalogEntry("gsc");
    if (!gscCatalog) throw new Error("Expected GSC catalog entry");

    expect(gscCatalog.defaultScopes).toEqual([GSC_READONLY_SCOPE]);
    const adapter = createGscReadOnlyAdapter(gscCatalog);
    expect(adapter.readOnlyGuaranteed).toBe(true);

    for (const forbidden of FORBIDDEN_PROVIDER_MUTATION_METHODS) {
      expect((adapter as unknown as Record<string, unknown>)[forbidden]).toBeUndefined();
    }

    // Mutating Search Console REST verbs or unallowlisted endpoints are blocked with PRODUCTION_SAFETY_VIOLATION
    const { executeGoogleReadRequest } = await import("../../src/lib/providers/google-shared/http");
    await expect(
      executeGoogleReadRequest({
        providerKey: "gsc",
        method: "PUT" as "GET",
        url: "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com",
        accessToken: "ya29.test",
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PRODUCTION_SAFETY_VIOLATION,
    });

    await expect(
      executeGoogleReadRequest({
        providerKey: "gsc",
        method: "DELETE" as "GET",
        url: "https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fexample.com%2F",
        accessToken: "ya29.test",
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PRODUCTION_SAFETY_VIOLATION,
    });

    await expect(
      executeGoogleReadRequest({
        providerKey: "gsc",
        method: "POST",
        url: "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/sitemaps",
        accessToken: "ya29.test",
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PRODUCTION_SAFETY_VIOLATION,
    });
  });

  it("preserves canonical Domain (sc-domain:) vs URL-Prefix (https://.../) identifiers and rejects malformed targets", () => {
    const domainProp = normalizeCanonicalGscSiteUrl("sc-domain:Avenor.Dev");
    expect(domainProp.siteUrl).toBe("sc-domain:avenor.dev");
    expect(domainProp.encodedSiteUrl).toBe("sc-domain%3Aavenor.dev");
    expect(domainProp.propertyKind).toBe("DOMAIN");
    expect(domainProp.hostDomain).toBe("avenor.dev");

    const urlPrefixProp = normalizeCanonicalGscSiteUrl("https://www.avenor.dev/");
    expect(urlPrefixProp.siteUrl).toBe("https://www.avenor.dev/");
    expect(urlPrefixProp.encodedSiteUrl).toBe("https%3A%2F%2Fwww.avenor.dev%2F");
    expect(urlPrefixProp.propertyKind).toBe("URL_PREFIX");
    expect(urlPrefixProp.urlPrefixProtocol).toBe("https");
    expect(urlPrefixProp.urlPrefixPath).toBe("/");

    const subfolderProp = normalizeCanonicalGscSiteUrl("https://avenor.dev/docs/");
    expect(subfolderProp.siteUrl).toBe("https://avenor.dev/docs/");
    expect(subfolderProp.urlPrefixPath).toBe("/docs/");

    expect(() => normalizeCanonicalGscSiteUrl("ftp://avenor.dev")).toThrow();
    expect(() => normalizeCanonicalGscSiteUrl("sc-domain:avenor.dev/subpath")).toThrow();
    expect(() => normalizeCanonicalGscSiteUrl("https://user:pass@avenor.dev/")).toThrow();
    expect(() => normalizeCanonicalGscSiteUrl("https://avenor.dev/?q=1")).toThrow();
  });

  it("discovers verified/unverified GSC properties via GET /webmasters/v3/sites, encodes URLs cleanly, and flags overlapping properties", async () => {
    const requestedUrls: string[] = [];
    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      requestedUrls.push(`${method} ${url}`);

      if (url === "https://www.googleapis.com/webmasters/v3/sites") {
        return new Response(
          JSON.stringify({
            siteEntry: [
              { siteUrl: "sc-domain:signalatlas.io", permissionLevel: "siteOwner" },
              { siteUrl: "https://signalatlas.io/", permissionLevel: "siteFullUser" },
              {
                siteUrl: "https://unverified.signalatlas.io/",
                permissionLevel: "siteUnverifiedUser",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url === "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Asignalatlas.io") {
        return new Response(
          JSON.stringify({ siteUrl: "sc-domain:signalatlas.io", permissionLevel: "siteOwner" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      throw new Error(`Unexpected URL in mockFetch: ${method} ${url}`);
    };

    const ctx = createGscContext({ workspaceId: "ws_gsc_discovery_unit" });
    const discovery = await discoverSearchConsoleSites(ctx, {
      fetchFn: mockFetch,
      bypassCache: true,
    });

    expect(discovery.sourceMode).toBe("live");
    expect(discovery.sites).toHaveLength(3);
    expect(discovery.unverifiedCount).toBe(1);
    expect(discovery.overlapCount).toBe(3);

    const domainSite = discovery.sites[0];
    expect(domainSite?.siteUrl).toBe("sc-domain:signalatlas.io");
    expect(domainSite?.propertyKind).toBe("DOMAIN");
    expect(domainSite?.verifiedAccess).toBe(true);
    expect(domainSite?.overlappingSiteUrls).toContain("https://signalatlas.io/");

    const unverifiedSite = discovery.sites[2];
    expect(unverifiedSite?.permissionLevel).toBe("siteUnverifiedUser");
    expect(unverifiedSite?.verifiedAccess).toBe(false);

    const mapped = mapGscSitesToDiscoveryItems(discovery.sites, [
      "resource_discovery",
      "search_queries",
    ]);
    expect(mapped[0]?.externalResourceId).toBe("sc-domain:signalatlas.io");
    expect(mapped[0]?.availableCapabilities).toContain("search_queries");
    expect(mapped[2]?.availableCapabilities).toEqual(["resource_discovery"]);
    expect(typeof mapped[0]?.metadata.overlapNote).toBe("string");

    const single = await inspectSearchConsoleSite({
      accessToken: "ya29.test",
      siteUrl: "sc-domain:signalatlas.io",
      fetchFn: mockFetch,
    });
    expect(single.permissionLevel).toBe("siteOwner");
    expect(requestedUrls).toEqual([
      "GET https://www.googleapis.com/webmasters/v3/sites",
      "GET https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Asignalatlas.io",
    ]);
  });

  it("handles empty Search Console accounts, unverified-only accounts, missing scope, and 403/401 errors without leaking tokens", async () => {
    const secret = "ya29.do_not_leak_gsc_secret";
    const emptyFetch: typeof fetch = async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    const emptyRes = await discoverSearchConsoleSites(
      createGscContext({ workspaceId: "ws_gsc_empty", accessToken: secret }),
      { fetchFn: emptyFetch, bypassCache: true },
    );
    expect(emptyRes.sites).toEqual([]);

    await expect(
      discoverSearchConsoleSites(
        createGscContext({
          grantedScopes: ["https://www.googleapis.com/auth/analytics.readonly"],
        }),
        { fetchFn: emptyFetch, bypassCache: true },
      ),
    ).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
      missingScopes: [GSC_READONLY_SCOPE],
    });

    const gscCatalog = getProviderCatalogEntry("gsc");
    if (!gscCatalog) throw new Error("Expected GSC catalog");
    const adapter = createGscReadOnlyAdapter(gscCatalog, {
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            siteEntry: [
              { siteUrl: "https://unverified-only.dev/", permissionLevel: "siteUnverifiedUser" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });

    const unverifiedHealth = await adapter.getConnectionHealth(
      createGscContext({ accessToken: secret }),
    );
    expect(unverifiedHealth.status).toBe("PERMISSION_MISSING");
    expect(JSON.stringify(unverifiedHealth)).not.toContain(secret);
  });
});

describe("Milestone 03 — Search Analytics Reporting & GA4 vs GSC Interpretation (THE-126)", () => {
  it("computes impression-weighted position & true CTR and rejects Discover/Google News query incompatibility", () => {
    // Row 1: 10 clicks, 1000 impressions, position 10 -> weight 10000
    // Row 2: 20 clicks, 100 impressions, position 2 -> weight 200
    // Unweighted mean position would wrongly be 6.0; true impression-weighted position is 10200 / 1100 = ~9.2727
    // Unweighted mean CTR would be 0.105; true CTR is 30 / 1100 = ~0.02727
    const totals = computeWeightedSearchTotalsFromRows([
      { keys: ["q1"], clicks: 10, impressions: 1000, ctr: 0.01, position: 10 },
      { keys: ["q2"], clicks: 20, impressions: 100, ctr: 0.2, position: 2 },
    ]);
    expect(totals.clicks).toBe(30);
    expect(totals.impressions).toBe(1100);
    expect(totals.ctr).toBeCloseTo(30 / 1100, 6);
    expect(totals.position).toBeCloseTo(10200 / 1100, 6);

    // Search Console DISCOVER and GOOGLE_NEWS do NOT allow query dimension or query filter
    expect(() =>
      validateSearchAnalyticsInput({
        siteUrl: "sc-domain:avenor.dev",
        startDate: "2026-10-01",
        endDate: "2026-10-14",
        searchType: "DISCOVER",
        dimensions: ["query"],
      }),
    ).toThrowError(/query/i);

    expect(() =>
      validateSearchAnalyticsInput({
        siteUrl: "sc-domain:avenor.dev",
        startDate: "2026-10-01",
        endDate: "2026-10-14",
        searchType: "GOOGLE_NEWS",
        dimensionFilterGroups: [
          { filters: [{ dimension: "query", operator: "contains", expression: "avenor" }] },
        ],
      }),
    ).toThrowError(/query/i);
  });

  it("queries Search Analytics v3 with pagination, Pacific Time, lag/anonymization gap notices, and adapter readMetrics", async () => {
    const queryBodies: Array<Record<string, unknown>> = [];
    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(init?.method).toBe("POST");
      expect(url).toBe(
        "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Asignal.dev/searchAnalytics/query",
      );
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      queryBodies.push(body);

      const dims = (body.dimensions as string[] | undefined) ?? [];
      if (dims.length === 0) {
        return new Response(
          JSON.stringify({
            rows: [{ clicks: 500, impressions: 12000, ctr: 500 / 12000, position: 5.8 }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (dims[0] === "date") {
        return new Response(
          JSON.stringify({
            rows: [
              { keys: ["2026-10-01"], clicks: 220, impressions: 5000, ctr: 0.044, position: 5.5 },
              { keys: ["2026-10-02"], clicks: 280, impressions: 7000, ctr: 0.04, position: 6.0 },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (dims[0] === "query") {
        const startRow = Number(body.startRow ?? 0);
        const rowLimit = Number(body.rowLimit ?? 1000);
        if (rowLimit === 2) {
          if (startRow === 0) {
            return new Response(
              JSON.stringify({
                rows: [
                  { keys: ["q1"], clicks: 150, impressions: 2500, ctr: 0.06, position: 2.1 },
                  { keys: ["q2"], clicks: 120, impressions: 2400, ctr: 0.05, position: 3.4 },
                ],
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          }
          return new Response(
            JSON.stringify({
              rows: [{ keys: ["q3"], clicks: 100, impressions: 2000, ctr: 0.05, position: 4.5 }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        // Returned query clicks = 370 vs unsegmented clicks = 500 -> 130 omitted anonymized clicks
        return new Response(
          JSON.stringify({
            rows: [
              {
                keys: ["signal atlas"],
                clicks: 240,
                impressions: 3600,
                ctr: 0.066,
                position: 2.1,
              },
              {
                keys: ["read only bi"],
                clicks: 130,
                impressions: 3200,
                ctr: 0.04,
                position: 6.5,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          rows: [
            {
              keys: [`sample-${dims[0]}`],
              clicks: 310,
              impressions: 8000,
              ctr: 0.038,
              position: 5.4,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const paged = await paginatedSearchAnalyticsQuery({
      accessToken: "ya29.test_gsc",
      siteUrl: "sc-domain:signal.dev",
      requestBody: { startDate: "2026-10-01", endDate: "2026-10-02", dimensions: ["query"] },
      pageSize: 2,
      maxPagesToFetch: 3,
      fetchFn: mockFetch,
    });
    expect(paged.pagesFetched).toBe(2);
    expect(paged.rows).toHaveLength(3);
    expect(paged.hasMore).toBe(false);

    const ctx = createGscContext({ workspaceId: "ws_gsc_126_bundle" });
    const bundle = await readSearchAnalyticsReportBundle(
      ctx,
      {
        siteUrl: "sc-domain:signal.dev",
        startDate: "2026-10-01",
        endDate: "2026-10-02",
      },
      { fetchFn: mockFetch, bypassCache: true },
    );

    expect(bundle.totals.clicks).toBe(500);
    expect(bundle.coverage.reportingTimeZone).toBe(GSC_REPORTING_TIMEZONE);
    expect(bundle.coverage.queryClicksVsTotalClicksGap?.unsegmentedClicks).toBe(500);
    expect(bundle.coverage.queryClicksVsTotalClicksGap?.returnedQueryClicks).toBe(370);
    expect(bundle.coverage.queryClicksVsTotalClicksGap?.omittedClicksEstimate).toBe(130);
    expect(bundle.coverage.notices.some((n) => n.includes("America/Los_Angeles"))).toBe(true);
    expect(bundle.coverage.notices.some((n) => n.includes("NOT equivalent"))).toBe(true);

    // Adapter readMetrics with missing scope must return null values cleanly (never 0)
    const gscCatalog = getProviderCatalogEntry("gsc");
    if (!gscCatalog) throw new Error("Expected GSC catalog");
    const adapter = createGscReadOnlyAdapter(gscCatalog, { fetchFn: mockFetch });
    const denied = await adapter.readMetrics(
      createGscContext({ grantedScopes: ["https://www.googleapis.com/auth/analytics.readonly"] }),
      {
        capabilityKey: "search_queries",
        externalResourceId: "sc-domain:signal.dev",
        metricKey: "clicks",
        granularity: "daily",
        startDateIso: "2026-10-01T00:00:00.000Z",
        endDateIso: "2026-10-02T23:59:59.999Z",
      },
    );
    expect(denied.capabilityStatus).toBe("MISSING_PERMISSION");
    expect(denied.points[0]?.value).toBeNull();
  });

  it("builds explicit GA4 vs GSC reconciliation explaining clicks != sessions and timezone offset mismatches", async () => {
    const ga4Bundle = await readGa4StandardReportBundle(
      {
        organizationId: "org_rec",
        workspaceId: "ws_rec",
        accessToken: "sbx_ga4_reconcile",
        grantedScopes: ["https://www.googleapis.com/auth/analytics.readonly"],
      },
      {
        propertyId: "properties/402918401",
        startDate: "2026-10-01",
        endDate: "2026-10-14",
        propertyTimeZone: "Europe/Berlin",
      },
    );

    const gscBundle = await readSearchAnalyticsReportBundle(
      createGscContext({
        organizationId: "org_rec",
        workspaceId: "ws_rec",
        accessToken: "sbx_gsc_reconcile",
      }),
      {
        siteUrl: "sc-domain:avenor.dev",
        startDate: "2026-10-01",
        endDate: "2026-10-14",
      },
    );

    const reconciliation = buildGa4VsGscReconciliation({
      ga4Bundle,
      gscBundle,
      projectPrimaryDomain: "https://avenor.dev",
    });

    expect(reconciliation.gscReportingTimeZone).toBe("America/Los_Angeles");
    expect(reconciliation.ga4ReportingTimeZone).toBe("Europe/Berlin");
    expect(reconciliation.timezoneOffsetMismatch).toBe(true);
    expect(reconciliation.scopeAlignmentStatus).toBe("PARTIAL_SUBSET");
    expect(reconciliation.gscClicks).not.toBeNull();
    expect(reconciliation.ga4OrganicSessions).not.toBeNull();
    expect(
      reconciliation.notes.some(
        (n) =>
          n.topic === "clicks_vs_sessions" &&
          n.summary.includes("never be summed with or treated as equal"),
      ),
    ).toBe(true);
    expect(reconciliation.notes.some((n) => n.topic === "timezone_alignment")).toBe(true);
  });
});
