import {
  type AuthenticatedSessionContext,
  authorizeProjectAccess,
  authorizeWorkspaceAccess,
  getLogicalProjectById,
  listWorkspaceProjects,
} from "@avenor/auth";
import { assertServerRuntime } from "@avenor/config";
import { dbQuery } from "@avenor/database";
import type { AvenorUxState, EnvironmentType, LogicalProjectSummary } from "@avenor/types";
import {
  aggregateMetricObservations,
  computeDimensionIdentity,
  queryMetricObservations,
  type StoredMetricObservation,
} from "@/lib/metrics";
import {
  classifyReportDataFreshness,
  type ReportCacheEnvelopeMetadata,
  sharedReportCache,
} from "./cache";
import {
  computeMetricDeltaComparison,
  type PortfolioMetricComparison,
  type ResolvedPortfolioDateWindow,
  resolvePortfolioDateWindow,
} from "./portfolio-service";

export type BackendProviderFilter = "all" | "neon" | "supabase" | "firebase-monitoring";

export interface BackendMappedSourceSummary {
  connectedResourceId: string;
  providerConnectionId: string;
  providerKey: "neon" | "supabase" | "firebase-monitoring";
  externalResourceId: string;
  displayName: string;
  connectionStatus: string;
  environmentId: string | null;
  environmentName: string | null;
  environmentType: EnvironmentType | null;
  lastSyncAtIso: string | null;
  metadata: Record<string, unknown>;
}

export interface BackendStorageGrowthSeries {
  providerKey: "neon" | "supabase" | "firebase-monitoring";
  metricKey: string;
  label: string;
  unit: "bytes";
  latestBytes: number | null;
  earliestBytes: number | null;
  growthBytes: number | null;
  growthPercent: number | null;
  sampleDays: number;
  uxState: AvenorUxState;
  note: string;
}

export interface BackendAuthSemanticsItem {
  key:
    | "supabase_registered_auth_users"
    | "supabase_auth_requests"
    | "ga4_active_visitors"
    | "neon_registered_users"
    | "firebase_registered_users";
  label: string;
  providerKey: "supabase" | "ga4" | "neon" | "firebase-monitoring";
  value: number | null;
  status: "SUPPORTED" | "UNAVAILABLE" | "NOT_CONNECTED" | "PLAN_RESTRICTED" | "MISSING_PERMISSION";
  unit: "accounts" | "requests" | "visitors";
  semanticClarification: string;
}

export interface BackendDailyTrendPoint {
  date: string;
  neonInstantaneousStorageBytes: number | null;
  neonComputeUnitSeconds: number | null;
  supabaseDbSizeBytes: number | null;
  supabaseApiRequests: number | null;
  supabaseAuthRequests: number | null;
  supabaseRegisteredAuthUsers: number | null;
  firebaseFirestoreReads: number | null;
  firebaseFunctionInvocations: number | null;
  firebaseFunctionErrors: number | null;
  firebaseStorageBytes: number | null;
}

export interface ProjectBackendIntelligenceReportDto {
  project: LogicalProjectSummary;
  dateWindow: ResolvedPortfolioDateWindow;
  environmentId: string | null;
  uxState: AvenorUxState;
  freshnessLabel: string;
  sources: readonly BackendMappedSourceSummary[];
  neon: {
    connected: boolean;
    uxState: AvenorUxState;
    instantaneousStorageBytes: number | null;
    storageConsumptionBytesMonth: number | null;
    computeUnitSeconds: number | null;
    activeTimeSeconds: number | null;
    networkTransferBytes: number | null;
    branchCount: number | null;
    comparisons: {
      computeUnitSeconds: PortfolioMetricComparison;
      storageConsumptionBytesMonth: PortfolioMetricComparison;
    };
    unitDisclaimer: string;
  };
  supabase: {
    connected: boolean;
    uxState: AvenorUxState;
    dbSizeBytes: number | null;
    storageSizeBytes: number | null;
    activeConnections: number | null;
    apiRequests: number | null;
    authRequests: number | null;
    registeredAuthUsers: number | null;
    comparisons: {
      apiRequests: PortfolioMetricComparison;
      authRequests: PortfolioMetricComparison;
    };
  };
  firebase: {
    connected: boolean;
    uxState: AvenorUxState;
    firestoreReads: number | null;
    firestoreWrites: number | null;
    firestoreDeletes: number | null;
    firestoreActiveListeners: number | null;
    functionInvocations: number | null;
    functionErrors: number | null;
    functionErrorRatePercent: number | null;
    functionMeanExecutionTimeMs: number | null;
    storageBytes: number | null;
    comparisons: {
      firestoreReads: PortfolioMetricComparison;
      functionInvocations: PortfolioMetricComparison;
    };
  };
  storageGrowth: readonly BackendStorageGrowthSeries[];
  authSemanticsPanel: readonly BackendAuthSemanticsItem[];
  dailyTrend: readonly BackendDailyTrendPoint[];
  limitations: readonly string[];
  cacheMetadata: ReportCacheEnvelopeMetadata;
}

