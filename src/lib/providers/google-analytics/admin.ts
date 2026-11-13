import {
  type DiscoveredExternalResource,
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import {
  executeGoogleReadRequest,
  GOOGLE_ANALYTICS_ADMIN_BASE,
  shouldExecuteLiveGoogleApi,
} from "../google-shared/http";
import {
  GA4_READONLY_SCOPE,
  type Ga4DataStreamRecord,
  type Ga4DiscoveredProperty,
  type Ga4DiscoveryResult,
} from "./types";

interface RawGa4AccountSummary {
  name?: string;
  account?: string;
  displayName?: string;
  propertySummaries?: Array<{
    property?: string;
    displayName?: string;
    propertyType?: string;
    parent?: string;
  }>;
}

interface RawGa4AccountSummariesResponse {
  accountSummaries?: RawGa4AccountSummary[];
  nextPageToken?: string;
}

interface RawGa4PropertyDetail {
  name?: string;
  displayName?: string;
  propertyType?: string;
  industryCategory?: string;
  timeZone?: string;
  currencyCode?: string;
  serviceLevel?: string;
  parent?: string;
}

interface RawGa4DataStream {
  name?: string;
  type?: string;
  displayName?: string;
  webStreamData?: {
    measurementId?: string;
    firebaseAppId?: string;
    defaultUri?: string;
  };
  androidAppStreamData?: {
    firebaseAppId?: string;
    packageName?: string;
  };
  iosAppStreamData?: {
    firebaseAppId?: string;
    bundleId?: string;
  };
}

interface RawGa4DataStreamsResponse {
  dataStreams?: RawGa4DataStream[];
  nextPageToken?: string;
}

export function hasGa4ReadOnlyScope(grantedScopes: readonly string[]): boolean {
  return grantedScopes.includes(GA4_READONLY_SCOPE);
}

/**
 * Validates and normalizes a GA4 property identifier to `properties/{numericId}`.
 * Rejects path traversal, empty inputs, and malformed identifiers.
 */
export function normalizeGa4PropertyResourceName(rawPropertyId: string): string {
  const trimmed = rawPropertyId.trim();
  const match = trimmed.match(/^(?:properties\/)?(\d{1,30})$/);
  if (!match) {
    throw new ProviderAdapterError({
      providerKey: "ga4",
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: `Invalid GA4 property identifier "${trimmed}". Expected "properties/{numericId}" or numeric ID.`,
    });
  }
  return `properties/${match[1]}`;
}

function extractNumericPropertyId(propertyName: string): string {
  return propertyName.replace(/^properties\//, "");
}

export function assertGa4ScenarioAndScope(context: ReadOnlyProviderContext): void {
  if (!context.organizationId || !context.workspaceId) {
    throw new ProviderAdapterError({
      providerKey: "ga4",
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "Workspace and organization context are required for GA4 access.",
    });
  }

  switch (context.simulationScenario) {
    case "expired_token":
      throw new ProviderAdapterError({
        providerKey: "ga4",
        code: PROVIDER_ERROR_CODES.CREDENTIAL_EXPIRED,
        message:
          "Google Analytics OAuth token has expired and requires refresh or re-authorization.",
      });
    case "revoked_token":
      throw new ProviderAdapterError({
        providerKey: "ga4",
        code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
        message:
          "Google Analytics OAuth consent was revoked upstream in Google Account permissions.",
      });
    case "rate_limited":
      throw new ProviderAdapterError({
        providerKey: "ga4",
        code: PROVIDER_ERROR_CODES.RATE_LIMITED,
        retryable: true,
        retryAfterSeconds: 60,
        message: "Google Analytics API rate limit quota reached. Retry after cooldown window.",
      });
    case "provider_unavailable":
      throw new ProviderAdapterError({
        providerKey: "ga4",
        code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
        retryable: true,
        retryAfterSeconds: 30,
        message: "Google Analytics API is temporarily unreachable (upstream 503).",
      });
    case "malformed_response":
      throw new ProviderAdapterError({
        providerKey: "ga4",
        code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
        message: "Google Analytics API returned an unexpected payload schema.",
      });
    case "missing_scope":
      throw new ProviderAdapterError({
        providerKey: "ga4",
        code: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
        missingScopes: [GA4_READONLY_SCOPE],
        message: `Missing required Google Analytics read-only scope: ${GA4_READONLY_SCOPE}.`,
      });
    default:
      break;
  }

  if (!hasGa4ReadOnlyScope(context.grantedScopes)) {
    throw new ProviderAdapterError({
      providerKey: "ga4",
      code: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
      missingScopes: [GA4_READONLY_SCOPE],
      message: `Google Analytics discovery requires read-only OAuth scope "${GA4_READONLY_SCOPE}".`,
    });
  }
}

export async function listGa4AccountSummaries(options: {
  accessToken: string;
  fetchFn?: typeof fetch;
  pageSize?: number;
  maxPages?: number;
}): Promise<{
  accountSummaries: RawGa4AccountSummary[];
  pageCount: number;
}> {
  const pageSize = Math.max(1, Math.min(options.pageSize ?? 200, 200));
  const maxPages = Math.max(1, Math.min(options.maxPages ?? 15, 50));
  const allSummaries: RawGa4AccountSummary[] = [];

  let nextPageToken: string | undefined;
  let pageCount = 0;

  for (let i = 0; i < maxPages; i += 1) {
    const url = new URL(`${GOOGLE_ANALYTICS_ADMIN_BASE}/accountSummaries`);
    url.searchParams.set("pageSize", String(pageSize));
    if (nextPageToken) {
      url.searchParams.set("pageToken", nextPageToken);
    }

    const page = await executeGoogleReadRequest<RawGa4AccountSummariesResponse>({
      providerKey: "ga4",
      url: url.toString(),
      method: "GET",
      accessToken: options.accessToken,
      fetchFn: options.fetchFn,
    });

    pageCount += 1;
    if (Array.isArray(page.accountSummaries)) {
      allSummaries.push(...page.accountSummaries);
    }

    if (!page.nextPageToken) {
      break;
    }
    nextPageToken = page.nextPageToken;
  }

  return { accountSummaries: allSummaries, pageCount };
}

export async function getGa4PropertyMetadata(options: {
  accessToken: string;
  propertyName: string;
  fetchFn?: typeof fetch;
}): Promise<RawGa4PropertyDetail> {
  const normalized = normalizeGa4PropertyResourceName(options.propertyName);
  return executeGoogleReadRequest<RawGa4PropertyDetail>({
    providerKey: "ga4",
    url: `${GOOGLE_ANALYTICS_ADMIN_BASE}/${normalized}`,
    method: "GET",
    accessToken: options.accessToken,
    fetchFn: options.fetchFn,
  });
}

export async function listGa4PropertyDataStreams(options: {
  accessToken: string;
  propertyName: string;
  fetchFn?: typeof fetch;
  maxPages?: number;
}): Promise<Ga4DataStreamRecord[]> {
  const normalized = normalizeGa4PropertyResourceName(options.propertyName);
  const maxPages = Math.max(1, Math.min(options.maxPages ?? 5, 20));
  const streams: Ga4DataStreamRecord[] = [];
  let nextPageToken: string | undefined;

  for (let i = 0; i < maxPages; i += 1) {
    const url = new URL(`${GOOGLE_ANALYTICS_ADMIN_BASE}/${normalized}/dataStreams`);
    url.searchParams.set("pageSize", "200");
    if (nextPageToken) {
      url.searchParams.set("pageToken", nextPageToken);
    }

    const res = await executeGoogleReadRequest<RawGa4DataStreamsResponse>({
      providerKey: "ga4",
      url: url.toString(),
      method: "GET",
      accessToken: options.accessToken,
      fetchFn: options.fetchFn,
    });

    for (const s of res.dataStreams ?? []) {
      const streamName = s.name ?? "";
      const streamIdMatch = streamName.match(/dataStreams\/([^/]+)$/);
      streams.push({
        streamName,
        streamId: streamIdMatch?.[1] ?? streamName,
        displayName: s.displayName ?? "Unnamed Stream",
        type: s.type ?? "WEB_DATA_STREAM",
        measurementId: s.webStreamData?.measurementId,
        defaultUri: s.webStreamData?.defaultUri,
        firebaseAppId:
          s.webStreamData?.firebaseAppId ??
          s.androidAppStreamData?.firebaseAppId ??
          s.iosAppStreamData?.firebaseAppId,
        appPackageOrBundleId: s.androidAppStreamData?.packageName ?? s.iosAppStreamData?.bundleId,
      });
    }

    if (!res.nextPageToken) {
      break;
    }
    nextPageToken = res.nextPageToken;
  }

  return streams;
}

function getSandboxGa4DiscoveryFixture(): Ga4DiscoveryResult {
  return {
    accountCount: 2,
    pageCount: 1,
    sourceMode: "sandbox_demo",
    properties: [
      {
        propertyName: "properties/402918401",
        numericPropertyId: "402918401",
        displayName: "Avenor Marketing & Web App (Prod)",
        accountName: "accounts/9012401",
        accountDisplayName: "Corstack Digital Holdings",
        timeZone: "America/New_York",
        currencyCode: "USD",
        propertyType: "PROPERTY_TYPE_ORDINARY",
        industryCategory: "TECHNOLOGY",
        serviceLevel: "GOOGLE_ANALYTICS_STANDARD",
        sourceMode: "sandbox_demo",
        dataStreams: [
          {
            streamName: "properties/402918401/dataStreams/71829011",
            streamId: "71829011",
            displayName: "Avenor Production Web",
            type: "WEB_DATA_STREAM",
            measurementId: "G-AVNR104P9Q",
            defaultUri: "https://avenor.dev",
          },
          {
            streamName: "properties/402918401/dataStreams/71829012",
            streamId: "71829012",
            displayName: "Avenor App Docs Web",
            type: "WEB_DATA_STREAM",
            measurementId: "G-DOCS882W3M",
            defaultUri: "https://docs.avenor.dev",
          },
        ],
      },
      {
        propertyName: "properties/402918992",
        numericPropertyId: "402918992",
        displayName: "Avenor Web App — Staging",
        accountName: "accounts/9012401",
        accountDisplayName: "Corstack Digital Holdings",
        timeZone: "UTC",
        currencyCode: "USD",
        propertyType: "PROPERTY_TYPE_ORDINARY",
        industryCategory: "TECHNOLOGY",
        serviceLevel: "GOOGLE_ANALYTICS_STANDARD",
        sourceMode: "sandbox_demo",
        dataStreams: [
          {
            streamName: "properties/402918992/dataStreams/71829400",
            streamId: "71829400",
            displayName: "Staging Web Stream",
            type: "WEB_DATA_STREAM",
            measurementId: "G-STG4092K1X",
            defaultUri: "https://staging.avenor.dev",
          },
        ],
      },
      {
        propertyName: "properties/551803210",
        numericPropertyId: "551803210",
        displayName: "EU Commerce Storefront",
        accountName: "accounts/9012885",
        accountDisplayName: "Avenor Europe GmbH",
        timeZone: "Europe/Berlin",
        currencyCode: "EUR",
        propertyType: "PROPERTY_TYPE_ORDINARY",
        industryCategory: "SHOPPING",
        serviceLevel: "GOOGLE_ANALYTICS_STANDARD",
        sourceMode: "sandbox_demo",
        dataStreams: [
          {
            streamName: "properties/551803210/dataStreams/88310205",
            streamId: "88310205",
            displayName: "EU Store Web",
            type: "WEB_DATA_STREAM",
            measurementId: "G-EUCOMM552L",
            defaultUri: "https://eu.avenor.dev",
          },
        ],
      },
    ],
  };
}

/**
 * Discovers accessible GA4 accounts, properties (with timezone/currency), and child data streams.
 * Strictly read-only, rejects missing `analytics.readonly` scope, and never fabricates properties on empty accounts.
 */
export async function discoverGa4PropertiesAndStreams(
  context: ReadOnlyProviderContext,
  options?: {
    fetchFn?: typeof fetch;
    maxPropertiesForEnrichment?: number;
  },
): Promise<Ga4DiscoveryResult> {
  assertGa4ScenarioAndScope(context);

  if (context.accessToken === "sbx_empty_account") {
    return {
      properties: [],
      accountCount: 0,
      pageCount: 1,
      sourceMode: "sandbox_demo",
    };
  }

  const executeLive = shouldExecuteLiveGoogleApi(context, Boolean(options?.fetchFn), "ga4");

  if (!executeLive) {
    return getSandboxGa4DiscoveryFixture();
  }

  const accessToken = context.accessToken ?? "";
  if (!accessToken) {
    throw new ProviderAdapterError({
      providerKey: "ga4",
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "Missing Google Analytics OAuth access token for resource discovery.",
    });
  }

  const { accountSummaries, pageCount } = await listGa4AccountSummaries({
    accessToken,
    fetchFn: options?.fetchFn,
  });

  if (accountSummaries.length === 0) {
    return {
      properties: [],
      accountCount: 0,
      pageCount,
      sourceMode: "live",
    };
  }

  const flattened: Array<{
    accountName: string;
    accountDisplayName: string;
    propertyName: string;
    displayName: string;
    propertyType: string;
  }> = [];

  for (const account of accountSummaries) {
    const accountName = account.account ?? account.name ?? "";
    const accountDisplayName = account.displayName ?? accountName ?? "Google Analytics Account";
    for (const prop of account.propertySummaries ?? []) {
      if (!prop.property) continue;
      flattened.push({
        accountName,
        accountDisplayName,
        propertyName: normalizeGa4PropertyResourceName(prop.property),
        displayName: prop.displayName ?? prop.property,
        propertyType: prop.propertyType ?? "PROPERTY_TYPE_ORDINARY",
      });
    }
  }

  if (flattened.length === 0) {
    return {
      properties: [],
      accountCount: accountSummaries.length,
      pageCount,
      sourceMode: "live",
    };
  }

  const limit = Math.max(1, Math.min(options?.maxPropertiesForEnrichment ?? 25, 100));
  const candidates = flattened.slice(0, limit);
  const properties: Ga4DiscoveredProperty[] = [];

  const batchSize = 4;
  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    const chunk = candidates.slice(offset, offset + batchSize);
    const enrichedChunk = await Promise.all(
      chunk.map(async (item): Promise<Ga4DiscoveredProperty> => {
        let timeZone: string | null = null;
        let currencyCode: string | null = null;
        let industryCategory: string | null = null;
        let serviceLevel: string | null = null;
        let propertyType = item.propertyType;
        let dataStreams: Ga4DataStreamRecord[] = [];
        let streamsErrorNote: string | undefined;

        try {
          const detail = await getGa4PropertyMetadata({
            accessToken,
            propertyName: item.propertyName,
            fetchFn: options?.fetchFn,
          });
          timeZone = detail.timeZone ?? null;
          currencyCode = detail.currencyCode ?? null;
          industryCategory = detail.industryCategory ?? null;
          serviceLevel = detail.serviceLevel ?? null;
          propertyType = detail.propertyType ?? propertyType;
        } catch (err) {
          if (
            err instanceof ProviderAdapterError &&
            (err.code === PROVIDER_ERROR_CODES.CREDENTIAL_EXPIRED ||
              err.code === PROVIDER_ERROR_CODES.UNAUTHORIZED)
          ) {
            throw err;
          }
        }

        try {
          dataStreams = await listGa4PropertyDataStreams({
            accessToken,
            propertyName: item.propertyName,
            fetchFn: options?.fetchFn,
          });
        } catch (err) {
          if (
            err instanceof ProviderAdapterError &&
            (err.code === PROVIDER_ERROR_CODES.CREDENTIAL_EXPIRED ||
              err.code === PROVIDER_ERROR_CODES.UNAUTHORIZED)
          ) {
            throw err;
          }
          streamsErrorNote =
            err instanceof Error
              ? err.message
              : "Data streams could not be inspected with current permissions.";
        }

        return {
          propertyName: item.propertyName,
          numericPropertyId: extractNumericPropertyId(item.propertyName),
          displayName: item.displayName,
          accountName: item.accountName,
          accountDisplayName: item.accountDisplayName,
          timeZone,
          currencyCode,
          propertyType,
          industryCategory,
          serviceLevel,
          dataStreams,
          streamsErrorNote,
          sourceMode: "live",
        };
      }),
    );
    properties.push(...enrichedChunk);
  }

  return {
    properties,
    accountCount: accountSummaries.length,
    pageCount,
    sourceMode: "live",
  };
}

function inferEnvironmentHint(displayName: string, primaryUri?: string): string {
  const combined = `${displayName} ${primaryUri ?? ""}`.toLowerCase();
  if (combined.includes("staging") || combined.includes("stg")) {
    return "STAGING";
  }
  if (combined.includes("dev") || combined.includes("sandbox")) {
    return "DEVELOPMENT";
  }
  return "PRODUCTION";
}

export function mapGa4PropertiesToDiscoveryItems(
  properties: readonly Ga4DiscoveredProperty[],
  availableCapabilities: readonly string[] = ["resource_discovery"],
): readonly DiscoveredExternalResource[] {
  return properties.map((prop) => {
    const primaryWebStream =
      prop.dataStreams.find((s) => s.type === "WEB_DATA_STREAM") ?? prop.dataStreams[0];
    const measurementIds = prop.dataStreams
      .map((s) => s.measurementId)
      .filter((id): id is string => Boolean(id));

    return {
      externalResourceId: prop.propertyName,
      externalResourceName: prop.displayName,
      resourceType: "ga4_property",
      regionOrLocation: prop.timeZone ?? "Property Timezone Unset",
      parentAccountOrOrg: prop.accountDisplayName || prop.accountName,
      availableCapabilities,
      metadata: {
        numericPropertyId: prop.numericPropertyId,
        accountName: prop.accountName,
        accountDisplayName: prop.accountDisplayName,
        timeZone: prop.timeZone,
        currencyCode: prop.currencyCode,
        propertyType: prop.propertyType,
        serviceLevel: prop.serviceLevel,
        streamCount: prop.dataStreams.length,
        primaryStreamId: primaryWebStream?.streamId ?? null,
        primaryMeasurementId: primaryWebStream?.measurementId ?? null,
        primaryStreamUrl: primaryWebStream?.defaultUri ?? null,
        measurementIdsSummary: measurementIds.join(", ") || null,
        dataStreamsJson: JSON.stringify(prop.dataStreams),
        streamsErrorNote: prop.streamsErrorNote ?? null,
        environmentHint: inferEnvironmentHint(prop.displayName, primaryWebStream?.defaultUri),
        sourceMode: prop.sourceMode,
      },
    };
  });
}
