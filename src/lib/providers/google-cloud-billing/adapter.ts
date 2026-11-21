import {
  type DiscoveredExternalResource,
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
import { shouldExecuteLiveGoogleApi } from "../google-shared/http";
import {
  assertGcpBillingScenarioAndScope,
  discoverGcpBillingAccountsAndProjects,
  hasCloudBillingMetadataScope,
  listGcpBillingAccounts,
  METADATA_ONLY_DISCOVERY_NOTICE,
  mapGcpBillingDiscoveryToExternalResources,
} from "./discovery";
import { GCP_BILLING_PROVIDER_KEY } from "./types";

/**
 * Strictly read-only Google Cloud Billing provider adapter.
 * Exposes zero mutation methods and separates billing account/project metadata discovery
 * (`cloud-billing.readonly`) from BigQuery billing export cost queries (`bigquery.readonly`).
 */
export function createGcpBillingReadOnlyAdapter(
  catalogEntry: ProviderCatalogEntry,
  options?: { fetchFn?: typeof fetch },
): ReadOnlyProviderAdapter {
  const fetchFn = options?.fetchFn;

  const adapter: ReadOnlyProviderAdapter = {
    providerKey: GCP_BILLING_PROVIDER_KEY,
    displayName: catalogEntry.displayName,
    category: catalogEntry.category,
    authMode: catalogEntry.authMode,
    catalogEntry,
    readOnlyGuaranteed: true,

    async validateCredentials(
      context: ReadOnlyProviderContext,
    ): Promise<ProviderCredentialValidationResult> {
      assertGcpBillingScenarioAndScope(context);

      const accessToken = context.accessToken ?? context.apiToken ?? "";
      if (!accessToken) {
        throw new ProviderAdapterError({
          providerKey: GCP_BILLING_PROVIDER_KEY,
          code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
          message: "Missing Google Cloud Billing read-only OAuth credential token.",
        });
      }

      if (
        shouldExecuteLiveGoogleApi(context, Boolean(fetchFn), GCP_BILLING_PROVIDER_KEY) &&
        hasCloudBillingMetadataScope(context.grantedScopes)
      ) {
        await listGcpBillingAccounts({
          accessToken,
          fetchFn,
          pageSize: 1,
          maxPages: 1,
        });
      }

      const missingRequiredScopes = catalogEntry.defaultScopes.filter(
        (reqScope) => !context.grantedScopes.includes(reqScope),
      );
      const capabilities = evaluateCapabilityMatrix(
        catalogEntry.capabilities,
        context.grantedScopes,
        { providerPlanTier: context.providerPlanTier ?? "pro" },
      );

      return {
        valid: true,
        externalAccountId: `google_billing_${context.workspaceId.slice(0, 8)}`,
        externalAccountLabel: "Google Cloud Billing (Read-Only)",
        grantedScopes: context.grantedScopes,
        missingRequiredScopes,
        healthStatus: missingRequiredScopes.length > 0 ? "PERMISSION_MISSING" : "HEALTHY",
        capabilities,
      };
    },

    async discoverResources(
      context: ReadOnlyProviderContext,
    ): Promise<readonly DiscoveredExternalResource[]> {
      const discovery = await discoverGcpBillingAccountsAndProjects(context, {
        fetchFn,
      });
      return mapGcpBillingDiscoveryToExternalResources(discovery, context.grantedScopes);
    },

    async getCapabilities(context: ReadOnlyProviderContext) {
      return evaluateCapabilityMatrix(catalogEntry.capabilities, context.grantedScopes, {
        providerPlanTier: context.providerPlanTier ?? "pro",
      });
    },

    async getConnectionHealth(
      context: ReadOnlyProviderContext,
    ): Promise<ProviderConnectionHealthSnapshot> {
      const checkedAtIso = new Date().toISOString();
      const started = Date.now();

      try {
        assertGcpBillingScenarioAndScope(context);

        if (!hasCloudBillingMetadataScope(context.grantedScopes)) {
          return {
            providerKey: GCP_BILLING_PROVIDER_KEY,
            status: "PERMISSION_MISSING",
            uxState: "permission_insufficient",
            checkedAtIso,
            latencyMs: Date.now() - started,
            grantedScopes: context.grantedScopes,
            missingScopes: catalogEntry.defaultScopes.filter(
              (s) => !context.grantedScopes.includes(s),
            ),
            errorCode: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
            message:
              "Connection is missing Google Cloud Billing read-only metadata scope (cloud-billing.readonly).",
          };
        }

        if (shouldExecuteLiveGoogleApi(context, Boolean(fetchFn), GCP_BILLING_PROVIDER_KEY)) {
          await listGcpBillingAccounts({
            accessToken: context.accessToken ?? "",
            fetchFn,
            pageSize: 1,
            maxPages: 1,
          });
        }

        return {
          providerKey: GCP_BILLING_PROVIDER_KEY,
          status: "HEALTHY",
          uxState: "connected_healthy",
          checkedAtIso,
          latencyMs: Date.now() - started,
          grantedScopes: context.grantedScopes,
          missingScopes: [],
          message: METADATA_ONLY_DISCOVERY_NOTICE,
        };
      } catch (err) {
        const adapterErr =
          err instanceof ProviderAdapterError
            ? err
            : new ProviderAdapterError({
                providerKey: GCP_BILLING_PROVIDER_KEY,
                code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
                message:
                  err instanceof Error
                    ? err.message
                    : "Google Cloud Billing health validation failed.",
              });

        return {
          providerKey: GCP_BILLING_PROVIDER_KEY,
          status: adapterErr.healthStatus,
          uxState: adapterErr.uxState,
          checkedAtIso,
          latencyMs: Date.now() - started,
          grantedScopes: context.grantedScopes,
          missingScopes: [],
          errorCode: adapterErr.code,
          message: adapterErr.message,
        };
      }
    },

    async readMetrics(
      context: ReadOnlyProviderContext,
      query: ProviderMetricQuery,
    ): Promise<ProviderMetricReadResult> {
      assertGcpBillingScenarioAndScope(context);
      const capabilities = evaluateCapabilityMatrix(
        catalogEntry.capabilities,
        context.grantedScopes,
        { providerPlanTier: context.providerPlanTier ?? "pro" },
      );

      const matchingCap = capabilities.find((c) => c.capabilityKey === query.capabilityKey);
      const observedAtIso = new Date().toISOString();

      if (!matchingCap?.allowsNumericMetric) {
        return {
          providerKey: GCP_BILLING_PROVIDER_KEY,
          externalResourceId: query.externalResourceId,
          capabilityKey: query.capabilityKey,
          metricKey: query.metricKey,
          capabilityStatus: matchingCap?.status ?? "UNSUPPORTED_BY_PROVIDER",
          uxState: matchingCap?.uxState ?? "unsupported_plan",
          observedAtIso,
          sourceFreshnessMinutes: matchingCap?.freshnessWindowMinutes ?? 720,
          provenanceLabel: `Google Cloud Billing • ${query.externalResourceId}`,
          statusExplanation:
            matchingCap?.statusExplanation ??
            "Historical cloud cost metrics require an onboarded BigQuery Cloud Billing export dataset and bigquery.readonly permission.",
          points: [
            {
              timestampIso: query.endDateIso,
              metricKey: query.metricKey,
              value: null,
              unit: "currency",
            },
          ],
        };
      }

      // Note: Cloud Billing Account metadata resources ("billingAccounts/..." or "gcp-project:...")
      // never fabricate historical cost figures when no BigQuery export dataset is linked.
      return {
        providerKey: GCP_BILLING_PROVIDER_KEY,
        externalResourceId: query.externalResourceId,
        capabilityKey: query.capabilityKey,
        metricKey: query.metricKey,
        capabilityStatus: matchingCap.status,
        uxState: "partial_coverage",
        observedAtIso,
        sourceFreshnessMinutes: matchingCap.freshnessWindowMinutes,
        provenanceLabel: `Google Cloud Billing • ${query.externalResourceId}`,
        statusExplanation: METADATA_ONLY_DISCOVERY_NOTICE,
        points: [
          {
            timestampIso: query.endDateIso,
            metricKey: query.metricKey,
            value: null,
            unit: "currency",
          },
        ],
      };
    },
  };

  return adapter;
}
