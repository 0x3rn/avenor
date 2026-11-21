import {
  type DiscoveredExternalResource,
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import {
  executeGoogleReadRequest,
  GOOGLE_CLOUD_BILLING_V1_BASE,
  shouldExecuteLiveGoogleApi,
} from "../google-shared/http";
import {
  GCP_BIGQUERY_READONLY_SCOPE,
  GCP_BILLING_METADATA_SCOPE,
  GCP_BILLING_PROVIDER_KEY,
  GCP_CLOUD_PLATFORM_READONLY_SCOPE,
  type GcpBillingAccountMetadata,
  type GcpBillingDiscoveryResult,
  type GcpProjectBillingAssociation,
} from "./types";

const BILLING_ACCOUNT_ID_RE = /^[A-Za-z0-9]{6}-[A-Za-z0-9]{6}-[A-Za-z0-9]{6}$/;
const GCP_PROJECT_ID_RE = /^[a-z][a-z0-9-]{4,29}$/;

export const METADATA_ONLY_DISCOVERY_NOTICE =
  "Google Cloud Billing API discovery verifies billing account metadata and linked Google Cloud project associations only. Comprehensive historical spending requires a linked BigQuery Cloud Billing export dataset.";

export function hasCloudBillingMetadataScope(grantedScopes: readonly string[]): boolean {
  return (
    grantedScopes.includes(GCP_BILLING_METADATA_SCOPE) ||
    grantedScopes.includes(GCP_CLOUD_PLATFORM_READONLY_SCOPE)
  );
}

export function hasBigQueryReadOnlyScope(grantedScopes: readonly string[]): boolean {
  return (
    grantedScopes.includes(GCP_BIGQUERY_READONLY_SCOPE) ||
    grantedScopes.includes(GCP_CLOUD_PLATFORM_READONLY_SCOPE)
  );
}

export function normalizeBillingAccountId(raw: string): string {
  const trimmed = raw.trim().replace(/^billingAccounts\//, "");
  if (!BILLING_ACCOUNT_ID_RE.test(trimmed)) {
    throw new ProviderAdapterError({
      providerKey: GCP_BILLING_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: `Invalid Google Cloud Billing Account ID "${raw}". Expected format XXXXXX-XXXXXX-XXXXXX.`,
    });
  }
  return trimmed;
}

export function normalizeGcpProjectId(raw: string): string {
  const trimmed = raw
    .trim()
    .replace(/^projects\//, "")
    .replace(/\/billingInfo$/, "");
  if (!GCP_PROJECT_ID_RE.test(trimmed)) {
    throw new ProviderAdapterError({
      providerKey: GCP_BILLING_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: `Invalid Google Cloud project ID "${raw}". Expected lowercase project slug (6-30 chars).`,
    });
  }
  return trimmed;
}

export function assertGcpBillingScenarioAndScope(
  context: ReadOnlyProviderContext,
  options?: { requireBigQueryScope?: boolean },
): void {
  if (!context.organizationId || !context.workspaceId) {
    throw new ProviderAdapterError({
      providerKey: GCP_BILLING_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "Workspace and organization context are required for Google Cloud Billing access.",
    });
  }

  switch (context.simulationScenario) {
    case "expired_token":
      throw new ProviderAdapterError({
        providerKey: GCP_BILLING_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.CREDENTIAL_EXPIRED,
        message:
          "Google Cloud Billing OAuth access token has expired and requires refresh or re-authorization.",
      });
    case "revoked_token":
      throw new ProviderAdapterError({
        providerKey: GCP_BILLING_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
        message:
          "Google Cloud Billing authorization grant was revoked upstream by the account owner.",
      });
    case "missing_scope":
      throw new ProviderAdapterError({
        providerKey: GCP_BILLING_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
        message: `Missing required Google Cloud Billing read-only OAuth scope (${GCP_BILLING_METADATA_SCOPE}).`,
      });
    case "rate_limited":
      throw new ProviderAdapterError({
        providerKey: GCP_BILLING_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.RATE_LIMITED,
        message: "Google Cloud Billing API rate limit reached. Retry after cooldown window.",
        retryable: true,
        retryAfterSeconds: 60,
      });
    case "provider_unavailable":
      throw new ProviderAdapterError({
        providerKey: GCP_BILLING_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
        message: "Google Cloud Billing API is temporarily unreachable (503).",
        retryable: true,
        retryAfterSeconds: 30,
      });
    default:
      break;
  }

  const hasBillingMeta = hasCloudBillingMetadataScope(context.grantedScopes);
  const hasBq = hasBigQueryReadOnlyScope(context.grantedScopes);

  if (options?.requireBigQueryScope && !hasBq) {
    throw new ProviderAdapterError({
      providerKey: GCP_BILLING_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
      message: `BigQuery billing export queries require read-only scope ${GCP_BIGQUERY_READONLY_SCOPE}. Billing account metadata scope alone cannot query BigQuery export tables.`,
    });
  }

  if (!hasBillingMeta && !hasBq) {
    throw new ProviderAdapterError({
      providerKey: GCP_BILLING_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
      message: `Missing Google Cloud Billing read-only OAuth scope (${GCP_BILLING_METADATA_SCOPE}). GA4 or Search Console scopes do not grant Cloud Billing access.`,
    });
  }
}

interface RawGcpBillingAccount {
  name?: string;
  open?: boolean;
  displayName?: string;
  masterBillingAccount?: string;
  currencyCode?: string;
  parent?: string;
}

interface RawListBillingAccountsResponse {
  billingAccounts?: RawGcpBillingAccount[];
  nextPageToken?: string;
}

interface RawProjectBillingInfo {
  name?: string;
  projectId?: string;
  billingAccountName?: string;
  billingEnabled?: boolean;
}

interface RawListAccountProjectsResponse {
  projectBillingInfo?: RawProjectBillingInfo[];
  nextPageToken?: string;
}

/**
 * Lists accessible Google Cloud Billing accounts via `GET /v1/billingAccounts` with full pagination support.
 */
export async function listGcpBillingAccounts(input: {
  accessToken: string;
  fetchFn?: typeof fetch;
  pageSize?: number;
  maxPages?: number;
}): Promise<{ accounts: GcpBillingAccountMetadata[]; pageCount: number }> {
  const pageSize = Math.min(Math.max(input.pageSize ?? 50, 1), 100);
  const maxPages = Math.min(Math.max(input.maxPages ?? 10, 1), 25);
  const accounts: GcpBillingAccountMetadata[] = [];
  const seenIds = new Set<string>();

  let pageToken: string | undefined;
  let pageCount = 0;

  do {
    pageCount += 1;
    const url = new URL(`${GOOGLE_CLOUD_BILLING_V1_BASE}/billingAccounts`);
    url.searchParams.set("pageSize", String(pageSize));
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const data = await executeGoogleReadRequest<RawListBillingAccountsResponse>({
      providerKey: GCP_BILLING_PROVIDER_KEY,
      url: url.toString(),
      method: "GET",
      accessToken: input.accessToken,
      fetchFn: input.fetchFn,
    });

    for (const raw of data.billingAccounts ?? []) {
      if (!raw.name) continue;
      const billingAccountId = normalizeBillingAccountId(raw.name);
      if (seenIds.has(billingAccountId)) continue;
      seenIds.add(billingAccountId);

      accounts.push({
        billingAccountName: `billingAccounts/${billingAccountId}`,
        billingAccountId,
        displayName: raw.displayName?.trim() || `Billing Account ${billingAccountId}`,
        open: Boolean(raw.open),
        masterBillingAccount: raw.masterBillingAccount?.trim() || null,
        currencyCode: raw.currencyCode?.trim().toUpperCase() || null,
        parent: raw.parent?.trim() || null,
      });
    }

    pageToken = data.nextPageToken?.trim() || undefined;
  } while (pageToken && pageCount < maxPages);

  return { accounts, pageCount };
}

/**
 * Retrieves a single Google Cloud Billing account via `GET /v1/billingAccounts/{billingAccountId}`.
 */
export async function getGcpBillingAccount(input: {
  accessToken: string;
  billingAccountId: string;
  fetchFn?: typeof fetch;
}): Promise<GcpBillingAccountMetadata> {
  const normalizedId = normalizeBillingAccountId(input.billingAccountId);
  const url = `${GOOGLE_CLOUD_BILLING_V1_BASE}/billingAccounts/${encodeURIComponent(normalizedId)}`;

  const raw = await executeGoogleReadRequest<RawGcpBillingAccount>({
    providerKey: GCP_BILLING_PROVIDER_KEY,
    url,
    method: "GET",
    accessToken: input.accessToken,
    fetchFn: input.fetchFn,
  });

  const id = raw.name ? normalizeBillingAccountId(raw.name) : normalizedId;

  return {
    billingAccountName: `billingAccounts/${id}`,
    billingAccountId: id,
    displayName: raw.displayName?.trim() || `Billing Account ${id}`,
    open: Boolean(raw.open),
    masterBillingAccount: raw.masterBillingAccount?.trim() || null,
    currencyCode: raw.currencyCode?.trim().toUpperCase() || null,
    parent: raw.parent?.trim() || null,
  };
}

/**
 * Lists Google Cloud projects linked to a specific billing account via
 * `GET /v1/billingAccounts/{billingAccountId}/projects` with full pagination support.
 */
export async function listGcpBillingAccountProjects(input: {
  accessToken: string;
  billingAccountId: string;
  fetchFn?: typeof fetch;
  pageSize?: number;
  maxPages?: number;
  observedAtIso?: string;
}): Promise<{ projects: GcpProjectBillingAssociation[]; pageCount: number }> {
  const normalizedAccountId = normalizeBillingAccountId(input.billingAccountId);
  const pageSize = Math.min(Math.max(input.pageSize ?? 50, 1), 100);
  const maxPages = Math.min(Math.max(input.maxPages ?? 10, 1), 25);
  const observedAtIso = input.observedAtIso ?? new Date().toISOString();

  const projects: GcpProjectBillingAssociation[] = [];
  const seenProjects = new Set<string>();
  let pageToken: string | undefined;
  let pageCount = 0;

  do {
    pageCount += 1;
    const url = new URL(
      `${GOOGLE_CLOUD_BILLING_V1_BASE}/billingAccounts/${encodeURIComponent(normalizedAccountId)}/projects`,
    );
    url.searchParams.set("pageSize", String(pageSize));
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const data = await executeGoogleReadRequest<RawListAccountProjectsResponse>({
      providerKey: GCP_BILLING_PROVIDER_KEY,
      url: url.toString(),
      method: "GET",
      accessToken: input.accessToken,
      fetchFn: input.fetchFn,
    });

    for (const raw of data.projectBillingInfo ?? []) {
      const candidateProjectId = raw.projectId || raw.name;
      if (!candidateProjectId) continue;
      const gcpProjectId = normalizeGcpProjectId(candidateProjectId);
      const dedupeKey = `${normalizedAccountId}::${gcpProjectId}`;
      if (seenProjects.has(dedupeKey)) continue;
      seenProjects.add(dedupeKey);

      const acctId = raw.billingAccountName
        ? normalizeBillingAccountId(raw.billingAccountName)
        : normalizedAccountId;

      projects.push({
        name: `projects/${gcpProjectId}/billingInfo`,
        gcpProjectId,
        billingAccountName: `billingAccounts/${acctId}`,
        billingAccountId: acctId,
        billingEnabled: Boolean(raw.billingEnabled),
        associationObservedAtIso: observedAtIso,
      });
    }

    pageToken = data.nextPageToken?.trim() || undefined;
  } while (pageToken && pageCount < maxPages);

  return { projects, pageCount };
}

/**
 * Retrieves billing info for a specific Google Cloud project via `GET /v1/projects/{projectId}/billingInfo`.
 */
export async function getGcpProjectBillingInfo(input: {
  accessToken: string;
  gcpProjectId: string;
  fetchFn?: typeof fetch;
  observedAtIso?: string;
}): Promise<GcpProjectBillingAssociation> {
  const normalizedProjectId = normalizeGcpProjectId(input.gcpProjectId);
  const url = `${GOOGLE_CLOUD_BILLING_V1_BASE}/projects/${encodeURIComponent(normalizedProjectId)}/billingInfo`;

  const raw = await executeGoogleReadRequest<RawProjectBillingInfo>({
    providerKey: GCP_BILLING_PROVIDER_KEY,
    url,
    method: "GET",
    accessToken: input.accessToken,
    fetchFn: input.fetchFn,
  });

  const billingAccountId = raw.billingAccountName
    ? normalizeBillingAccountId(raw.billingAccountName)
    : "";

  return {
    name: `projects/${normalizedProjectId}/billingInfo`,
    gcpProjectId: normalizedProjectId,
    billingAccountName: billingAccountId ? `billingAccounts/${billingAccountId}` : "",
    billingAccountId,
    billingEnabled: Boolean(raw.billingEnabled),
    associationObservedAtIso: input.observedAtIso ?? new Date().toISOString(),
  };
}

const SANDBOX_BILLING_ACCOUNTS: readonly GcpBillingAccountMetadata[] = [
  {
    billingAccountName: "billingAccounts/01A2B3-45C6D7-89E0F1",
    billingAccountId: "01A2B3-45C6D7-89E0F1",
    displayName: "Avenor Cloud Production Billing",
    open: true,
    masterBillingAccount: null,
    currencyCode: "USD",
    parent: "organizations/901284012",
  },
];

const SANDBOX_PROJECT_ASSOCIATIONS: readonly GcpProjectBillingAssociation[] = [
  {
    name: "projects/avenor-cloud-prod/billingInfo",
    gcpProjectId: "avenor-cloud-prod",
    billingAccountName: "billingAccounts/01A2B3-45C6D7-89E0F1",
    billingAccountId: "01A2B3-45C6D7-89E0F1",
    billingEnabled: true,
    associationObservedAtIso: "2026-11-18T00:00:00.000Z",
  },
  {
    name: "projects/avenor-cloud-staging/billingInfo",
    gcpProjectId: "avenor-cloud-staging",
    billingAccountName: "billingAccounts/01A2B3-45C6D7-89E0F1",
    billingAccountId: "01A2B3-45C6D7-89E0F1",
    billingEnabled: true,
    associationObservedAtIso: "2026-11-18T00:00:00.000Z",
  },
];

/**
 * Discovers accessible Google Cloud Billing accounts and their linked GCP projects read-only.
 * Never claims that metadata discovery provides historical cost data.
 */
export async function discoverGcpBillingAccountsAndProjects(
  context: ReadOnlyProviderContext,
  options?: {
    fetchFn?: typeof fetch;
    pageSize?: number;
    maxPages?: number;
  },
): Promise<GcpBillingDiscoveryResult> {
  assertGcpBillingScenarioAndScope(context);

  if (!hasCloudBillingMetadataScope(context.grantedScopes)) {
    throw new ProviderAdapterError({
      providerKey: GCP_BILLING_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
      message: `Billing account and project discovery requires ${GCP_BILLING_METADATA_SCOPE}.`,
    });
  }

  const observedAtIso = new Date().toISOString();

  if (!shouldExecuteLiveGoogleApi(context, Boolean(options?.fetchFn), GCP_BILLING_PROVIDER_KEY)) {
    return {
      accounts: [...SANDBOX_BILLING_ACCOUNTS],
      linkedProjects: [...SANDBOX_PROJECT_ASSOCIATIONS],
      hasHistoricalCostAccess: false,
      metadataOnlyNotice: METADATA_ONLY_DISCOVERY_NOTICE,
      emptyReason: null,
      accountsPageCount: 1,
      projectsPageCount: 1,
      observedAtIso,
    };
  }

  const accessToken = context.accessToken ?? context.apiToken ?? "";
  if (!accessToken) {
    throw new ProviderAdapterError({
      providerKey: GCP_BILLING_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "Missing Google Cloud Billing read-only OAuth access token.",
    });
  }

  const accountsListing = await listGcpBillingAccounts({
    accessToken,
    fetchFn: options?.fetchFn,
    pageSize: options?.pageSize,
    maxPages: options?.maxPages,
  });

  if (accountsListing.accounts.length === 0) {
    return {
      accounts: [],
      linkedProjects: [],
      hasHistoricalCostAccess: false,
      metadataOnlyNotice: METADATA_ONLY_DISCOVERY_NOTICE,
      emptyReason: "NO_BILLING_ACCOUNTS",
      accountsPageCount: accountsListing.pageCount,
      projectsPageCount: 0,
      observedAtIso,
    };
  }

  const linkedProjects: GcpProjectBillingAssociation[] = [];
  let projectsPageCount = 0;

  for (const account of accountsListing.accounts) {
    const projRes = await listGcpBillingAccountProjects({
      accessToken,
      billingAccountId: account.billingAccountId,
      fetchFn: options?.fetchFn,
      pageSize: options?.pageSize,
      maxPages: options?.maxPages,
      observedAtIso,
    });
    projectsPageCount += projRes.pageCount;
    linkedProjects.push(...projRes.projects);
  }

  return {
    accounts: accountsListing.accounts,
    linkedProjects,
    hasHistoricalCostAccess: false,
    metadataOnlyNotice: METADATA_ONLY_DISCOVERY_NOTICE,
    emptyReason: linkedProjects.length === 0 ? "NO_LINKED_PROJECTS" : null,
    accountsPageCount: accountsListing.pageCount,
    projectsPageCount,
    observedAtIso,
  };
}

/**
 * Converts discovered Google Cloud Billing accounts and linked GCP projects into Avenor
 * `DiscoveredExternalResource` records with explicit separation between Billing Account ID,
 * GCP Project ID, BigQuery export dataset project, and Avenor Logical Project ID.
 */
export function mapGcpBillingDiscoveryToExternalResources(
  discovery: GcpBillingDiscoveryResult,
  grantedScopes: readonly string[],
): DiscoveredExternalResource[] {
  const resources: DiscoveredExternalResource[] = [];
  const accountById = new Map(discovery.accounts.map((a) => [a.billingAccountId, a]));
  const hasBqScope = hasBigQueryReadOnlyScope(grantedScopes);

  for (const account of discovery.accounts) {
    const linkedForAccount = discovery.linkedProjects.filter(
      (p) => p.billingAccountId === account.billingAccountId,
    );

    resources.push({
      externalResourceId: account.billingAccountName,
      externalResourceName: `${account.displayName} (${account.billingAccountId})`,
      resourceType: "gcp_billing_account",
      regionOrLocation: "Global",
      parentAccountOrOrg: account.parent ?? "Google Cloud Billing",
      availableCapabilities: ["resource_discovery"],
      metadata: {
        billingAccountId: account.billingAccountId,
        billingAccountName: account.billingAccountName,
        accountStatus: account.open ? "OPEN" : "CLOSED",
        currencyCode: account.currencyCode ?? "USD",
        linkedGcpProjectCount: linkedForAccount.length,
        linkedGcpProjectIds: linkedForAccount.map((p) => p.gcpProjectId).join(","),
        hasHistoricalCostAccess: false,
        requiresBigQueryExportOnboarding: true,
        bigQueryScopeGranted: hasBqScope,
        metadataOnlyNotice: discovery.metadataOnlyNotice,
        observedAtIso: discovery.observedAtIso,
      },
    });
  }

  for (const proj of discovery.linkedProjects) {
    const parentAccount = accountById.get(proj.billingAccountId);
    const environmentHint = /stag|preview|qa/i.test(proj.gcpProjectId)
      ? "STAGING"
      : /dev|local|sandbox/i.test(proj.gcpProjectId)
        ? "DEVELOPMENT"
        : "PRODUCTION";

    resources.push({
      externalResourceId: `gcp-project:${proj.gcpProjectId}`,
      externalResourceName: `${proj.gcpProjectId} (${parentAccount?.displayName ?? proj.billingAccountId})`,
      resourceType: "gcp_billing_project",
      regionOrLocation: "Global",
      parentAccountOrOrg: `${parentAccount?.displayName ?? "Billing Account"} (${proj.billingAccountId})`,
      availableCapabilities: ["resource_discovery"],
      metadata: {
        gcpProjectId: proj.gcpProjectId,
        billingAccountId: proj.billingAccountId,
        billingAccountName: proj.billingAccountName,
        billingAccountDisplayName: parentAccount?.displayName ?? proj.billingAccountId,
        billingAccountOpen: parentAccount?.open ?? true,
        billingEnabled: proj.billingEnabled,
        currencyCode: parentAccount?.currencyCode ?? "USD",
        environmentHint,
        associationObservedAtIso: proj.associationObservedAtIso,
        associationHistoryJson: JSON.stringify([
          {
            billingAccountId: proj.billingAccountId,
            billingEnabled: proj.billingEnabled,
            observedAtIso: proj.associationObservedAtIso,
          },
        ]),
        hasHistoricalCostAccess: false,
        requiresBigQueryExportOnboarding: true,
        metadataOnlyNotice: discovery.metadataOnlyNotice,
      },
    });
  }

  return resources;
}
