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
