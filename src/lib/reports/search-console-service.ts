import type { AuthenticatedSessionContext } from "@avenor/auth";
import {
  type AvenorUxState,
  PROVIDER_ERROR_CODES,
  ProviderAdapterError,
  type ReadOnlyProviderContext,
} from "@avenor/types";
import {
  type ResolvedProjectBindingOption,
  resolveProjectProviderTelemetryContext,
} from "@/lib/connections/project-telemetry";
import { readGa4StandardReportBundle } from "@/lib/providers/google-analytics";
import {
  buildGa4VsGscReconciliation,
  type Ga4VsGscReconciliationSummary,
  GSC_MAX_ROW_LIMIT,
  GSC_REPORTING_TIMEZONE,
  type GscDataState,
  type GscDimensionFilter,
  type GscDimensionFilterGroup,
  type GscSearchAnalyticsBundle,
  type GscSearchType,
  readSearchAnalyticsReportBundle,
} from "@/lib/providers/google-search-console";
import { type ResolvedReportDateWindow, resolveReportDateWindow } from "./date-window";

export interface ProjectSearchConsoleResponseDto {
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
  filters: {
    searchType: GscSearchType;
    dataState: GscDataState;
    queryText: string | null;
    pageText: string | null;
    country: string | null;
    device: string | null;
    rowLimit: number;
    startRow: number;
  };
  report: GscSearchAnalyticsBundle | null;
  reconciliation: Ga4VsGscReconciliationSummary | null;
}

const VALID_SEARCH_TYPES = new Set<GscSearchType>([
  "WEB",
  "IMAGE",
  "VIDEO",
  "NEWS",
  "DISCOVER",
  "GOOGLE_NEWS",
]);

function normalizeSearchType(raw: string | null | undefined): GscSearchType {
  if (!raw) return "WEB";
  const upper = raw.toUpperCase() as GscSearchType;
  return VALID_SEARCH_TYPES.has(upper) ? upper : "WEB";
}

function buildBlockedActionLabel(err: ProviderAdapterError): string {
  if (
    err.code === PROVIDER_ERROR_CODES.CREDENTIAL_EXPIRED ||
    err.code === PROVIDER_ERROR_CODES.UNAUTHORIZED ||
    err.code === PROVIDER_ERROR_CODES.INSUFFICIENT_SCOPE
  ) {
    return "Reconnect Search Console";
  }
  if (err.code === PROVIDER_ERROR_CODES.RATE_LIMITED) {
    return "Retry after quota window";
  }
  return "Inspect Search Console connection";
}

/**
 * Parses URL search parameters consistently between Next.js Route Handlers and Cloudflare Worker.
 */
export function parseSearchConsoleReportParams(searchParams: URLSearchParams) {
  const rawLimit = Number.parseInt(searchParams.get("rowLimit") ?? "250", 10);
  const rawStartRow = Number.parseInt(searchParams.get("startRow") ?? "0", 10);
  return {
    environmentId: searchParams.get("environmentId"),
    resourceId: searchParams.get("resourceId"),
    preset: searchParams.get("preset"),
    startDate: searchParams.get("startDate"),
    endDate: searchParams.get("endDate"),
    compare: searchParams.get("compare") !== "0",
    searchType: normalizeSearchType(searchParams.get("searchType")),
    dataState: (searchParams.get("dataState") === "all" ? "all" : "final") as GscDataState,
    queryText: searchParams.get("query")?.trim() || null,
    pageText: searchParams.get("page")?.trim() || null,
    country: searchParams.get("country")?.trim() || null,
    device: searchParams.get("device")?.trim() || null,
    rowLimit: Number.isFinite(rawLimit) ? Math.max(10, Math.min(rawLimit, GSC_MAX_ROW_LIMIT)) : 250,
    startRow: Number.isFinite(rawStartRow) && rawStartRow >= 0 ? rawStartRow : 0,
    bypassCache: searchParams.get("refresh") === "1",
  };
}

/**
 * Queries project-scoped Search Analytics metrics (`clicks`, `impressions`, weighted `ctr`,
 * impression-weighted `position`) alongside optional GA4 vs GSC semantic reconciliation.
 */
