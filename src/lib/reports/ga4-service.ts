import type { AuthenticatedSessionContext } from "@avenor/auth";
import {
  type AvenorUxState,
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import {
  type ProjectTelemetryBindingResolution,
  type ResolvedProjectBindingOption,
  resolveProjectProviderTelemetryContext,
} from "@/lib/connections/project-telemetry";
import {
  type Ga4RealtimeReportBundle,
  readGa4RealtimeReportBundle,
} from "@/lib/providers/google-analytics";

export interface ProjectGa4RealtimeResponseDto {
  projectId: string;
  projectName: string;
  primaryDomain: string | null;
  status: "ready" | "blocked";
  uxState: AvenorUxState;
  message: string | null;
  actionLabel: string | null;
  actionHref: string | null;
  selectedBinding: ResolvedProjectBindingOption | null;
  availableBindings: ResolvedProjectBindingOption[];
  workspaceUnmappedCount: number;
  realtime: Ga4RealtimeReportBundle | null;
}

function handleRealtimeProviderError(
  resolution: ProjectTelemetryBindingResolution,
  binding: ResolvedProjectBindingOption,
  allBindings: ResolvedProjectBindingOption[],
  err: ProviderAdapterError,
): ProjectGa4RealtimeResponseDto {
  return {
    projectId: resolution.projectId,
    projectName: resolution.projectName,
    primaryDomain: resolution.primaryDomain,
    status: "blocked",
    uxState: err.uxState,
    message: err.message,
    actionLabel:
      err.code === PROVIDER_ERROR_CODES.CREDENTIAL_EXPIRED ||
      err.code === PROVIDER_ERROR_CODES.UNAUTHORIZED ||
      err.code === PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE
        ? "Reconnect Google Analytics"
        : err.code === PROVIDER_ERROR_CODES.RATE_LIMITED
          ? "Retry after quota window"
          : "Inspect GA4 connection",
    actionHref: "/connections?provider=ga4",
    selectedBinding: binding,
    availableBindings: allBindings,
    workspaceUnmappedCount: 0,
    realtime: null,
  };
}

/**
 * Queries project-scoped GA4 Realtime activity (30-minute rolling window estimate)
 * using the active workspace's mapped GA4 property and vaulted read-only token.
 */
export async function getProjectGa4RealtimeTelemetry(
  session: AuthenticatedSessionContext | null,
  projectId: string,
  options?: {
    environmentId?: string | null;
    resourceId?: string | null;
    bypassCache?: boolean;
    fetchFn?: typeof fetch;
    simulationScenario?: ReadOnlyProviderContext["simulationScenario"];
  },
): Promise<{ statusCode: number; payload: ProjectGa4RealtimeResponseDto }> {
  const resolution = await resolveProjectProviderTelemetryContext(session, projectId, "ga4", {
    environmentId: options?.environmentId,
    resourceId: options?.resourceId,
    simulationScenario: options?.simulationScenario,
  });

  if (resolution.state.kind === "blocked") {
    return {
      statusCode: 200,
      payload: {
        projectId: resolution.projectId,
        projectName: resolution.projectName,
        primaryDomain: resolution.primaryDomain,
        status: "blocked",
        uxState: resolution.state.uxState,
        message: resolution.state.message,
        actionLabel: resolution.state.actionLabel,
        actionHref: resolution.state.actionHref,
        selectedBinding: resolution.state.availableBindings[0] ?? null,
        availableBindings: resolution.state.availableBindings,
        workspaceUnmappedCount: resolution.state.workspaceUnmappedCount,
        realtime: null,
      },
    };
  }

  const { binding, allBindings, providerContext } = resolution.state;

  try {
    const realtime = await readGa4RealtimeReportBundle(
      providerContext,
      {
        propertyId: binding.externalResourceId,
        projectId: resolution.projectId,
      },
      {
        fetchFn: options?.fetchFn,
        bypassCache: options?.bypassCache,
      },
    );

    const uxState: AvenorUxState = realtime.rateLimited
      ? "rate_limited"
      : realtime.stale
        ? "stale_cached"
        : "connected_healthy";

    return {
      statusCode: 200,
      payload: {
        projectId: resolution.projectId,
        projectName: resolution.projectName,
        primaryDomain: resolution.primaryDomain,
        status: "ready",
        uxState,
        message: realtime.rateLimited
          ? `GA4 Realtime API rate limit hit; showing stale snapshot (${realtime.freshnessSeconds}s old).`
          : realtime.stale
            ? `Showing cached realtime snapshot (${realtime.freshnessSeconds}s old).`
            : null,
        actionLabel: null,
        actionHref: null,
        selectedBinding: binding,
        availableBindings: allBindings,
        workspaceUnmappedCount: 0,
        realtime,
      },
    };
  } catch (err) {
    if (err instanceof ProviderAdapterError) {
      const dto = handleRealtimeProviderError(resolution, binding, allBindings, err);
      return {
        statusCode: err.code === PROVIDER_ERROR_CODES.RATE_LIMITED ? 429 : 200,
        payload: dto,
      };
    }
    throw err;
  }
}
