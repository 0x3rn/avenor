export const GSC_READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export const GSC_REPORTING_TIMEZONE = "America/Los_Angeles";
export const GSC_MIN_FINAL_LAG_HOURS = 48;
export const GSC_MAX_FINAL_LAG_HOURS = 72;
export const GSC_MAX_ROW_LIMIT = 25_000;

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

export type GscSearchType = "WEB" | "IMAGE" | "VIDEO" | "NEWS" | "DISCOVER" | "GOOGLE_NEWS";

export type GscDimension = "date" | "query" | "page" | "country" | "device" | "searchAppearance";

export type GscDataState = "final" | "all";

export type GscMetricKey = "clicks" | "impressions" | "ctr" | "position";

export type GscFilterOperator =
  | "equals"
  | "notEquals"
  | "contains"
  | "notContains"
  | "includingRegex"
  | "excludingRegex";

export interface GscDimensionFilter {
  dimension: GscDimension;
  operator: GscFilterOperator;
  expression: string;
}

export interface GscDimensionFilterGroup {
  groupType?: "and";
  filters: GscDimensionFilter[];
}

export interface GscSearchAnalyticsInput {
  siteUrl: string;
  startDate: string; // YYYY-MM-DD in Pacific Time
  endDate: string; // YYYY-MM-DD in Pacific Time
  compareStartDate?: string;
  compareEndDate?: string;
  searchType?: GscSearchType;
  dataState?: GscDataState;
  dimensions?: readonly GscDimension[];
  dimensionFilterGroups?: readonly GscDimensionFilterGroup[];
  rowLimit?: number;
  startRow?: number;
  maxPagesToFetch?: number;
  projectId?: string | null;
}

export interface GscSearchAnalyticsRow {
  keys: string[];
  date?: string;
  query?: string;
  page?: string;
  country?: string;
  device?: string;
  searchAppearance?: string;
  clicks: number;
  impressions: number;
  ctr: number; // Ratio 0..1
  position: number | null; // Average rank weighted by impressions; null when 0 impressions
}

export interface GscSearchAnalyticsTotals {
  clicks: number | null;
  impressions: number | null;
  /**
   * Weighted ratio clicks / impressions (NEVER average of per-row CTRs).
   */
  ctr: number | null;
  /**
   * Impression-weighted average ranking position (NEVER unweighted mean of per-row positions).
   */
  position: number | null;
}

export interface GscDataCoverageMetadata {
  reportingTimeZone: typeof GSC_REPORTING_TIMEZONE;
  dataState: GscDataState;
  finalDataCutoffDate: string;
  expectedLagHours: number;
  hasPreliminaryDatesInWindow: boolean;
  isTopRowLimited: boolean;
  privacyAnonymizedPossible: boolean;
  queryClicksVsTotalClicksGap: {
    unsegmentedClicks: number | null;
    returnedQueryClicks: number | null;
    omittedClicksEstimate: number | null;
  } | null;
  notices: string[];
}

export interface GscSearchAnalyticsBundle {
  siteUrl: string;
  encodedSiteUrl: string;
  propertyKind: GscPropertyKind;
  sourceMode: "live" | "sandbox_demo";
  cacheStatus: "hit" | "miss";
  fetchedAtIso: string;
  searchType: GscSearchType;
  dataState: GscDataState;
  startDate: string;
  endDate: string;
  compareStartDate: string | null;
  compareEndDate: string | null;
  totals: GscSearchAnalyticsTotals;
  comparisonTotals: GscSearchAnalyticsTotals | null;
  dailySeries: GscSearchAnalyticsRow[];
  comparisonDailySeries: GscSearchAnalyticsRow[] | null;
  topQueries: GscSearchAnalyticsRow[];
  topPages: GscSearchAnalyticsRow[];
  byCountry: GscSearchAnalyticsRow[];
  byDevice: GscSearchAnalyticsRow[];
  bySearchAppearance: GscSearchAnalyticsRow[];
  customRows: GscSearchAnalyticsRow[];
  pagination: {
    rowLimit: number;
    startRow: number;
    rowsReturned: number;
    hasMore: boolean;
    pagesFetched: number;
  };
  coverage: GscDataCoverageMetadata;
}

export interface Ga4VsGscReconciliationNote {
  topic:
    | "clicks_vs_sessions"
    | "timezone_alignment"
    | "freshness_lag"
    | "property_scope"
    | "privacy_and_sampling";
  title: string;
  summary: string;
  severity: "info" | "warning";
}

export interface Ga4VsGscReconciliationSummary {
  ga4PropertyName: string | null;
  ga4ReportingTimeZone: string | null;
  gscSiteUrl: string | null;
  gscPropertyKind: GscPropertyKind | null;
  gscReportingTimeZone: typeof GSC_REPORTING_TIMEZONE;
  timezoneOffsetMismatch: boolean;
  ga4TotalSessions: number | null;
  ga4OrganicSessions: number | null;
  ga4ActiveUsers: number | null;
  gscClicks: number | null;
  gscImpressions: number | null;
  gscCtr: number | null;
  gscPosition: number | null;
  /**
   * Informational diagnostic ratio: gscClicks / ga4OrganicSessions when both are positive.
   * Never treats GSC clicks as equivalent to GA4 sessions or users.
   */
  clickToOrganicSessionRatio: number | null;
  scopeAlignmentStatus: "ALIGNED" | "PARTIAL_SUBSET" | "MISMATCHED_CANONICAL" | "INCOMPLETE";
  notes: Ga4VsGscReconciliationNote[];
}