export async function getProjectSearchConsoleTelemetry(
  session: AuthenticatedSessionContext | null,
  projectId: string,
  options?: {
    environmentId?: string | null;
    resourceId?: string | null;
    preset?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    compare?: boolean;
    searchType?: GscSearchType;
    dataState?: GscDataState;
    queryText?: string | null;
    pageText?: string | null;
    country?: string | null;
    device?: string | null;
    rowLimit?: number;
    startRow?: number;
    bypassCache?: boolean;
    fetchFn?: typeof fetch;
    simulationScenario?: ReadOnlyProviderContext["simulationScenario"];
  },
): Promise<{ statusCode: number; payload: ProjectSearchConsoleResponseDto }> {
  const searchType = normalizeSearchType(options?.searchType);
  const dataState: GscDataState = options?.dataState === "all" ? "all" : "final";
  const rowLimit = Math.max(10, Math.min(options?.rowLimit ?? 250, GSC_MAX_ROW_LIMIT));
  const startRow = Math.max(0, options?.startRow ?? 0);

  const window = resolveReportDateWindow({
    preset: options?.preset,
    startDate: options?.startDate,
    endDate: options?.endDate,
    compare: options?.compare ?? true,
    timeZone: GSC_REPORTING_TIMEZONE,
    endLagDays: dataState === "final" ? 2 : 0,
  });

  const filtersState = {
    searchType,
    dataState,
    queryText: options?.queryText?.trim() || null,
    pageText: options?.pageText?.trim() || null,
    country: options?.country?.trim() || null,
    device: options?.device?.trim() || null,
    rowLimit,
    startRow,
  };

  const resolution = await resolveProjectProviderTelemetryContext(session, projectId, "gsc", {
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
        window,
        filters: filtersState,
        report: null,
        reconciliation: null,
      },
    };
  }

  const { binding, allBindings, providerContext } = resolution.state;

  // Reject verified=false property cleanly at service layer before API calls
  if (binding.metadata.verifiedAccess === false) {
    return {
      statusCode: 200,
      payload: {
        projectId: resolution.projectId,
        projectName: resolution.projectName,
        primaryDomain: resolution.primaryDomain,
        status: "blocked",
        uxState: "permission_insufficient",
        message: `Search Console property "${binding.externalResourceId}" has unverified permission (${String(binding.metadata.permissionLevel ?? "siteUnverifiedUser")}). Verify ownership in Search Console before reading metrics.`,
        actionLabel: "Verify property access",
        actionHref: "/connections?provider=gsc",
        selectedBinding: binding,
        availableBindings: allBindings,
        workspaceUnmappedCount: 0,
        window,
        filters: filtersState,
        report: null,
        reconciliation: null,
      },
    };
  }

  const activeFilters: GscDimensionFilter[] = [];
  if (filtersState.queryText && searchType !== "DISCOVER" && searchType !== "GOOGLE_NEWS") {
    activeFilters.push({
      dimension: "query",
      operator: "contains",
      expression: filtersState.queryText,
    });
  }
  if (filtersState.pageText) {
    activeFilters.push({
      dimension: "page",
      operator: "contains",
      expression: filtersState.pageText,
    });
  }
  if (filtersState.country) {
    activeFilters.push({
      dimension: "country",
      operator: "equals",
      expression: filtersState.country.toLowerCase(),
    });
  }
  if (filtersState.device) {
    activeFilters.push({
      dimension: "device",
      operator: "equals",
      expression: filtersState.device.toUpperCase(),
    });
  }

  const dimensionFilterGroups: GscDimensionFilterGroup[] | undefined =
    activeFilters.length > 0 ? [{ groupType: "and", filters: activeFilters }] : undefined;

  try {
    const gscReportPromise = readSearchAnalyticsReportBundle(
      providerContext,
      {
        siteUrl: binding.externalResourceId,
        startDate: window.startDate,
        endDate: window.endDate,
        compareStartDate: window.compareStartDate ?? undefined,
        compareEndDate: window.compareEndDate ?? undefined,
        searchType,
        dataState,
        dimensionFilterGroups,
        rowLimit,
        startRow,
        projectId: resolution.projectId,
      },
      {
        fetchFn: options?.fetchFn,
        bypassCache: options?.bypassCache,
      },
    );

    // Opportunistically read project's GA4 property to enrich the GA4 vs GSC reconciliation card
    const ga4BundlePromise = (async () => {
      try {
        const ga4Res = await resolveProjectProviderTelemetryContext(session, projectId, "ga4", {
          environmentId: options?.environmentId,
          simulationScenario: options?.simulationScenario,
        });
        if (ga4Res.state.kind !== "ready") {
          return null;
        }
        return await readGa4StandardReportBundle(
          ga4Res.state.providerContext,
          {
            propertyId: ga4Res.state.binding.externalResourceId,
            startDate: window.startDate,
            endDate: window.endDate,
            projectId: resolution.projectId,
          },
          {
            fetchFn: options?.fetchFn,
            bypassCache: options?.bypassCache,
          },
        );
      } catch {
        return null;
      }
    })();

    const [report, ga4Bundle] = await Promise.all([gscReportPromise, ga4BundlePromise]);

    const reconciliation = buildGa4VsGscReconciliation({
      ga4Bundle,
      gscBundle: report,
      projectPrimaryDomain: resolution.primaryDomain,
    });

    const isEmptyFiltered =
      activeFilters.length > 0 && report.topQueries.length === 0 && report.topPages.length === 0;
    const hasCoverageCaveats =
      report.coverage.hasPreliminaryDatesInWindow ||
      report.coverage.isTopRowLimited ||
      (report.coverage.queryClicksVsTotalClicksGap?.omittedClicksEstimate ?? 0) > 0;

    const uxState: AvenorUxState = isEmptyFiltered
      ? "empty_filtered"
      : hasCoverageCaveats
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
        message: isEmptyFiltered
          ? "No Search Console rows matched your active filters."
          : report.coverage.notices.length > 0
            ? report.coverage.notices[0]
            : null,
        actionLabel: null,
        actionHref: null,
        selectedBinding: binding,
        availableBindings: allBindings,
        workspaceUnmappedCount: 0,
        window,
        filters: filtersState,
        report,
        reconciliation,
      },
    };
  } catch (err) {
    if (err instanceof ProviderAdapterError) {
      return {
        statusCode: err.code === PROVIDER_ERROR_CODES.RATE_LIMITED ? 429 : 200,
        payload: {
          projectId: resolution.projectId,
          projectName: resolution.projectName,
          primaryDomain: resolution.primaryDomain,
          status: "blocked",
          uxState: err.uxState,
          message: err.message,
          actionLabel: buildBlockedActionLabel(err),
          actionHref: "/connections?provider=gsc",
          selectedBinding: binding,
          availableBindings: allBindings,
          workspaceUnmappedCount: 0,
          window,
          filters: filtersState,
          report: null,
          reconciliation: null,
        },
      };
    }
    throw err;
  }
}
