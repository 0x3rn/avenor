import type { BackendCredentialSafetyVerdict } from "../backend-feasibility";

export const NEON_PROVIDER_KEY = "neon" as const;
export const NEON_API_BASE_URL = "https://console.neon.tech/api/v2" as const;

export const NEON_CANONICAL_METRIC_KEYS = {
  COMPUTE_UNIT_SECONDS: "neon.compute_unit_seconds",
  ACTIVE_TIME_SECONDS: "neon.active_time_seconds",
  STORAGE_CONSUMPTION_BYTES_MONTH: "neon.storage_consumption_bytes_month",
  INSTANTANEOUS_STORAGE_BYTES: "neon.instantaneous_storage_bytes",
  NETWORK_TRANSFER_BYTES: "neon.network_transfer_bytes",
  WRITTEN_DATA_BYTES: "neon.written_data_bytes",
  BRANCH_COUNT: "neon.branch_count",
} as const;

export type NeonCanonicalMetricKey =
  (typeof NEON_CANONICAL_METRIC_KEYS)[keyof typeof NEON_CANONICAL_METRIC_KEYS];

export type NeonBranchEnvironmentClass = "PRODUCTION" | "STAGING" | "DEVELOPMENT";

export interface NeonProjectSettingsMetadata {
  readonly ipAllowlistEnabled: boolean;
  readonly ipAllowlistCount: number;
  readonly protectedBranchesOnly: boolean;
  readonly historyRetentionSeconds: number;
}

export interface NeonProjectRecord {
  readonly id: string;
  readonly name: string;
  readonly regionId: string;
  readonly pgVersion: number;
  readonly orgId: string | null;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
  readonly syntheticStorageSizeBytes: number | null;
  readonly branchLogicalSizeLimitBytes: number | null;
  readonly computeLastActiveAtIso: string | null;
  readonly settings: NeonProjectSettingsMetadata;
}

export interface NeonBranchRecord {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly isPrimary: boolean;
  readonly isDefault: boolean;
  readonly isProtected: boolean;
  readonly currentState: string;
  readonly logicalSizeBytes: number | null;
  readonly environmentHint: NeonBranchEnvironmentClass;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
}

export interface NeonDatabaseMetadataRecord {
  readonly id: number;
  readonly projectId: string;
  readonly branchId: string;
  readonly name: string;
  readonly ownerName: string;
  readonly createdAtIso: string;
}

export interface NeonEndpointRecord {
  readonly id: string;
  readonly projectId: string;
  readonly branchId: string;
  readonly type: "read_write" | "read_only";
  readonly currentState: string;
  readonly autoscalingLimitMinCu: number;
  readonly autoscalingLimitMaxCu: number;
  readonly suspendTimeoutSeconds: number;
}

export interface NeonConsumptionPeriodWindow {
  readonly timeframeStartIso: string;
  readonly timeframeEndIso: string;
  readonly activeTimeSeconds: number;
  readonly computeUnitSeconds: number;
  readonly writtenDataBytes: number;
  readonly syntheticStorageByteSeconds: number;
  readonly storageConsumptionBytesMonth: number;
  readonly networkTransferBytes: number;
}

export interface NeonProjectDiscoveryBundle {
  readonly projects: readonly NeonProjectRecord[];
  readonly branchesByProject: Readonly<Record<string, readonly NeonBranchRecord[]>>;
  readonly databasesByProject: Readonly<Record<string, readonly NeonDatabaseMetadataRecord[]>>;
  readonly endpointsByProject: Readonly<Record<string, readonly NeonEndpointRecord[]>>;
  readonly credentialSafety: BackendCredentialSafetyVerdict;
}
