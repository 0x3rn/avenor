export const VERCEL_PROVIDER_KEY = "vercel" as const;
export const VERCEL_API_BASE_URL = "https://api.vercel.com" as const;

export const VERCEL_CANONICAL_METRIC_KEYS = {
  DEPLOYMENTS_TOTAL: "vercel.deployments_total",
  DEPLOYMENTS_READY: "vercel.deployments_ready",
  DEPLOYMENTS_FAILED: "vercel.deployments_failed",
  DEPLOYMENT_SUCCESS_RATE: "vercel.deployment_success_rate",
  MEAN_BUILD_DURATION_MS: "vercel.mean_build_duration_ms",
  BILLED_COST: "vercel.billed_cost",
} as const;

export type VercelCanonicalMetricKey =
  (typeof VERCEL_CANONICAL_METRIC_KEYS)[keyof typeof VERCEL_CANONICAL_METRIC_KEYS];

export interface VercelProjectRecord {
  readonly id: string;
  readonly name: string;
  readonly framework: string | null;
  readonly accountId: string;
  readonly updatedAtIso: string;
}

export interface VercelDeploymentRecord {
  readonly uid: string;
  readonly projectId: string;
  readonly name: string;
  readonly target: "production" | "preview";
  readonly state: "READY" | "ERROR" | "BUILDING" | "QUEUED" | "CANCELED";
  readonly commitSha: string | null;
  readonly commitBranch: string | null;
  readonly createdAtIso: string;
  readonly readyAtIso: string | null;
  readonly buildDurationMs: number | null;
}

export interface VercelFocusChargeRecord {
  readonly serviceName: string;
  readonly chargeCategory: string;
  readonly billingCurrency: string;
  readonly billedCost: number;
  readonly effectiveCost: number;
  readonly consumedQuantity: number | null;
  readonly consumedUnit: string | null;
  readonly chargePeriodStartIso: string;
  readonly chargePeriodEndIso: string;
}
