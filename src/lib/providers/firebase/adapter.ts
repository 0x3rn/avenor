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
import {
  executeGoogleReadRequest,
  GOOGLE_CLOUD_MONITORING_V3_BASE,
  shouldExecuteLiveGoogleApi,
} from "../google-shared/http";
import {
  assertFirebaseMonitoringCredentialAndSimulation,
  discoverFirebaseMonitoredProjects,
  hasMonitoringReadScope,
  mapFirebaseMonitoredProjectsToExternalResources,
} from "./discovery";
import { FIREBASE_MONITORING_DESCRIPTOR_SPECS, normalizeCloudMonitoringPoints } from "./timeseries";
import {
  type CloudMonitoringRawPoint,
  type CloudMonitoringTimeSeries,
  FIREBASE_CANONICAL_METRIC_KEYS,
  FIREBASE_MONITORING_PROVIDER_KEY,
  type FirebaseCanonicalMetricKey,
  GOOGLE_MONITORING_READ_SCOPE,
} from "./types";

interface CloudMonitoringTimeSeriesListResponse {
  timeSeries?: CloudMonitoringTimeSeries[];
  nextPageToken?: string;
}

const DETERMINISTIC_FIREBASE_RAW_POINTS: Readonly<
  Record<FirebaseCanonicalMetricKey, readonly CloudMonitoringRawPoint[]>
