import { PROVIDER_ERROR_CODES } from "@avenor/types";
import { describe, expect, it } from "vitest";
import {
  assertAllowedGoogleReadEndpoint,
  createGcpBillingReadOnlyAdapter,
  discoverGcpBillingAccountsAndProjects,
  GCP_BIGQUERY_READONLY_SCOPE,
  GCP_BILLING_METADATA_SCOPE,
  getGcpBillingAccount,
  getGcpProjectBillingInfo,
  getProviderCatalogEntry,
  mapGcpBillingDiscoveryToExternalResources,
} from "@/lib/providers";

function createMockFetch(
  handlers: Record<string, { status: number; body: unknown }>,
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const urlStr = typeof input === "string" ? input : input.toString();
    const matchedKey = Object.keys(handlers).find((k) => urlStr.includes(k));
    const entry = matchedKey ? handlers[matchedKey] : { status: 404, body: { error: { message: "Not found" } } };
    return new Response(JSON.stringify(entry?.body ?? {}), {
      status: entry?.status ?? 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("THE-133: Google Cloud Billing Account & Linked Project Read-Only Discovery", () => {
  it("discovers multiple billing accounts and linked GCP projects across paginated responses", async () => {
    const mockFetch = (async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname.endsWith("/billingAccounts")) {
        const pageToken = url.searchParams.get("pageToken");
        if (!pageToken) {
          return new Response(
            JSON.stringify({
              billingAccounts: [
                {
                  name: "billingAccounts/01A2B3-45C6D7-89E0F1",
                  displayName: "Primary USD Billing",
                  open: true,
                  currencyCode: "USD",
                },
              ],
              nextPageToken: "acct_page_2",
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            billingAccounts: [
              {
                name: "billingAccounts/02F9E8-76D5C4-32B1A0",
                displayName: "EU Subsidiary Billing",
                open: true,
                currencyCode: "EUR",
              },
            ],
          }),
          { status: 200 },
        );
      }

      if (url.pathname.includes("/01A2B3-45C6D7-89E0F1/projects")) {
        const pageToken = url.searchParams.get("pageToken");
        if (!pageToken) {
          return new Response(
            JSON.stringify({
              projectBillingInfo: [
                {
                  name: "projects/avenor-core-prod/billingInfo",
                  projectId: "avenor-core-prod",
                  billingAccountName: "billingAccounts/01A2B3-45C6D7-89E0F1",
                  billingEnabled: true,
                },
              ],
              nextPageToken: "proj_page_2",
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            projectBillingInfo: [
              {
                name: "projects/avenor-core-staging/billingInfo",
                projectId: "avenor-core-staging",
                billingAccountName: "billingAccounts/01A2B3-45C6D7-89E0F1",
                billingEnabled: true,
              },
            ],
          }),
          { status: 200 },
        );
      }

      if (url.pathname.includes("/02F9E8-76D5C4-32B1A0/projects")) {
        return new Response(
          JSON.stringify({
            projectBillingInfo: [
              {
                name: "projects/avenor-eu-api/billingInfo",
                projectId: "avenor-eu-api",
                billingAccountName: "billingAccounts/02F9E8-76D5C4-32B1A0",
                billingEnabled: true,
              },
            ],
          }),
          { status: 200 },
        );
      }

      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    const discovery = await discoverGcpBillingAccountsAndProjects(
      {
        organizationId: "org_1",
        workspaceId: "wks_1",
        accessToken: "ya29.live_test_token",
        grantedScopes: [GCP_BILLING_METADATA_SCOPE],
      },
      { fetchFn: mockFetch, pageSize: 1, maxPages: 5 },
    );

    expect(discovery.accounts).toHaveLength(2);
    expect(discovery.accountsPageCount).toBe(2);
    expect(discovery.linkedProjects).toHaveLength(3);
    expect(discovery.projectsPageCount).toBe(3);
    expect(discovery.hasHistoricalCostAccess).toBe(false);
    expect(discovery.metadataOnlyNotice).toContain("BigQuery Cloud Billing export");

    const mapped = mapGcpBillingDiscoveryToExternalResources(discovery, [
      GCP_BILLING_METADATA_SCOPE,
    ]);
    // 2 billing accounts + 3 linked projects = 5 resources
    expect(mapped).toHaveLength(5);

    const euProj = mapped.find((r) => r.externalResourceId === "gcp-project:avenor-eu-api");
    expect(euProj?.metadata.gcpProjectId).toBe("avenor-eu-api");
    expect(euProj?.metadata.billingAccountId).toBe("02F9E8-76D5C4-32B1A0");
    expect(euProj?.metadata.currencyCode).toBe("EUR");
    expect(euProj?.metadata.hasHistoricalCostAccess).toBe(false);
    expect(typeof euProj?.metadata.associationHistoryJson).toBe("string");
  });

  it("distinguishes empty billing account list from missing OAuth scope, missing IAM permission, and never fabricates 0 spend", async () => {
    // 1. GA4 scope alone is rejected for Cloud Billing discovery
    await expect(
      discoverGcpBillingAccountsAndProjects({
        organizationId: "org_1",
        workspaceId: "wks_1",
        accessToken: "ya29.ga4_only",
        grantedScopes: ["https://www.googleapis.com/auth/analytics.readonly"],
      }),
    ).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
    });

    // 2. Empty billing account list returns emptyReason = NO_BILLING_ACCOUNTS
    const emptyFetch = createMockFetch({
      "/billingAccounts": { status: 200, body: { billingAccounts: [] } },
    });
    const emptyDiscovery = await discoverGcpBillingAccountsAndProjects(
      {
        organizationId: "org_1",
        workspaceId: "wks_1",
        accessToken: "ya29.no_accounts",
        grantedScopes: [GCP_BILLING_METADATA_SCOPE],
      },
      { fetchFn: emptyFetch },
    );
    expect(emptyDiscovery.emptyReason).toBe("NO_BILLING_ACCOUNTS");
    expect(emptyDiscovery.hasHistoricalCostAccess).toBe(false);

    // 3. Adapter readMetrics returns null (never 0) when only metadata discovery is configured
    const catalogEntry = getProviderCatalogEntry("gcp-billing");
    expect(catalogEntry).toBeDefined();
    if (!catalogEntry) throw new Error("Missing gcp-billing catalog entry");

    const adapter = createGcpBillingReadOnlyAdapter(catalogEntry);
    const readRes = await adapter.readMetrics(
      {
        organizationId: "org_1",
        workspaceId: "wks_1",
        accessToken: "sbx_token",
        grantedScopes: [GCP_BILLING_METADATA_SCOPE, GCP_BIGQUERY_READONLY_SCOPE],
      },
      {
        externalResourceId: "gcp-project:avenor-cloud-prod",
        capabilityKey: "billing_cost_export",
        metricKey: "net_cost",
        granularity: "daily",
        startDateIso: "2026-11-01T00:00:00.000Z",
        endDateIso: "2026-11-15T00:00:00.000Z",
      },
    );
    expect(readRes.points[0]?.value).toBeNull();
    expect(readRes.points[0]?.value).not.toBe(0);
  });

  it("supports single billing account lookup, project billingInfo lookup, and blocks POST mutations on Cloud Billing API", async () => {
    const mockFetch = createMockFetch({
      "/billingAccounts/01A2B3-45C6D7-89E0F1": {
        status: 200,
        body: {
          name: "billingAccounts/01A2B3-45C6D7-89E0F1",
          displayName: "Core Billing",
          open: true,
          currencyCode: "USD",
        },
      },
      "/projects/avenor-api-prod/billingInfo": {
        status: 200,
        body: {
          name: "projects/avenor-api-prod/billingInfo",
          projectId: "avenor-api-prod",
          billingAccountName: "billingAccounts/01A2B3-45C6D7-89E0F1",
          billingEnabled: true,
        },
      },
    });

    const acct = await getGcpBillingAccount({
      accessToken: "ya29.tok",
      billingAccountId: "01A2B3-45C6D7-89E0F1",
      fetchFn: mockFetch,
    });
    expect(acct.billingAccountId).toBe("01A2B3-45C6D7-89E0F1");
    expect(acct.currencyCode).toBe("USD");

    const info = await getGcpProjectBillingInfo({
      accessToken: "ya29.tok",
      gcpProjectId: "avenor-api-prod",
      fetchFn: mockFetch,
    });
    expect(info.gcpProjectId).toBe("avenor-api-prod");
    expect(info.billingAccountId).toBe("01A2B3-45C6D7-89E0F1");
    expect(info.billingEnabled).toBe(true);

    // Cloud Billing POST must be blocked by compile/runtime allowlist
    expect(() =>
      assertAllowedGoogleReadEndpoint(
        "https://cloudbilling.googleapis.com/v1/billingAccounts",
        "POST",
      ),
    ).toThrow(/strictly GET-only/i);
  });
});
