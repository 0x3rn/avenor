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
  createGa4ReadOnlyAdapter,
  discoverGa4PropertiesAndStreams,
  GA4_READONLY_SCOPE,
  normalizeGa4PropertyResourceName,
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
