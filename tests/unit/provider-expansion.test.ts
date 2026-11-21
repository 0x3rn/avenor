import { assertReadOnlyAdapterContract } from "@avenor/types";
import { describe, expect, it } from "vitest";
import { getProviderAdapter } from "@/lib/providers/adapters";
import { PROVIDER_EXPANSION_FEASIBILITY_MATRIX } from "@/lib/providers/expansion-matrix";
import {
  assertAllowlistedFoundryBridgeRequest,
  resolveFoundryOneBridgeConfig,
  validateFoundryOneAggregatePayload,
} from "@/lib/providers/foundry-bridge";
import { assertAllowlistedPostHogGetRequest } from "@/lib/providers/posthog";

describe("THE-168 Provider Catalog Expansion (PostHog) & Isolated Foundry One Bridge", () => {
  it("documents 5 expansion candidates and registers the strictly read-only PostHog adapter", async () => {
    expect(PROVIDER_EXPANSION_FEASIBILITY_MATRIX.length).toBeGreaterThanOrEqual(5);
    const posthogEntry = PROVIDER_EXPANSION_FEASIBILITY_MATRIX.find(
      (e) => e.providerKey === "posthog",
    );
    expect(posthogEntry?.decision).toBe("IMPLEMENTED_IN_M11");

    const adapter = getProviderAdapter("posthog");
    expect(() => assertReadOnlyAdapterContract(adapter)).not.toThrow();

    // Allowlisted aggregate endpoints succeed
    expect(
      assertAllowlistedPostHogGetRequest(
        "GET",
        "https://eu.posthog.com/api/projects/78102/insights/",
      ).pathname,
    ).toBe("/api/projects/78102/insights/");

    // Non-GET, raw PII (/persons, /events), and feature-flag endpoints are strictly blocked
    expect(() =>
      assertAllowlistedPostHogGetRequest(
        "POST",
        "https://eu.posthog.com/api/projects/78102/insights/",
      ),
    ).toThrow(/Only GET requests are permitted/i);
    expect(() =>
      assertAllowlistedPostHogGetRequest(
        "GET",
        "https://eu.posthog.com/api/projects/78102/persons/",
      ),
    ).toThrow(/raw PII/i);
    expect(() =>
      assertAllowlistedPostHogGetRequest(
        "GET",
        "https://eu.posthog.com/api/projects/78102/feature_flags/",
      ),
    ).toThrow(/blocked/i);

    const metrics = await adapter.readMetrics(
      {
        organizationId: "org_1",
        connectionId: "conn_ph_1",
        workspaceId: "ws_1",
        accessToken: "phx_readonly_test_key",
        grantedScopes: ["project:read", "insight:read"],
      },
      {
        externalResourceId: "posthog:project:78102",
        capabilityKey: "product_analytics_aggregates",
        metricKey: "posthog.insight_events_total",
        granularity: "daily",
        startDateIso: "2026-11-14",
        endDateIso: "2026-11-20",
      },
    );
    expect(metrics.uxState).toBe("connected_healthy");
  });

  it("keeps optional Foundry One bridge disabled by default, isolates credentials, blocks control actions, and rejects PII", () => {
    // Disabled by default
    const disabledCfg = resolveFoundryOneBridgeConfig({});
    expect(disabledCfg.enabled).toBe(false);
    expect(() =>
      assertAllowlistedFoundryBridgeRequest(
        "GET",
        "https://metrics.foundryone.internal/v1/telemetry/health",
        {},
      ),
    ).toThrow(/disabled by default/i);

    // Rejects shared Avenor auth/vault credentials
    expect(() =>
      resolveFoundryOneBridgeConfig({
        FOUNDRY_ONE_BRIDGE_ENABLED: "true",
        FOUNDRY_ONE_METRICS_BRIDGE_URL: "https://telemetry.foundryone.example",
        FOUNDRY_ONE_METRICS_BRIDGE_TOKEN: "shared_secret_123",
        BETTER_AUTH_SECRET: "shared_secret_123",
      }),
    ).toThrow(/Credential isolation violation/i);

    const isolatedEnv = {
      FOUNDRY_ONE_BRIDGE_ENABLED: "true",
      FOUNDRY_ONE_METRICS_BRIDGE_URL: "https://telemetry.foundryone.example",
      FOUNDRY_ONE_METRICS_BRIDGE_TOKEN: "fo_ro_bridge_dedicated_token_xyz",
      BETTER_AUTH_SECRET: "avenor_auth_secret_abc",
    };

    // Allows strictly GET on /v1/telemetry/aggregates
    expect(
      assertAllowlistedFoundryBridgeRequest(
        "GET",
        "https://telemetry.foundryone.example/v1/telemetry/aggregates",
        isolatedEnv,
      ).pathname,
    ).toBe("/v1/telemetry/aggregates");

    // Blocks POST, /admin, /sql, /deploy
    expect(() =>
      assertAllowlistedFoundryBridgeRequest(
        "POST",
        "https://telemetry.foundryone.example/v1/telemetry/aggregates",
        isolatedEnv,
      ),
    ).toThrow(/Only read-only GET/i);
    expect(() =>
      assertAllowlistedFoundryBridgeRequest(
        "GET",
        "https://telemetry.foundryone.example/v1/admin/deploy",
        isolatedEnv,
      ),
    ).toThrow(/control\/sensitive path/i);

    // Aggregate-only Zod strict schema rejects any unexpected PII field
    const valid = validateFoundryOneAggregatePayload({
      serviceName: "foundry-core-api",
      environment: "PRODUCTION",
      windowStartIso: "2026-11-21T00:00:00.000Z",
      windowEndIso: "2026-11-21T01:00:00.000Z",
      requestCount: 18500,
      error5xxCount: 3,
      p95LatencyMs: 142.5,
    });
    expect(valid.requestCount).toBe(18500);

    expect(() =>
      validateFoundryOneAggregatePayload({
        serviceName: "foundry-core-api",
        environment: "PRODUCTION",
        windowStartIso: "2026-11-21T00:00:00.000Z",
        windowEndIso: "2026-11-21T01:00:00.000Z",
        requestCount: 18500,
        error5xxCount: 3,
        p95LatencyMs: 142.5,
        userEmails: ["leak@example.com"],
      }),
    ).toThrow(/non-aggregate or malformed/i);
  });
});
