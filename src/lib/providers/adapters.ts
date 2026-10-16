import {
  assertReadOnlyAdapterContract,
  type DiscoveredExternalResource,
  type EvaluatedProviderCapability,
  evaluateCapabilityMatrix,
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ProviderCatalogEntry,
  type ProviderConnectionHealthSnapshot,
  type ProviderCredentialValidationResult,
  type ProviderMetricQuery,
  type ProviderMetricReadResult,
  type ReadOnlyProviderAdapter,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import { getProviderCatalogEntry, PROVIDER_CATALOG } from "./catalog";

const SAMPLE_RESOURCES_BY_PROVIDER: Record<string, readonly DiscoveredExternalResource[]> = {
  "avenor-sandbox": [
    {
      externalResourceId: "sbx_stream_prod_web",
      externalResourceName: "Avenor Marketing & Console (Production)",
      resourceType: "sandbox_stream",
      regionOrLocation: "eu-west-1",
      parentAccountOrOrg: "Avenor Verification Sandbox",
      availableCapabilities: ["resource_discovery", "analytics_sessions"],
      metadata: {
        environmentHint: "PRODUCTION",
        domain: "avenor.corstack.dev",
        samplingRate: 100,
      },
    },
    {
      externalResourceId: "sbx_stream_stg_web",
      externalResourceName: "Avenor Console Preview (Staging)",
      resourceType: "sandbox_stream",
      regionOrLocation: "eu-west-1",
      parentAccountOrOrg: "Avenor Verification Sandbox",
      availableCapabilities: ["resource_discovery", "analytics_sessions"],
      metadata: {
        environmentHint: "STAGING",
        domain: "staging.avenor.corstack.dev",
        samplingRate: 100,
      },
    },
    {
      externalResourceId: "sbx_stream_dev_local",
      externalResourceName: "Avenor Local Development Stream",
      resourceType: "sandbox_stream",
      regionOrLocation: "us-east-1",
      parentAccountOrOrg: "Avenor Verification Sandbox",
      availableCapabilities: ["resource_discovery", "analytics_sessions"],
      metadata: {
        environmentHint: "DEVELOPMENT",
        domain: "localhost:3000",
        samplingRate: 100,
      },
    },
  ],
  ga4: [
    {
      externalResourceId: "properties/481920114",
      externalResourceName: "Core Web App — GA4 Production",
      resourceType: "ga4_property",
      regionOrLocation: "UTC",
      parentAccountOrOrg: "Google Analytics Account #9012",
      availableCapabilities: ["resource_discovery", "analytics_sessions"],
      metadata: {
        environmentHint: "PRODUCTION",
        currencyCode: "USD",
        timeZone: "UTC",
      },
    },
    {
      externalResourceId: "properties/481920115",
      externalResourceName: "Core Web App — GA4 Staging",
      resourceType: "ga4_property",
      regionOrLocation: "UTC",
      parentAccountOrOrg: "Google Analytics Account #9012",
      availableCapabilities: ["resource_discovery", "analytics_sessions"],
      metadata: {
        environmentHint: "STAGING",
        currencyCode: "USD",
        timeZone: "UTC",
      },
    },
  ],
  gsc: [
    {
      externalResourceId: "sc-domain:avenor.corstack.dev",
      externalResourceName: "sc-domain:avenor.corstack.dev",
      resourceType: "gsc_site",
      regionOrLocation: "Global",
      parentAccountOrOrg: "Google Search Console",
      availableCapabilities: ["resource_discovery", "search_queries"],
      metadata: {
        environmentHint: "PRODUCTION",
        permissionLevel: "siteFullUser",
      },
    },
  ],
  github: [
    {
      externalResourceId: "repo:corstack/avenor-platform",
      externalResourceName: "corstack/avenor-platform",
      resourceType: "github_repository",
      regionOrLocation: "Global",
      parentAccountOrOrg: "corstack",
      availableCapabilities: ["resource_discovery", "repository_activity"],
      metadata: {
        environmentHint: "PRODUCTION",
        defaultBranch: "main",
        visibility: "private",
      },
    },
  ],
};

function enforceContextAndSimulation(
  catalogEntry: ProviderCatalogEntry,
  context: ReadOnlyProviderContext,
): void {
  if (!context.organizationId || !context.workspaceId) {
    throw new ProviderAdapterError({
      providerKey: catalogEntry.providerKey,
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "Workspace and organization context are required for read-only provider access.",
    });
  }

  switch (context.simulationScenario) {
    case "expired_token":
      throw new ProviderAdapterError({
        providerKey: catalogEntry.providerKey,
        code: PROVIDER_ERROR_CODES.CREDENTIAL_EXPIRED,
        message: `Access token for ${catalogEntry.displayName} has expired and requires refresh or re-authorization.`,
      });
    case "revoked_token":
      throw new ProviderAdapterError({
        providerKey: catalogEntry.providerKey,
        code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
        message: `Authorization grant for ${catalogEntry.displayName} was revoked upstream by the account owner.`,
      });
    case "rate_limited":
      throw new ProviderAdapterError({
        providerKey: catalogEntry.providerKey,
        code: PROVIDER_ERROR_CODES.RATE_LIMITED,
        message: `${catalogEntry.displayName} rate limit quota reached. Retry after cooldown window.`,
        retryable: true,
        retryAfterSeconds: 60,
      });
    case "provider_unavailable":
      throw new ProviderAdapterError({
        providerKey: catalogEntry.providerKey,
        code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
        message: `${catalogEntry.displayName} API is temporarily unreachable (upstream 503).`,
        retryable: true,
        retryAfterSeconds: 30,
      });
    case "malformed_response":
      throw new ProviderAdapterError({
        providerKey: catalogEntry.providerKey,
        code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
        message: `${catalogEntry.displayName} returned an unexpected payload schema during read-only inspection.`,
        retryable: false,
      });
    default:
      break;
  }
}

export class DeterministicReadOnlyProviderAdapter implements ReadOnlyProviderAdapter {
  public readonly providerKey: string;
  public readonly displayName: string;
  public readonly category: ProviderCatalogEntry["category"];
  public readonly authMode: ProviderCatalogEntry["authMode"];
  public readonly readOnlyGuaranteed = true as const;
  public readonly catalogEntry: ProviderCatalogEntry;

  constructor(catalogEntry: ProviderCatalogEntry) {
    this.catalogEntry = catalogEntry;
    this.providerKey = catalogEntry.providerKey;
    this.displayName = catalogEntry.displayName;
    this.category = catalogEntry.category;
    this.authMode = catalogEntry.authMode;
  }

  private getEffectiveScopes(context: ReadOnlyProviderContext): readonly string[] {
    if (context.simulationScenario === "missing_scope") {
      // Keep only discovery scope if present, omit secondary metric scopes
      return context.grantedScopes.slice(0, 1);
    }
    return context.grantedScopes;
  }

  private getEffectivePlanTier(context: ReadOnlyProviderContext): "free" | "pro" | "enterprise" {
    if (context.simulationScenario === "plan_restricted") {
      return "free";
    }
    return context.providerPlanTier ?? "pro";
  }

  public async validateCredentials(
    context: ReadOnlyProviderContext,
  ): Promise<ProviderCredentialValidationResult> {
    enforceContextAndSimulation(this.catalogEntry, context);

    const hasToken = Boolean(context.accessToken || context.apiToken);
    if (!hasToken) {
      throw new ProviderAdapterError({
        providerKey: this.providerKey,
        code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
        message: `Missing read-only credential token for ${this.displayName}.`,
      });
    }

    const effectiveScopes = this.getEffectiveScopes(context);
    const missingRequiredScopes = this.catalogEntry.defaultScopes.filter(
      (reqScope) => !effectiveScopes.includes(reqScope),
    );
    const capabilities = evaluateCapabilityMatrix(this.catalogEntry.capabilities, effectiveScopes, {
      providerPlanTier: this.getEffectivePlanTier(context),
    });

    const healthStatus = missingRequiredScopes.length > 0 ? "PERMISSION_MISSING" : "HEALTHY";

    return {
      valid: true,
      externalAccountId: `acct_${this.providerKey}_${context.workspaceId.slice(0, 8)}`,
      externalAccountLabel: `${this.catalogEntry.shortName} Read-Only Account`,
      grantedScopes: effectiveScopes,
      missingRequiredScopes,
      healthStatus,
      capabilities,
    };
  }

  public async discoverResources(
    context: ReadOnlyProviderContext,
  ): Promise<readonly DiscoveredExternalResource[]> {
    enforceContextAndSimulation(this.catalogEntry, context);

    const discoveryCap = this.catalogEntry.capabilities.find(
      (c) => c.capabilityKey === "resource_discovery",
    );
    const effectiveScopes = this.getEffectiveScopes(context);

    if (discoveryCap) {
      const missingDiscoveryScopes = discoveryCap.requiredScopes.filter(
        (scope) => !effectiveScopes.includes(scope),
      );
      if (missingDiscoveryScopes.length > 0) {
        throw new ProviderAdapterError({
          providerKey: this.providerKey,
          code: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
          message: `Cannot discover ${this.displayName} resources: missing read-only scope ${missingDiscoveryScopes.join(", ")}.`,
          missingScopes: missingDiscoveryScopes,
        });
      }
    }

    const predefined = SAMPLE_RESOURCES_BY_PROVIDER[this.providerKey];
    if (predefined) {
      return predefined;
    }

    return [
      {
        externalResourceId: `${this.providerKey}_res_prod`,
        externalResourceName: `${this.catalogEntry.shortName} Production Resource`,
        resourceType: this.catalogEntry.resourceTypeKey,
        regionOrLocation: "Global",
        parentAccountOrOrg: `${this.catalogEntry.shortName} Organization`,
        availableCapabilities: this.catalogEntry.capabilities.map((c) => c.capabilityKey),
        metadata: {
          environmentHint: "PRODUCTION",
        },
      },
    ];
  }

  public async getCapabilities(
    context: ReadOnlyProviderContext,
  ): Promise<readonly EvaluatedProviderCapability[]> {
    enforceContextAndSimulation(this.catalogEntry, context);

    return evaluateCapabilityMatrix(
      this.catalogEntry.capabilities,
      this.getEffectiveScopes(context),
      {
        providerPlanTier: this.getEffectivePlanTier(context),
      },
    );
  }

  public async getConnectionHealth(
    context: ReadOnlyProviderContext,
  ): Promise<ProviderConnectionHealthSnapshot> {
    const checkedAtIso = new Date().toISOString();
    try {
      enforceContextAndSimulation(this.catalogEntry, context);
      const effectiveScopes = this.getEffectiveScopes(context);
      const missingScopes = this.catalogEntry.defaultScopes.filter(
        (s) => !effectiveScopes.includes(s),
      );

      if (missingScopes.length > 0) {
        return {
          providerKey: this.providerKey,
          status: "PERMISSION_MISSING",
          uxState: "permission_insufficient",
          checkedAtIso,
          latencyMs: 38,
          grantedScopes: effectiveScopes,
          missingScopes,
          message: `Connection is active but missing ${missingScopes.length} required read-only scope(s): ${missingScopes.join(", ")}.`,
          errorCode: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
        };
      }

      if (context.simulationScenario === "stale_data") {
        return {
          providerKey: this.providerKey,
          status: "STALE",
          uxState: "stale_cached",
          checkedAtIso,
          latencyMs: 42,
          grantedScopes: effectiveScopes,
          missingScopes: [],
          message: `Connection is reachable, but source freshness exceeded expected window for ${this.displayName}.`,
        };
      }

      return {
        providerKey: this.providerKey,
        status: "HEALTHY",
        uxState: "connected_healthy",
        checkedAtIso,
        latencyMs: 24,
        grantedScopes: effectiveScopes,
        missingScopes: [],
        message: `${this.displayName} read-only connection verified and within freshness window.`,
      };
    } catch (error) {
      if (error instanceof ProviderAdapterError) {
        return {
          providerKey: this.providerKey,
          status: error.healthStatus,
          uxState: error.uxState,
          checkedAtIso,
          latencyMs: 65,
          grantedScopes: context.grantedScopes,
          missingScopes: error.missingScopes,
          message: error.message,
          errorCode: error.code,
        };
      }
      throw error;
    }
  }

  public async readMetrics(
    context: ReadOnlyProviderContext,
    query: ProviderMetricQuery,
  ): Promise<ProviderMetricReadResult> {
    enforceContextAndSimulation(this.catalogEntry, context);

    const capabilities = await this.getCapabilities(context);
    const matchingCap = capabilities.find((cap) => cap.capabilityKey === query.capabilityKey);

    if (!matchingCap) {
      throw new ProviderAdapterError({
        providerKey: this.providerKey,
        code: PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY,
        message: `Capability "${query.capabilityKey}" is not supported by ${this.displayName}.`,
      });
    }

    const observedAtIso = new Date().toISOString();

    // Never fabricate numeric 0 when capability is missing permission, plan restricted, or unsupported
    if (
      !matchingCap.allowsNumericMetric ||
      matchingCap.status === "MISSING_PERMISSION" ||
      matchingCap.status === "PLAN_RESTRICTED" ||
      matchingCap.status === "UNSUPPORTED_BY_PROVIDER"
    ) {
      return {
        providerKey: this.providerKey,
        externalResourceId: query.externalResourceId,
        capabilityKey: query.capabilityKey,
        metricKey: query.metricKey,
        capabilityStatus: matchingCap.status,
        uxState: matchingCap.uxState,
        observedAtIso,
        sourceFreshnessMinutes: matchingCap.freshnessWindowMinutes,
        provenanceLabel: `${this.catalogEntry.shortName} • Read-only`,
        statusExplanation: matchingCap.statusExplanation,
        points: [
          {
            timestampIso: query.endDateIso,
            metricKey: query.metricKey,
            value: null,
            unit: "count",
          },
        ],
      };
    }

    const resources = await this.discoverResources(context);
    const resourceExists = resources.some(
      (res) => res.externalResourceId === query.externalResourceId,
    );
    if (!resourceExists) {
      throw new ProviderAdapterError({
        providerKey: this.providerKey,
        code: PROVIDER_ERROR_CODES.RESOURCE_NOT_FOUND,
        message: `External resource "${query.externalResourceId}" was not found in ${this.displayName}.`,
      });
    }

    return {
      providerKey: this.providerKey,
      externalResourceId: query.externalResourceId,
      capabilityKey: query.capabilityKey,
      metricKey: query.metricKey,
      capabilityStatus: matchingCap.status,
      uxState: matchingCap.uxState,
      observedAtIso,
      sourceFreshnessMinutes: matchingCap.freshnessWindowMinutes,
      provenanceLabel: `${this.catalogEntry.shortName} • ${query.externalResourceId}`,
      statusExplanation: matchingCap.statusExplanation,
      points: [
        {
          timestampIso: query.startDateIso,
          metricKey: query.metricKey,
          value: 1240,
          unit: "count",
        },
        {
          timestampIso: query.endDateIso,
          metricKey: query.metricKey,
          value: 1490,
          unit: "count",
        },
      ],
    };
  }
}

const ADAPTER_REGISTRY = new Map<string, ReadOnlyProviderAdapter>();

for (const entry of PROVIDER_CATALOG) {
  const adapter = new DeterministicReadOnlyProviderAdapter(entry);
  assertReadOnlyAdapterContract(adapter);
  ADAPTER_REGISTRY.set(entry.providerKey, adapter);
}

export function getProviderAdapter(providerKey: string): ReadOnlyProviderAdapter {
  const existing = ADAPTER_REGISTRY.get(providerKey);
  if (existing) {
    assertReadOnlyAdapterContract(existing);
    return existing;
  }

  const catalogEntry = getProviderCatalogEntry(providerKey);
  if (!catalogEntry) {
    throw new ProviderAdapterError({
      providerKey,
      code: PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY,
      message: `Unknown provider "${providerKey}".`,
    });
  }

  const adapter = new DeterministicReadOnlyProviderAdapter(catalogEntry);
  assertReadOnlyAdapterContract(adapter);
  ADAPTER_REGISTRY.set(providerKey, adapter);
  return adapter;
}

export function listRegisteredProviderAdapters(): readonly ReadOnlyProviderAdapter[] {
  return Array.from(ADAPTER_REGISTRY.values());
}
