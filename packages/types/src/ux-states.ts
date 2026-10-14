/**
 * Master Product Design Brief Section 13:
 * Standardized 21 UX States for Avenor.
 * Empty or unconnected states must NEVER be rendered as numeric 0.
 */
export const AVENOR_UX_STATES = [
  "loading_initial",
  "loading_refresh",
  "empty_first_use",
  "empty_filtered",
  "unconnected",
  "connected_syncing",
  "connected_healthy",
  "stale_cached",
  "partial_coverage",
  "permission_insufficient",
  "unsupported_plan",
  "rate_limited",
  "provider_error",
  "archived_resource",
  "no_change",
  "insufficient_history",
  "anomaly_detected",
  "budget_warning",
  "confirm_destructive_avenor_action",
  "access_denied_role",
  "plan_limit_reached",
] as const;

export type AvenorUxState = (typeof AVENOR_UX_STATES)[number];

export type SemanticTone = "neutral" | "indigo" | "signal" | "success" | "warning" | "critical";

export interface UxStateDescriptor {
  state: AvenorUxState;
  label: string;
  explanation: string;
  tone: SemanticTone;
  allowsNumericMetric: boolean;
}

export const UX_STATE_DESCRIPTORS: Record<AvenorUxState, UxStateDescriptor> = {
  loading_initial: {
    state: "loading_initial",
    label: "Loading signal",
    explanation: "Retrieving initial project context and verified signal state.",
    tone: "neutral",
    allowsNumericMetric: false,
  },
  loading_refresh: {
    state: "loading_refresh",
    label: "Refreshing",
    explanation: "Updating signal observations while preserving last verified snapshot.",
    tone: "signal",
    allowsNumericMetric: true,
  },
  empty_first_use: {
    state: "empty_first_use",
    label: "No signals configured yet",
    explanation:
      "Create a logical project and map read-only sources to begin observing product signals.",
    tone: "neutral",
    allowsNumericMetric: false,
  },
  empty_filtered: {
    state: "empty_filtered",
    label: "No matching items",
    explanation: "No projects or signals match the active filter criteria.",
    tone: "neutral",
    allowsNumericMetric: false,
  },
  unconnected: {
    state: "unconnected",
    label: "Not connected",
    explanation: "No read-only provider connection is mapped to this project environment yet.",
    tone: "neutral",
    allowsNumericMetric: false,
  },
  connected_syncing: {
    state: "connected_syncing",
    label: "Syncing",
    explanation: "Read-only connection verified; initial observation sync is in progress.",
    tone: "signal",
    allowsNumericMetric: false,
  },
  connected_healthy: {
    state: "connected_healthy",
    label: "Healthy",
    explanation: "Read-only signal source is connected and within its freshness window.",
    tone: "success",
    allowsNumericMetric: true,
  },
  stale_cached: {
    state: "stale_cached",
    label: "Stale snapshot",
    explanation: "Showing last verified observation; recent scheduled sync has not completed.",
    tone: "warning",
    allowsNumericMetric: true,
  },
  partial_coverage: {
    state: "partial_coverage",
    label: "Partial coverage",
    explanation: "Some environments or mapped sources are still awaiting read-only connection.",
    tone: "warning",
    allowsNumericMetric: true,
  },
  permission_insufficient: {
    state: "permission_insufficient",
    label: "Permission required",
    explanation: "The connected credential lacks read-only viewer permission for this resource.",
    tone: "warning",
    allowsNumericMetric: false,
  },
  unsupported_plan: {
    state: "unsupported_plan",
    label: "Provider tier limitation",
    explanation: "This metric is not exposed by the external provider's current plan tier.",
    tone: "neutral",
    allowsNumericMetric: false,
  },
  rate_limited: {
    state: "rate_limited",
    label: "Rate limited",
    explanation:
      "Provider API quota reached; Avenor will retry automatically after the cooldown window.",
    tone: "warning",
    allowsNumericMetric: true,
  },
  provider_error: {
    state: "provider_error",
    label: "Provider unavailable",
    explanation: "External provider returned an upstream error during read-only inspection.",
    tone: "critical",
    allowsNumericMetric: false,
  },
  archived_resource: {
    state: "archived_resource",
    label: "Archived",
    explanation:
      "This logical project or environment is archived and no longer polls external sources.",
    tone: "neutral",
    allowsNumericMetric: true,
  },
  no_change: {
    state: "no_change",
    label: "Stable",
    explanation: "No material variance observed across the comparison window.",
    tone: "neutral",
    allowsNumericMetric: true,
  },
  insufficient_history: {
    state: "insufficient_history",
    label: "Insufficient history",
    explanation: "Baseline comparison requires additional historical collection days.",
    tone: "neutral",
    allowsNumericMetric: true,
  },
  anomaly_detected: {
    state: "anomaly_detected",
    label: "Signal shift detected",
    explanation: "Observed metric deviated materially from its recent baseline.",
    tone: "warning",
    allowsNumericMetric: true,
  },
  budget_warning: {
    state: "budget_warning",
    label: "Cost threshold alert",
    explanation: "Observed cloud spend is approaching the configured Avenor alert threshold.",
    tone: "warning",
    allowsNumericMetric: true,
  },
  confirm_destructive_avenor_action: {
    state: "confirm_destructive_avenor_action",
    label: "Confirmation required",
    explanation:
      "This action modifies Avenor-owned workspace metadata only and never mutates external providers.",
    tone: "critical",
    allowsNumericMetric: false,
  },
  access_denied_role: {
    state: "access_denied_role",
    label: "Role restricted",
    explanation: "Your current workspace role has read access only and cannot modify this setting.",
    tone: "warning",
    allowsNumericMetric: false,
  },
  plan_limit_reached: {
    state: "plan_limit_reached",
    label: "Workspace limit reached",
    explanation: "Current workspace entitlement limit reached for this resource type.",
    tone: "warning",
    allowsNumericMetric: false,
  },
};

/**
 * Enforces the Signal Atlas rule: Empty or unconnected is never rendered as numeric 0.
 * A numeric 0 is only permitted when the state explicitly allows numeric metrics
 * AND a genuine numeric measurement was recorded.
 */
export function canRenderNumericValue(
  state: AvenorUxState,
  value: number | null | undefined,
): value is number {
  const descriptor = UX_STATE_DESCRIPTORS[state];
  if (!descriptor?.allowsNumericMetric) {
    return false;
  }
  return typeof value === "number" && Number.isFinite(value);
}