> = {
  [FIREBASE_CANONICAL_METRIC_KEYS.FIRESTORE_DOCUMENT_READS]: [
    {
      interval: { startTime: "2026-11-19T00:00:00.000Z", endTime: "2026-11-20T00:00:00.000Z" },
      value: { int64Value: "284500" },
    },
    {
      interval: { startTime: "2026-11-20T00:00:00.000Z", endTime: "2026-11-21T00:00:00.000Z" },
      value: { int64Value: "312900" },
    },
  ],
  [FIREBASE_CANONICAL_METRIC_KEYS.FIRESTORE_DOCUMENT_WRITES]: [
    {
      interval: { startTime: "2026-11-19T00:00:00.000Z", endTime: "2026-11-20T00:00:00.000Z" },
      value: { int64Value: "64200" },
    },
    {
      interval: { startTime: "2026-11-20T00:00:00.000Z", endTime: "2026-11-21T00:00:00.000Z" },
      value: { int64Value: "71800" },
    },
  ],
  [FIREBASE_CANONICAL_METRIC_KEYS.FIRESTORE_DOCUMENT_DELETES]: [
    {
      interval: { startTime: "2026-11-19T00:00:00.000Z", endTime: "2026-11-20T00:00:00.000Z" },
      value: { int64Value: "3100" },
    },
    {
      interval: { startTime: "2026-11-20T00:00:00.000Z", endTime: "2026-11-21T00:00:00.000Z" },
      value: { int64Value: "3450" },
    },
  ],
  [FIREBASE_CANONICAL_METRIC_KEYS.FIRESTORE_ACTIVE_LISTENERS]: [
    {
      interval: { endTime: "2026-11-20T00:00:00.000Z" },
      value: { int64Value: "145" },
    },
    {
      interval: { endTime: "2026-11-21T00:00:00.000Z" },
      value: { int64Value: "168" },
    },
  ],
  [FIREBASE_CANONICAL_METRIC_KEYS.FUNCTION_INVOCATIONS]: [
    {
      interval: { startTime: "2026-11-19T00:00:00.000Z", endTime: "2026-11-20T00:00:00.000Z" },
      value: { int64Value: "92400" },
    },
    {
      interval: { startTime: "2026-11-20T00:00:00.000Z", endTime: "2026-11-21T00:00:00.000Z" },
      value: { int64Value: "104600" },
    },
  ],
  [FIREBASE_CANONICAL_METRIC_KEYS.FUNCTION_ERRORS]: [
    {
      interval: { startTime: "2026-11-19T00:00:00.000Z", endTime: "2026-11-20T00:00:00.000Z" },
      value: { int64Value: "42" },
    },
    {
      interval: { startTime: "2026-11-20T00:00:00.000Z", endTime: "2026-11-21T00:00:00.000Z" },
      value: { int64Value: "38" },
    },
  ],
  [FIREBASE_CANONICAL_METRIC_KEYS.FUNCTION_EXECUTION_TIME_MS]: [
    {
      interval: { endTime: "2026-11-20T00:00:00.000Z" },
      value: { distributionValue: { count: 92400, mean: 142_500_000 } }, // 142.5 ms in ns
    },
    {
      interval: { endTime: "2026-11-21T00:00:00.000Z" },
      value: { distributionValue: { count: 104600, mean: 136_200_000 } }, // 136.2 ms in ns
    },
  ],
  [FIREBASE_CANONICAL_METRIC_KEYS.STORAGE_BYTES]: [
    {
      interval: { endTime: "2026-11-20T00:00:00.000Z" },
      value: { int64Value: "5368709120" },
    },
    {
      interval: { endTime: "2026-11-21T00:00:00.000Z" },
      value: { int64Value: "5512495104" },
    },
  ],
  [FIREBASE_CANONICAL_METRIC_KEYS.RULES_EVALUATIONS_ALLOW]: [
    {
      interval: { startTime: "2026-11-19T00:00:00.000Z", endTime: "2026-11-20T00:00:00.000Z" },
      value: { int64Value: "345000" },
    },
    {
      interval: { startTime: "2026-11-20T00:00:00.000Z", endTime: "2026-11-21T00:00:00.000Z" },
      value: { int64Value: "381000" },
    },
  ],
  [FIREBASE_CANONICAL_METRIC_KEYS.RULES_EVALUATIONS_DENY]: [
    {
      interval: { startTime: "2026-11-19T00:00:00.000Z", endTime: "2026-11-20T00:00:00.000Z" },
      value: { int64Value: "215" },
    },
    {
      interval: { startTime: "2026-11-20T00:00:00.000Z", endTime: "2026-11-21T00:00:00.000Z" },
      value: { int64Value: "184" },
    },
  ],
  [FIREBASE_CANONICAL_METRIC_KEYS.RULES_EVALUATIONS_ERROR]: [
    {
      interval: { startTime: "2026-11-19T00:00:00.000Z", endTime: "2026-11-20T00:00:00.000Z" },
      value: { int64Value: "0" },
    },
    {
      interval: { startTime: "2026-11-20T00:00:00.000Z", endTime: "2026-11-21T00:00:00.000Z" },
      value: { int64Value: "0" },
    },
  ],
};

function resolveGcpProjectIdFromResourceId(externalResourceId: string): string {
  return externalResourceId.startsWith("firebase-project:")
    ? externalResourceId.slice("firebase-project:".length)
    : externalResourceId;
}

/**
 * Strictly read-only Firebase / Google Cloud Monitoring API v3 provider adapter.
 * Uses `https://www.googleapis.com/auth/monitoring.read` for cryptographically enforced
 * read-only telemetry access and unconditionally rejects Firebase Admin SDK service accounts.
 */
