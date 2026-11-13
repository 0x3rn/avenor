import {
  ERROR_CODES,
  FORBIDDEN_PROVIDER_MUTATION_METHODS,
  PROVIDER_ERROR_CODES,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConnectionsConsole } from "../../src/components/connections/connections-console";
import { getProviderCatalogEntry, PROVIDER_CATALOG } from "../../src/lib/providers";
import {
  checkGa4DimensionMetricCompatibility,
  createGa4ReadOnlyAdapter,
  discoverGa4PropertiesAndStreams,
  GA4_METRIC_DICTIONARY,
  GA4_READONLY_SCOPE,
  normalizeGa4PropertyResourceName,
  parseGa4MetricNumber,
  readGa4StandardReportBundle,
  resolveGa4MetricDefinition,
  validateGa4StandardQueryInputs,
} from "../../src/lib/providers/google-analytics";
import { ScopedTelemetryCache } from "../../src/lib/providers/google-shared/cache";
import { executeGoogleReadRequest } from "../../src/lib/providers/google-shared/http";

function createTestContext(overrides?: Partial<ReadOnlyProviderContext>): ReadOnlyProviderContext {
  return {
    organizationId: "org_test_1",
    workspaceId: "ws_test_1",
    connectionId: "conn_ga4_1",
    accessToken: "ya29.test_access_token_do_not_leak",
    grantedScopes: [GA4_READONLY_SCOPE],
    ...overrides,
  };
}