export interface WorkspaceBackendProjectRow {
  projectId: string;
  projectName: string;
  projectSlug: string;
  connectedBackendProviders: readonly ("neon" | "supabase" | "firebase-monitoring")[];
  uxState: AvenorUxState;
  neonInstantaneousStorageBytes: number | null;
  neonComputeUnitSeconds: number | null;
  supabaseDbSizeBytes: number | null;
  supabaseRegisteredAuthUsers: number | null;
  firebaseFunctionInvocations: number | null;
  firebaseFunctionErrorRatePercent: number | null;
  firebaseStorageBytes: number | null;
}

export interface WorkspaceBackendIntelligenceReportDto {
  workspaceId: string;
  dateWindow: ResolvedPortfolioDateWindow;
  uxState: AvenorUxState;
  connectedProjectCount: number;
  totalProjectCount: number;
  summary: {
    totalNeonComputeUnitSeconds: number | null;
    totalNeonInstantaneousStorageBytes: number | null;
    totalSupabaseDbSizeBytes: number | null;
    totalSupabaseApiRequests: number | null;
    totalFirebaseFirestoreReads: number | null;
    totalFirebaseFunctionInvocations: number | null;
    totalFirebaseFunctionErrors: number | null;
  };
  projects: readonly WorkspaceBackendProjectRow[];
  unitSeparationNotice: string;
  cacheMetadata: ReportCacheEnvelopeMetadata;
}

export interface BackendReportQueryInput {
  workspaceId?: string;
  preset?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  environmentId?: string | null;
  compare?: boolean;
  bypassCache?: boolean;
}

const BACKEND_PROVIDER_KEY_LIST = ["neon", "supabase", "firebase-monitoring"] as const;

function computeGaugeStorageGrowth(
  observations: readonly StoredMetricObservation[],
  providerKey: "neon" | "supabase" | "firebase-monitoring",
  metricKey: string,
  label: string,
  note: string,
): BackendStorageGrowthSeries {
  const byDate = new Map<string, number>();
  for (const obs of observations) {
    if (obs.canonicalMetricKey !== metricKey || obs.numericValue === null) {
      continue;
    }
    const day = obs.periodStartDate.slice(0, 10);
    // Keep latest reading for that day (never sum gauge points across same day)
    byDate.set(day, obs.numericValue);
  }

  const dates = Array.from(byDate.keys()).sort();
  if (dates.length === 0) {
    return {
      providerKey,
      metricKey,
      label,
      unit: "bytes",
      latestBytes: null,
      earliestBytes: null,
      growthBytes: null,
      growthPercent: null,
      sampleDays: 0,
      uxState: "empty_filtered",
      note,
    };
  }

  const earliestDate = dates[0];
  const latestDate = dates[dates.length - 1];
  const earliestBytes = earliestDate ? (byDate.get(earliestDate) ?? null) : null;
  const latestBytes = latestDate ? (byDate.get(latestDate) ?? null) : null;
  const growthBytes =
    earliestBytes !== null && latestBytes !== null && dates.length >= 2
      ? Math.round((latestBytes - earliestBytes) * 100) / 100
      : null;
  const growthPercent =
    growthBytes !== null && earliestBytes !== null && earliestBytes > 0
      ? Math.round((growthBytes / earliestBytes) * 10_000) / 100
      : null;

  return {
    providerKey,
    metricKey,
    label,
    unit: "bytes",
    latestBytes,
    earliestBytes,
    growthBytes,
    growthPercent,
    sampleDays: dates.length,
    uxState: "connected_healthy",
    note,
  };
}

function aggregateSingleMetric(
  observations: readonly StoredMetricObservation[],
  canonicalKey: string,
): number | null {
  const filtered = observations.filter(
    (o) => o.canonicalMetricKey === canonicalKey && o.numericValue !== null,
  );
  if (filtered.length === 0) {
    return null;
  }
  const agg = aggregateMetricObservations({
    canonicalMetricKey: canonicalKey,
    observations: filtered,
  });
  return agg.value;
}