export function createFirebaseMonitoringReadOnlyAdapter(
  catalogEntry: ProviderCatalogEntry,
  options?: { fetchFn?: typeof fetch },
): ReadOnlyProviderAdapter {
  const fetchFn = options?.fetchFn;

  const adapter: ReadOnlyProviderAdapter = {
    providerKey: FIREBASE_MONITORING_PROVIDER_KEY,
    displayName: catalogEntry.displayName,
    category: catalogEntry.category,
    authMode: catalogEntry.authMode,
    catalogEntry,
    readOnlyGuaranteed: true,

    async validateCredentials(
      context: ReadOnlyProviderContext,
    ): Promise<ProviderCredentialValidationResult> {
      const { accessToken } = assertFirebaseMonitoringCredentialAndSimulation(context);

      if (
        shouldExecuteLiveGoogleApi(context, Boolean(fetchFn), FIREBASE_MONITORING_PROVIDER_KEY) &&
        hasMonitoringReadScope(context.grantedScopes)
      ) {
        await executeGoogleReadRequest({
          providerKey: FIREBASE_MONITORING_PROVIDER_KEY,
          url: `${GOOGLE_CLOUD_MONITORING_V3_BASE}/projects/avenor-cloud-prod/monitoredResourceDescriptors`,
          method: "GET",
          accessToken,
          fetchFn,
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
        externalAccountId: `firebase_monitoring_${context.workspaceId.slice(0, 8)}`,
        externalAccountLabel: "Firebase / Google Cloud Monitoring (monitoring.read)",
        grantedScopes: context.grantedScopes,
        missingRequiredScopes,
        healthStatus: missingRequiredScopes.length > 0 ? "PERMISSION_MISSING" : "HEALTHY",
        capabilities,
      };
    },

    async discoverResources(
      context: ReadOnlyProviderContext,
    ): Promise<readonly DiscoveredExternalResource[]> {
      const projects = await discoverFirebaseMonitoredProjects(context, { fetchFn });
      return mapFirebaseMonitoredProjectsToExternalResources(projects, context.grantedScopes);
    },

    async getCapabilities(context: ReadOnlyProviderContext) {
      assertFirebaseMonitoringCredentialAndSimulation(context);
      const effectiveScopes =
        context.simulationScenario === "missing_scope" ? [] : context.grantedScopes;
      return evaluateCapabilityMatrix(catalogEntry.capabilities, effectiveScopes, {
        providerPlanTier: context.providerPlanTier ?? "pro",
      });
    },

    async getConnectionHealth(
      context: ReadOnlyProviderContext,
    ): Promise<ProviderConnectionHealthSnapshot> {
      const checkedAtIso = new Date().toISOString();
      const started = Date.now();

      try {
        const { accessToken } = assertFirebaseMonitoringCredentialAndSimulation(context);
        if (
          !hasMonitoringReadScope(context.grantedScopes) ||
          context.simulationScenario === "missing_scope"
        ) {
          return {
            providerKey: FIREBASE_MONITORING_PROVIDER_KEY,
            status: "PERMISSION_MISSING",
            uxState: "permission_insufficient",
            checkedAtIso,
            latencyMs: Date.now() - started,
            grantedScopes: context.grantedScopes,
            missingScopes: [GOOGLE_MONITORING_READ_SCOPE],
            errorCode: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
            message: `Missing required Google OAuth scope (${GOOGLE_MONITORING_READ_SCOPE}).`,
          };
        }

        if (context.simulationScenario === "stale_data") {
          return {
            providerKey: FIREBASE_MONITORING_PROVIDER_KEY,
            status: "STALE",
            uxState: "stale_cached",
            checkedAtIso,
            latencyMs: Date.now() - started,
            grantedScopes: context.grantedScopes,
            missingScopes: [],
            message:
              "Google Cloud Monitoring API v3 is reachable, but time-series alignment points are lagging beyond expected freshness.",
          };
        }

        if (
          shouldExecuteLiveGoogleApi(context, Boolean(fetchFn), FIREBASE_MONITORING_PROVIDER_KEY)
        ) {
          await executeGoogleReadRequest({
            providerKey: FIREBASE_MONITORING_PROVIDER_KEY,
            url: `${GOOGLE_CLOUD_MONITORING_V3_BASE}/projects/avenor-cloud-prod/monitoredResourceDescriptors`,
            method: "GET",
            accessToken,
            fetchFn,
          });
        }

        return {
          providerKey: FIREBASE_MONITORING_PROVIDER_KEY,
          status: "HEALTHY",
          uxState: "connected_healthy",
          checkedAtIso,
          latencyMs: Date.now() - started,
          grantedScopes: context.grantedScopes,
          missingScopes: [],
          message:
            "Google Cloud Monitoring v3 read-only connection verified (`monitoring.read`; zero data-plane or Admin SDK user access).",
        };
      } catch (err) {
        const adapterErr =
          err instanceof ProviderAdapterError
            ? err
            : new ProviderAdapterError({
                providerKey: FIREBASE_MONITORING_PROVIDER_KEY,
                code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
                message:
                  err instanceof Error
                    ? err.message
                    : "Google Cloud Monitoring health check failed.",
              });

        return {
          providerKey: FIREBASE_MONITORING_PROVIDER_KEY,
          status: adapterErr.healthStatus,
          uxState: adapterErr.uxState,
          checkedAtIso,
          latencyMs: Date.now() - started,
          grantedScopes: context.grantedScopes,
          missingScopes: adapterErr.missingScopes,
          errorCode: adapterErr.code,
          message: adapterErr.message,
        };
      }
    },

    async readMetrics(
      context: ReadOnlyProviderContext,
      query: ProviderMetricQuery,
    ): Promise<ProviderMetricReadResult> {
      const { accessToken } = assertFirebaseMonitoringCredentialAndSimulation(context);
      const observedAtIso = new Date().toISOString();

      // 1. Registered user count is explicitly unsupported via Cloud Monitoring (Admin SDK prohibited)
      if (
        query.metricKey === "firebase.registered_users" ||
        query.metricKey === "registered_users" ||
        query.capabilityKey === "user_count_posture"
      ) {
        return {
          providerKey: FIREBASE_MONITORING_PROVIDER_KEY,
          externalResourceId: query.externalResourceId,
          capabilityKey: query.capabilityKey,
          metricKey: query.metricKey,
          capabilityStatus: "UNSUPPORTED_BY_PROVIDER",
          uxState: "unsupported_plan",
          observedAtIso,
          sourceFreshnessMinutes: 0,
          provenanceLabel: `Google Cloud Monitoring v3 • ${query.externalResourceId}`,
          statusExplanation:
            "Google Cloud Monitoring `monitoring.read` does not expose a registered Firebase Auth user headcount descriptor, and Avenor refuses to use the privileged Firebase Admin SDK (`auth.listUsers()`) to enumerate user PII.",
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

      if (
        !hasMonitoringReadScope(context.grantedScopes) ||
        context.simulationScenario === "missing_scope"
      ) {
        return {
          providerKey: FIREBASE_MONITORING_PROVIDER_KEY,
          externalResourceId: query.externalResourceId,
          capabilityKey: query.capabilityKey,
          metricKey: query.metricKey,
          capabilityStatus: "MISSING_PERMISSION",
          uxState: "permission_insufficient",
          observedAtIso,
          sourceFreshnessMinutes: 30,
          provenanceLabel: `Google Cloud Monitoring v3 • ${query.externalResourceId}`,
          statusExplanation: `Missing required Google OAuth scope \`${GOOGLE_MONITORING_READ_SCOPE}\`.`,
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

      const spec =
        FIREBASE_MONITORING_DESCRIPTOR_SPECS[query.metricKey as FirebaseCanonicalMetricKey] ??
        FIREBASE_MONITORING_DESCRIPTOR_SPECS[
          FIREBASE_CANONICAL_METRIC_KEYS.FIRESTORE_DOCUMENT_READS
        ];

      const gcpProjectId = resolveGcpProjectIdFromResourceId(query.externalResourceId);

      let rawPoints: readonly CloudMonitoringRawPoint[] = [];
      let detectedKind = spec.metricKind;

      if (
        !shouldExecuteLiveGoogleApi(context, Boolean(fetchFn), FIREBASE_MONITORING_PROVIDER_KEY)
      ) {
        if (gcpProjectId !== "avenor-cloud-prod") {
          throw new ProviderAdapterError({
            providerKey: FIREBASE_MONITORING_PROVIDER_KEY,
            code: PROVIDER_ERROR_CODES.RESOURCE_NOT_FOUND,
            message: `Firebase / GCP project "${gcpProjectId}" was not found.`,
          });
        }
        rawPoints = DETERMINISTIC_FIREBASE_RAW_POINTS[spec.canonicalMetricKey] ?? [];
      } else {
        const alignmentPeriod = query.granularity === "hourly" ? "3600s" : "86400s";
        const filterParts = [`metric.type = "${spec.gcpMetricType}"`];
        if (spec.additionalFilter) {
          filterParts.push(spec.additionalFilter);
        }

        const collectedPoints: CloudMonitoringRawPoint[] = [];
        let pageToken: string | undefined;
        let pages = 0;

        do {
          const tsUrl = new URL(
            `${GOOGLE_CLOUD_MONITORING_V3_BASE}/projects/${encodeURIComponent(gcpProjectId)}/timeSeries`,
          );
          tsUrl.searchParams.set("filter", filterParts.join(" AND "));
          tsUrl.searchParams.set("interval.startTime", query.startDateIso);
          tsUrl.searchParams.set("interval.endTime", query.endDateIso);
          tsUrl.searchParams.set("aggregation.alignmentPeriod", alignmentPeriod);
          if (pageToken) {
            tsUrl.searchParams.set("pageToken", pageToken);
          }

          const payload = await executeGoogleReadRequest<CloudMonitoringTimeSeriesListResponse>({
            providerKey: FIREBASE_MONITORING_PROVIDER_KEY,
            url: tsUrl.toString(),
            method: "GET",
            accessToken,
            fetchFn,
          });

          for (const series of payload.timeSeries ?? []) {
            if (series.metricKind) {
              detectedKind = series.metricKind;
            }
            for (const pt of series.points ?? []) {
              collectedPoints.push(pt);
            }
          }

          pageToken = payload.nextPageToken;
          pages += 1;
        } while (pageToken && pages < 5);

        rawPoints = collectedPoints;
      }

      const normalized = normalizeCloudMonitoringPoints(rawPoints, detectedKind, {
        conversion: spec.valueUnitConversion,
        gaugeRollup:
          spec.canonicalMetricKey === FIREBASE_CANONICAL_METRIC_KEYS.FUNCTION_EXECUTION_TIME_MS
            ? "GAUGE_MEAN"
            : "GAUGE_LATEST",
      });

      return {
        providerKey: FIREBASE_MONITORING_PROVIDER_KEY,
        externalResourceId: query.externalResourceId,
        capabilityKey: query.capabilityKey,
        metricKey: query.metricKey,
        capabilityStatus: "SUPPORTED",
        uxState: "connected_healthy",
        observedAtIso,
        sourceFreshnessMinutes: 5,
        provenanceLabel: `Google Cloud Monitoring v3 • ${gcpProjectId} (${spec.gcpMetricType})`,
        statusExplanation:
          normalized.metricKind === "GAUGE"
            ? `Read-only GAUGE time series (${normalized.rollupStrategy}; latest=${normalized.latestValue ?? 0}, mean=${normalized.meanValue ?? 0}, max=${normalized.maxValue ?? 0}; sampled gauge points are never summed).`
            : normalized.metricKind === "CUMULATIVE"
              ? `Read-only CUMULATIVE time series converted to reset-safe interval deltas (counterResetsDetected=${normalized.counterResetsDetected}).`
              : `Read-only DELTA time series summed across aligned intervals (${normalized.summaryValue ?? 0}).`,
        points: normalized.points.map((pt) => ({
          timestampIso: pt.timestampIso,
          metricKey: query.metricKey,
          value: pt.value,
          unit: spec.unit,
          dimensions: {
            gcpProjectId,
            metricKind: normalized.metricKind,
            rollupStrategy: normalized.rollupStrategy,
          },
        })),
      };
    },
  };

  return adapter;
}