describe("Milestone 03 — GA4 Admin API Discovery & Read-Only Guardrails (THE-122)", () => {
  it("enforces strictly read-only transport and adapter surface with zero mutation methods", async () => {
    const ga4Catalog = getProviderCatalogEntry("ga4");
    expect(ga4Catalog).toBeDefined();
    if (!ga4Catalog) throw new Error("Expected GA4 catalog entry");
    const adapter = createGa4ReadOnlyAdapter(ga4Catalog);

    expect(adapter.readOnlyGuaranteed).toBe(true);
    for (const forbiddenMethod of FORBIDDEN_PROVIDER_MUTATION_METHODS) {
      expect((adapter as unknown as Record<string, unknown>)[forbiddenMethod]).toBeUndefined();
    }

    // Mutating HTTP verbs or non-allowlisted hosts/endpoints must fail hard before fetch
    await expect(
      executeGoogleReadRequest({
        providerKey: "ga4",
        url: "https://analyticsadmin.googleapis.com/v1beta/properties/12345",
        method: "POST",
        accessToken: "ya29.test",
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PRODUCTION_SAFETY_VIOLATION,
    });

    await expect(
      executeGoogleReadRequest({
        providerKey: "ga4",
        url: "https://evil.example.com/v1beta/accountSummaries",
        method: "GET",
        accessToken: "ya29.test",
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PRODUCTION_SAFETY_VIOLATION,
    });
  });

  it("validates and normalizes GA4 property resource names and rejects path traversal or measurement IDs", () => {
    expect(normalizeGa4PropertyResourceName("314159265")).toBe("properties/314159265");
    expect(normalizeGa4PropertyResourceName("properties/314159265")).toBe("properties/314159265");

    expect(() => normalizeGa4PropertyResourceName("G-MEASUREMENT123")).toThrowError();
    expect(() => normalizeGa4PropertyResourceName("../admin/accounts")).toThrowError();
    expect(() => normalizeGa4PropertyResourceName("")).toThrowError();
  });

  it("paginates accountSummaries, fetches property metadata & child data streams via HTTP GET, and preserves Property ID vs Measurement ID distinction", async () => {
    const recordedRequests: Array<{ method: string; url: string }> = [];

    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      recordedRequests.push({ method, url });

      if (url.includes("/accountSummaries") && !url.includes("pageToken=")) {
        return new Response(
          JSON.stringify({
            accountSummaries: [
              {
                name: "accountSummaries/1001",
                account: "accounts/1001",
                displayName: "Acme Holdings",
                propertySummaries: [
                  {
                    property: "properties/987654321",
                    displayName: "Acme Global Web",
                    propertyType: "PROPERTY_TYPE_ORDINARY",
                  },
                ],
              },
            ],
            nextPageToken: "page_2_token",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url.includes("/accountSummaries") && url.includes("pageToken=page_2_token")) {
        return new Response(
          JSON.stringify({
            accountSummaries: [
              {
                name: "accountSummaries/1002",
                account: "accounts/1002",
                displayName: "Acme EU",
                propertySummaries: [
                  {
                    property: "properties/112233445",
                    displayName: "Acme EU App",
                    propertyType: "PROPERTY_TYPE_ORDINARY",
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url.endsWith("/properties/987654321")) {
        return new Response(
          JSON.stringify({
            name: "properties/987654321",
            displayName: "Acme Global Web",
            timeZone: "America/Los_Angeles",
            currencyCode: "USD",
            propertyType: "PROPERTY_TYPE_ORDINARY",
            serviceLevel: "GOOGLE_ANALYTICS_360",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url.endsWith("/properties/987654321/dataStreams?pageSize=200")) {
        return new Response(
          JSON.stringify({
            dataStreams: [
              {
                name: "properties/987654321/dataStreams/777111",
                type: "WEB_DATA_STREAM",
                displayName: "Acme Production Web",
                webStreamData: {
                  measurementId: "G-ACMEWEB01",
                  defaultUri: "https://acme.example.com",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url.endsWith("/properties/112233445")) {
        return new Response(
          JSON.stringify({
            name: "properties/112233445",
            displayName: "Acme EU App",
            timeZone: "Europe/Paris",
            currencyCode: "EUR",
            propertyType: "PROPERTY_TYPE_ORDINARY",
            serviceLevel: "GOOGLE_ANALYTICS_STANDARD",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url.endsWith("/properties/112233445/dataStreams?pageSize=200")) {
        return new Response(
          JSON.stringify({
            dataStreams: [
              {
                name: "properties/112233445/dataStreams/888222",
                type: "IOS_APP_DATA_STREAM",
                displayName: "Acme iOS",
                iosAppStreamData: {
                  firebaseAppId: "1:999:ios:abc",
                  bundleId: "com.acme.ios",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response(JSON.stringify({ error: { message: "Unexpected URL" } }), {
        status: 404,
      });
    };

    const discovery = await discoverGa4PropertiesAndStreams(createTestContext(), {
      fetchFn: mockFetch,
    });

    expect(discovery.sourceMode).toBe("live");
    expect(discovery.pageCount).toBe(2);
    expect(discovery.accountCount).toBe(2);
    expect(discovery.properties).toHaveLength(2);
    expect(recordedRequests.every((r) => r.method === "GET")).toBe(true);

    const ga4Catalog = getProviderCatalogEntry("ga4");
    if (!ga4Catalog) throw new Error("Expected GA4 catalog entry");
    const adapter = createGa4ReadOnlyAdapter(ga4Catalog, {
      fetchFn: mockFetch,
    });
    const discoveredItems = await adapter.discoverResources(createTestContext());

    expect(discoveredItems).toHaveLength(2);
    const first = discoveredItems[0];
    expect(first.externalResourceId).toBe("properties/987654321");
    expect(first.resourceType).toBe("ga4_property");
    expect(first.metadata?.timeZone).toBe("America/Los_Angeles");
    expect(first.metadata?.currencyCode).toBe("USD");
    expect(first.metadata?.primaryMeasurementId).toBe("G-ACMEWEB01");
    const streams = JSON.parse(String(first.metadata?.dataStreamsJson)) as Array<{
      measurementId?: string | null;
    }>;
    expect(streams[0]?.measurementId).toBe("G-ACMEWEB01");
    expect(first.externalResourceId).not.toBe("G-ACMEWEB01");
  });

  it("returns empty property list on accounts with zero accessible GA4 properties and rejects missing scope", async () => {
    const emptyFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ accountSummaries: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    const emptyResult = await discoverGa4PropertiesAndStreams(createTestContext(), {
      fetchFn: emptyFetch,
    });
    expect(emptyResult.properties).toEqual([]);
    expect(emptyResult.accountCount).toBe(0);

    await expect(
      discoverGa4PropertiesAndStreams(
        createTestContext({
          grantedScopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
        }),
        { fetchFn: emptyFetch },
      ),
    ).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
      missingScopes: [GA4_READONLY_SCOPE],
    });
  });

  it("normalizes 401/403/429 responses cleanly without leaking Google access tokens", async () => {
    const token = "ya29.super_secret_token_xyz_999";

    const expiredFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 401,
            message: `Invalid Credentials for Bearer ${token}`,
            status: "UNAUTHENTICATED",
          },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      );

    await expect(
      discoverGa4PropertiesAndStreams(createTestContext({ accessToken: token }), {
        fetchFn: expiredFetch,
      }),
    ).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.CREDENTIAL_EXPIRED,
    });

    const rateLimitedFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 429,
            message: "Quota exceeded for quota metric 'Admin API Requests'",
            status: "RESOURCE_EXHAUSTED",
          },
        }),
        {
          status: 429,
          headers: { "content-type": "application/json", "Retry-After": "1" },
        },
      );

    try {
      await executeGoogleReadRequest({
        providerKey: "ga4",
        url: "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
        method: "GET",
        accessToken: token,
        fetchFn: rateLimitedFetch,
        maxRetries: 0,
      });
      throw new Error("Expected rate limit error");
    } catch (err) {
      expect((err as { code?: string }).code).toBe(PROVIDER_ERROR_CODES.RATE_LIMITED);
      expect(JSON.stringify(err)).not.toContain(token);
    }
  });

  it("isolates and invalidates ScopedTelemetryCache entries strictly per organization, workspace, and connection", () => {
    const cache = new ScopedTelemetryCache(10);
    const keyBase = {
      organizationId: "org_a",
      workspaceId: "ws_a",
      projectId: "proj_a",
      connectionId: "conn_1",
      providerKey: "ga4",
      externalResourceId: "properties/123",
      operation: "discovery",
      params: { b: 2, a: 1 },
    };

    cache.set(keyBase, { count: 42 }, 60_000);

    // Identical params in different key order hit the same tenant slot
    expect(cache.get<{ count: number }>({ ...keyBase, params: { a: 1, b: 2 } })?.value.count).toBe(
      42,
    );

    // Different org, workspace, project, or connection NEVER hits the entry
    expect(cache.get({ ...keyBase, organizationId: "org_b" })).toBeNull();
    expect(cache.get({ ...keyBase, workspaceId: "ws_b" })).toBeNull();
    expect(cache.get({ ...keyBase, projectId: "proj_b" })).toBeNull();
    expect(cache.get({ ...keyBase, connectionId: "conn_2" })).toBeNull();

    const removed = cache.invalidateConnection("org_a", "ws_a", "conn_1");
    expect(removed).toBe(1);
    expect(cache.get(keyBase)).toBeNull();
  });

  it("renders GA4 Catalog entry with analytics.readonly guarantee and no client-side secrets", () => {
    const html = renderToStaticMarkup(
      createElement(ConnectionsConsole, {
        workspaceId: "ws_ui_test",
        workspaceName: "Signal Atlas QA",
        userRole: "OWNER",
        canManageConnections: true,
        catalog: PROVIDER_CATALOG,
        initialConnections: [
          {
            id: "conn_ga4_ui",
            workspaceId: "ws_ui_test",
            providerKey: "ga4",
            providerDisplayName: "Google Analytics 4",
            displayName: "GA4 Marketing Property",
            authMode: "oauth2",
            status: "HEALTHY",
            externalAccountId: "accounts/1001",
            externalAccountLabel: "Acme Holdings",
            requestedScopes: [GA4_READONLY_SCOPE],
            grantedScopes: [GA4_READONLY_SCOPE],
            missingScopes: [],
            encryptionKeyVersion: 1,
            lastVerifiedAtIso: new Date().toISOString(),
            lastSyncAtIso: null,
            disconnectedAtIso: null,
            createdAtIso: new Date().toISOString(),
            updatedAtIso: new Date().toISOString(),
            lastErrorCode: null,
            lastErrorSummary: null,
            credentialSummary: {
              keyId: "v1",
              encryptionVersion: 1,
              algorithm: "AES-256-GCM",
              status: "ACTIVE",
              refreshTokenPresent: true,
              tokenExpiresAtIso: null,
              rotatedAtIso: null,
              revokedAtIso: null,
            },
            connectedResources: [
              {
                id: "res_ga4_1",
                providerConnectionId: "conn_ga4_ui",
                workspaceId: "ws_ui_test",
                externalResourceId: "properties/402918402",
                resourceType: "ga4_property",
                displayName: "Avenor Marketing Web",
                metadata: {
                  timeZone: "America/New_York",
                  currencyCode: "USD",
                  dataStreams: [
                    {
                      streamId: "99104210",
                      displayName: "Production Web Stream",
                      type: "WEB_DATA_STREAM",
                      measurementId: "G-AVN402PROD",
                      defaultUri: "https://avenor.dev",
                    },
                  ],
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
            mappings: [],
            capabilities: [],
          },
        ],
        projects: [],
      }),
    );

    expect(html).toContain("GA4 Marketing Property");
    expect(html).toContain("https://www.googleapis.com/auth/analytics.readonly");
    expect(html).toContain('data-testid="connect-provider-ga4"');
  });
});

describe("Milestone 03 — GA4 Standard Reporting Adapter & Metric Dictionary (THE-123)", () => {
  it("resolves documented GA4 metric definitions, rejects unmapped metrics/dimensions, and distinguishes 0 from null", () => {
    expect(GA4_METRIC_DICTIONARY.sessions.apiName).toBe("sessions");
    expect(GA4_METRIC_DICTIONARY.activeUsers.aggregationRule).toBe(
      "non_additive_across_properties",
    );
    expect(GA4_METRIC_DICTIONARY.activeUsers.crossPropertySummable).toBe(false);
    expect(GA4_METRIC_DICTIONARY.engagementRate.unit).toBe("ratio");

    const convDef = resolveGa4MetricDefinition("keyEvents");
    expect(convDef.apiName).toBe("keyEvents");
    expect(() => resolveGa4MetricDefinition("unknown_metric_xyz")).toThrowError(
      /Unsupported GA4 standard metric/i,
    );

    expect(parseGa4MetricNumber("0")).toBe(0);
    expect(parseGa4MetricNumber("128.45")).toBe(128.45);
    expect(parseGa4MetricNumber("")).toBeNull();
    expect(parseGa4MetricNumber(null)).toBeNull();
    expect(parseGa4MetricNumber("not-a-number")).toBeNull();

    // Valid standard report input passes cleanly
    expect(() =>
      validateGa4StandardQueryInputs({
        startDate: "2026-10-01",
        endDate: "2026-10-07",
        metrics: ["sessions", "activeUsers", "engagedSessions", "engagementRate"],
        dimensions: ["date", "sessionDefaultChannelGroup"],
      }),
    ).not.toThrow();

    // Realtime-only dimensions must NEVER leak into standard reports
    expect(() =>
      validateGa4StandardQueryInputs({
        startDate: "2026-10-01",
        endDate: "2026-10-07",
        metrics: ["sessions"],
        dimensions: ["minutesAgo"],
      }),
    ).toThrowError(/dimension/i);

    // Inverted date ranges must fail fast
    expect(() =>
      validateGa4StandardQueryInputs({
        startDate: "2026-10-10",
        endDate: "2026-10-01",
        metrics: ["sessions"],
      }),
    ).toThrowError(/date/i);
  });

  it("queries GA4 Data API batchRunReports with TOTAL aggregation for non-additive users, preserves property timezone, extracts sampling/thresholding/other flags, and caches per tenant", async () => {
    const capturedRequests: Array<{ url: string; method: string; body: unknown }> = [];
    let batchCallCount = 0;

    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      capturedRequests.push({ url, method, body });

      if (url.endsWith("/properties/402918401:checkCompatibility")) {
        return new Response(
          JSON.stringify({
            dimensionCompatibilities: [
              { dimensionMetadata: { apiName: "date" }, compatibility: "COMPATIBLE" },
            ],
            metricCompatibilities: [
              { metricMetadata: { apiName: "sessions" }, compatibility: "COMPATIBLE" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url.includes("/properties/402918401/keyEvents")) {
        return new Response(
          JSON.stringify({
            keyEvents: [
              {
                name: "properties/402918401/keyEvents/signup_complete",
                eventName: "signup_complete",
                countingMethod: "ONCE_PER_SESSION",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url.endsWith("/properties/402918401:batchRunReports")) {
        batchCallCount += 1;
        const payload = body as { requests: Array<{ dimensions?: Array<{ name: string }> }> };
        const firstDim = payload.requests[0]?.dimensions?.[0]?.name ?? "";

        // Batch 1 (starts with "date") vs Batch 2 (starts with "deviceCategory")
        if (firstDim === "date") {
          return new Response(
            JSON.stringify({
              reports: [
                // Report 0: date trend (coreMetrics order)
                {
                  dimensionHeaders: [{ name: "date" }],
                  metricHeaders: [
                    { name: "activeUsers", type: "TYPE_INTEGER" },
                    { name: "totalUsers", type: "TYPE_INTEGER" },
                    { name: "newUsers", type: "TYPE_INTEGER" },
                    { name: "sessions", type: "TYPE_INTEGER" },
                    { name: "engagedSessions", type: "TYPE_INTEGER" },
                    { name: "engagementRate", type: "TYPE_FLOAT" },
                    { name: "screenPageViews", type: "TYPE_INTEGER" },
                    { name: "eventCount", type: "TYPE_INTEGER" },
                    { name: "averageSessionDuration", type: "TYPE_SECONDS" },
                    { name: "keyEvents", type: "TYPE_INTEGER" },
                  ],
                  rows: [
                    {
                      dimensionValues: [{ value: "20261001" }],
                      metricValues: [
                        { value: "90" },
                        { value: "95" },
                        { value: "40" },
                        { value: "100" },
                        { value: "70" },
                        { value: "0.7" },
                        { value: "260" },
                        { value: "710" },
                        { value: "120.5" },
                        { value: "5" },
                      ],
                    },
                    {
                      dimensionValues: [{ value: "20261002" }],
                      metricValues: [
                        { value: "130" },
                        { value: "140" },
                        { value: "55" },
                        { value: "150" },
                        { value: "105" },
                        { value: "0.7" },
                        { value: "390" },
                        { value: "980" },
                        { value: "140.0" },
                        { value: "0" },
                      ],
                    },
                  ],
                  totals: [
                    {
                      dimensionValues: [{ value: "RESERVED_TOTAL" }],
                      metricValues: [
                        // Distinct 2-day activeUsers is 185, NOT 90 + 130 = 220!
                        { value: "185" },
                        { value: "195" },
                        { value: "95" },
                        { value: "250" },
                        { value: "175" },
                        { value: "0.7" },
                        { value: "650" },
                        { value: "1690" },
                        { value: "132.2" },
                        { value: "5" },
                      ],
                    },
                  ],
                  rowCount: 2,
                  metadata: {
                    timeZone: "Europe/Berlin",
                    currencyCode: "EUR",
                    subjectToThresholding: true,
                    dataLossFromOtherRow: true,
                    samplingMetadatas: [
                      { samplesReadCount: "500000", samplingSpaceSize: "1200000" },
                    ],
                  },
                },
                // Report 1: sessionDefaultChannelGroup
                {
                  dimensionHeaders: [{ name: "sessionDefaultChannelGroup" }],
                  metricHeaders: [
                    { name: "activeUsers" },
                    { name: "sessions" },
                    { name: "engagedSessions" },
                    { name: "engagementRate" },
                    { name: "screenPageViews" },
                    { name: "eventCount" },
                    { name: "keyEvents" },
                  ],
                  rows: [
                    {
                      dimensionValues: [{ value: "Organic Search" }],
                      metricValues: [
                        { value: "145" },
                        { value: "180" },
                        { value: "135" },
                        { value: "0.75" },
                        { value: "420" },
                        { value: "1100" },
                        { value: "4" },
                      ],
                    },
                  ],
                  metadata: { timeZone: "Europe/Berlin", currencyCode: "EUR" },
                },
                // Report 2: sessionSourceMedium
                {
                  dimensionHeaders: [{ name: "sessionSourceMedium" }],
                  metricHeaders: [
                    { name: "activeUsers" },
                    { name: "sessions" },
                    { name: "engagedSessions" },
                    { name: "engagementRate" },
                    { name: "screenPageViews" },
                    { name: "eventCount" },
                    { name: "keyEvents" },
                  ],
                  rows: [
                    {
                      dimensionValues: [{ value: "google / organic" }],
                      metricValues: [
                        { value: "140" },
                        { value: "170" },
                        { value: "130" },
                        { value: "0.76" },
                        { value: "400" },
                        { value: "1020" },
                        { value: "4" },
                      ],
                    },
                  ],
                  metadata: { timeZone: "Europe/Berlin", currencyCode: "EUR" },
                },
                // Report 3: landingPage + pageTitle
                {
                  dimensionHeaders: [{ name: "landingPage" }, { name: "pageTitle" }],
                  metricHeaders: [
                    { name: "activeUsers" },
                    { name: "sessions" },
                    { name: "engagedSessions" },
                    { name: "engagementRate" },
                    { name: "screenPageViews" },
                    { name: "eventCount" },
                    { name: "keyEvents" },
                  ],
                  rows: [
                    {
                      dimensionValues: [{ value: "/pricing" }, { value: "Pricing — Avenor" }],
                      metricValues: [
                        { value: "75" },
                        { value: "90" },
                        { value: "72" },
                        { value: "0.8" },
                        { value: "210" },
                        { value: "610" },
                        { value: "3" },
                      ],
                    },
                  ],
                  metadata: { timeZone: "Europe/Berlin", currencyCode: "EUR" },
                },
                // Report 4: pagePath + pageTitle
                {
                  dimensionHeaders: [{ name: "pagePath" }, { name: "pageTitle" }],
                  metricHeaders: [
                    { name: "activeUsers" },
                    { name: "sessions" },
                    { name: "engagedSessions" },
                    { name: "engagementRate" },
                    { name: "screenPageViews" },
                    { name: "eventCount" },
                    { name: "keyEvents" },
                  ],
                  rows: [
                    {
                      dimensionValues: [{ value: "/pricing" }, { value: "Pricing — Avenor" }],
                      metricValues: [
                        { value: "75" },
                        { value: "90" },
                        { value: "72" },
                        { value: "0.8" },
                        { value: "210" },
                        { value: "610" },
                        { value: "3" },
                      ],
                    },
                  ],
                  metadata: { timeZone: "Europe/Berlin", currencyCode: "EUR" },
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json", "x-goog-quota-remaining": "1950" },
            },
          );
        }

        // Batch 2 (deviceCategory, country, city, eventName)
        return new Response(
          JSON.stringify({
            reports: [
              {
                dimensionHeaders: [{ name: "deviceCategory" }],
                metricHeaders: [
                  { name: "activeUsers" },
                  { name: "sessions" },
                  { name: "engagedSessions" },
                  { name: "engagementRate" },
                  { name: "screenPageViews" },
                  { name: "eventCount" },
                  { name: "keyEvents" },
                ],
                rows: [
                  {
                    dimensionValues: [{ value: "desktop" }],
                    metricValues: [
                      { value: "130" },
                      { value: "170" },
                      { value: "129" },
                      { value: "0.76" },
                      { value: "440" },
                      { value: "1120" },
                      { value: "4" },
                    ],
                  },
                ],
                metadata: { timeZone: "Europe/Berlin", currencyCode: "EUR" },
              },
              {
                dimensionHeaders: [{ name: "country" }],
                metricHeaders: [
                  { name: "activeUsers" },
                  { name: "sessions" },
                  { name: "engagedSessions" },
                  { name: "engagementRate" },
                  { name: "screenPageViews" },
                  { name: "eventCount" },
                  { name: "keyEvents" },
                ],
                rows: [
                  {
                    dimensionValues: [{ value: "Germany" }],
                    metricValues: [
                      { value: "110" },
                      { value: "145" },
                      { value: "110" },
                      { value: "0.76" },
                      { value: "380" },
                      { value: "950" },
                      { value: "4" },
                    ],
                  },
                ],
                metadata: { timeZone: "Europe/Berlin", currencyCode: "EUR" },
              },
              {
                dimensionHeaders: [{ name: "city" }],
                metricHeaders: [
                  { name: "activeUsers" },
                  { name: "sessions" },
                  { name: "engagedSessions" },
                  { name: "engagementRate" },
                  { name: "screenPageViews" },
                  { name: "eventCount" },
                  { name: "keyEvents" },
                ],
                rows: [
                  {
                    dimensionValues: [{ value: "Berlin" }],
                    metricValues: [
                      { value: "62" },
                      { value: "80" },
                      { value: "62" },
                      { value: "0.78" },
                      { value: "210" },
                      { value: "510" },
                      { value: "2" },
                    ],
                  },
                ],
                metadata: { timeZone: "Europe/Berlin", currencyCode: "EUR" },
              },
              {
                dimensionHeaders: [{ name: "eventName" }],
                metricHeaders: [
                  { name: "eventCount" },
                  { name: "activeUsers" },
                  { name: "keyEvents" },
                ],
                rows: [
                  {
                    dimensionValues: [{ value: "page_view" }],
                    metricValues: [{ value: "650" }, { value: "185" }, { value: "0" }],
                  },
                ],
                metadata: { timeZone: "Europe/Berlin", currencyCode: "EUR" },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      throw new Error(`Unexpected GA4 URL in test: ${method} ${url}`);
    };

    const ctx = createTestContext({ workspaceId: "ws_ga4_123_cache_test" });
    const compat = await checkGa4DimensionMetricCompatibility({
      context: ctx,
      propertyName: "properties/402918401",
      metrics: ["sessions"],
      dimensions: ["date"],
      fetchFn: mockFetch,
    });
    expect(compat.compatible).toBe(true);
    expect(compat.incompatibleDimensions).toHaveLength(0);

    const bundle = await readGa4StandardReportBundle(
      ctx,
      {
        propertyId: "402918401",
        startDate: "2026-10-01",
        endDate: "2026-10-02",
      },
      { fetchFn: mockFetch, bypassCache: true },
    );

    expect(bundle.reportingTimeZone).toBe("Europe/Berlin");
    expect(bundle.currencyCode).toBe("EUR");
    expect(bundle.totals.sessions).toBe(250);
    // Crucial correctness check: uses reserved TOTAL row (185), never 90 + 130 = 220!
    expect(bundle.totals.activeUsers).toBe(185);
    expect(bundle.totals.totalUsers).toBe(195);
    expect(bundle.dailySeries[1]?.keyEvents).toBe(0);
    expect(bundle.dataQuality.isSampled).toBe(true);
    expect(bundle.dataQuality.isThresholded).toBe(true);
    expect(bundle.dataQuality.hasOtherRowTruncation).toBe(true);
    expect(bundle.channels[0]?.dimensionValue).toBe("Organic Search");
    expect(bundle.landingPages[0]?.dimensionValue).toBe("/pricing");
    expect(bundle.devices[0]?.dimensionValue).toBe("desktop");
    expect(bundle.countries[0]?.dimensionValue).toBe("Germany");

    // Verify outgoing batchRunReports used POST and requested metricAggregations: ["TOTAL"]
    const batchReq = capturedRequests.find((r) => r.url.endsWith(":batchRunReports"));
    expect(batchReq?.method).toBe("POST");
    const batchPayload = batchReq?.body as {
      requests: Array<{ metricAggregations?: string[] }>;
    };
    expect(batchPayload.requests[0]?.metricAggregations).toContain("TOTAL");

    // Populate cache without bypassCache and verify hit on second call
    expect(batchCallCount).toBe(2);
    await readGa4StandardReportBundle(
      ctx,
      {
        propertyId: "402918401",
        startDate: "2026-10-01",
        endDate: "2026-10-02",
      },
      { fetchFn: mockFetch },
    );
    expect(batchCallCount).toBe(4);

    const cachedBundle = await readGa4StandardReportBundle(
      ctx,
      {
        propertyId: "402918401",
        startDate: "2026-10-01",
        endDate: "2026-10-02",
      },
      { fetchFn: mockFetch },
    );
    expect(cachedBundle.cacheStatus).toBe("hit");
    expect(cachedBundle.totals.activeUsers).toBe(185);
    expect(batchCallCount).toBe(4);

    // Different tenant must NOT hit cached bundle from org_test_1
    const otherTenantBundle = await readGa4StandardReportBundle(
      createTestContext({ organizationId: "org_other", workspaceId: "ws_other" }),
      {
        propertyId: "402918401",
        startDate: "2026-10-01",
        endDate: "2026-10-02",
      },
      { fetchFn: mockFetch },
    );
    expect(otherTenantBundle.cacheStatus).toBe("miss");
    expect(otherTenantBundle.totals.activeUsers).toBe(185);
    expect(batchCallCount).toBe(6);
  });

  it("maps readMetrics for sandbox and insufficient-scope contexts without fabricating zero fallbacks", async () => {
    const ga4Catalog = getProviderCatalogEntry("ga4");
    if (!ga4Catalog) {
      throw new Error("Expected GA4 catalog entry");
    }
    const adapter = createGa4ReadOnlyAdapter(ga4Catalog);

    const sandboxRead = await adapter.readMetrics(
      createTestContext({ accessToken: "sbx_ga4_demo_token" }),
      {
        capabilityKey: "analytics_sessions",
        externalResourceId: "properties/402918401",
        metricKey: "sessions",
        startDateIso: "2026-10-01T00:00:00.000Z",
        endDateIso: "2026-10-05T23:59:59.999Z",
        granularity: "daily",
      },
    );
    expect(sandboxRead.capabilityStatus).toBe("SUPPORTED");
    expect(sandboxRead.points).toHaveLength(5);
    expect(sandboxRead.points[0]?.value).toBeGreaterThan(0);

    // Missing required scope yields capability MISSING_PERMISSION with null values (never 0)
    const deniedRead = await adapter.readMetrics(
      createTestContext({ grantedScopes: ["https://www.googleapis.com/auth/webmasters.readonly"] }),
      {
        capabilityKey: "analytics_sessions",
        externalResourceId: "properties/402918401",
        metricKey: "sessions",
        startDateIso: "2026-10-01T00:00:00.000Z",
        endDateIso: "2026-10-02T23:59:59.999Z",
        granularity: "daily",
      },
    );
    expect(deniedRead.capabilityStatus).toBe("MISSING_PERMISSION");
    expect(deniedRead.points).toHaveLength(1);
    expect(deniedRead.points[0]?.value).toBeNull();
  });
});
