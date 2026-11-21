import {
  type DiscoveredExternalResource,
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import { evaluateBackendCredentialSafety } from "../backend-feasibility";
import {
  executeGoogleReadRequest,
  GOOGLE_CLOUD_MONITORING_V3_BASE,
  shouldExecuteLiveGoogleApi,
} from "../google-shared/http";
import {
  FIREBASE_MONITORING_PROVIDER_KEY,
  type FirebaseMonitoredProjectRecord,
  GOOGLE_MONITORING_READ_SCOPE,
} from "./types";

interface CloudMonitoringResourceDescriptorsResponse {
  resourceDescriptors?: Array<{
    type?: string;
    displayName?: string;
  }>;
}

interface CloudMonitoringMetricDescriptorsResponse {
  metricDescriptors?: Array<{
    type?: string;
    metricKind?: string;
    valueType?: string;
  }>;
}

export function hasMonitoringReadScope(grantedScopes: readonly string[]): boolean {
  return grantedScopes.includes(GOOGLE_MONITORING_READ_SCOPE);
}

export function assertFirebaseMonitoringCredentialAndSimulation(context: ReadOnlyProviderContext): {
  accessToken: string;
} {
  if (!context.organizationId || !context.workspaceId) {
    throw new ProviderAdapterError({
      providerKey: FIREBASE_MONITORING_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message:
        "Workspace and organization context are required for Firebase / Cloud Monitoring read-only access.",
    });
  }

  switch (context.simulationScenario) {
    case "expired_token":
      throw new ProviderAdapterError({
        providerKey: FIREBASE_MONITORING_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.CREDENTIAL_EXPIRED,
        message: "Google Cloud Monitoring OAuth access token has expired.",
      });
    case "revoked_token":
      throw new ProviderAdapterError({
        providerKey: FIREBASE_MONITORING_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
        message: "Google Cloud Monitoring OAuth authorization grant was revoked.",
      });
    case "rate_limited":
      throw new ProviderAdapterError({
        providerKey: FIREBASE_MONITORING_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.RATE_LIMITED,
        message: "Google Cloud Monitoring API v3 quota reached (HTTP 429).",
        retryable: true,
        retryAfterSeconds: 60,
      });
    case "provider_unavailable":
      throw new ProviderAdapterError({
        providerKey: FIREBASE_MONITORING_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
        message: "Google Cloud Monitoring API v3 is temporarily unreachable (HTTP 503).",
        retryable: true,
        retryAfterSeconds: 30,
      });
    case "malformed_response":
      throw new ProviderAdapterError({
        providerKey: FIREBASE_MONITORING_PROVIDER_KEY,
        code: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
        message: "Google Cloud Monitoring API v3 returned an unexpected JSON schema.",
        retryable: false,
      });
    default:
      break;
  }

  const rawToken = (context.accessToken ?? context.apiToken ?? "").trim();
  if (!rawToken) {
    throw new ProviderAdapterError({
      providerKey: FIREBASE_MONITORING_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.UNAUTHORIZED,
      message: "Missing Google OAuth token with `monitoring.read` scope.",
    });
  }

  const isAdminSdk =
    rawToken.includes('"private_key"') ||
    rawToken.includes("BEGIN PRIVATE KEY") ||
    rawToken.includes("firebase-adminsdk");

  const safetyVerdict = evaluateBackendCredentialSafety({
    providerKey: "firebase-monitoring",
    credentialType: isAdminSdk ? "firebase_admin_sdk_key" : "oauth2_access_token",
    rawTokenPreview: rawToken,
    grantedScopes:
      context.grantedScopes.length > 0 ? context.grantedScopes : [GOOGLE_MONITORING_READ_SCOPE],
  });

  if (!safetyVerdict.accepted && safetyVerdict.status === "UNSAFE") {
    throw new ProviderAdapterError({
      providerKey: FIREBASE_MONITORING_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
      message: safetyVerdict.reason,
      retryable: false,
    });
  }

  return { accessToken: rawToken };
}

const DETERMINISTIC_FIREBASE_PROJECTS: readonly FirebaseMonitoredProjectRecord[] = [
  {
    gcpProjectId: "avenor-cloud-prod",
    displayName: "Core Web App — Firebase & GCP Production",
    region: "us-central1",
    firestoreEnabled: true,
    cloudFunctionsEnabled: true,
    cloudStorageEnabled: true,
    securityRulesTelemetryActive: true,
  },
];

export async function discoverFirebaseMonitoredProjects(
  context: ReadOnlyProviderContext,
  options?: {
    fetchFn?: typeof fetch;
    targetProjectIds?: readonly string[];
  },
): Promise<readonly FirebaseMonitoredProjectRecord[]> {
  const { accessToken } = assertFirebaseMonitoringCredentialAndSimulation(context);

  if (
    !hasMonitoringReadScope(context.grantedScopes) ||
    context.simulationScenario === "missing_scope"
  ) {
    throw new ProviderAdapterError({
      providerKey: FIREBASE_MONITORING_PROVIDER_KEY,
      code: PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE,
      message: `Missing required Google OAuth scope \`${GOOGLE_MONITORING_READ_SCOPE}\` for Firebase / Cloud Monitoring discovery.`,
      missingScopes: [GOOGLE_MONITORING_READ_SCOPE],
    });
  }

  if (
    !shouldExecuteLiveGoogleApi(
      context,
      Boolean(options?.fetchFn),
      FIREBASE_MONITORING_PROVIDER_KEY,
    )
  ) {
    return DETERMINISTIC_FIREBASE_PROJECTS;
  }

  const projectIds = options?.targetProjectIds ?? ["avenor-cloud-prod"];
  const discovered: FirebaseMonitoredProjectRecord[] = [];

  for (const projectId of projectIds) {
    const [resourceDescPayload, metricDescPayload] = await Promise.all([
      executeGoogleReadRequest<CloudMonitoringResourceDescriptorsResponse>({
        providerKey: FIREBASE_MONITORING_PROVIDER_KEY,
        url: `${GOOGLE_CLOUD_MONITORING_V3_BASE}/projects/${encodeURIComponent(projectId)}/monitoredResourceDescriptors`,
        method: "GET",
        accessToken,
        fetchFn: options?.fetchFn,
      }),
      executeGoogleReadRequest<CloudMonitoringMetricDescriptorsResponse>({
        providerKey: FIREBASE_MONITORING_PROVIDER_KEY,
        url: `${GOOGLE_CLOUD_MONITORING_V3_BASE}/projects/${encodeURIComponent(projectId)}/metricDescriptors`,
        method: "GET",
        accessToken,
        fetchFn: options?.fetchFn,
      }),
    ]);

    const resourceTypes = new Set(
      (resourceDescPayload.resourceDescriptors ?? []).map((r) => r.type ?? ""),
    );
    const metricTypes = new Set(
      (metricDescPayload.metricDescriptors ?? []).map((m) => m.type ?? ""),
    );

    discovered.push({
      gcpProjectId: projectId,
      displayName: `${projectId} (Firebase & Cloud Monitoring)`,
      region: "us-central1",
      firestoreEnabled:
        resourceTypes.has("firestore_instance") ||
        metricTypes.has("firestore.googleapis.com/document/read_count"),
      cloudFunctionsEnabled:
        resourceTypes.has("cloud_function") ||
        metricTypes.has("cloudfunctions.googleapis.com/function/execution_count"),
      cloudStorageEnabled:
        resourceTypes.has("gcs_bucket") ||
        metricTypes.has("storage.googleapis.com/storage/total_bytes"),
      securityRulesTelemetryActive: metricTypes.has(
        "firestore.googleapis.com/rules/evaluation_count",
      ),
    });
  }

  return discovered;
}

export function mapFirebaseMonitoredProjectsToExternalResources(
  projects: readonly FirebaseMonitoredProjectRecord[],
  grantedScopes: readonly string[],
): readonly DiscoveredExternalResource[] {
  const availableCapabilities = hasMonitoringReadScope(grantedScopes)
    ? ["resource_discovery", "firebase_telemetry"]
    : [];

  return projects.map((project) => ({
    externalResourceId: `firebase-project:${project.gcpProjectId}`,
    externalResourceName: project.displayName,
    resourceType: "firebase_gcp_project",
    regionOrLocation: project.region,
    parentAccountOrOrg: "Google Cloud / Firebase",
    availableCapabilities,
    metadata: {
      environmentHint: "PRODUCTION",
      gcpProjectId: project.gcpProjectId,
      firestoreEnabled: project.firestoreEnabled,
      cloudFunctionsEnabled: project.cloudFunctionsEnabled,
      cloudStorageEnabled: project.cloudStorageEnabled,
      securityRulesTelemetryActive: project.securityRulesTelemetryActive,
      adminSdkRejectedByDefault: true,
      intrinsicProviderReadOnly: true,
    },
  }));
}
