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
  type Ga4StandardReportBundle,
  readGa4RealtimeReportBundle,
  readGa4StandardReportBundle,
} from "@/lib/providers/google-analytics";
import { type ResolvedReportDateWindow, resolveReportDateWindow } from "./date-window";

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

export interface ProjectGa4StandardResponseDto {
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
  window: ResolvedReportDateWindow;
  report: Ga4StandardReportBundle | null;
  realtime: Ga4RealtimeReportBundle | null;
}

function buildBlockedActionLabel(err: ProviderAdapterError): string {
  if (
    err.code === PROVIDER_ERROR_CODES.CREDENTIAL_EXPIRED ||
    err.code === PROVIDER_ERROR_CODES.UNAUTHORIZED ||
    err.code === PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE
  ) {
    return "Reconnect Google Analytics";
  }
  if (err.code === PROVIDER_ERROR_CODES.RATE_LIMITED) {
    return "Retry after quota window";
  }
  return "Inspect GA4 connection";
}

function handleGa4RealtimeProviderError(
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
    actionLabel: buildBlockedActionLabel(err),
    actionHref: "/connections?provider=ga4",
    selectedBinding: binding,
    availableBindings: allBindings,
    workspaceUnmappedCount: 0,
    realtime: null,
  };
}

function handleGa4StandardProviderError(
  resolution: ProjectTelemetryBindingResolution,
  binding: ResolvedProjectBindingOption,
  allBindings: ResolvedProjectBindingOption[],
  window: ResolvedReportDateWindow,
  err: ProviderAdapterError,
): ProjectGa4StandardResponseDto {
  return {
    projectId: resolution.projectId,
    projectName: resolution.projectName,
    primaryDomain: resolution.primaryDomain,
    status: "blocked",
    uxState: err.uxState,
    message: err.message,
    actionLabel: buildBlockedActionLabel(err),
    actionHref: "/connections?provider=ga4",
    selectedBinding: binding,
    availableBindings: allBindings,
    workspaceUnmappedCount: 0,
    window,
    report: null,
    realtime: null,
  };
}

/**
 * Parses URL search parameters consistently between Next.js Route Handlers and Cloudflare Worker.
 */
export function parseGa4ReportSearchParams(searchParams: URLSearchParams) {
  return {
    environmentId: searchParams.get("environmentId"),
    resourceId: searchParams.get("resourceId"),
    preset: searchParams.get("preset"),
    startDate: searchParams.get("startDate"),
    endDate: searchParams.get("endDate"),
    compare: searchParams.get("compare") !== "0",
    bypassCache: searchParams.get("refresh") === "1",
    includeRealtime: searchParams.get("includeRealtime") === "1",
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
      const dto = handleGa4RealtimeProviderError(resolution, binding, allBindings, err);
      return {
        statusCode: err.code === PROVIDER_ERROR_CODES.RATE_LIMITED ? 429 : 200,
        payload: dto,
      };
    }
    throw err;
  }
}

/**
 * Queries project-scoped GA4 Data API v1beta standard traffic reports (overview, trends,
 * acquisition channels, landing pages, devices, countries, and key events) with honest
 * provenance, timezone labeling, and sampling/thresholding disclosure.
 */
export async function getProjectGa4StandardTelemetry(
  session: AuthenticatedSessionContext | null,
  projectId: string,
  options?: {
    environmentId?: string | null;
    resourceId?: string | null;
    preset?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    compare?: boolean;
    includeRealtime?: boolean;
    bypassCache?: boolean;
    fetchFn?: typeof fetch;
    simulationScenario?: ReadOnlyProviderContext["simulationScenario"];
  },
): Promise<{ statusCode: number; payload: ProjectGa4StandardResponseDto }> {
  const resolution = await resolveProjectProviderTelemetryContext(session, projectId, "ga4", {
    environmentId: options?.environmentId,
    resourceId: options?.resourceId,
    simulationScenario: options?.simulationScenario,
  });

  const bindingMetaTimeZone =
    resolution.state.kind === "ready" &&
    typeof resolution.state.binding.metadata.reportingTimeZone === "string"
      ? resolution.state.binding.metadata.reportingTimeZone
      : "UTC";

  const initialWindow = resolveReportDateWindow({
    preset: options?.preset,
    startDate: options?.startDate,
    endDate: options?.endDate,
    compare: options?.compare ?? true,
    timeZone: bindingMetaTimeZone,
    endLagDays: 0,
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
        window: initialWindow,
        report: null,
        realtime: null,
      },
    };
  }

  const { binding, allBindings, providerContext } = resolution.state;

  try {
    const [report, realtime] = await Promise.all([
      readGa4StandardReportBundle(
        providerContext,
        {
          propertyId: binding.externalResourceId,
          startDate: initialWindow.startDate,
          endDate: initialWindow.endDate,
          compareStartDate: initialWindow.compareStartDate ?? undefined,
          compareEndDate: initialWindow.compareEndDate ?? undefined,
          projectId: resolution.projectId,
          propertyTimeZone:
            typeof binding.metadata.reportingTimeZone === "string"
              ? binding.metadata.reportingTimeZone
              : null,
          currencyCode:
            typeof binding.metadata.currencyCode === "string"
              ? binding.metadata.currencyCode
              : null,
        },
        {
          fetchFn: options?.fetchFn,
          bypassCache: options?.bypassCache,
        },
      ),
      options?.includeRealtime
        ? readGa4RealtimeReportBundle(
            providerContext,
            {
              propertyId: binding.externalResourceId,
              projectId: resolution.projectId,
            },
            {
              fetchFn: options?.fetchFn,
              bypassCache: options?.bypassCache,
            },
          ).catch(() => null)
        : Promise.resolve(null),
    ]);

    const resolvedWindow: ResolvedReportDateWindow = {
      ...initialWindow,
      timeZone: report.reportingTimeZone || initialWindow.timeZone,
    };

    const hasQualityWarning =
      report.dataQuality.isSampled ||
      report.dataQuality.isThresholded ||
      report.dataQuality.hasOtherRowTruncation;

    const isEmptyData =
      report.dailySeries.length === 0 &&
      report.channels.length === 0 &&
      Boolean(report.dataQuality.emptyReason);

    const uxState: AvenorUxState = isEmptyData
      ? "empty_filtered"
      : hasQualityWarning
        ? "partial_coverage"
        : "connected_healthy";

    return {
      statusCode: 200,
      payload: {
        projectId: resolution.projectId,
        projectName: resolution.projectName,
        primaryDomain: resolution.primaryDomain,
        status: "ready",
        uxState,
        message: isEmptyData
          ? (report.dataQuality.emptyReason ?? "No GA4 observations returned for this date range.")
          : hasQualityWarning
            ? report.dataQuality.notices.join(" ")
            : null,
        actionLabel: null,
        actionHref: null,
        selectedBinding: binding,
        availableBindings: allBindings,
        workspaceUnmappedCount: 0,
        window: resolvedWindow,
        report,
        realtime,
      },
    };
  } catch (err) {
    if (err instanceof ProviderAdapterError) {
      const dto = handleGa4StandardProviderError(
        resolution,
        binding,
        allBindings,
        initialWindow,
        err,
      );
      return {
        statusCode: err.code === PROVIDER_ERROR_CODES.RATE_LIMITED ? 429 : 200,
        payload: dto,
      };
    }
    throw err;
  }
}
