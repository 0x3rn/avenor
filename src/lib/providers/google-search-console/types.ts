export const GSC_READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export type GscPropertyKind = "DOMAIN" | "URL_PREFIX";

export type GscPermissionLevel =
  | "siteOwner"
  | "siteFullUser"
  | "siteRestrictedUser"
  | "siteUnverifiedUser"
  | string;

export interface GscDiscoveredSite {
  siteUrl: string;
  encodedSiteUrl: string;
  propertyKind: GscPropertyKind;
  hostDomain: string;
  urlPrefixProtocol: "http" | "https" | null;
  urlPrefixPath: string | null;
  permissionLevel: GscPermissionLevel;
  verifiedAccess: boolean;
  accessTierLabel: string;
  overlappingSiteUrls: string[];
  sourceMode: "live" | "sandbox_demo";
}

export interface GscDiscoveryResult {
  sites: GscDiscoveredSite[];
  overlapCount: number;
  unverifiedCount: number;
  sourceMode: "live" | "sandbox_demo";
}
