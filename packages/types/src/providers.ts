import type { ConnectionHealthStatus } from "./domain";
import { AppError, ERROR_CODES, redactSensitiveText } from "./errors";
import { type AvenorUxState, canRenderNumericValue } from "./ux-states";

export const PROVIDER_CATEGORIES = [
  "analytics",
  "search",
  "cloud_billing",
  "database_backend",
  "hosting_edge",
  "delivery_reliability",
  "sandbox",
] as const;

export type ProviderCategory = (typeof PROVIDER_CATEGORIES)[number];

export const PROVIDER_CATEGORY_LABELS: Record<ProviderCategory, string> = {
  analytics: "Product & Web Analytics",
  search: "Search & Organic Visibility",
  cloud_billing: "Cloud FinOps & Billing",
  database_backend: "Database & Backend Runtime",
  hosting_edge: "Edge, Hosting & CDN",
  delivery_reliability: "Delivery & Error Telemetry",
  sandbox: "Verification & Sandbox",
};

export const PROVIDER_AUTH_MODES = ["oauth2", "api_token", "service_account", "sandbox"] as const;
export type ProviderAuthMode = (typeof PROVIDER_AUTH_MODES)[number];

export const PROVIDER_AVAILABILITY_STATUSES = [
  "active_sandbox",
  "oauth_framework_ready",
  "planned_milestone",
] as const;
export type ProviderAvailabilityStatus = (typeof PROVIDER_AVAILABILITY_STATUSES)[number];

export const CAPABILITY_STATUSES = [
  "SUPPORTED",
  "MISSING_PERMISSION",
  "UNSUPPORTED_BY_PROVIDER",
  "PLAN_RESTRICTED",
  "PREVIEW_ONLY",
] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

export const CAPABILITY_GRANULARITIES = [
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "realtimeSnapshot",
] as const;
export type CapabilityGranularity = (typeof CAPABILITY_GRANULARITIES)[number];

export const FORBIDDEN_PROVIDER_MUTATION_METHODS = [
  "executeArbitrarySQL",
  "executeSql",
  "updateResource",
  "deleteResource",
  "createResource",
  "deployProject",
  "triggerDeployment",
  "modifyUser",
  "modifyPolicy",
  "changeBillingSettings",
  "mutateSource",
  "writeExternal",
] as const;

export type ForbiddenProviderMutationMethod = (typeof FORBIDDEN_PROVIDER_MUTATION_METHODS)[number];

/**
 * Compile-time guarantee prohibiting any source mutation method on a provider adapter.
 */
export type ProhibitMutationMethods = {
  readonly [K in ForbiddenProviderMutationMethod]?: never;
};

export const PROVIDER_ERROR_CODES = {
  UNAUTHORIZED: "UNAUTHORIZED",
  INSUFFICIENT_SCOPE: "INSUFFICIENT_SCOPE",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  RESOURCE_UNAVAILABLE: "RESOURCE_UNAVAILABLE",
  UNSUPPORTED_CAPABILITY: "UNSUPPORTED_CAPABILITY",
  RATE_LIMITED: "RATE_LIMITED",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  CREDENTIAL_EXPIRED: "CREDENTIAL_EXPIRED",
  PROVIDER_RESPONSE_INVALID: "PROVIDER_RESPONSE_INVALID",
} as const;

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[keyof typeof PROVIDER_ERROR_CODES];

export function mapProviderErrorCodeToUxState(code: ProviderErrorCode): AvenorUxState {
  switch (code) {
    case PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE:
    case PROVIDER_ERROR_CODES.PERMISSION_DENIED:
    case PROVIDER_ERROR_CODES.UNAUTHORIZED:
    case PROVIDER_ERROR_CODES.CREDENTIAL_EXPIRED:
      return "permission_insufficient";
    case PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY:
      return "unsupported_plan";
    case PROVIDER_ERROR_CODES.RATE_LIMITED:
      return "rate_limited";
    case PROVIDER_ERROR_CODES.RESOURCE_NOT_FOUND:
    case PROVIDER_ERROR_CODES.RESOURCE_UNAVAILABLE:
    case PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE:
    case PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID:
      return "provider_error";
  }
}

