export const ALERT_CATEGORIES = [
  "PROVIDER_CONNECTION_FAILURE",
  "STALE_DATA",
  "KPI_THRESHOLD",
  "CLOUD_SPENDING_THRESHOLD",
] as const;

export type AlertCategory = (typeof ALERT_CATEGORIES)[number];