export async function getProjectBackendIntelligenceReport(
  session: AuthenticatedSessionContext | null,
  projectId: string,
  query: BackendReportQueryInput = {},
): Promise<ProjectBackendIntelligenceReportDto> {
  assertServerRuntime("getProjectBackendIntelligenceReport");

  const access = await authorizeProjectAccess({
    session,
    projectId,
    expectedWorkspaceId: query.workspaceId ?? session?.activeWorkspace.id,
    requiredPermission: "project:read",
  });
  const project = await getLogicalProjectById(session, access.projectId, access.workspaceId);

  const dateWindow = resolvePortfolioDateWindow({
    preset: query.preset ?? "28d",
    startDate: query.startDate ?? null,
    endDate: query.endDate ?? null,
    compare: query.compare ?? true,
  });
  const environmentId = query.environmentId?.trim() || null;
  const totalDimHash = computeDimensionIdentity({}).hash;

  const cached = await sharedReportCache.getOrLoad<
    Omit<ProjectBackendIntelligenceReportDto, "cacheMetadata">
  >(
    {
      organizationId: access.organizationId,
      workspaceId: access.workspaceId,
      projectId: project.id,
      environmentId,
      role: access.role,
      surface: "project_control_center",
      startDate: dateWindow.startDate,
      endDate: dateWindow.endDate,
      compareEnabled: dateWindow.compareEnabled,
      filters: {
        reportKind: "project_backend_intelligence",
        preset: dateWindow.preset,
      },
    },
    async () => {
      const mappedRes = await dbQuery<{
        connected_resource_id: string;
        provider_connection_id: string;
        provider_key: string;
        external_resource_id: string;
        display_name: string;
        connection_status: string;
        environment_id: string | null;
        environment_name: string | null;
        environment_type: EnvironmentType | null;
        last_sync_at: Date | null;
        metadata: Record<string, unknown> | null;
      }>(
        `SELECT
           cr.id AS connected_resource_id,
           cr.provider_connection_id,
           pc.provider_key,
           cr.external_resource_id,
           cr.display_name,
           pc.status AS connection_status,
           rm.environment_id,
           pe.name AS environment_name,
           pe.environment_type,
           pc.last_sync_at,
           cr.metadata
         FROM resource_mappings rm
         INNER JOIN connected_resources cr ON cr.id = rm.connected_resource_id
         INNER JOIN provider_connections pc ON pc.id = cr.provider_connection_id
         LEFT JOIN project_environments pe ON pe.id = rm.environment_id
         WHERE rm.workspace_id = $1
           AND rm.project_id = $2
           AND pc.provider_key = ANY($3::text[])
           AND pc.status != 'DISCONNECTED'
           AND ($4::text IS NULL OR rm.environment_id = $4)
         ORDER BY pc.provider_key ASC, cr.display_name ASC`,
        [access.workspaceId, project.id, [...BACKEND_PROVIDER_KEY_LIST], environmentId],
      );

      const sources: BackendMappedSourceSummary[] = mappedRes.rows.map((r) => ({
        connectedResourceId: r.connected_resource_id,
        providerConnectionId: r.provider_connection_id,
        providerKey: r.provider_key as "neon" | "supabase" | "firebase-monitoring",
        externalResourceId: r.external_resource_id,
        displayName: r.display_name,
        connectionStatus: r.connection_status,
        environmentId: r.environment_id,
        environmentName: r.environment_name,
        environmentType: r.environment_type,
        lastSyncAtIso: r.last_sync_at ? new Date(r.last_sync_at).toISOString() : null,
        metadata: r.metadata ?? {},
      }));

      const backendMetricKeys = [
        "neon.compute_unit_seconds",
        "neon.active_time_seconds",
        "neon.storage_consumption_bytes_month",
        "neon.instantaneous_storage_bytes",
        "neon.network_transfer_bytes",
        "neon.branch_count",
        "supabase.db_size_bytes",
        "supabase.storage_size_bytes",
        "supabase.active_connections",
        "supabase.api_requests",
        "supabase.auth_requests",
        "supabase.registered_auth_users",
        "firebase.firestore_document_reads",
        "firebase.firestore_document_writes",
        "firebase.firestore_document_deletes",
        "firebase.firestore_active_listeners",
        "firebase.function_invocations",
        "firebase.function_errors",
        "firebase.function_execution_time_ms",
        "firebase.storage_bytes",
        "ga4.active_users",
      ];

      const [currentObs, previousObs] = await Promise.all([
        queryMetricObservations({
          organizationId: access.organizationId,
          workspaceId: access.workspaceId,
          projectId: project.id,
          environmentId: environmentId ?? undefined,
          canonicalMetricKeys: backendMetricKeys,
          periodStartDate: dateWindow.startDate,
          periodEndDate: dateWindow.endDate,
          granularity: "DAILY",
          dimensionKeyHash: totalDimHash,
        }),
        dateWindow.compareEnabled && dateWindow.compareStartDate && dateWindow.compareEndDate
          ? queryMetricObservations({
              organizationId: access.organizationId,
              workspaceId: access.workspaceId,
              projectId: project.id,
              environmentId: environmentId ?? undefined,
              canonicalMetricKeys: [
                "neon.compute_unit_seconds",
                "neon.storage_consumption_bytes_month",
                "supabase.api_requests",
                "supabase.auth_requests",
                "firebase.firestore_document_reads",
                "firebase.function_invocations",
              ],
              periodStartDate: dateWindow.compareStartDate,
              periodEndDate: dateWindow.compareEndDate,
              granularity: "DAILY",
              dimensionKeyHash: totalDimHash,
            })
          : Promise.resolve([] as StoredMetricObservation[]),
      ]);

      const neonSources = sources.filter((s) => s.providerKey === "neon");
      const supabaseSources = sources.filter((s) => s.providerKey === "supabase");
      const firebaseSources = sources.filter((s) => s.providerKey === "firebase-monitoring");

      const neonConnected =
        neonSources.length > 0 || currentObs.some((o) => o.canonicalMetricKey.startsWith("neon."));
      const supabaseConnected =
        supabaseSources.length > 0 ||
        currentObs.some((o) => o.canonicalMetricKey.startsWith("supabase."));
      const firebaseConnected =
        firebaseSources.length > 0 ||
        currentObs.some((o) => o.canonicalMetricKey.startsWith("firebase."));

      // Aggregate Neon
      const neonInstantaneousStorageBytes = aggregateSingleMetric(
        currentObs,
        "neon.instantaneous_storage_bytes",
      );
      const neonStorageConsumptionBytesMonth = aggregateSingleMetric(
        currentObs,
        "neon.storage_consumption_bytes_month",
      );
      const neonComputeUnitSeconds = aggregateSingleMetric(currentObs, "neon.compute_unit_seconds");
      const neonActiveTimeSeconds = aggregateSingleMetric(currentObs, "neon.active_time_seconds");
      const neonNetworkTransferBytes = aggregateSingleMetric(
        currentObs,
        "neon.network_transfer_bytes",
      );
      const neonBranchCount = aggregateSingleMetric(currentObs, "neon.branch_count");

      const prevNeonCuSeconds = aggregateSingleMetric(previousObs, "neon.compute_unit_seconds");
      const prevNeonStorageBytesMonth = aggregateSingleMetric(
        previousObs,
        "neon.storage_consumption_bytes_month",
      );

      // Aggregate Supabase
      const supabaseDbSizeBytes = aggregateSingleMetric(currentObs, "supabase.db_size_bytes");
      const supabaseStorageSizeBytes = aggregateSingleMetric(
        currentObs,
        "supabase.storage_size_bytes",
      );
      const supabaseActiveConnections = aggregateSingleMetric(
        currentObs,
        "supabase.active_connections",
      );
      const supabaseApiRequests = aggregateSingleMetric(currentObs, "supabase.api_requests");
      const supabaseAuthRequests = aggregateSingleMetric(currentObs, "supabase.auth_requests");
      const supabaseRegisteredAuthUsers = aggregateSingleMetric(
        currentObs,
        "supabase.registered_auth_users",
      );

      const prevSupabaseApiRequests = aggregateSingleMetric(previousObs, "supabase.api_requests");
      const prevSupabaseAuthRequests = aggregateSingleMetric(previousObs, "supabase.auth_requests");

      // Aggregate Firebase / Cloud Monitoring
      const firebaseFirestoreReads = aggregateSingleMetric(
        currentObs,
        "firebase.firestore_document_reads",
      );
      const firebaseFirestoreWrites = aggregateSingleMetric(
        currentObs,
        "firebase.firestore_document_writes",
      );
      const firebaseFirestoreDeletes = aggregateSingleMetric(
        currentObs,
        "firebase.firestore_document_deletes",
      );
      const firebaseFirestoreActiveListeners = aggregateSingleMetric(
        currentObs,
        "firebase.firestore_active_listeners",
      );
      const firebaseFunctionInvocations = aggregateSingleMetric(
        currentObs,
        "firebase.function_invocations",
      );
      const firebaseFunctionErrors = aggregateSingleMetric(currentObs, "firebase.function_errors");
      const firebaseFunctionMeanExecutionTimeMs = aggregateSingleMetric(
        currentObs,
        "firebase.function_execution_time_ms",
      );
      const firebaseStorageBytes = aggregateSingleMetric(currentObs, "firebase.storage_bytes");

      const firebaseFunctionErrorRatePercent =
        firebaseFunctionInvocations !== null &&
        firebaseFunctionInvocations > 0 &&
        firebaseFunctionErrors !== null
          ? Math.round((firebaseFunctionErrors / firebaseFunctionInvocations) * 10_000) / 100
          : null;

      const prevFirebaseReads = aggregateSingleMetric(
        previousObs,
        "firebase.firestore_document_reads",
      );
      const prevFirebaseInvocations = aggregateSingleMetric(
        previousObs,
        "firebase.function_invocations",
      );

      // GA4 active visitors for side-by-side semantic separation
      const ga4ActiveVisitors = aggregateSingleMetric(currentObs, "ga4.active_users");

      // Storage growth series (instantaneous byte gauges only—never bytes_month!)
      const storageGrowth: BackendStorageGrowthSeries[] = [];
      if (neonConnected) {
        storageGrowth.push(
          computeGaugeStorageGrowth(
            currentObs,
            "neon",
            "neon.instantaneous_storage_bytes",
            "Neon Instantaneous Branch Storage",
            "Point-in-time branch logical_size in bytes (distinct from billing bytes-month).",
          ),
        );
      }
      if (supabaseConnected) {
        storageGrowth.push(
          computeGaugeStorageGrowth(
            currentObs,
            "supabase",
            "supabase.db_size_bytes",
            "Supabase PostgreSQL Database Size",
            "Point-in-time Postgres database footprint in bytes via Management API.",
          ),
        );
        storageGrowth.push(
          computeGaugeStorageGrowth(
            currentObs,
            "supabase",
            "supabase.storage_size_bytes",
            "Supabase Object Storage Footprint",
            "Point-in-time object storage bytes without inspecting customer files.",
          ),
        );
      }
      if (firebaseConnected) {
        storageGrowth.push(
          computeGaugeStorageGrowth(
            currentObs,
            "firebase-monitoring",
            "firebase.storage_bytes",
            "Firebase / Cloud Storage Footprint",
            "GAUGE total_bytes from Google Cloud Monitoring v3 (never summed across samples).",
          ),
        );
      }

      // Honest User Count & Auth Semantics Panel
      const authSemanticsPanel: BackendAuthSemanticsItem[] = [
        {
          key: "supabase_registered_auth_users",
          label: "Supabase Registered Auth Accounts",
          providerKey: "supabase",
          value: supabaseRegisteredAuthUsers,
          status: !supabaseConnected
            ? "NOT_CONNECTED"
            : supabaseRegisteredAuthUsers !== null
              ? "SUPPORTED"
              : "UNAVAILABLE",
          unit: "accounts",
          semanticClarification:
            supabaseRegisteredAuthUsers !== null
              ? "Aggregate account count from allowlisted Supabase usage counter (zero raw auth.users PII). Distinct from GA4 visitors and GoTrue HTTP request volume."
              : "Unavailable without querying raw auth.users rows; Avenor never fabricates 0 or substitutes auth_requests.",
        },
        {
          key: "supabase_auth_requests",
          label: "Supabase GoTrue Auth HTTP Requests",
          providerKey: "supabase",
          value: supabaseAuthRequests,
          status: !supabaseConnected
            ? "NOT_CONNECTED"
            : supabaseAuthRequests !== null
              ? "SUPPORTED"
              : "UNAVAILABLE",
          unit: "requests",
          semanticClarification:
            "Authentication gateway HTTP request traffic (sign-ins, token refreshes, session checks) — NOT registered user headcount.",
        },
        {
          key: "ga4_active_visitors",
          label: "GA4 Active Visitors (Web/App Analytics)",
          providerKey: "ga4",
          value: ga4ActiveVisitors,
          status: ga4ActiveVisitors !== null ? "SUPPORTED" : "NOT_CONNECTED",
          unit: "visitors",
          semanticClarification:
            "Client-side analytics visitors measured by GA4 cookies/app instances — fundamentally different from backend registered auth accounts.",
        },
        {
          key: "neon_registered_users",
          label: "Neon Registered Application Users",
          providerKey: "neon",
          value: null,
          status: neonConnected ? "UNAVAILABLE" : "NOT_CONNECTED",
          unit: "accounts",
          semanticClarification:
            "Neon is a serverless Postgres engine with no control-plane user directory; Avenor refuses to query customer SQL tables.",
        },
        {
          key: "firebase_registered_users",
          label: "Firebase Auth Registered Users",
          providerKey: "firebase-monitoring",
          value: null,
          status: firebaseConnected ? "UNAVAILABLE" : "NOT_CONNECTED",
          unit: "accounts",
          semanticClarification:
            "Cloud Monitoring `monitoring.read` does not expose a registered user count descriptor, and Firebase Admin SDK (`auth.listUsers()`) is prohibited.",
        },
      ];

      // Build daily trend map
      const trendByDate = new Map<string, BackendDailyTrendPoint>();
      const ensureDay = (date: string): BackendDailyTrendPoint => {
        const existing = trendByDate.get(date);
        if (existing) {
          return existing;
        }
        const fresh: BackendDailyTrendPoint = {
          date,
          neonInstantaneousStorageBytes: null,
          neonComputeUnitSeconds: null,
          supabaseDbSizeBytes: null,
          supabaseApiRequests: null,
          supabaseAuthRequests: null,
          supabaseRegisteredAuthUsers: null,
          firebaseFirestoreReads: null,
          firebaseFunctionInvocations: null,
          firebaseFunctionErrors: null,
          firebaseStorageBytes: null,
        };
        trendByDate.set(date, fresh);
        return fresh;
      };

      for (const obs of currentObs) {
        if (obs.numericValue === null) {
          continue;
        }
        const day = obs.periodStartDate.slice(0, 10);
        const bucket = ensureDay(day);
        switch (obs.canonicalMetricKey) {
          case "neon.instantaneous_storage_bytes":
            bucket.neonInstantaneousStorageBytes = obs.numericValue;
            break;
          case "neon.compute_unit_seconds":
            bucket.neonComputeUnitSeconds = (bucket.neonComputeUnitSeconds ?? 0) + obs.numericValue;
            break;
          case "supabase.db_size_bytes":
            bucket.supabaseDbSizeBytes = obs.numericValue;
            break;
          case "supabase.api_requests":
            bucket.supabaseApiRequests = (bucket.supabaseApiRequests ?? 0) + obs.numericValue;
            break;
          case "supabase.auth_requests":
            bucket.supabaseAuthRequests = (bucket.supabaseAuthRequests ?? 0) + obs.numericValue;
            break;
          case "supabase.registered_auth_users":
            bucket.supabaseRegisteredAuthUsers = obs.numericValue;
            break;
          case "firebase.firestore_document_reads":
            bucket.firebaseFirestoreReads = (bucket.firebaseFirestoreReads ?? 0) + obs.numericValue;
            break;
          case "firebase.function_invocations":
            bucket.firebaseFunctionInvocations =
              (bucket.firebaseFunctionInvocations ?? 0) + obs.numericValue;
            break;
          case "firebase.function_errors":
            bucket.firebaseFunctionErrors = (bucket.firebaseFunctionErrors ?? 0) + obs.numericValue;
            break;
          case "firebase.storage_bytes":
            bucket.firebaseStorageBytes = obs.numericValue;
            break;
          default:
            break;
        }
      }

      const dailyTrend = Array.from(trendByDate.values()).sort((a, b) =>
        a.date.localeCompare(b.date),
      );

      const anyBackendConnected = neonConnected || supabaseConnected || firebaseConnected;
      const hasBackendObs = currentObs.some(
        (o) =>
          o.canonicalMetricKey.startsWith("neon.") ||
          o.canonicalMetricKey.startsWith("supabase.") ||
          o.canonicalMetricKey.startsWith("firebase."),
      );

      const latestSyncedIso =
        sources
          .map((s) => s.lastSyncAtIso)
          .filter((iso): iso is string => Boolean(iso))
          .sort()
          .pop() ?? null;

      const freshness = classifyReportDataFreshness({
        lastSuccessfulSyncIso: latestSyncedIso,
        freshnessWindowMinutes: 60,
        completenessState: hasBackendObs ? "COMPLETE" : "UNAVAILABLE",
      });

      const overallUxState: AvenorUxState = !anyBackendConnected
        ? "unconnected"
        : !hasBackendObs
          ? "empty_filtered"
          : freshness.uxState;

      const neonUxState: AvenorUxState = !neonConnected
        ? "unconnected"
        : neonComputeUnitSeconds !== null || neonInstantaneousStorageBytes !== null
          ? "connected_healthy"
          : "empty_filtered";

      const supabaseUxState: AvenorUxState = !supabaseConnected
        ? "unconnected"
        : supabaseDbSizeBytes !== null || supabaseApiRequests !== null
          ? "connected_healthy"
          : "empty_filtered";

      const firebaseUxState: AvenorUxState = !firebaseConnected
        ? "unconnected"
        : firebaseFirestoreReads !== null ||
            firebaseFunctionInvocations !== null ||
            firebaseStorageBytes !== null
          ? "connected_healthy"
          : "empty_filtered";

      const limitations: string[] = [
        "Strictly read-only control-plane and monitoring telemetry: zero arbitrary SQL execution, zero customer table rows, and zero raw auth.users PII.",
        "GAUGE metrics (DB size, storage footprint, active connections, active Firestore listeners, registered auth accounts) always use latest/mean/max aggregation and are never summed across dates.",
        "Neon compute-unit seconds (CU-seconds) are never mislabeled as CPU utilization percentage, and billing storage consumption (bytes-month) is kept strictly distinct from instantaneous branch size (bytes).",
      ];

      return {
        project,
        dateWindow,
        environmentId,
        uxState: overallUxState,
        freshnessLabel: freshness.badgeLabel,
        sources,
        neon: {
          connected: neonConnected,
          uxState: neonUxState,
          instantaneousStorageBytes: neonInstantaneousStorageBytes,
          storageConsumptionBytesMonth: neonStorageConsumptionBytesMonth,
          computeUnitSeconds: neonComputeUnitSeconds,
          activeTimeSeconds: neonActiveTimeSeconds,
          networkTransferBytes: neonNetworkTransferBytes,
          branchCount: neonBranchCount,
          comparisons: {
            computeUnitSeconds: computeMetricDeltaComparison(
              neonComputeUnitSeconds,
              prevNeonCuSeconds,
            ),
            storageConsumptionBytesMonth: computeMetricDeltaComparison(
              neonStorageConsumptionBytesMonth,
              prevNeonStorageBytesMonth,
            ),
          },
          unitDisclaimer:
            "CU-seconds reflect allocated serverless compute capacity over time (not CPU %); bytes-month consumption is separate from instantaneous branch storage bytes.",
        },
        supabase: {
          connected: supabaseConnected,
          uxState: supabaseUxState,
          dbSizeBytes: supabaseDbSizeBytes,
          storageSizeBytes: supabaseStorageSizeBytes,
          activeConnections: supabaseActiveConnections,
          apiRequests: supabaseApiRequests,
          authRequests: supabaseAuthRequests,
          registeredAuthUsers: supabaseRegisteredAuthUsers,
          comparisons: {
            apiRequests: computeMetricDeltaComparison(supabaseApiRequests, prevSupabaseApiRequests),
            authRequests: computeMetricDeltaComparison(
              supabaseAuthRequests,
              prevSupabaseAuthRequests,
            ),
          },
        },
        firebase: {
          connected: firebaseConnected,
          uxState: firebaseUxState,
          firestoreReads: firebaseFirestoreReads,
          firestoreWrites: firebaseFirestoreWrites,
          firestoreDeletes: firebaseFirestoreDeletes,
          firestoreActiveListeners: firebaseFirestoreActiveListeners,
          functionInvocations: firebaseFunctionInvocations,
          functionErrors: firebaseFunctionErrors,
          functionErrorRatePercent: firebaseFunctionErrorRatePercent,
          functionMeanExecutionTimeMs: firebaseFunctionMeanExecutionTimeMs,
          storageBytes: firebaseStorageBytes,
          comparisons: {
            firestoreReads: computeMetricDeltaComparison(firebaseFirestoreReads, prevFirebaseReads),
            functionInvocations: computeMetricDeltaComparison(
              firebaseFunctionInvocations,
              prevFirebaseInvocations,
            ),
          },
        },
        storageGrowth,
        authSemanticsPanel,
        dailyTrend,
        limitations,
      };
    },
    { bypassCache: query.bypassCache },
  );

  return {
    ...cached.value,
    cacheMetadata: cached.metadata,
  };
}

