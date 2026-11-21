import {
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ProviderMetricPoint,
  type ProviderMetricQuery,
  type ProviderMetricReadResult,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import {
  discoverSupabaseProjects,
  hasSupabaseAnalyticsReadScope,
  hasSupabaseProjectsReadScope,
} from "./discovery";
import {
  assertSupabaseCredentialAndSimulation,
  executeSupabaseReadOnlyGetJson,
  shouldExecuteLiveSupabaseApi,
} from "./http";
import {
  SUPABASE_API_BASE_URL,
  SUPABASE_CANONICAL_METRIC_KEYS,
  SUPABASE_PROVIDER_KEY,
  type SupabaseUsageTelemetryWindow,
} from "./types";

interface SupabaseApiUsageResponse {
  db_size_bytes?: number;
  storage_size_bytes?: number;
  active_connections?: number;
  aggregate_registered_auth_users_count?: number | null;
  users?: unknown[];
}

interface SupabaseApiAnalyticsCountsResponse {
  result?: Array<{
    timestamp?: string;
    total_rest_requests?: number;
    total_storage_requests?: number;
    total_realtime_requests?: number;
    total_auth_requests?: number;
    db_size_bytes?: number;
    storage_size_bytes?: number;
    active_connections?: number;
    aggregate_registered_auth_users_count?: number | null;
  }>;
}

export function getSupabaseMetricUnit(metricKey: string): string {
  switch (metricKey) {
    case SUPABASE_CANONICAL_METRIC_KEYS.DB_SIZE_BYTES:
    case SUPABASE_CANONICAL_METRIC_KEYS.STORAGE_SIZE_BYTES:
      return "bytes";
    default:
      return "count";
  }
}

const DETERMINISTIC_SUPABASE_USAGE_WINDOWS: readonly SupabaseUsageTelemetryWindow[] = [
  {
    timestampIso: "2026-11-20T00:00:00.000Z",
    dbSizeBytes: 854_589_440,
    storageSizeBytes: 3_221_225_472,
    activeConnections: 18,
    apiRequests: 142_800,
    authRequests: 19_450,
    registeredAuthUsers: 4_820,
    registeredAuthUsersSource: "ALLOWLISTED_AGGREGATE_USAGE_COUNTER",
  },
  {
    timestampIso: "2026-11-21T00:00:00.000Z",
    dbSizeBytes: 872_415_232,
    storageSizeBytes: 3_288_334_336,
    activeConnections: 22,
    apiRequests: 158_920,
    authRequests: 21_310,
    registeredAuthUsers: 4_865,
    registeredAuthUsersSource: "ALLOWLISTED_AGGREGATE_USAGE_COUNTER",
  },
];

export async function fetchSupabaseUsageTelemetryWindows(
  context: ReadOnlyProviderContext,
  options: {
    projectRef: string;
    startDateIso: string;
    endDateIso: string;
    fetchFn?: typeof fetch;
  },
): Promise<readonly SupabaseUsageTelemetryWindow[]> {
  const { token } = assertSupabaseCredentialAndSimulation(context);

  if (!shouldExecuteLiveSupabaseApi(context, Boolean(options.fetchFn))) {
    return DETERMINISTIC_SUPABASE_USAGE_WINDOWS;
  }

  const [usageSnapshot, countsPayload] = await Promise.all([
    executeSupabaseReadOnlyGetJson<SupabaseApiUsageResponse>({
      url: `${SUPABASE_API_BASE_URL}/projects/${encodeURIComponent(options.projectRef)}/usage`,
      apiToken: token,
      fetchFn: options.fetchFn,
    }),
    executeSupabaseReadOnlyGetJson<SupabaseApiAnalyticsCountsResponse>({
      url: `${SUPABASE_API_BASE_URL}/projects/${encodeURIComponent(options.projectRef)}/analytics/endpoints/usage.api-counts`,
      apiToken: token,
      fetchFn: options.fetchFn,
    }),
  ]);

  // Guard: If an upstream endpoint ever returned a raw `users` array instead of an aggregate count,
  // refuse to use it for registeredAuthUsers.
  const hasProhibitedRawUsersArray = Array.isArray(usageSnapshot?.users);
  const safeAggregateUsers =
    !hasProhibitedRawUsersArray &&
    typeof usageSnapshot?.aggregate_registered_auth_users_count === "number"
      ? usageSnapshot.aggregate_registered_auth_users_count
      : null;

  const rows = countsPayload?.result ?? [];
  if (rows.length === 0) {
    return [
      {
        timestampIso: options.endDateIso,
        dbSizeBytes:
          typeof usageSnapshot?.db_size_bytes === "number" ? usageSnapshot.db_size_bytes : 0,
        storageSizeBytes:
          typeof usageSnapshot?.storage_size_bytes === "number"
            ? usageSnapshot.storage_size_bytes
            : 0,
        activeConnections:
          typeof usageSnapshot?.active_connections === "number"
            ? usageSnapshot.active_connections
            : 0,
        apiRequests: 0,
        authRequests: 0,
        registeredAuthUsers: safeAggregateUsers,
        registeredAuthUsersSource:
          safeAggregateUsers !== null
            ? "ALLOWLISTED_AGGREGATE_USAGE_COUNTER"
            : "UNAVAILABLE_WITHOUT_RAW_AUTH_USERS_QUERY",
      },
    ];
  }

  return rows.map((row) => {
    const restReqs = typeof row.total_rest_requests === "number" ? row.total_rest_requests : 0;
    const storageReqs =
      typeof row.total_storage_requests === "number" ? row.total_storage_requests : 0;
    const realtimeReqs =
      typeof row.total_realtime_requests === "number" ? row.total_realtime_requests : 0;
    const authReqs = typeof row.total_auth_requests === "number" ? row.total_auth_requests : 0;

    const rowAggregateUsers =
      !hasProhibitedRawUsersArray && typeof row.aggregate_registered_auth_users_count === "number"
        ? row.aggregate_registered_auth_users_count
        : safeAggregateUsers;

    return {
      timestampIso: row.timestamp ?? options.endDateIso,
      dbSizeBytes:
        typeof row.db_size_bytes === "number"
          ? row.db_size_bytes
          : typeof usageSnapshot?.db_size_bytes === "number"
            ? usageSnapshot.db_size_bytes
            : 0,
      storageSizeBytes:
        typeof row.storage_size_bytes === "number"
          ? row.storage_size_bytes
          : typeof usageSnapshot?.storage_size_bytes === "number"
            ? usageSnapshot.storage_size_bytes
            : 0,
      activeConnections:
        typeof row.active_connections === "number"
          ? row.active_connections
          : typeof usageSnapshot?.active_connections === "number"
            ? usageSnapshot.active_connections
            : 0,
      apiRequests: restReqs + storageReqs + realtimeReqs,
      authRequests: authReqs,
      registeredAuthUsers: rowAggregateUsers,
      registeredAuthUsersSource:
        rowAggregateUsers !== null
          ? "ALLOWLISTED_AGGREGATE_USAGE_COUNTER"
          : "UNAVAILABLE_WITHOUT_RAW_AUTH_USERS_QUERY",
    };
  });
}

export async function readSupabaseProjectMetrics(
  context: ReadOnlyProviderContext,
  query: ProviderMetricQuery,
  options?: { fetchFn?: typeof fetch },
): Promise<ProviderMetricReadResult> {
  assertSupabaseCredentialAndSimulation(context);
  const observedAtIso = new Date().toISOString();
  const unit = getSupabaseMetricUnit(query.metricKey);

  if (
    !hasSupabaseProjectsReadScope(context.grantedScopes) ||
    !hasSupabaseAnalyticsReadScope(context.grantedScopes) ||
    context.simulationScenario === "missing_scope"
  ) {
    return {
      providerKey: SUPABASE_PROVIDER_KEY,
      externalResourceId: query.externalResourceId,
      capabilityKey: query.capabilityKey,
      metricKey: query.metricKey,
      capabilityStatus: "MISSING_PERMISSION",
      uxState: "permission_insufficient",
      observedAtIso,
      sourceFreshnessMinutes: 60,
      provenanceLabel: `Supabase Management API • ${query.externalResourceId}`,
      statusExplanation:
        "Missing required read-only scope `analytics:read` or `projects:read`. Re-authorize with viewer scopes.",
      points: [
        {
          timestampIso: query.endDateIso,
          metricKey: query.metricKey,
          value: null,
          unit,
        },
      ],
    };
  }

  const discovery = await discoverSupabaseProjects(context, {
    fetchFn: options?.fetchFn,
  });
  const project = discovery.projects.find((p) => p.ref === query.externalResourceId);
  if (!project) {
    throw new ProviderAdapterError({
      providerKey: SUPABASE_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.RESOURCE_NOT_FOUND,
      message: `Supabase project "${query.externalResourceId}" was not found.`,
    });
  }

  if (project.status === "INACTIVE") {
    return {
      providerKey: SUPABASE_PROVIDER_KEY,
      externalResourceId: query.externalResourceId,
      capabilityKey: query.capabilityKey,
      metricKey: query.metricKey,
      capabilityStatus: "PLAN_RESTRICTED",
      uxState: "provider_error",
      observedAtIso,
      sourceFreshnessMinutes: 60,
      provenanceLabel: `Supabase Management API • ${project.name}`,
      statusExplanation:
        "Supabase project is currently INACTIVE (paused). Avenor renders a transparent non-numeric state and never triggers project restoration.",
      points: [
        {
          timestampIso: query.endDateIso,
          metricKey: query.metricKey,
          value: null,
          unit,
        },
      ],
    };
  }

  const windows = await fetchSupabaseUsageTelemetryWindows(context, {
    projectRef: query.externalResourceId,
    startDateIso: query.startDateIso,
    endDateIso: query.endDateIso,
    fetchFn: options?.fetchFn,
  });

  if (query.metricKey === SUPABASE_CANONICAL_METRIC_KEYS.REGISTERED_AUTH_USERS) {
    const hasSafeAggregate = windows.some(
      (w) =>
        w.registeredAuthUsers !== null &&
        w.registeredAuthUsersSource === "ALLOWLISTED_AGGREGATE_USAGE_COUNTER",
    );

    if (!hasSafeAggregate || context.simulationScenario === "plan_restricted") {
      return {
        providerKey: SUPABASE_PROVIDER_KEY,
        externalResourceId: query.externalResourceId,
        capabilityKey: query.capabilityKey,
        metricKey: query.metricKey,
        capabilityStatus: "UNSUPPORTED_BY_PROVIDER",
        uxState: "unsupported_plan",
        observedAtIso,
        sourceFreshnessMinutes: 60,
        provenanceLabel: `Supabase Management API • ${project.name}`,
        statusExplanation:
          "Aggregate registered Auth user count is unavailable without querying raw `auth.users` rows. Avenor refuses to inspect `auth.users` or conflate GoTrue HTTP request counts (`supabase.auth_requests`) with registered user headcount.",
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

    return {
      providerKey: SUPABASE_PROVIDER_KEY,
      externalResourceId: query.externalResourceId,
      capabilityKey: query.capabilityKey,
      metricKey: query.metricKey,
      capabilityStatus: "SUPPORTED",
      uxState: "connected_healthy",
      observedAtIso,
      sourceFreshnessMinutes: 30,
      provenanceLabel: `Supabase Management API • ${project.name} (${project.region})`,
      statusExplanation:
        "Aggregate registered Auth user count read from allowlisted Management API usage counter (zero raw `auth.users` rows or PII accessed; strictly separate from `supabase.auth_requests`).",
      points: windows.map((w) => ({
        timestampIso: w.timestampIso,
        metricKey: query.metricKey,
        value: w.registeredAuthUsers,
        unit: "count",
        dimensions: {
          projectRef: project.ref,
          region: project.region,
        },
      })),
    };
  }

  const points: ProviderMetricPoint[] = windows.map((w) => {
    let value: number | null = null;
    switch (query.metricKey) {
      case SUPABASE_CANONICAL_METRIC_KEYS.DB_SIZE_BYTES:
        value = w.dbSizeBytes;
        break;
      case SUPABASE_CANONICAL_METRIC_KEYS.STORAGE_SIZE_BYTES:
        value = w.storageSizeBytes;
        break;
      case SUPABASE_CANONICAL_METRIC_KEYS.ACTIVE_CONNECTIONS:
        value = w.activeConnections;
        break;
      case SUPABASE_CANONICAL_METRIC_KEYS.API_REQUESTS:
        value = w.apiRequests;
        break;
      case SUPABASE_CANONICAL_METRIC_KEYS.AUTH_REQUESTS:
        value = w.authRequests;
        break;
      default:
        value = w.dbSizeBytes;
        break;
    }

    return {
      timestampIso: w.timestampIso,
      metricKey: query.metricKey,
      value,
      unit,
      dimensions: {
        projectRef: project.ref,
        region: project.region,
      },
    };
  });

  return {
    providerKey: SUPABASE_PROVIDER_KEY,
    externalResourceId: query.externalResourceId,
    capabilityKey: query.capabilityKey,
    metricKey: query.metricKey,
    capabilityStatus: "SUPPORTED",
    uxState: "connected_healthy",
    observedAtIso,
    sourceFreshnessMinutes: 30,
    provenanceLabel: `Supabase Management API • ${project.name} (${project.region})`,
    statusExplanation:
      query.metricKey === SUPABASE_CANONICAL_METRIC_KEYS.AUTH_REQUESTS
        ? "GoTrue Auth gateway HTTP request volume (`supabase.auth_requests`). Represents authentication traffic, not registered user headcount."
        : "Read-only Supabase Management API v1 telemetry.",
    points,
  };
}