export function mapProviderErrorCodeToHealthStatus(
  code: ProviderErrorCode,
): ConnectionHealthStatus {
  switch (code) {
    case PROVIDER_ERROR_CODES.CREDENTIAL_EXPIRED:
      return "TOKEN_EXPIRED";
    case PROVIDER_ERROR_CODES.UNAUTHORIZED:
      return "REVOKED";
    case PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE:
    case PROVIDER_ERROR_CODES.PERMISSION_DENIED:
      return "PERMISSION_MISSING";
    case PROVIDER_ERROR_CODES.RATE_LIMITED:
      return "RATE_LIMITED";
    case PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE:
    case PROVIDER_ERROR_CODES.RESOURCE_UNAVAILABLE:
      return "PROVIDER_UNAVAILABLE";
    case PROVIDER_ERROR_CODES.RESOURCE_NOT_FOUND:
    case PROVIDER_ERROR_CODES.UNSUPPORTED_CAPABILITY:
    case PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID:
      return "DEGRADED";
  }
}

export class ProviderAdapterError extends Error {
  public readonly providerKey: string;
  public readonly code: ProviderErrorCode;
  public readonly retryable: boolean;
  public readonly retryAfterSeconds?: number;
  public readonly missingScopes: readonly string[];
  public readonly uxState: AvenorUxState;
  public readonly healthStatus: ConnectionHealthStatus;

  constructor(options: {
    providerKey: string;
    code: ProviderErrorCode;
    message: string;
    retryable?: boolean;
    retryAfterSeconds?: number;
    missingScopes?: readonly string[];
    cause?: unknown;
  }) {
    super(redactSensitiveText(options.message), { cause: options.cause });
    this.name = "ProviderAdapterError";
    this.providerKey = options.providerKey;
    this.code = options.code;
    this.retryable =
      options.retryable ??
      (options.code === PROVIDER_ERROR_CODES.RATE_LIMITED ||
        options.code === PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE ||
        options.code === PROVIDER_ERROR_CODES.RESOURCE_UNAVAILABLE);
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.missingScopes = options.missingScopes ?? [];
    this.uxState = mapProviderErrorCodeToUxState(options.code);
    this.healthStatus = mapProviderErrorCodeToHealthStatus(options.code);
  }

  public toAppError(): AppError {
    const isRateLimit = this.code === PROVIDER_ERROR_CODES.RATE_LIMITED;
    return new AppError({
      code: isRateLimit ? ERROR_CODES.RATE_LIMITED : ERROR_CODES.EXTERNAL_PROVIDER_ERROR,
      message: redactSensitiveText(this.message),
      details: {
        providerKey: this.providerKey,
        providerErrorCode: this.code,
        uxState: this.uxState,
        healthStatus: this.healthStatus,
        ...(this.missingScopes.length > 0 ? { missingScopes: [...this.missingScopes] } : {}),
      },
      cause: this,
    });
  }
}

export interface ProviderRateLimitPolicy {
  requestsPerMinute: number;
  burstLimit: number;
  retryStrategy: "exponential_backoff" | "retry_after_header";
}

export interface ProviderCapabilityDescriptor {
  capabilityKey: string;
  label: string;
  description: string;
  requiredScopes: readonly string[];
  requiredPermissions: readonly string[];
  supportedGranularities: readonly CapabilityGranularity[];
  supportedDimensions: readonly string[];
  expectedLatencyMinutes: number;
  freshnessWindowMinutes: number;
  rateLimitPolicy: ProviderRateLimitPolicy;
  requiresPaidProviderPlan?: boolean;
  defaultStatus?: CapabilityStatus;
}

export interface EvaluatedProviderCapability extends ProviderCapabilityDescriptor {
  status: CapabilityStatus;
  statusExplanation: string;
  missingScopes: readonly string[];
  uxState: AvenorUxState;
  allowsNumericMetric: boolean;
}

export interface ProviderCatalogEntry {
  providerKey: string;
  displayName: string;
  shortName: string;
  category: ProviderCategory;
  authMode: ProviderAuthMode;
  availabilityStatus: ProviderAvailabilityStatus;
  targetMilestone: "M02" | "M03" | "M04" | "M06" | "M07" | "M08";
  summary: string;
  readOnlyGuaranteeText: string;
  prohibitedOperationsSummary: readonly string[];
  resourceTypeLabel: string;
  resourceTypeKey: string;
  oauthAuthorizeUrl?: string;
  oauthTokenUrl?: string;
  oauthRevokeUrl?: string;
  defaultScopes: readonly string[];
  capabilities: readonly ProviderCapabilityDescriptor[];
}

