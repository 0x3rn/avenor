import { assertReadOnlyAdapterContract, PROVIDER_ERROR_CODES } from "@avenor/types";
import { describe, expect, it, vi } from "vitest";
import {
  assertAllowlistedSupabaseGetRequest,
  createSupabaseReadOnlyAdapter,
  getProviderCatalogEntry,
  SUPABASE_CANONICAL_METRIC_KEYS,
  sanitizeSupabaseResponseObject,
} from "@/lib/providers";

describe("THE-140: Supabase read-only backend connector", () => {
  const supabaseCatalog = getProviderCatalogEntry("supabase");
  if (!supabaseCatalog) {
    throw new Error("Expected supabase provider catalog entry");
  }

  it("satisfies Avenor's strict read-only adapter contract and blocks non-GET verbs or prohibited endpoints (/database/query, /api-keys, /auth/users)", () => {
    const adapter = createSupabaseReadOnlyAdapter(supabaseCatalog);
    expect(() => assertReadOnlyAdapterContract(adapter)).not.toThrow();

    expect(() =>
      assertAllowlistedSupabaseGetRequest("GET", "https://api.supabase.com/v1/projects"),
    ).not.toThrow();
    expect(() =>
      assertAllowlistedSupabaseGetRequest(
        "GET",
        "https://api.supabase.com/v1/projects/sbref_1/health",
      ),
    ).not.toThrow();

    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect(() =>
        assertAllowlistedSupabaseGetRequest(method, "https://api.supabase.com/v1/projects"),
      ).toThrow(/Only GET requests are permitted/i);
    }

    expect(() =>
      assertAllowlistedSupabaseGetRequest(
        "GET",
        "https://api.supabase.com/v1/projects/sbref_1/database/query",
      ),
    ).toThrow(/blocked prohibited endpoint/i);

    expect(() =>
      assertAllowlistedSupabaseGetRequest(
        "GET",
        "https://api.supabase.com/v1/projects/sbref_1/api-keys",
      ),
    ).toThrow(/blocked prohibited endpoint/i);

    expect(() =>
      assertAllowlistedSupabaseGetRequest(
        "GET",
        "https://api.supabase.com/v1/projects/sbref_1/auth/users",
      ),
    ).toThrow(/blocked prohibited endpoint/i);
  });

  it("unconditionally rejects Supabase service_role JWTs, sb_secret_* keys, and direct Postgres connection strings", async () => {
    const adapter = createSupabaseReadOnlyAdapter(supabaseCatalog);

    const serviceRolePayload = Buffer.from(
      JSON.stringify({ role: "service_role", iss: "supabase" }),
    ).toString("base64url");
    const fakeServiceRoleJwt = `eyJhbGciOiJIUzI1NiJ9.${serviceRolePayload}.sig`;

    await expect(
      adapter.validateCredentials({
        organizationId: "org_1",
        workspaceId: "ws_1",
        apiToken: fakeServiceRoleJwt,
        grantedScopes: ["projects:read", "analytics:read"],
      }),
    ).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
    });

    await expect(
      adapter.validateCredentials({
        organizationId: "org_1",
        workspaceId: "ws_1",
        apiToken: "sb_secret_prod_99999",
        grantedScopes: ["projects:read", "analytics:read"],
      }),
    ).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
    });

    await expect(
      adapter.validateCredentials({
        organizationId: "org_1",
        workspaceId: "ws_1",
        apiToken: "postgres://postgres:secret@db.sbref.supabase.co:5432/postgres",
        grantedScopes: ["projects:read", "analytics:read"],
      }),
    ).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
    });
  });

  it("strips any accidental user PII or secret keys from upstream responses and qualifies RLS posture as NOT_VERIFIED without SQL table inspection", async () => {
    const raw = {
      ssl_enforced: true,
      smtp_pass: "super_secret_smtp",
      jwt_secret: "super_secret_jwt",
      nested: {
        email: "customer@example.com",
        phone: "+15550000000",
        user_metadata: { fullName: "Alice" },
        safeCount: 42,
      },
    };
    const sanitized = sanitizeSupabaseResponseObject(raw);
    expect(sanitized).toEqual({
      ssl_enforced: true,
      nested: {
        safeCount: 42,
      },
    });

    const adapter = createSupabaseReadOnlyAdapter(supabaseCatalog);
    const resources = await adapter.discoverResources({
      organizationId: "org_1",
      workspaceId: "ws_1",
      apiToken: "sbp_oauth_valid_readonly",
      grantedScopes: ["projects:read", "analytics:read"],
    });

    expect(resources).toHaveLength(1);
    expect(resources[0]?.externalResourceId).toBe("sbref-core-prod-01");
    expect(resources[0]?.metadata.rlsVerificationStatus).toBe("NOT_VERIFIED");
    expect(resources[0]?.metadata.serviceRoleRejectedByDefault).toBe(true);
  });

  it("strictly separates supabase.auth_requests (GoTrue HTTP traffic) from supabase.registered_auth_users (aggregate counter) and refuses raw auth.users payloads", async () => {
    const adapter = createSupabaseReadOnlyAdapter(supabaseCatalog);
    const context = {
      organizationId: "org_1",
      workspaceId: "ws_1",
      apiToken: "sbp_oauth_valid_readonly",
      grantedScopes: ["projects:read", "analytics:read"],
    };

    const authRequestsRes = await adapter.readMetrics(context, {
      externalResourceId: "sbref-core-prod-01",
      capabilityKey: "postgres_metadata",
      metricKey: SUPABASE_CANONICAL_METRIC_KEYS.AUTH_REQUESTS,
      granularity: "daily",
      startDateIso: "2026-11-20T00:00:00.000Z",
      endDateIso: "2026-11-21T00:00:00.000Z",
    });

    const registeredUsersRes = await adapter.readMetrics(context, {
      externalResourceId: "sbref-core-prod-01",
      capabilityKey: "user_count_posture",
      metricKey: SUPABASE_CANONICAL_METRIC_KEYS.REGISTERED_AUTH_USERS,
      granularity: "daily",
      startDateIso: "2026-11-20T00:00:00.000Z",
      endDateIso: "2026-11-21T00:00:00.000Z",
    });

    expect(authRequestsRes.capabilityStatus).toBe("SUPPORTED");
    expect(authRequestsRes.points[1]?.value).toBe(21_310);
    expect(authRequestsRes.statusExplanation).toContain("not registered user headcount");

    expect(registeredUsersRes.capabilityStatus).toBe("SUPPORTED");
    expect(registeredUsersRes.points[1]?.value).toBe(4_865);
    expect(registeredUsersRes.points[1]?.value).not.toBe(authRequestsRes.points[1]?.value);

    // When upstream does not expose aggregate_registered_auth_users_count (or returns a raw users array),
    // registered_auth_users returns UNSUPPORTED_BY_PROVIDER with value: null (never 0 and never auth_requests!)
    const mockFetchWithoutAggregateCounter = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/projects")) {
        return new Response(
          JSON.stringify([
            {
              ref: "sbref-core-prod-01",
              name: "Core Web App — Supabase Production",
              organization_id: "sb-org",
              region: "us-east-1",
              status: "ACTIVE_HEALTHY",
            },
          ]),
          { status: 200 },
        );
      }
      if (url.endsWith("/usage")) {
        return new Response(
          JSON.stringify({
            db_size_bytes: 500_000_000,
            storage_size_bytes: 1_000_000_000,
            active_connections: 12,
            // No aggregate_registered_auth_users_count exposed
          }),
          { status: 200 },
        );
      }
      if (url.includes("/usage.api-counts")) {
        return new Response(
          JSON.stringify({
            result: [
              {
                timestamp: "2026-11-21T00:00:00.000Z",
                total_rest_requests: 50_000,
                total_auth_requests: 9_800,
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    const liveAdapter = createSupabaseReadOnlyAdapter(supabaseCatalog, {
      fetchFn: mockFetchWithoutAggregateCounter,
    });
    const unavailableUsersRes = await liveAdapter.readMetrics(context, {
      externalResourceId: "sbref-core-prod-01",
      capabilityKey: "user_count_posture",
      metricKey: SUPABASE_CANONICAL_METRIC_KEYS.REGISTERED_AUTH_USERS,
      granularity: "daily",
      startDateIso: "2026-11-20T00:00:00.000Z",
      endDateIso: "2026-11-21T00:00:00.000Z",
    });

    expect(unavailableUsersRes.capabilityStatus).toBe("UNSUPPORTED_BY_PROVIDER");
    expect(unavailableUsersRes.points[0]?.value).toBeNull();
    expect(unavailableUsersRes.points[0]?.value).not.toBe(0);
    expect(unavailableUsersRes.points[0]?.value).not.toBe(9_800);
  });
});
