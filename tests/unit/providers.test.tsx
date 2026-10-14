import {
  assertReadOnlyAdapterContract,
  evaluateCapabilityMatrix,
  FORBIDDEN_PROVIDER_MUTATION_METHODS,
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
} from "@avenor/types";
import { CapabilityMatrixList, CapabilityStatusBadge, ReadOnlyGuaranteeCallout } from "@avenor/ui";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  getProviderAdapter,
  getProviderCatalogEntry,
  listProviderCatalogEntries,
  listRegisteredProviderAdapters,
} from "@/lib/providers";

describe("THE-117: Read-only provider contracts and granular capability discovery", () => {
  it("verifies all registered provider adapters satisfy the read-only contract and expose zero mutation methods", () => {
    const adapters = listRegisteredProviderAdapters();
    expect(adapters.length).toBeGreaterThanOrEqual(10);

    for (const adapter of adapters) {
      expect(() => assertReadOnlyAdapterContract(adapter)).not.toThrow();
      expect(adapter.readOnlyGuaranteed).toBe(true);

      for (const forbiddenMethod of FORBIDDEN_PROVIDER_MUTATION_METHODS) {
        expect((adapter as unknown as Record<string, unknown>)[forbiddenMethod]).toBeUndefined();
      }
    }
  });

  it("rejects any adapter that exposes a prohibited mutation method or lacks readOnlyGuaranteed", () => {
    const baseAdapter = getProviderAdapter("avenor-sandbox");

    for (const forbiddenMethod of FORBIDDEN_PROVIDER_MUTATION_METHODS) {
      const rogueAdapter = {
        ...baseAdapter,
        readOnlyGuaranteed: true,
        validateCredentials: baseAdapter.validateCredentials.bind(baseAdapter),
        discoverResources: baseAdapter.discoverResources.bind(baseAdapter),
        getCapabilities: baseAdapter.getCapabilities.bind(baseAdapter),
        getConnectionHealth: baseAdapter.getConnectionHealth.bind(baseAdapter),
        readMetrics: baseAdapter.readMetrics.bind(baseAdapter),
        [forbiddenMethod]: async () => ({ mutated: true }),
      };

      expect(() => assertReadOnlyAdapterContract(rogueAdapter)).toThrow(
        /prohibited source mutation method/i,
      );
    }

    const nonReadOnlyAdapter = {
      ...baseAdapter,
      readOnlyGuaranteed: false,
    };
    expect(() => assertReadOnlyAdapterContract(nonReadOnlyAdapter)).toThrow(
      /readOnlyGuaranteed must be true/i,
    );
  });

  it("evaluates granular capabilities accurately across SUPPORTED, MISSING_PERMISSION, PLAN_RESTRICTED, UNSUPPORTED_BY_PROVIDER, and PREVIEW_ONLY", () => {
    const sandboxCatalog = getProviderCatalogEntry("avenor-sandbox");
    expect(sandboxCatalog).toBeDefined();
    if (!sandboxCatalog) {
      throw new Error("Expected avenor-sandbox catalog entry");
    }

    // 1. Partial scope grant -> resource_discovery SUPPORTED, analytics_sessions MISSING_PERMISSION
    const partialMatrix = evaluateCapabilityMatrix(
      sandboxCatalog.capabilities,
      ["sandbox.resources.readonly"],
      { providerPlanTier: "pro" },
    );

    const discoveryCap = partialMatrix.find((c) => c.capabilityKey === "resource_discovery");
    const sessionsCap = partialMatrix.find((c) => c.capabilityKey === "analytics_sessions");
    const rawSqlCap = partialMatrix.find((c) => c.capabilityKey === "raw_sql_inspection");

    expect(discoveryCap?.status).toBe("SUPPORTED");
    expect(discoveryCap?.allowsNumericMetric).toBe(true);

    expect(sessionsCap?.status).toBe("MISSING_PERMISSION");
    expect(sessionsCap?.missingScopes).toEqual(["sandbox.metrics.readonly"]);
    expect(sessionsCap?.uxState).toBe("permission_insufficient");
    expect(sessionsCap?.allowsNumericMetric).toBe(false);

    expect(rawSqlCap?.status).toBe("UNSUPPORTED_BY_PROVIDER");
    expect(rawSqlCap?.allowsNumericMetric).toBe(false);

    // 2. Full scope grant on free plan -> enterprise_audit_stream is PLAN_RESTRICTED
    const freeTierMatrix = evaluateCapabilityMatrix(
      sandboxCatalog.capabilities,
      ["sandbox.resources.readonly", "sandbox.metrics.readonly"],
      { providerPlanTier: "free" },
    );
    const enterpriseCap = freeTierMatrix.find((c) => c.capabilityKey === "enterprise_audit_stream");
    expect(enterpriseCap?.status).toBe("PLAN_RESTRICTED");
    expect(enterpriseCap?.uxState).toBe("unsupported_plan");
    expect(enterpriseCap?.allowsNumericMetric).toBe(false);

    // 3. GA4 preview capability status
    const ga4Catalog = getProviderCatalogEntry("ga4");
    expect(ga4Catalog).toBeDefined();
    if (!ga4Catalog) {
      throw new Error("Expected ga4 catalog entry");
    }
    const ga4Matrix = evaluateCapabilityMatrix(ga4Catalog.capabilities, ga4Catalog.defaultScopes);
    const ga4Sessions = ga4Matrix.find((c) => c.capabilityKey === "analytics_sessions");
    expect(ga4Sessions?.status).toBe("PREVIEW_ONLY");
  });

  it("never fabricates numeric 0 when reading metrics for missing permissions or unsupported capabilities", async () => {
    const adapter = getProviderAdapter("avenor-sandbox");

    const missingPermResult = await adapter.readMetrics(
      {
        organizationId: "org_1",
        workspaceId: "ws_1",
        accessToken: "token_valid",
        grantedScopes: ["sandbox.resources.readonly"], // Missing sandbox.metrics.readonly
      },
      {
        externalResourceId: "sbx_stream_prod_web",
        capabilityKey: "analytics_sessions",
        metricKey: "sessions",
        granularity: "daily",
        startDateIso: "2026-10-01T00:00:00.000Z",
        endDateIso: "2026-10-07T00:00:00.000Z",
      },
    );

    expect(missingPermResult.capabilityStatus).toBe("MISSING_PERMISSION");
    expect(missingPermResult.uxState).toBe("permission_insufficient");
    expect(missingPermResult.points[0]?.value).toBeNull();
    expect(missingPermResult.points[0]?.value).not.toBe(0);

    const unsupportedResult = await adapter.readMetrics(
      {
        organizationId: "org_1",
        workspaceId: "ws_1",
        accessToken: "token_valid",
        grantedScopes: ["sandbox.resources.readonly", "sandbox.metrics.readonly"],
      },
      {
        externalResourceId: "sbx_stream_prod_web",
        capabilityKey: "raw_sql_inspection",
        metricKey: "rows",
        granularity: "daily",
        startDateIso: "2026-10-01T00:00:00.000Z",
        endDateIso: "2026-10-07T00:00:00.000Z",
      },
    );

    expect(unsupportedResult.capabilityStatus).toBe("UNSUPPORTED_BY_PROVIDER");
    expect(unsupportedResult.uxState).toBe("unsupported_plan");
    expect(unsupportedResult.points[0]?.value).toBeNull();
  });

  it("normalizes provider errors and redacts raw tokens or secrets from error messages", async () => {
    const adapter = getProviderAdapter("avenor-sandbox");

    await expect(
      adapter.discoverResources({
        organizationId: "org_1",
        workspaceId: "ws_1",
        accessToken: "token_valid",
        grantedScopes: ["sandbox.resources.readonly"],
        simulationScenario: "rate_limited",
      }),
    ).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.RATE_LIMITED,
      retryable: true,
      uxState: "rate_limited",
      healthStatus: "RATE_LIMITED",
    });

    const errWithSecret = new ProviderAdapterError({
      providerKey: "ga4",
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message:
        "Upstream rejected Bearer ya29_secretGoogleAccessToken99999 and refresh_token=1//0gSecretRefreshTokenValue",
    });

    expect(errWithSecret.message).not.toContain("ya29_secretGoogleAccessToken99999");
    expect(errWithSecret.message).not.toContain("1//0gSecretRefreshTokenValue");
    expect(errWithSecret.message).toContain("[REDACTED]");
    expect(errWithSecret.toAppError().toPublicJson().error.message).not.toContain(
      "1//0gSecretRefreshTokenValue",
    );
  });

  it("filters provider catalog by category, search query, and availability status", () => {
    const analyticsOnly = listProviderCatalogEntries({ category: "analytics" });
    expect(analyticsOnly.map((e) => e.providerKey)).toEqual(["ga4"]);

    const searchResult = listProviderCatalogEntries({ search: "Neon" });
    expect(searchResult.map((e) => e.providerKey)).toEqual(["neon"]);

    const sandboxOnly = listProviderCatalogEntries({ availabilityStatus: "active_sandbox" });
    expect(sandboxOnly.map((e) => e.providerKey)).toEqual(["avenor-sandbox"]);
  });

  it("renders vendor-neutral capability badges, read-only guarantee callout, and capability matrix transparently", async () => {
    const adapter = getProviderAdapter("avenor-sandbox");
    const capabilities = await adapter.getCapabilities({
      organizationId: "org_1",
      workspaceId: "ws_1",
      grantedScopes: ["sandbox.resources.readonly"],
      providerPlanTier: "free",
    });

    render(
      <div>
        <CapabilityStatusBadge status="SUPPORTED" />
        <ReadOnlyGuaranteeCallout
          providerName={adapter.displayName}
          guaranteeText={adapter.catalogEntry.readOnlyGuaranteeText}
          requiredScopes={adapter.catalogEntry.defaultScopes}
          prohibitedOperations={adapter.catalogEntry.prohibitedOperationsSummary}
        />
        <CapabilityMatrixList capabilities={capabilities} />
      </div>,
    );

    expect(screen.getByTestId("read-only-guarantee-callout")).toHaveTextContent(
      "Read-Only Security Contract",
    );
    expect(screen.getByTestId("capability-row-resource_discovery")).toHaveTextContent("Supported");
    expect(screen.getByTestId("capability-row-analytics_sessions")).toHaveTextContent(
      "Missing read scope",
    );
    expect(screen.getByTestId("capability-row-raw_sql_inspection")).toHaveTextContent(
      "Unsupported by provider",
    );
  });
});
