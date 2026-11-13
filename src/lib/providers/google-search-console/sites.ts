import {
  type DiscoveredExternalResource,
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import { sharedGoogleTelemetryCache } from "../google-shared/cache";
import {
  executeGoogleReadRequest,
  GOOGLE_SEARCH_CONSOLE_V3_BASE,
  shouldExecuteLiveGoogleApi,
} from "../google-shared/http";
import {
  GSC_READONLY_SCOPE,
  type GscDiscoveredSite,
  type GscDiscoveryResult,
  type GscPermissionLevel,
  type GscPropertyKind,
} from "./types";

const GSC_DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000;

export interface RawGscSiteEntry {
  siteUrl?: string;
  permissionLevel?: string;
}

interface RawGscSitesListResponse {
  siteEntry?: RawGscSiteEntry[];
}

export interface CanonicalGscSiteParts {
  siteUrl: string;
  encodedSiteUrl: string;
  propertyKind: GscPropertyKind;
  hostDomain: string;
  urlPrefixProtocol: "http" | "https" | null;
  urlPrefixPath: string | null;
}

/**
 * Validates and preserves canonical Google Search Console property identifiers:
 * - Domain property: `sc-domain:example.com`
 * - URL-prefix property: `https://example.com/` or `https://sub.example.com/docs/`
 * Rejects path traversal, credentials, query strings, and malformed formats.
 */
export function normalizeCanonicalGscSiteUrl(rawSiteUrl: string): CanonicalGscSiteParts {
  const trimmed = rawSiteUrl.trim();
  if (!trimmed || trimmed.includes("..") || trimmed.includes("\\")) {
    throw new ProviderAdapterError({
      providerKey: "gsc",
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: `Invalid Search Console property identifier "${trimmed}".`,
    });
  }

  if (trimmed.toLowerCase().startsWith("sc-domain:")) {
    const domainPart = trimmed.slice("sc-domain:".length).trim().toLowerCase();
    if (
      !domainPart ||
      domainPart.includes("/") ||
      domainPart.includes(":") ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
        domainPart,
      )
    ) {
      throw new ProviderAdapterError({
        providerKey: "gsc",
        code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
        message: `Invalid Search Console domain property "${trimmed}". Expected "sc-domain:example.com".`,
      });
    }
    const siteUrl = `sc-domain:${domainPart}`;
    return {
      siteUrl,
      encodedSiteUrl: encodeURIComponent(siteUrl),
      propertyKind: "DOMAIN",
      hostDomain: domainPart,
      urlPrefixProtocol: null,
      urlPrefixPath: null,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ProviderAdapterError({
      providerKey: "gsc",
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: `Invalid Search Console URL-prefix property "${trimmed}". Expected "https://..." or "sc-domain:...".`,
    });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ProviderAdapterError({
      providerKey: "gsc",
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: `Search Console URL-prefix properties must use HTTP or HTTPS ("${trimmed}").`,
    });
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ProviderAdapterError({
      providerKey: "gsc",
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: `Search Console property "${trimmed}" cannot contain credentials, query strings, or hash fragments.`,
    });
  }

  const hostDomain = parsed.hostname.toLowerCase();
  const pathNormalized = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
  const protocolName = parsed.protocol === "http:" ? "http" : "https";
  const siteUrl = `${protocolName}://${parsed.host.toLowerCase()}${pathNormalized}`;

  return {
    siteUrl,
    encodedSiteUrl: encodeURIComponent(siteUrl),
    propertyKind: "URL_PREFIX",
    hostDomain,
    urlPrefixProtocol: protocolName,
    urlPrefixPath: pathNormalized,
  };
}

export function hasGscReadOnlyScope(grantedScopes: readonly string[]): boolean {
  return grantedScopes.includes(GSC_READONLY_SCOPE);
}

export function formatGscPermissionLabel(permissionLevel: GscPermissionLevel): {
  verifiedAccess: boolean;
  accessTierLabel: string;
} {
  switch (permissionLevel) {
    case "siteOwner":
      return { verifiedAccess: true, accessTierLabel: "Verified Owner" };
    case "siteFullUser":
      return { verifiedAccess: true, accessTierLabel: "Full Read User" };
    case "siteRestrictedUser":
      return { verifiedAccess: true, accessTierLabel: "Restricted Read User" };
    case "siteUnverifiedUser":
      return { verifiedAccess: false, accessTierLabel: "Unverified (Read Blocked)" };
    default:
      return {
        verifiedAccess: permissionLevel !== "siteUnverifiedUser",
        accessTierLabel: permissionLevel || "Unknown Permission",
      };
  }
}

export function assertGscScenarioAndScope(context: ReadOnlyProviderContext): void {
  if (!context.organizationId || !context.workspaceId) {
    throw new ProviderAdapterError({
      providerKey: "gsc",
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "Workspace and organization context are required for Search Console access.",
    });
  }

  switch (context.simulationScenario) {
    case "expired_token":
      throw new ProviderAdapterError({
        providerKey: "gsc",
        code: PROVIDER_ERROR_CODES.CREDENTIAL_EXPIRED,
        message: "Google Search Console OAuth access token expired. Refresh or re-authorize.",
      });
    case "revoked_token":
      throw new ProviderAdapterError({
        providerKey: "gsc",
        code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
        message: "Google Search Console OAuth authorization was revoked upstream.",
      });
    case "rate_limited":
      throw new ProviderAdapterError({
        providerKey: "gsc",
        code: PROVIDER_ERROR_CODES.RATE_LIMITED,
        retryable: true,
        retryAfterSeconds: 60,
        message: "Google Search Console API rate limit reached. Retry after cooldown.",
      });
    case "provider_unavailable":
      throw new ProviderAdapterError({
        providerKey: "gsc",
        code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
        retryable: true,
        retryAfterSeconds: 30,
        message: "Google Search Console API temporarily unavailable.",
      });
    case "malformed_response":
      throw new ProviderAdapterError({
        providerKey: "gsc",
        code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
        message: "Google Search Console API returned an unexpected payload schema.",
      });
    case "missing_scope":
      throw new ProviderAdapterError({
        providerKey: "gsc",
        code: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
        missingScopes: [GSC_READONLY_SCOPE],
        message: `Missing required Google Search Console read-only scope: ${GSC_READONLY_SCOPE}.`,
      });
    default:
      break;
  }

  if (!hasGscReadOnlyScope(context.grantedScopes)) {
    throw new ProviderAdapterError({
      providerKey: "gsc",
      code: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
      missingScopes: [GSC_READONLY_SCOPE],
      message: `Google Search Console requires read-only OAuth scope "${GSC_READONLY_SCOPE}".`,
    });
  }
}

export async function listSearchConsoleSites(options: {
  accessToken: string;
  fetchFn?: typeof fetch;
}): Promise<RawGscSiteEntry[]> {
  const url = `${GOOGLE_SEARCH_CONSOLE_V3_BASE}/sites`;
  const data = await executeGoogleReadRequest<RawGscSitesListResponse>({
    providerKey: "gsc",
    method: "GET",
    url,
    accessToken: options.accessToken,
    fetchFn: options.fetchFn,
  });

  if (data.siteEntry !== undefined && !Array.isArray(data.siteEntry)) {
    throw new ProviderAdapterError({
      providerKey: "gsc",
      code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      message: "Google Search Console sites response contained a malformed siteEntry list.",
    });
  }

  return data.siteEntry ?? [];
}

export async function inspectSearchConsoleSite(options: {
  accessToken: string;
  siteUrl: string;
  fetchFn?: typeof fetch;
}): Promise<RawGscSiteEntry> {
  const canonical = normalizeCanonicalGscSiteUrl(options.siteUrl);
  const url = `${GOOGLE_SEARCH_CONSOLE_V3_BASE}/sites/${canonical.encodedSiteUrl}`;
  return executeGoogleReadRequest<RawGscSiteEntry>({
    providerKey: "gsc",
    method: "GET",
    url,
    accessToken: options.accessToken,
    fetchFn: options.fetchFn,
  });
}

function getRootDomainHint(hostDomain: string): string {
  const clean = hostDomain.replace(/^www\./, "").toLowerCase();
  const labels = clean.split(".");
  if (labels.length >= 2) {
    return labels.slice(-2).join(".");
  }
  return clean;
}

function annotateSiteOverlaps(rawSites: Omit<GscDiscoveredSite, "overlappingSiteUrls">[]): {
  sites: GscDiscoveredSite[];
  overlapCount: number;
  unverifiedCount: number;
} {
  let overlapCount = 0;
  let unverifiedCount = 0;

  const sites: GscDiscoveredSite[] = rawSites.map((site) => {
    if (!site.verifiedAccess) {
      unverifiedCount += 1;
    }
    const root = getRootDomainHint(site.hostDomain);
    const others = rawSites
      .filter(
        (candidate) =>
          candidate.siteUrl !== site.siteUrl &&
          (getRootDomainHint(candidate.hostDomain) === root ||
            candidate.hostDomain.endsWith(`.${site.hostDomain}`) ||
            site.hostDomain.endsWith(`.${candidate.hostDomain}`)),
      )
      .map((candidate) => candidate.siteUrl);

    if (others.length > 0) {
      overlapCount += 1;
    }

    return {
      ...site,
      overlappingSiteUrls: others,
    };
  });

  return { sites, overlapCount, unverifiedCount };
}

function buildSandboxSites(context: ReadOnlyProviderContext): RawGscSiteEntry[] {
  if (context.accessToken === "sbx_empty_account") {
    return [];
  }
  if (context.accessToken === "sbx_unverified_only") {
    return [
      { siteUrl: "sc-domain:pending-verify.avenor.dev", permissionLevel: "siteUnverifiedUser" },
    ];
  }

  return [
    { siteUrl: "sc-domain:avenor.dev", permissionLevel: "siteOwner" },
    { siteUrl: "https://avenor.dev/", permissionLevel: "siteFullUser" },
    { siteUrl: "https://staging.avenor.dev/", permissionLevel: "siteRestrictedUser" },
  ];
}

/**
 * Discovers accessible Google Search Console properties using `webmasters.readonly`
 * (`GET /webmasters/v3/sites`), preserves exact domain (`sc-domain:...`) and URL-prefix
 * (`https://.../`) identifiers, checks verification & permission levels, and caches per tenant.
 */
export async function discoverSearchConsoleSites(
  context: ReadOnlyProviderContext,
  options?: {
    fetchFn?: typeof fetch;
    bypassCache?: boolean;
  },
): Promise<GscDiscoveryResult> {
  assertGscScenarioAndScope(context);

  const cacheParts = {
    organizationId: context.organizationId,
    workspaceId: context.workspaceId,
    projectId: null,
    connectionId: context.connectionId ?? "direct",
    providerKey: "gsc",
    externalResourceId: "sites",
    operation: "site_discovery",
    params: {
      tokenDigestHint: options?.fetchFn
        ? "mock_fetch"
        : (context.accessToken?.slice(0, 8) ?? "none"),
    },
  };

  if (!options?.bypassCache && !context.simulationScenario) {
    const cached = sharedGoogleTelemetryCache.get<GscDiscoveryResult>(cacheParts);
    if (cached) {
      return cached.value;
    }
  }

  const executeLive = shouldExecuteLiveGoogleApi(context, Boolean(options?.fetchFn), "gsc");
  const rawEntries = executeLive
    ? await listSearchConsoleSites({
        accessToken: context.accessToken ?? "",
        fetchFn: options?.fetchFn,
      })
    : buildSandboxSites(context);

  const sourceMode: "live" | "sandbox_demo" = executeLive ? "live" : "sandbox_demo";

  const parsedEntries: Omit<GscDiscoveredSite, "overlappingSiteUrls">[] = [];
  for (const entry of rawEntries) {
    if (!entry.siteUrl) continue;
    const canonical = normalizeCanonicalGscSiteUrl(entry.siteUrl);
    const permissionLevel: GscPermissionLevel = entry.permissionLevel ?? "siteUnverifiedUser";
    const { verifiedAccess, accessTierLabel } = formatGscPermissionLabel(permissionLevel);

    parsedEntries.push({
      siteUrl: canonical.siteUrl,
      encodedSiteUrl: canonical.encodedSiteUrl,
      propertyKind: canonical.propertyKind,
      hostDomain: canonical.hostDomain,
      urlPrefixProtocol: canonical.urlPrefixProtocol,
      urlPrefixPath: canonical.urlPrefixPath,
      permissionLevel,
      verifiedAccess,
      accessTierLabel,
      sourceMode,
    });
  }

  const annotated = annotateSiteOverlaps(parsedEntries);
  const result: GscDiscoveryResult = {
    sites: annotated.sites,
    overlapCount: annotated.overlapCount,
    unverifiedCount: annotated.unverifiedCount,
    sourceMode,
  };

  if (!options?.bypassCache && !context.simulationScenario) {
    sharedGoogleTelemetryCache.set(cacheParts, result, GSC_DISCOVERY_CACHE_TTL_MS);
  }

  return result;
}

export function mapGscSitesToDiscoveryItems(
  sites: readonly GscDiscoveredSite[],
  availableCapabilities: readonly string[],
): DiscoveredExternalResource[] {
  return sites.map((site) => {
    const capabilities = site.verifiedAccess
      ? [...availableCapabilities]
      : availableCapabilities.filter((cap) => cap === "resource_discovery");

    const envHint = site.hostDomain.includes("staging")
      ? "STAGING"
      : site.hostDomain.includes("dev.") || site.hostDomain.includes("localhost")
        ? "DEVELOPMENT"
        : "PRODUCTION";

    return {
      externalResourceId: site.siteUrl,
      externalResourceName:
        site.propertyKind === "DOMAIN"
          ? `${site.hostDomain} (Domain Property)`
          : `${site.siteUrl} (URL-Prefix Property)`,
      resourceType: "gsc_site",
      regionOrLocation: "Global",
      parentAccountOrOrg:
        site.propertyKind === "DOMAIN" ? "Search Console Domain" : "Search Console URL-Prefix",
      availableCapabilities: capabilities,
      metadata: {
        environmentHint: envHint,
        propertyKind: site.propertyKind,
        canonicalSiteUrl: site.siteUrl,
        encodedSiteUrl: site.encodedSiteUrl,
        hostDomain: site.hostDomain,
        urlPrefixProtocol: site.urlPrefixProtocol,
        urlPrefixPath: site.urlPrefixPath,
        permissionLevel: site.permissionLevel,
        verifiedAccess: site.verifiedAccess,
        accessTierLabel: site.accessTierLabel,
        overlappingCount: site.overlappingSiteUrls.length,
        overlappingSitesJson:
          site.overlappingSiteUrls.length > 0 ? JSON.stringify(site.overlappingSiteUrls) : null,
        overlapNote:
          site.overlappingSiteUrls.length > 0
            ? `Also verified in this account: ${site.overlappingSiteUrls.join(", ")}. Domain and URL-prefix metrics overlap.`
            : null,
        sourceMode: site.sourceMode,
      },
    };
  });
}
