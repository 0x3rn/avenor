import { assertReadOnlyAdapterContract, PROVIDER_ERROR_CODES } from "@avenor/types";
import { describe, expect, it, vi } from "vitest";
import {
  assertAllowlistedNeonGetRequest,
  classifyNeonBranchEnvironment,
  convertNeonByteSecondsToBytesMonth,
  createNeonReadOnlyAdapter,
  getProviderCatalogEntry,
  NEON_CANONICAL_METRIC_KEYS,
} from "@/lib/providers";

describe("THE-139: Neon read-only project/branch/database/compute metrics connector", () => {
  const neonCatalog = getProviderCatalogEntry("neon");
  if (!neonCatalog) {
    throw new Error("Expected neon provider catalog entry");
  }

  it("satisfies Avenor's strict read-only adapter contract and blocks non-GET verbs or sensitive endpoints", () => {
    const adapter = createNeonReadOnlyAdapter(neonCatalog);
    expect(() => assertReadOnlyAdapterContract(adapter)).not.toThrow();

    // Valid GET endpoints pass
    expect(() =>
      assertAllowlistedNeonGetRequest("GET", "https://console.neon.tech/api/v2/projects"),
    ).not.toThrow();
    expect(() =>
      assertAllowlistedNeonGetRequest(
        "GET",
        "https://console.neon.tech/api/v2/consumption_history/projects?from=2026-11-01T00:00:00Z",
      ),
    ).not.toThrow();

    // Non-GET HTTP verbs are rejected
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect(() =>
        assertAllowlistedNeonGetRequest(method, "https://console.neon.tech/api/v2/projects"),
      ).toThrow(/Only GET requests are permitted/i);
    }

    // Prohibited sensitive paths (/connection_uri, /reveal_password, /roles) are rejected even on GET
    expect(() =>
      assertAllowlistedNeonGetRequest(
        "GET",
        "https://console.neon.tech/api/v2/projects/proj_1/connection_uri",
      ),
    ).toThrow(/blocked prohibited sensitive path/i);
    expect(() =>
      assertAllowlistedNeonGetRequest(
        "GET",
        "https://console.neon.tech/api/v2/projects/proj_1/branches/br_1/roles/neondb_owner/reveal_password",
      ),
    ).toThrow(/blocked prohibited sensitive path/i);
  });

  it("rejects direct PostgreSQL connection strings (postgres:// or postgresql://) during credential validation", async () => {
    const adapter = createNeonReadOnlyAdapter(neonCatalog);

    await expect(
      adapter.validateCredentials({
        organizationId: "org_1",
        workspaceId: "ws_1",
        apiToken: "postgresql://neondb_owner:secret@ep-main.us-east-2.aws.neon.tech/neondb",
        grantedScopes: ["neon.projects.readonly", "neon.consumption.readonly"],
      }),
    ).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
    });
  });

  it("discovers Neon projects, classifies branch environments (PRODUCTION/STAGING/DEVELOPMENT), and extracts metadata via mocked Neon API v2", async () => {
    expect(classifyNeonBranchEnvironment({ name: "main", isPrimary: true })).toBe("PRODUCTION");
    expect(classifyNeonBranchEnvironment({ name: "staging-preview" })).toBe("STAGING");
    expect(classifyNeonBranchEnvironment({ name: "feat/add-indexes" })).toBe("DEVELOPMENT");

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v2/projects?")) {
        return new Response(
          JSON.stringify({
            projects: [
              {
                id: "neon-proj-live-1",
                name: "Avenor Live Postgres",
                region_id: "aws-eu-central-1",
                pg_version: 17,
                org_id: "org-corstack",
                synthetic_storage_size: 2_147_483_648,
                history_retention_seconds: 604800,
                settings: {
                  allowed_ips: {
                    ips: ["10.0.0.1/32"],
                    protected_branches_only: true,
                  },
                },
              },
            ],
            pagination: { cursor: null },
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/projects/neon-proj-live-1/branches")) {
        return new Response(
          JSON.stringify({
            branches: [
              {
                id: "br-prod-main",
                project_id: "neon-proj-live-1",
                name: "main",
                primary: true,
                default: true,
                protected: true,
                current_state: "ready",
                logical_size: 1_500_000_000,
              },
              {
                id: "br-stg-01",
                project_id: "neon-proj-live-1",
                name: "staging",
                primary: false,
                default: false,
                protected: false,
                current_state: "ready",
                logical_size: 500_000_000,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/branches/br-prod-main/databases")) {
        return new Response(
          JSON.stringify({
            databases: [
              { id: 1, branch_id: "br-prod-main", name: "appdb", owner_name: "app_owner" },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/projects/neon-proj-live-1/endpoints")) {
        return new Response(
          JSON.stringify({
            endpoints: [
              {
                id: "ep-rw-1",
                project_id: "neon-proj-live-1",
                branch_id: "br-prod-main",
                type: "read_write",
                current_state: "active",
                autoscaling_limit_min_cu: 0.5,
                autoscaling_limit_max_cu: 4,
                suspend_timeout_seconds: 300,
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("Not Found", { status: 404 });
    }) as unknown as typeof fetch;

    const adapter = createNeonReadOnlyAdapter(neonCatalog, { fetchFn: mockFetch });
    const resources = await adapter.discoverResources({
      organizationId: "org_1",
      workspaceId: "ws_1",
      apiToken: "napi_proj_readonly_test_key",
      grantedScopes: ["neon.projects.readonly", "neon.consumption.readonly"],
    });

    expect(resources).toHaveLength(1);
    const res = resources[0];
    expect(res?.externalResourceId).toBe("neon-proj-live-1");
    expect(res?.metadata.pgVersion).toBe(17);
    expect(res?.metadata.branchCount).toBe(2);
    expect(res?.metadata.instantaneousStorageBytes).toBe(2_000_000_000);
    expect(res?.metadata.minCu).toBe(0.5);
    expect(res?.metadata.maxCu).toBe(4);
    expect(res?.metadata.protectedBranchConfigured).toBe(true);
    expect(res?.metadata.ipAllowlistConfigured).toBe(true);
    expect(res?.metadata.intrinsicProviderReadOnly).toBe(false);
    expect(res?.metadata.adapterGetOnlyLockActive).toBe(true);
  });

  it("preserves unit semantics: distinguishes bytes_month consumption from instantaneous bytes, keeps compute_unit_seconds in seconds (never CPU %), and never fabricates 0 when plan-gated or querying registered users", async () => {
    const adapter = createNeonReadOnlyAdapter(neonCatalog);
    const context = {
      organizationId: "org_1",
      workspaceId: "ws_1",
      apiToken: "napi_proj_test",
      grantedScopes: ["neon.projects.readonly", "neon.consumption.readonly"],
      providerPlanTier: "pro" as const,
    };

    // 1. Compute-unit seconds is in seconds, never CPU %
    const cuResult = await adapter.readMetrics(context, {
      externalResourceId: "neon-proj-core-prod",
      capabilityKey: "postgres_metadata",
      metricKey: NEON_CANONICAL_METRIC_KEYS.COMPUTE_UNIT_SECONDS,
      granularity: "daily",
      startDateIso: "2026-11-19T00:00:00.000Z",
      endDateIso: "2026-11-21T00:00:00.000Z",
    });
    expect(cuResult.capabilityStatus).toBe("SUPPORTED");
    expect(cuResult.points[0]?.unit).toBe("seconds");
    expect(cuResult.points[0]?.value).toBe(81_000);
    expect(cuResult.statusExplanation).toContain("Not CPU utilization percentage");

    // 2. Storage consumption is in bytes_month, whereas instantaneous storage is in bytes
    const storageConsumptionResult = await adapter.readMetrics(context, {
      externalResourceId: "neon-proj-core-prod",
      capabilityKey: "postgres_metadata",
      metricKey: NEON_CANONICAL_METRIC_KEYS.STORAGE_CONSUMPTION_BYTES_MONTH,
      granularity: "daily",
      startDateIso: "2026-11-19T00:00:00.000Z",
      endDateIso: "2026-11-21T00:00:00.000Z",
    });
    expect(storageConsumptionResult.points[0]?.unit).toBe("bytes_month");
    expect(storageConsumptionResult.points[0]?.value).toBe(
      convertNeonByteSecondsToBytesMonth(1_900_800_000 * 86_400),
    );

    const instantaneousStorageResult = await adapter.readMetrics(context, {
      externalResourceId: "neon-proj-core-prod",
      capabilityKey: "postgres_metadata",
      metricKey: NEON_CANONICAL_METRIC_KEYS.INSTANTANEOUS_STORAGE_BYTES,
      granularity: "daily",
      startDateIso: "2026-11-19T00:00:00.000Z",
      endDateIso: "2026-11-21T00:00:00.000Z",
    });
    expect(instantaneousStorageResult.points[0]?.unit).toBe("bytes");
    expect(instantaneousStorageResult.points[0]?.value).toBe(2_254_857_829);

    // 3. Free plan gates consumption_history -> PLAN_RESTRICTED with value: null (never 0)
    const freePlanCuResult = await adapter.readMetrics(
      { ...context, providerPlanTier: "free" },
      {
        externalResourceId: "neon-proj-core-prod",
        capabilityKey: "postgres_metadata",
        metricKey: NEON_CANONICAL_METRIC_KEYS.COMPUTE_UNIT_SECONDS,
        granularity: "daily",
        startDateIso: "2026-11-19T00:00:00.000Z",
        endDateIso: "2026-11-21T00:00:00.000Z",
      },
    );
    expect(freePlanCuResult.capabilityStatus).toBe("PLAN_RESTRICTED");
    expect(freePlanCuResult.uxState).toBe("unsupported_plan");
    expect(freePlanCuResult.points[0]?.value).toBeNull();
    expect(freePlanCuResult.points[0]?.value).not.toBe(0);

    // 4. Registered user count is UNSUPPORTED_BY_PROVIDER on Neon with value: null
    const userCountResult = await adapter.readMetrics(context, {
      externalResourceId: "neon-proj-core-prod",
      capabilityKey: "user_count_posture",
      metricKey: "neon.registered_users",
      granularity: "daily",
      startDateIso: "2026-11-19T00:00:00.000Z",
      endDateIso: "2026-11-21T00:00:00.000Z",
    });
    expect(userCountResult.capabilityStatus).toBe("UNSUPPORTED_BY_PROVIDER");
    expect(userCountResult.points[0]?.value).toBeNull();
  });
});
