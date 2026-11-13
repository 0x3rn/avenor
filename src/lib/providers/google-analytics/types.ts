export const GA4_READONLY_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export type Ga4DataStreamType =
  | "WEB_DATA_STREAM"
  | "ANDROID_APP_DATA_STREAM"
  | "IOS_APP_DATA_STREAM"
  | string;

export interface Ga4DataStreamRecord {
  streamName: string;
  streamId: string;
  displayName: string;
  type: Ga4DataStreamType;
  measurementId?: string;
  defaultUri?: string;
  firebaseAppId?: string;
  appPackageOrBundleId?: string;
}

export type Ga4PropertyType =
  | "PROPERTY_TYPE_ORDINARY"
  | "PROPERTY_TYPE_SUBPROPERTY"
  | "PROPERTY_TYPE_ROLLUP"
  | string;

export interface Ga4DiscoveredProperty {
  propertyName: string; // Canonical "properties/123456"
  numericPropertyId: string;
  displayName: string;
  accountName: string; // Canonical "accounts/987654"
  accountDisplayName: string;
  timeZone: string | null;
  currencyCode: string | null;
  propertyType: Ga4PropertyType;
  industryCategory: string | null;
  serviceLevel: string | null;
  dataStreams: Ga4DataStreamRecord[];
  streamsErrorNote?: string;
  sourceMode: "live" | "sandbox_demo";
}

export interface Ga4DiscoveryResult {
  properties: Ga4DiscoveredProperty[];
  accountCount: number;
  pageCount: number;
  sourceMode: "live" | "sandbox_demo";
}

export type Ga4MetricUnit = "users" | "sessions" | "views" | "events" | "ratio" | "seconds";

export type Ga4AggregationRule = "sum" | "non_additive_across_properties" | "weighted_ratio";

export interface Ga4MetricDictionaryEntry {
  apiName: string;
  avenorKey: string;
  label: string;
  description: string;
  unit: Ga4MetricUnit;
  aggregationRule: Ga4AggregationRule;
  crossPropertySummable: boolean;
  caveat: string;
}

export interface Ga4DimensionDictionaryEntry {
  apiName: string;
  avenorKey: string;
  label: string;
  description: string;
  realtimeSupported: boolean;
  standardSupported: boolean;
}

export interface Ga4KeyEventDefinition {
  name: string;
  eventName: string;
  countingMethod: string | null;
  defaultValue: number | null;
  currencyCode: string | null;
}

export interface Ga4DataQualityFlags {
  isSampled: boolean;
  samplingRatePct: number | null;
  isThresholded: boolean;
  hasOtherRowTruncation: boolean;
  emptyReason: string | null;
  notices: string[];
}

export interface Ga4QuotaSnapshot {
  tokensRemainingDay: number | null;
  tokensRemainingHour: number | null;
  tokensConsumed: number | null;
}

export interface Ga4DateSeriesPoint {
  date: string; // YYYY-MM-DD in property reporting timezone
  activeUsers: number | null;
  totalUsers: number | null;
  newUsers: number | null;
  sessions: number | null;
  engagedSessions: number | null;
  engagementRate: number | null;
  screenPageViews: number | null;
  eventCount: number | null;
  averageSessionDuration: number | null;
  keyEvents: number | null;
}

export interface Ga4BreakdownRow {
  dimensionValue: string;
  secondaryDimensionValue?: string;
  activeUsers: number | null;
  sessions: number | null;
  engagedSessions: number | null;
  engagementRate: number | null;
  screenPageViews: number | null;
  eventCount: number | null;
  keyEvents: number | null;
}

export interface Ga4OverviewTotals {
  activeUsers: number | null;
  totalUsers: number | null;
  newUsers: number | null;
  sessions: number | null;
  engagedSessions: number | null;
  engagementRate: number | null;
  screenPageViews: number | null;
  eventCount: number | null;
  averageSessionDuration: number | null;
  keyEvents: number | null;
}

export interface Ga4StandardReportInput {
  propertyId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  compareStartDate?: string;
  compareEndDate?: string;
  projectId?: string | null;
  propertyTimeZone?: string | null;
  currencyCode?: string | null;
}

export interface Ga4StandardReportBundle {
  propertyName: string;
  numericPropertyId: string;
  reportingTimeZone: string;
  currencyCode: string | null;
  sourceMode: "live" | "sandbox_demo";
  cacheStatus: "hit" | "miss";
  fetchedAtIso: string;
  startDate: string;
  endDate: string;
  compareStartDate: string | null;
  compareEndDate: string | null;
  totals: Ga4OverviewTotals;
  comparisonTotals: Ga4OverviewTotals | null;
  dailySeries: Ga4DateSeriesPoint[];
  comparisonSeries: Ga4DateSeriesPoint[] | null;
  channels: Ga4BreakdownRow[];
  sourceMediums: Ga4BreakdownRow[];
  landingPages: Ga4BreakdownRow[];
  topPages: Ga4BreakdownRow[];
  devices: Ga4BreakdownRow[];
  countries: Ga4BreakdownRow[];
  cities: Ga4BreakdownRow[];
  topEvents: Ga4BreakdownRow[];
  keyEventDefinitions: Ga4KeyEventDefinition[];
  dataQuality: Ga4DataQualityFlags;
  quota: Ga4QuotaSnapshot;
}

export interface Ga4CompatibilityResult {
  compatible: boolean;
  incompatibleMetrics: string[];
  incompatibleDimensions: string[];
  checkedViaRemoteApi: boolean;
  reasons: string[];
}

export interface Ga4RealtimeDimensionRow {
  dimensionValues: Record<string, string>;
  activeUsers: number | null;
  screenPageViews: number | null;
  eventCount: number | null;
}

export interface Ga4RealtimeReportBundle {
  propertyName: string;
  sourceMode: "live" | "sandbox_demo";
  windowMinutes: 30;
  windowLabel: string;
  observedAtIso: string;
  freshnessSeconds: number;
  activeUsersLast30m: number | null;
  screenPageViewsLast30m: number | null;
  eventCountLast30m: number | null;
  minuteTrend: Array<{
    minutesAgo: number;
    activeUsers: number | null;
  }>;
  byCountry: Ga4RealtimeDimensionRow[];
  byDevice: Ga4RealtimeDimensionRow[];
  byScreenOrPage: Ga4RealtimeDimensionRow[];
  isEstimateNotice: string;
  rateLimited: boolean;
  retryAfterSeconds: number | null;
  stale: boolean;
}
