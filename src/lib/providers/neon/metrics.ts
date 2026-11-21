import {
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ProviderMetricPoint,
  type ProviderMetricQuery,
  type ProviderMetricReadResult,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import { discoverNeonProjectsAndBranches, hasNeonConsumptionScope } from "./discovery";
import {
  assertNeonCredentialAndSimulation,
  executeNeonReadOnlyGetJson,
  shouldExecuteLiveNeonApi,
} from "./http";
import {
  NEON_API_BASE_URL,
  NEON_CANONICAL_METRIC_KEYS,
  NEON_PROVIDER_KEY,
  type NeonConsumptionPeriodWindow,
} from "./types";

const SECONDS_PER_30_DAY_BILLING_MONTH = 30 * 86_400; // 2,592,000 seconds

interface NeonApiConsumptionHistoryResponse {
  projects?: Array<{
    project_id?: string;
    periods?: Array<{
      period_id?: string;
      consumption?: Array<{
        timeframe_start?: string;
        timeframe_end?: string;
        active_time_seconds?: number;
        compute_time_seconds?: number;
        written_data_bytes?: number;
        synthetic_storage_size?: number;
        data_transfer_bytes?: number;
      }>;
    }>;
  }>;
}

/**
 * Converts Neon's cumulative `synthetic_storage_size` (which is reported in byte-seconds
 * over the consumption interval) into normalized `bytes_month` (`byteSeconds / 2,592,000`).
 * Strictly distinct from `neon.instantaneous_storage_bytes` (branch `logical_size` in bytes).
 */
export function convertNeonByteSecondsToBytesMonth(byteSeconds: number): number {
  if (!Number.isFinite(byteSeconds) || byteSeconds < 0) {
    return 0;
  }
  return Math.round((byteSeconds / SECONDS_PER_30_DAY_BILLING_MONTH) * 100) / 100;
}

export function getNeonMetricUnit(metricKey: string): string {
  switch (metricKey) {
    case NEON_CANONICAL_METRIC_KEYS.COMPUTE_UNIT_SECONDS:
    case NEON_CANONICAL_METRIC_KEYS.ACTIVE_TIME_SECONDS:
      return "seconds";
    case NEON_CANONICAL_METRIC_KEYS.STORAGE_CONSUMPTION_BYTES_MONTH:
      return "bytes_month";
    case NEON_CANONICAL_METRIC_KEYS.INSTANTANEOUS_STORAGE_BYTES:
    case NEON_CANONICAL_METRIC_KEYS.NETWORK_TRANSFER_BYTES:
    case NEON_CANONICAL_METRIC_KEYS.WRITTEN_DATA_BYTES:
      return "bytes";
    case NEON_CANONICAL_METRIC_KEYS.BRANCH_COUNT:
      return "count";
    default:
      return "count";
  }
}

const DETERMINISTIC_NEON_CONSUMPTION_WINDOWS: readonly NeonConsumptionPeriodWindow[] = [
  {
    timeframeStartIso: "2026-11-19T00:00:00.000Z",
    timeframeEndIso: "2026-11-20T00:00:00.000Z",
    activeTimeSeconds: 54_000,
    computeUnitSeconds: 81_000, // 1.5 CU average while active — never CPU %!
    writtenDataBytes: 184_549_376,
    syntheticStorageByteSeconds: 1_900_800_000 * 86_400, // 1.9 GB across 24h in byte-seconds
    storageConsumptionBytesMonth: convertNeonByteSecondsToBytesMonth(1_900_800_000 * 86_400),
    networkTransferBytes: 94_371_840,
  },
  {
    timeframeStartIso: "2026-11-20T00:00:00.000Z",
    timeframeEndIso: "2026-11-21T00:00:00.000Z",
    activeTimeSeconds: 61_200,
    computeUnitSeconds: 91_800,
    writtenDataBytes: 215_482_368,
    syntheticStorageByteSeconds: 2_254_857_830 * 86_400,
    storageConsumptionBytesMonth: convertNeonByteSecondsToBytesMonth(2_254_857_830 * 86_400),
    networkTransferBytes: 112_197_632,
  },
];

export async function fetchNeonProjectConsumptionWindows(
  context: ReadOnlyProviderContext,
  options: {
    projectId: string;
    startDateIso: string;
    endDateIso: string;
    granularity: "hourly" | "daily" | "monthly";
    fetchFn?: typeof fetch;
  },
): Promise<readonly NeonConsumptionPeriodWindow[]> {
  const { token } = assertNeonCredentialAndSimulation(context);

  if (!shouldExecuteLiveNeonApi(context, Boolean(options.fetchFn))) {
    return DETERMINISTIC_NEON_CONSUMPTION_WINDOWS;
  }

  const url = new URL(`${NEON_API_BASE_URL}/consumption_history/projects`);
  url.searchParams.set("from", options.startDateIso);
  url.searchParams.set("to", options.endDateIso);
  url.searchParams.set("granularity", options.granularity);
  url.searchParams.set("project_ids", options.projectId);

  const payload = await executeNeonReadOnlyGetJson<NeonApiConsumptionHistoryResponse>({
    url: url.toString(),
    apiToken: token,
    fetchFn: options.fetchFn,
  });

  if (!payload || typeof payload !== "object" || !Array.isArray(payload.projects)) {
    throw new ProviderAdapterError({
      providerKey: NEON_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: "Neon consumption history response missing `projects` array.",
    });
  }

  const projectEntry = payload.projects.find((p) => p.project_id === options.projectId);
  if (!projectEntry) {
    return [];
  }

  const windows: NeonConsumptionPeriodWindow[] = [];
  for (const period of projectEntry.periods ?? []) {
    for (const item of period.consumption ?? []) {
      if (!item.timeframe_start || !item.timeframe_end) {
        continue;
      }
      const syntheticByteSeconds =
        typeof item.synthetic_storage_size === "number" ? item.synthetic_storage_size : 0;

      windows.push({
        timeframeStartIso: item.timeframe_start,
        timeframeEndIso: item.timeframe_end,
        activeTimeSeconds:
          typeof item.active_time_seconds === "number" ? item.active_time_seconds : 0,
        computeUnitSeconds:
          typeof item.compute_time_seconds === "number" ? item.compute_time_seconds : 0,
        writtenDataBytes: typeof item.written_data_bytes === "number" ? item.written_data_bytes : 0,
        syntheticStorageByteSeconds: syntheticByteSeconds,
        storageConsumptionBytesMonth: convertNeonByteSecondsToBytesMonth(syntheticByteSeconds),
        networkTransferBytes:
          typeof item.data_transfer_bytes === "number" ? item.data_transfer_bytes : 0,
      });
    }
  }

  return windows;
}

export async function readNeonProjectMetrics(
  context: ReadOnlyProviderContext,
  query: ProviderMetricQuery,
  options?: { fetchFn?: typeof fetch },
): Promise<ProviderMetricReadResult> {
  assertNeonCredentialAndSimulation(context);
  const observedAtIso = new Date().toISOString();
  const unit = getNeonMetricUnit(query.metricKey);

  // 1. Registered user count is explicitly unsupported on Neon Control Plane
  if (
    query.metricKey === "neon.registered_users" ||
    query.metricKey === "registered_users" ||
    query.capabilityKey === "user_count_posture"
  ) {
    return {
      providerKey: NEON_PROVIDER_KEY,
      externalResourceId: query.externalResourceId,
      capabilityKey: query.capabilityKey,
      metricKey: query.metricKey,
      capabilityStatus: "UNSUPPORTED_BY_PROVIDER",
      uxState: "unsupported_plan",
      observedAtIso,
      sourceFreshnessMinutes: 0,
      provenanceLabel: `Neon Control Plane • ${query.externalResourceId}`,
      statusExplanation:
        "Neon is a serverless PostgreSQL engine without a control-plane application user directory. Avenor refuses to query customer SQL tables to fabricate a user count.",
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

  // 2. Check required scope
  if (
    !hasNeonConsumptionScope(context.grantedScopes) ||
    context.simulationScenario === "missing_scope"
  ) {
    return {
      providerKey: NEON_PROVIDER_KEY,
      externalResourceId: query.externalResourceId,
      capabilityKey: query.capabilityKey,
      metricKey: query.metricKey,
      capabilityStatus: "MISSING_PERMISSION",
      uxState: "permission_insufficient",
      observedAtIso,
      sourceFreshnessMinutes: 60,
      provenanceLabel: `Neon Control Plane • ${query.externalResourceId}`,
      statusExplanation:
        "Missing required read-only scope `neon.consumption.readonly`. Re-authorize or update token permissions.",
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

  // 3. Instantaneous branch storage and branch count come from branch metadata discovery
  // (available even on Neon Free tier where consumption_history is plan-gated)
  if (
    query.metricKey === NEON_CANONICAL_METRIC_KEYS.INSTANTANEOUS_STORAGE_BYTES ||
    query.metricKey === NEON_CANONICAL_METRIC_KEYS.BRANCH_COUNT
  ) {
    const discovery = await discoverNeonProjectsAndBranches(context, {
      fetchFn: options?.fetchFn,
    });
    const project = discovery.projects.find((p) => p.id === query.externalResourceId);
    if (!project) {
      throw new ProviderAdapterError({
        providerKey: NEON_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.RESOURCE_NOT_FOUND,
        message: `Neon project "${query.externalResourceId}" was not found.`,
      });
    }

    const branches = discovery.branchesByProject[project.id] ?? [];
    const totalInstantaneousBytes = branches.reduce((sum, b) => sum + (b.logicalSizeBytes ?? 0), 0);

    const pointValue =
      query.metricKey === NEON_CANONICAL_METRIC_KEYS.BRANCH_COUNT
        ? branches.length
        : totalInstantaneousBytes > 0
          ? totalInstantaneousBytes
          : project.syntheticStorageSizeBytes;

    return {
      providerKey: NEON_PROVIDER_KEY,
      externalResourceId: query.externalResourceId,
      capabilityKey: query.capabilityKey,
      metricKey: query.metricKey,
      capabilityStatus: "SUPPORTED",
      uxState: "connected_healthy",
      observedAtIso,
      sourceFreshnessMinutes: 15,
      provenanceLabel: `Neon Control Plane • ${project.name} (${project.regionId})`,
      statusExplanation:
        query.metricKey === NEON_CANONICAL_METRIC_KEYS.INSTANTANEOUS_STORAGE_BYTES
          ? "Instantaneous logical storage footprint in bytes aggregated across active Neon branches (distinct from billing-horizon byte-months)."
          : "Active Neon branch count from control-plane branch discovery.",
      points: [
        {
          timestampIso: query.endDateIso,
          metricKey: query.metricKey,
          value: pointValue,
          unit,
          dimensions: {
            projectId: project.id,
            region: project.regionId,
          },
        },
      ],
    };
  }

  // 4. Plan-gated consumption history check
  if (context.providerPlanTier === "free" || context.simulationScenario === "plan_restricted") {
    return {
      providerKey: NEON_PROVIDER_KEY,
      externalResourceId: query.externalResourceId,
      capabilityKey: query.capabilityKey,
      metricKey: query.metricKey,
      capabilityStatus: "PLAN_RESTRICTED",
      uxState: "unsupported_plan",
      observedAtIso,
      sourceFreshnessMinutes: 60,
      provenanceLabel: `Neon Control Plane • ${query.externalResourceId}`,
      statusExplanation:
        "Neon `/api/v2/consumption_history/projects` requires a Launch, Scale, Business, or Enterprise plan tier. Avenor renders an honest plan-gated state instead of fabricating 0.",
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

  const neonGranularity: "hourly" | "daily" | "monthly" =
    query.granularity === "hourly"
      ? "hourly"
      : query.granularity === "monthly"
        ? "monthly"
        : "daily";

  try {
    const windows = await fetchNeonProjectConsumptionWindows(context, {
      projectId: query.externalResourceId,
      startDateIso: query.startDateIso,
      endDateIso: query.endDateIso,
      granularity: neonGranularity,
      fetchFn: options?.fetchFn,
    });

    const points: ProviderMetricPoint[] = windows.map((win) => {
      let value: number | null = null;
      switch (query.metricKey) {
        case NEON_CANONICAL_METRIC_KEYS.COMPUTE_UNIT_SECONDS:
          value = win.computeUnitSeconds;
          break;
        case NEON_CANONICAL_METRIC_KEYS.ACTIVE_TIME_SECONDS:
          value = win.activeTimeSeconds;
          break;
        case NEON_CANONICAL_METRIC_KEYS.STORAGE_CONSUMPTION_BYTES_MONTH:
          value = win.storageConsumptionBytesMonth;
          break;
        case NEON_CANONICAL_METRIC_KEYS.NETWORK_TRANSFER_BYTES:
          value = win.networkTransferBytes;
          break;
        case NEON_CANONICAL_METRIC_KEYS.WRITTEN_DATA_BYTES:
          value = win.writtenDataBytes;
          break;
        default:
          value = win.computeUnitSeconds;
          break;
      }

      return {
        timestampIso: win.timeframeEndIso,
        metricKey: query.metricKey,
        value,
        unit,
        dimensions: {
          projectId: query.externalResourceId,
        },
      };
    });

    return {
      providerKey: NEON_PROVIDER_KEY,
      externalResourceId: query.externalResourceId,
      capabilityKey: query.capabilityKey,
      metricKey: query.metricKey,
      capabilityStatus: "SUPPORTED",
      uxState: "connected_healthy",
      observedAtIso,
      sourceFreshnessMinutes: 30,
      provenanceLabel: `Neon Consumption API v2 • ${query.externalResourceId}`,
      statusExplanation:
        query.metricKey === NEON_CANONICAL_METRIC_KEYS.COMPUTE_UNIT_SECONDS
          ? "Allocated Neon compute-unit seconds (CU-seconds) from consumption_history. Not CPU utilization percentage."
          : query.metricKey === NEON_CANONICAL_METRIC_KEYS.STORAGE_CONSUMPTION_BYTES_MONTH
            ? "Billing-horizon storage consumption in bytes-month (converted from synthetic_storage_size byte-seconds)."
            : "Read-only Neon Control Plane consumption series.",
      points,
    };
  } catch (err) {
    if (
      err instanceof ProviderAdapterError &&
      err.code === PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY
    ) {
      return {
        providerKey: NEON_PROVIDER_KEY,
        externalResourceId: query.externalResourceId,
        capabilityKey: query.capabilityKey,
        metricKey: query.metricKey,
        capabilityStatus: "PLAN_RESTRICTED",
        uxState: "unsupported_plan",
        observedAtIso,
        sourceFreshnessMinutes: 60,
        provenanceLabel: `Neon Consumption API v2 • ${query.externalResourceId}`,
        statusExplanation: err.message,
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
    throw err;
  }
}
