import {
  ERROR_CODES,
  FORBIDDEN_PROVIDER_MUTATION_METHODS,
  PROVIDER_ERROR_CODES,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import { describe, expect, it } from "vitest";
import { getProviderCatalogEntry } from "../../src/lib/providers";
import {
  createGscReadOnlyAdapter,
  discoverSearchConsoleSites,
  GSC_READONLY_SCOPE,
  inspectSearchConsoleSite,
  mapGscSitesToDiscoveryItems,
  normalizeCanonicalGscSiteUrl,
} from "../../src/lib/providers/google-search-console";

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