export interface DiscoveredExternalResource {
  externalResourceId: string;
  externalResourceName: string;
  resourceType: string;
  regionOrLocation: string | null;
  parentAccountOrOrg: string | null;
  availableCapabilities: readonly string[];
  metadata: Record<string, string | number | boolean | null>;
}

export interface ProviderMetricQuery {
  externalResourceId: string;
  capabilityKey: string;
  metricKey: string;
  granularity: CapabilityGranularity;
  startDateIso: string;
  endDateIso: string;
  dimensions?: readonly string[];
}

export interface ProviderMetricPoint {
  timestampIso: string;
  metricKey: string;
  /**
   * Null when state does not permit numeric metrics (e.g., MISSING_PERMISSION,
   * UNSUPPORTED_BY_PROVIDER, PLAN_RESTRICTED). Never fabricate numeric 0.
   */
  value: number | null;
  unit: string;
  dimensions?: Record<string, string>;
}

export interface ProviderMetricReadResult {
  providerKey: string;
  externalResourceId: string;
  capabilityKey: string;
  metricKey: string;
  capabilityStatus: CapabilityStatus;
  uxState: AvenorUxState;
  observedAtIso: string;
  sourceFreshnessMinutes: number;
  provenanceLabel: string;
  statusExplanation: string;
  points: readonly ProviderMetricPoint[];
}

export interface ProviderConnectionHealthSnapshot {
  providerKey: string;
  status: ConnectionHealthStatus;
  uxState: AvenorUxState;
  checkedAtIso: string;
  latencyMs: number;
  grantedScopes: readonly string[];
  missingScopes: readonly string[];
  message: string;
  errorCode?: ProviderErrorCode;
}

export interface ReadOnlyProviderContext {
  organizationId: string;
  workspaceId: string;
  connectionId?: string;
  accessToken?: string;
  apiToken?: string;
  grantedScopes: readonly string[];
  providerPlanTier?: "free" | "pro" | "enterprise";
  simulationScenario?:
    | "healthy"
    | "missing_scope"
    | "plan_restricted"
    | "rate_limited"
    | "expired_token"
    | "revoked_token"
    | "provider_unavailable"
    | "malformed_response";
}

export interface ProviderCredentialValidationResult {
  valid: boolean;
  externalAccountId: string;
  externalAccountLabel: string;
  grantedScopes: readonly string[];
  missingRequiredScopes: readonly string[];
  healthStatus: ConnectionHealthStatus;
  capabilities: readonly EvaluatedProviderCapability[];
}

export interface ReadOnlyProviderAdapter extends ProhibitMutationMethods {
  readonly providerKey: string;
  readonly displayName: string;
  readonly category: ProviderCategory;
  readonly authMode: ProviderAuthMode;
  readonly readOnlyGuaranteed: true;
  readonly catalogEntry: ProviderCatalogEntry;

  validateCredentials(
    context: ReadOnlyProviderContext,
  ): Promise<ProviderCredentialValidationResult>;
  discoverResources(
    context: ReadOnlyProviderContext,
  ): Promise<readonly DiscoveredExternalResource[]>;
  getCapabilities(
    context: ReadOnlyProviderContext,
  ): Promise<readonly EvaluatedProviderCapability[]>;
  getConnectionHealth(context: ReadOnlyProviderContext): Promise<ProviderConnectionHealthSnapshot>;
  readMetrics(
    context: ReadOnlyProviderContext,
    query: ProviderMetricQuery,
  ): Promise<ProviderMetricReadResult>;
}

/**
 * Runtime contract guard that verifies an adapter strictly conforms to Avenor's
 * read-only provider contract and exposes zero mutation methods.
 */