export async function getWorkspaceBackendIntelligenceReport(
  session: AuthenticatedSessionContext | null,
  query: BackendReportQueryInput = {},
): Promise<WorkspaceBackendIntelligenceReportDto> {
  assertServerRuntime("getWorkspaceBackendIntelligenceReport");

  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId: query.workspaceId ?? session?.activeWorkspace.id ?? "",
    requiredPermission: "workspace:read",
  });
  const dateWindow = resolvePortfolioDateWindow({
    preset: query.preset ?? "28d",
    startDate: query.startDate ?? null,
    endDate: query.endDate ?? null,
    compare: query.compare ?? true,
  });

  const cached = await sharedReportCache.getOrLoad<
    Omit<WorkspaceBackendIntelligenceReportDto, "cacheMetadata">
  >(
    {
      organizationId: access.organizationId,
      workspaceId: access.workspaceId,
      projectId: null,
      environmentId: null,
      role: access.role,
      surface: "portfolio_overview",
      startDate: dateWindow.startDate,
      endDate: dateWindow.endDate,
      compareEnabled: dateWindow.compareEnabled,
      filters: {
        reportKind: "workspace_backend_intelligence",
        preset: dateWindow.preset,
      },
    },
    async () => {
      const workspaceProjects = await listWorkspaceProjects(session, access.workspaceId, {
        includeArchived: false,
      });
      const rows: WorkspaceBackendProjectRow[] = [];

      let totalNeonCu = 0;
      let hasNeonCu = false;
      let totalNeonStorage = 0;
      let hasNeonStorage = false;
      let totalSupabaseDb = 0;
      let hasSupabaseDb = false;
      let totalSupabaseApi = 0;
      let hasSupabaseApi = false;
      let totalFirebaseReads = 0;
      let hasFirebaseReads = false;
      let totalFirebaseInv = 0;
      let hasFirebaseInv = false;
      let totalFirebaseErr = 0;
      let hasFirebaseErr = false;

      for (const proj of workspaceProjects) {
        const projReport = await getProjectBackendIntelligenceReport(session, proj.id, {
          workspaceId: access.workspaceId,
          preset: query.preset ?? "28d",
          startDate: dateWindow.startDate,
          endDate: dateWindow.endDate,
          compare: false,
        });

        const providers: ("neon" | "supabase" | "firebase-monitoring")[] = [];
        if (projReport.neon.connected) providers.push("neon");
        if (projReport.supabase.connected) providers.push("supabase");
        if (projReport.firebase.connected) providers.push("firebase-monitoring");

        if (projReport.neon.computeUnitSeconds !== null) {
          totalNeonCu += projReport.neon.computeUnitSeconds;
          hasNeonCu = true;
        }
        if (projReport.neon.instantaneousStorageBytes !== null) {
          totalNeonStorage += projReport.neon.instantaneousStorageBytes;
          hasNeonStorage = true;
        }
        if (projReport.supabase.dbSizeBytes !== null) {
          totalSupabaseDb += projReport.supabase.dbSizeBytes;
          hasSupabaseDb = true;
        }
        if (projReport.supabase.apiRequests !== null) {
          totalSupabaseApi += projReport.supabase.apiRequests;
          hasSupabaseApi = true;
        }
        if (projReport.firebase.firestoreReads !== null) {
          totalFirebaseReads += projReport.firebase.firestoreReads;
          hasFirebaseReads = true;
        }
        if (projReport.firebase.functionInvocations !== null) {
          totalFirebaseInv += projReport.firebase.functionInvocations;
          hasFirebaseInv = true;
        }
        if (projReport.firebase.functionErrors !== null) {
          totalFirebaseErr += projReport.firebase.functionErrors;
          hasFirebaseErr = true;
        }

        rows.push({
          projectId: proj.id,
          projectName: proj.name,
          projectSlug: proj.slug,
          connectedBackendProviders: providers,
          uxState: projReport.uxState,
          neonInstantaneousStorageBytes: projReport.neon.instantaneousStorageBytes,
          neonComputeUnitSeconds: projReport.neon.computeUnitSeconds,
          supabaseDbSizeBytes: projReport.supabase.dbSizeBytes,
          supabaseRegisteredAuthUsers: projReport.supabase.registeredAuthUsers,
          firebaseFunctionInvocations: projReport.firebase.functionInvocations,
          firebaseFunctionErrorRatePercent: projReport.firebase.functionErrorRatePercent,
          firebaseStorageBytes: projReport.firebase.storageBytes,
        });
      }

      const connectedProjectCount = rows.filter(
        (r) => r.connectedBackendProviders.length > 0,
      ).length;

      return {
        workspaceId: access.workspaceId,
        dateWindow,
        uxState: connectedProjectCount > 0 ? "connected_healthy" : "unconnected",
        connectedProjectCount,
        totalProjectCount: rows.length,
        summary: {
          totalNeonComputeUnitSeconds: hasNeonCu ? Math.round(totalNeonCu * 100) / 100 : null,
          totalNeonInstantaneousStorageBytes: hasNeonStorage
            ? Math.round(totalNeonStorage * 100) / 100
            : null,
          totalSupabaseDbSizeBytes: hasSupabaseDb ? Math.round(totalSupabaseDb * 100) / 100 : null,
          totalSupabaseApiRequests: hasSupabaseApi
            ? Math.round(totalSupabaseApi * 100) / 100
            : null,
          totalFirebaseFirestoreReads: hasFirebaseReads
            ? Math.round(totalFirebaseReads * 100) / 100
            : null,
          totalFirebaseFunctionInvocations: hasFirebaseInv
            ? Math.round(totalFirebaseInv * 100) / 100
            : null,
          totalFirebaseFunctionErrors: hasFirebaseErr
            ? Math.round(totalFirebaseErr * 100) / 100
            : null,
        },
        projects: rows,
        unitSeparationNotice:
          "Backend totals are grouped strictly by provider and canonical unit: Neon CU-seconds are never converted to CPU %, Neon bytes-month consumption is separate from instantaneous storage bytes, and registered auth accounts are never summed across disparate auth/analytics providers.",
      };
    },
    { bypassCache: query.bypassCache },
  );

  return {
    ...cached.value,
    cacheMetadata: cached.metadata,
  };
}
