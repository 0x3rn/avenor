export const GCP_BILLING_METADATA_SCOPE = "https://www.googleapis.com/auth/cloud-billing.readonly";

export const GCP_BIGQUERY_READONLY_SCOPE = "https://www.googleapis.com/auth/bigquery.readonly";

export const GCP_CLOUD_PLATFORM_READONLY_SCOPE =
  "https://www.googleapis.com/auth/cloud-platform.read-only";

export const GCP_BILLING_PROVIDER_KEY = "gcp-billing";

export type GcpBillingDiscoveryErrorReason =
  | "NO_BILLING_ACCOUNTS"
  | "INSUFFICIENT_OAUTH_SCOPE"
  | "MISSING_IAM_PERMISSION"
  | "BILLING_API_DISABLED"
  | "INVALID_BILLING_ACCOUNT"
  | "NO_LINKED_PROJECTS"
  | "EXPIRED_TOKEN"
  | "REVOKED_TOKEN"
  | "PROVIDER_UNAVAILABLE";

export interface GcpBillingAccountMetadata {
  /** Full resource name e.g. "billingAccounts/01A2B3-45C6D7-89E0F1" */
  billingAccountName: string;
  /** Short billing account identifier e.g. "01A2B3-45C6D7-89E0F1" */
  billingAccountId: string;
  displayName: string;
  open: boolean;
  masterBillingAccount: string | null;
  currencyCode: string | null;
  parent: string | null;
}

export interface GcpProjectBillingAssociation {
  /** Full resource name e.g. "projects/avenor-prod-401/billingInfo" */
  name: string;
  /** Google Cloud project ID e.g. "avenor-prod-401" (distinct from Avenor logical project ID and GA4 property ID) */
  gcpProjectId: string;
  billingAccountName: string;
  billingAccountId: string;
  billingEnabled: boolean;
  /** Timestamp when this association was observed so historical cost attribution is never silently rewritten */
  associationObservedAtIso: string;
}

export interface GcpBillingDiscoveryResult {
  accounts: GcpBillingAccountMetadata[];
  linkedProjects: GcpProjectBillingAssociation[];
  /** Always false for Cloud Billing metadata API discovery; historical spend requires an authorized BigQuery billing export */
  hasHistoricalCostAccess: false;
  metadataOnlyNotice: string;
  emptyReason: GcpBillingDiscoveryErrorReason | null;
  accountsPageCount: number;
  projectsPageCount: number;
  observedAtIso: string;
}