export function assertReadOnlyAdapterContract(
  adapter: unknown,
): asserts adapter is ReadOnlyProviderAdapter {
  if (!adapter || typeof adapter !== "object") {
    throw new AppError({
      code: ERROR_CODES.PRODUCTION_SAFETY_VIOLATION,
      message: "Invalid provider adapter: expected non-null object.",
    });
  }

  const record = adapter as Record<string, unknown>;

  if (record.readOnlyGuaranteed !== true) {
    throw new AppError({
      code: ERROR_CODES.PRODUCTION_SAFETY_VIOLATION,
      message: `Provider adapter "${String(record.providerKey ?? "unknown")}" violated read-only contract: readOnlyGuaranteed must be true.`,
    });
  }

  for (const forbiddenMethod of FORBIDDEN_PROVIDER_MUTATION_METHODS) {
    if (forbiddenMethod in record && record[forbiddenMethod] !== undefined) {
      throw new AppError({
        code: ERROR_CODES.PRODUCTION_SAFETY_VIOLATION,
        message: `Provider adapter "${String(record.providerKey ?? "unknown")}" exposes prohibited source mutation method "${forbiddenMethod}". External provider access in Avenor is strictly read-only.`,
      });
    }
  }

  const requiredMethods = [
    "validateCredentials",
    "discoverResources",
    "getCapabilities",
    "getConnectionHealth",
    "readMetrics",
  ] as const;

  for (const method of requiredMethods) {
    if (typeof record[method] !== "function") {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Provider adapter "${String(record.providerKey ?? "unknown")}" is missing required read-only method "${method}".`,
      });
    }
  }
}

/**
 * Evaluates a provider's declared capabilities against actual granted OAuth scopes / permissions
 * and provider plan tier. Never fabricates numeric fallback values.
 */
export function evaluateCapabilityMatrix(
  catalogCapabilities: readonly ProviderCapabilityDescriptor[],
  grantedScopes: readonly string[],
  options?: {
    providerPlanTier?: "free" | "pro" | "enterprise";
    restrictedCapabilities?: readonly string[];
    unsupportedCapabilities?: readonly string[];
  },
): EvaluatedProviderCapability[] {
  const grantedSet = new Set(grantedScopes.map((s) => s.trim()));
  const restrictedSet = new Set(options?.restrictedCapabilities ?? []);
  const unsupportedSet = new Set(options?.unsupportedCapabilities ?? []);
  const planTier = options?.providerPlanTier ?? "pro";

  return catalogCapabilities.map((cap) => {
    if (cap.defaultStatus === "UNSUPPORTED_BY_PROVIDER" || unsupportedSet.has(cap.capabilityKey)) {
      return {
        ...cap,
        status: "UNSUPPORTED_BY_PROVIDER",
        statusExplanation:
          "This signal is not exposed by the external provider API. Avenor renders a transparent non-numeric state instead of fabricating 0.",
        missingScopes: [],
        uxState: "unsupported_plan",
        allowsNumericMetric: false,
      };
    }

    const missingScopes = cap.requiredScopes.filter((scope) => !grantedSet.has(scope));
    if (missingScopes.length > 0) {
      return {
        ...cap,
        status: "MISSING_PERMISSION",
        statusExplanation: `Missing required read-only scope: ${missingScopes.join(", ")}. Re-authorize with viewer scope to enable this signal.`,
        missingScopes,
        uxState: "permission_insufficient",
        allowsNumericMetric: false,
      };
    }

    if (
      (cap.requiresPaidProviderPlan && planTier === "free") ||
      restrictedSet.has(cap.capabilityKey) ||
      cap.defaultStatus === "PLAN_RESTRICTED"
    ) {
      return {
        ...cap,
        status: "PLAN_RESTRICTED",
        statusExplanation:
          "The connected external provider account is on a plan tier that restricts access to this telemetry endpoint.",
        missingScopes: [],
        uxState: "unsupported_plan",
        allowsNumericMetric: false,
      };
    }

    if (cap.defaultStatus === "PREVIEW_ONLY") {
      return {
        ...cap,
        status: "PREVIEW_ONLY",
        statusExplanation:
          "Read-only contract verified in Milestone 02; live scheduled ingestion activates in the target provider milestone.",
        missingScopes: [],
        uxState: "connected_healthy",
        allowsNumericMetric: true,
      };
    }

    return {
      ...cap,
      status: "SUPPORTED",
      statusExplanation: `Read-only capability verified. Expected source freshness window: ${cap.freshnessWindowMinutes}m.`,
      missingScopes: [],
      uxState: "connected_healthy",
      allowsNumericMetric: canRenderNumericValue("connected_healthy", 0),
    };
  });
}
