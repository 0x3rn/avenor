import {
  type AuthenticatedSessionContext,
  authorizeProjectAccess,
  authorizeWorkspaceAccess,
  listWorkspaceProjects,
} from "@avenor/auth";
import { assertServerRuntime } from "@avenor/config";
import { dbQuery, getDatabasePool } from "@avenor/database";
import type { AvenorUxState, EnvironmentType, LogicalProjectSummary } from "@avenor/types";

import {
  executeResourceIngestionSync,
  getProjectSyncStatusSummary,
  type IngestionRunRecord,
  type IngestionRunStatus,
  type IngestionRunType,
  type ProjectSyncStatusSummaryDto,
} from "@/lib/ingestion";
import {
  type AggregatedMetricResult,
  aggregateMetricObservations,
  computeDimensionIdentity,
  queryMetricObservations,
  type StoredMetricObservation,
} from "@/lib/metrics";
import {
  classifyReportDataFreshness,
  type ReportCacheEnvelopeMetadata,
  type ReportFreshnessClassification,
  sharedReportCache,
} from "./cache";
import { addCalendarDays, countInclusiveDays, formatDateInTimeZone } from "./date-window";

export type PortfolioDatePreset = "7d" | "28d" | "90d" | "mtd" | "custom";

export interface ResolvedPortfolioDateWindow {
  preset: PortfolioDatePreset;
  timeZone: string;
  startDate: string;
  endDate: string;
  compareEnabled: boolean;
  compareStartDate: string | null;
  compareEndDate: string | null;
  dayCount: number;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizePortfolioPreset(
  rawPreset: string | null | undefined,
): PortfolioDatePreset {
  if (!rawPreset) return "28d";
  const normalized = rawPreset.trim().toLowerCase();
  if (normalized === "7d" || normalized === "last_7_days") return "7d";
  if (normalized === "28d" || normalized === "last_28_days") return "28d";
  if (normalized === "90d" || normalized === "last_90_days") return "90d";
  if (normalized === "mtd" || normalized === "month_to_date") return "mtd";
  if (normalized === "custom") return "custom";
  return "28d";
}

export function resolvePortfolioDateWindow(input?: {
  preset?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  compare?: boolean;
  timeZone?: string;
  now?: Date;
}): ResolvedPortfolioDateWindow {
  const now = input?.now ?? new Date();
  const timeZone = input?.timeZone || "UTC";
  const compareEnabled = input?.compare ?? true;
  const preset = normalizePortfolioPreset(input?.preset);

  const customStart = input?.startDate?.trim() ?? "";
  const customEnd = input?.endDate?.trim() ?? "";

  let resolvedPreset = preset;
  let startDate: string;
  let endDate: string;

  if (
    (preset === "custom" || (customStart && customEnd)) &&
    ISO_DATE_RE.test(customStart) &&
    ISO_DATE_RE.test(customEnd) &&
    customStart <= customEnd
  ) {
    resolvedPreset = "custom";
    startDate = customStart;
    endDate = customEnd;
  } else if (preset === "mtd") {
    endDate = formatDateInTimeZone(now, timeZone, 0);
    startDate = `${endDate.slice(0, 8)}01`;
  } else {
    const windowDays = preset === "7d" ? 7 : preset === "90d" ? 90 : 28;
    endDate = formatDateInTimeZone(now, timeZone, 0);
    startDate = addCalendarDays(endDate, -(windowDays - 1));
    resolvedPreset = preset === "custom" ? "28d" : preset;
  }

  const dayCount = countInclusiveDays(startDate, endDate);
  const compareEndDate = compareEnabled ? addCalendarDays(startDate, -1) : null;
  const compareStartDate =
    compareEnabled && compareEndDate ? addCalendarDays(compareEndDate, -(dayCount - 1)) : null;

  return {
    preset: resolvedPreset,
    timeZone,
    startDate,
    endDate,
    compareEnabled,
    compareStartDate,
    compareEndDate,
    dayCount,
  };
}

export interface PortfolioMetricComparison {
  currentValue: number | null;
  previousValue: number | null;
  absoluteDelta: number | null;
  percentDelta: number | null;
  direction: "up" | "down" | "flat" | "new_activity" | "unavailable";
  formattedDeltaLabel: string | null;
}

export function computeMetricDeltaComparison(
  currentValue: number | null,
  previousValue: number | null,
  options?: { invertPolarity?: boolean },
): PortfolioMetricComparison {
  if (currentValue === null || previousValue === null) {
    return {
      currentValue,
      previousValue,
      absoluteDelta: null,
      percentDelta: null,
      direction: "unavailable",
      formattedDeltaLabel: null,
    };
  }

  const absoluteDelta = Number((currentValue - previousValue).toFixed(4));
  if (Math.abs(previousValue) < 1e-9) {
    if (Math.abs(currentValue) < 1e-9) {
      return {
        currentValue,
        previousValue,
        absoluteDelta: 0,
        percentDelta: 0,
        direction: "flat",
        formattedDeltaLabel: "0.0% vs prior period",
      };
    }
    return {
      currentValue,
      previousValue,
      absoluteDelta,
      percentDelta: null,
      direction: "new_activity",
      formattedDeltaLabel: "New activity vs 0 prior",
    };
  }

  const rawPercent = ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
  const percentDelta = Number(rawPercent.toFixed(2));
  if (Math.abs(percentDelta) < 0.05) {
    return {
      currentValue,
      previousValue,
      absoluteDelta,
      percentDelta: 0,
      direction: "flat",
      formattedDeltaLabel: "0.0% vs prior period",
    };
  }

  const isPositiveChange = options?.invertPolarity ? rawPercent < 0 : rawPercent > 0;
  const sign = rawPercent > 0 ? "+" : "";
  return {
    currentValue,
    previousValue,
    absoluteDelta,
    percentDelta,
    direction: isPositiveChange ? "up" : "down",
    formattedDeltaLabel: `${sign}${percentDelta.toFixed(1)}% vs prior period`,
  };
}

export interface PortfolioMappedResourceBadge {
  connectedResourceId: string;
  providerConnectionId: string;
  providerKey: string;
  externalResourceId: string;
  displayName: string;
  environmentId: string | null;
  environmentType: EnvironmentType | null;
  connectionStatus: string;
  syncState: string;
  reportingTimezone: string;
  lastSyncedAtIso: string | null;
  sourceLagNotice: string | null;
}

export interface PortfolioAttentionItem {
  id: string;
  severity: "warning" | "critical" | "info";
  category:
    | "expired_or_revoked"
    | "sync_failed"
    | "rate_limited"
    | "stale_watermark"
    | "unmapped_project"
    | "gsc_lag_notice"
    | "multi_property_overlap";
  title: string;
  description: string;
  projectId: string | null;
  projectName: string | null;
  providerKey: string | null;
  ctaLabel: string;
  ctaHref: string;
}

export interface PortfolioDailyTrendPoint {
  date: string;
  sessions: number | null;
  engagedSessions: number | null;
  gscClicks: number | null;
  gscImpressions: number | null;
  gscCtr: number | null;
}

export interface PortfolioProductPerformanceRow {
  project: LogicalProjectSummary;
  mappedResources: PortfolioMappedResourceBadge[];
  uxState: AvenorUxState;
  freshnessLabel: string;
  lastSyncedAtIso: string | null;
  hasMultiPropertyWarning: boolean;
  multiPropertyNotice: string | null;
  metrics: {
    sessions: AggregatedMetricResult;
    activeUsers: AggregatedMetricResult;
    engagementRate: AggregatedMetricResult;
    keyEvents: AggregatedMetricResult;
    gscClicks: AggregatedMetricResult;
    gscImpressions: AggregatedMetricResult;
    gscCtr: AggregatedMetricResult;
    gscAveragePosition: AggregatedMetricResult;
  };
  comparisons: {
    sessions: PortfolioMetricComparison;
    gscClicks: PortfolioMetricComparison;
    gscImpressions: PortfolioMetricComparison;
    gscCtr: PortfolioMetricComparison;
  };
}

export interface WorkspacePortfolioOverviewDto {
  organizationId: string;
  workspaceId: string;
  workspaceName: string;
  defaultTimezone: string;
  defaultCurrency: string;
  dateWindow: ResolvedPortfolioDateWindow;
  summaryCounts: {
    activeProjectCount: number;
    archivedProjectCount: number;
    configuredEnvironmentCount: number;
    mappedProjectCount: number;
    healthyConnectionCount: number;
    degradedConnectionCount: number;
    distinctGa4PropertyCount: number;
    distinctGscPropertyCount: number;
  };
  portfolioMetrics: {
    sessions: AggregatedMetricResult;
    activeUsers: AggregatedMetricResult;
    engagedSessions: AggregatedMetricResult;
    engagementRate: AggregatedMetricResult;
    keyEvents: AggregatedMetricResult;
    gscClicks: AggregatedMetricResult;
    gscImpressions: AggregatedMetricResult;
    gscCtr: AggregatedMetricResult;
    gscAveragePosition: AggregatedMetricResult;
  };
  portfolioComparisons: {
    sessions: PortfolioMetricComparison;
    engagedSessions: PortfolioMetricComparison;
    gscClicks: PortfolioMetricComparison;
    gscImpressions: PortfolioMetricComparison;
    gscCtr: PortfolioMetricComparison;
    gscAveragePosition: PortfolioMetricComparison;
  };
  nonAdditiveNotices: string[];
  dailyTrend: PortfolioDailyTrendPoint[];
  products: PortfolioProductPerformanceRow[];
  attentionItems: PortfolioAttentionItem[];
  recentSyncRuns: Array<
    IngestionRunRecord & {
      projectName: string | null;
      resourceDisplayName: string;
    }
  >;
  cacheMetadata?: ReportCacheEnvelopeMetadata;
  freshnessClassification?: ReportFreshnessClassification;
}

export interface ProjectDimensionBreakdownItem {
  dimensionValue: string;
  secondaryValue?: string | null;
  primaryMetricValue: number | null;
  secondaryMetricValue: number | null;
  tertiaryMetricValue?: number | null;
  quaternaryMetricValue?: number | null;
}

export interface ProjectControlCenterOverviewDto {
  organizationId: string;
  workspaceId: string;
  project: LogicalProjectSummary;
  selectedEnvironmentId: string | null;
  selectedEnvironmentType: EnvironmentType;
  dateWindow: ResolvedPortfolioDateWindow;
  mappedResources: PortfolioMappedResourceBadge[];
  hasOverlappingGa4Properties: boolean;
  hasOverlappingGscProperties: boolean;
  overlapWarnings: string[];
  uxState: AvenorUxState;
  audienceUxState: AvenorUxState;
  searchUxState: AvenorUxState;
  freshnessLabel: string;
  metrics: {
    sessions: AggregatedMetricResult;
    activeUsers: AggregatedMetricResult;
    engagedSessions: AggregatedMetricResult;
    engagementRate: AggregatedMetricResult;
    pageViews: AggregatedMetricResult;
    keyEvents: AggregatedMetricResult;
    eventCount: AggregatedMetricResult;
    gscClicks: AggregatedMetricResult;
    gscImpressions: AggregatedMetricResult;
    gscCtr: AggregatedMetricResult;
    gscAveragePosition: AggregatedMetricResult;
  };
  comparisons: {
    sessions: PortfolioMetricComparison;
    activeUsers: PortfolioMetricComparison;
    engagementRate: PortfolioMetricComparison;
    pageViews: PortfolioMetricComparison;
    gscClicks: PortfolioMetricComparison;
    gscImpressions: PortfolioMetricComparison;
    gscCtr: PortfolioMetricComparison;
    gscAveragePosition: PortfolioMetricComparison;
  };
  dailyTrend: PortfolioDailyTrendPoint[];
  breakdowns: {
    topChannels: ProjectDimensionBreakdownItem[];
    topPages: ProjectDimensionBreakdownItem[];
    topQueries: ProjectDimensionBreakdownItem[];
    topSearchPages: ProjectDimensionBreakdownItem[];
  };
  syncStatus: ProjectSyncStatusSummaryDto;
  cacheMetadata?: ReportCacheEnvelopeMetadata;
  freshnessClassification?: ReportFreshnessClassification;
}

interface DbWorkspaceMappedResourceRow {
  mapping_id: string;
  project_id: string;
  environment_id: string | null;
  environment_type: EnvironmentType | null;
  connected_resource_id: string;
  provider_connection_id: string;
  provider_key: string;
  external_resource_id: string;
  display_name: string;
  metadata: Record<string, unknown> | null;
  connection_status: string;
  sync_state: string | null;
  last_succeeded_at: Date | null;
  rate_limit_reset_at: Date | null;
  consecutive_failures: number | null;
  last_error_summary: string | null;
}

const EMPTY_DIMENSION_HASH = computeDimensionIdentity({}).hash;
const GSC_WEB_SUMMARY_DIMENSION_HASH = computeDimensionIdentity({ searchType: "web" }).hash;

function isGa4ProviderKey(providerKey: string): boolean {
  return providerKey === "ga4" || providerKey === "google_analytics_4";
}

function isGscProviderKey(providerKey: string): boolean {
  return providerKey === "gsc" || providerKey === "google_search_console";
}

function isSummaryObservation(obs: StoredMetricObservation): boolean {
  return (
    obs.dimensionKeyHash === EMPTY_DIMENSION_HASH ||
    obs.dimensionKeyHash === GSC_WEB_SUMMARY_DIMENSION_HASH
  );
}

function enumerateDatesBetween(startDate: string, endDate: string): string[] {
  const count = countInclusiveDays(startDate, endDate);
  const dates: string[] = [];
  for (let i = 0; i < count; i += 1) {
    dates.push(addCalendarDays(startDate, i));
  }
  return dates;
}

function buildDailyTrendFromObservations(
  dates: readonly string[],
  observations: readonly StoredMetricObservation[],
): PortfolioDailyTrendPoint[] {
  const dailyAll = observations.filter((o) => o.granularity === "DAILY" && isSummaryObservation(o));

  return dates.map((date) => {
    const forDay = dailyAll.filter((o) => o.periodStartDate === date);
    const sessionsRes = aggregateMetricObservations({
      canonicalMetricKey: "ga4.sessions",
      observations: forDay,
      requestedStartDate: date,
      requestedEndDate: date,
    });
    const engagedRes = aggregateMetricObservations({
      canonicalMetricKey: "ga4.engaged_sessions",
      observations: forDay,
      requestedStartDate: date,
      requestedEndDate: date,
    });
    const clicksRes = aggregateMetricObservations({
      canonicalMetricKey: "gsc.clicks",
      observations: forDay,
      requestedStartDate: date,
      requestedEndDate: date,
    });
    const impressionsRes = aggregateMetricObservations({
      canonicalMetricKey: "gsc.impressions",
      observations: forDay,
      requestedStartDate: date,
      requestedEndDate: date,
    });
    const ctrRes = aggregateMetricObservations({
      canonicalMetricKey: "gsc.ctr",
      observations: forDay,
      requestedStartDate: date,
      requestedEndDate: date,
    });

    return {
      date,
      sessions: sessionsRes.value,
      engagedSessions: engagedRes.value,
      gscClicks: clicksRes.value,
      gscImpressions: impressionsRes.value,
      gscCtr: ctrRes.value,
    };
  });
}

async function maybeHydrateEmptyMappedResources(input: {
  organizationId: string;
  workspaceId: string;
  mappings: readonly DbWorkspaceMappedResourceRow[];
  existingObservations: readonly StoredMetricObservation[];
  connectionString?: string;
}): Promise<boolean> {
  const observedResources = new Set(input.existingObservations.map((o) => o.connectedResourceId));
  let didHydrate = false;

  for (const m of input.mappings) {
    if (observedResources.has(m.connected_resource_id)) continue;
    if (m.connection_status !== "HEALTHY") continue;
    if (
      m.sync_state === "FAILED" ||
      m.sync_state === "RATE_LIMITED" ||
      m.sync_state === "PAUSED" ||
      m.sync_state === "CONNECTION_REVOKED"
    ) {
      continue;
    }

    try {
      const outcome = await executeResourceIngestionSync(
        {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          projectId: m.project_id,
          environmentId: m.environment_id,
          providerConnectionId: m.provider_connection_id,
          connectedResourceId: m.connected_resource_id,
          runType: "SCHEDULED_SYNC",
        },
        { connectionString: input.connectionString },
      );
      if (outcome.outcome === "completed" || outcome.outcome === "partially_completed") {
        didHydrate = true;
        observedResources.add(m.connected_resource_id);
      }
    } catch {
      // Never block read path if background auto-hydration encounters an adapter error
    }
  }

  return didHydrate;
}

/**
 * Loads the unified Workspace Portfolio Overview backed by canonical `metric_observations`,
 * `ingestion_watermarks`, `ingestion_runs`, and `resource_mappings`.
 */
export async function getWorkspacePortfolioOverview(
  session: AuthenticatedSessionContext | null,
  query?: {
    workspaceId?: string;
    preset?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    compare?: boolean;
    autoHydrateIfEmpty?: boolean;
    bypassCache?: boolean;
    now?: Date;
  },
  options?: { connectionString?: string },
): Promise<WorkspacePortfolioOverviewDto> {
  assertServerRuntime("getWorkspacePortfolioOverview");

  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId: query?.workspaceId ?? session?.activeWorkspace.id ?? "",
    requiredPermission: "workspace:read",
  });

  const pool = getDatabasePool(options?.connectionString);
  const wsRes = await dbQuery<{
    name: string;
    default_timezone: string;
    default_currency: string;
  }>(
    `SELECT name, default_timezone, default_currency
     FROM workspaces
     WHERE id = $1 AND organization_id = $2
     LIMIT 1`,
    [access.workspaceId, access.organizationId],
    pool,
  );
  const ws = wsRes.rows[0] ?? {
    name: session?.activeWorkspace.name ?? "Workspace",
    default_timezone: session?.activeWorkspace.defaultTimezone ?? "UTC",
    default_currency: session?.activeWorkspace.defaultCurrency ?? "USD",
  };

  const dateWindow = resolvePortfolioDateWindow({
    preset: query?.preset,
    startDate: query?.startDate,
    endDate: query?.endDate,
    compare: query?.compare ?? true,
    timeZone: ws.default_timezone,
    now: query?.now,
  });

  const cached = await sharedReportCache.getOrLoad(
    {
      organizationId: access.organizationId,
      workspaceId: access.workspaceId,
      projectId: null,
      environmentId: null,
      role: access.role,
      surface: "portfolio_overview",
      startDate: dateWindow.startDate,
      endDate: dateWindow.endDate,
      compareEnabled: dateWindow.compareEnabled,
      filters: { preset: dateWindow.preset },
    },
    async () => {
      return computeWorkspacePortfolioOverviewUncached({
        session,
        access,
        ws,
        dateWindow,
        query,
        options,
      });
    },
    {
      bypassCache: query?.bypassCache,
    },
  );

  return {
    ...cached.value,
    cacheMetadata: cached.metadata,
  };
}

async function computeWorkspacePortfolioOverviewUncached(input: {
  session: AuthenticatedSessionContext | null;
  access: { organizationId: string; workspaceId: string; role: string };
  ws: { name: string; default_timezone: string; default_currency: string };
  dateWindow: ResolvedPortfolioDateWindow;
  query?: {
    autoHydrateIfEmpty?: boolean;
  };
  options?: { connectionString?: string };
}): Promise<WorkspacePortfolioOverviewDto> {
  const { session, access, ws, dateWindow, query, options } = input;
  const pool = getDatabasePool(options?.connectionString);

  const allProjects = await listWorkspaceProjects(session, access.workspaceId, {
    includeArchived: true,
  });
  const activeProjects = allProjects.filter((p: LogicalProjectSummary) => p.status === "ACTIVE");
  const archivedProjects = allProjects.filter(
    (p: LogicalProjectSummary) => p.status === "ARCHIVED",
  );

  const mappingsRes = await dbQuery<DbWorkspaceMappedResourceRow>(
    `SELECT
       rm.id AS mapping_id,
       rm.project_id,
       rm.environment_id,
       pe.environment_type,
       cr.id AS connected_resource_id,
       cr.provider_connection_id,
       pc.provider_key,
       cr.external_resource_id,
       cr.display_name,
       cr.metadata,
       pc.status AS connection_status,
       iw.sync_state,
       iw.last_succeeded_at,
       iw.rate_limit_reset_at,
       iw.consecutive_failures,
       iw.last_error_summary
     FROM resource_mappings rm
     INNER JOIN connected_resources cr ON cr.id = rm.connected_resource_id
     INNER JOIN provider_connections pc ON pc.id = cr.provider_connection_id
     LEFT JOIN project_environments pe ON pe.id = rm.environment_id
     LEFT JOIN LATERAL (
       SELECT
         w.sync_state,
         w.last_succeeded_at,
         w.rate_limit_reset_at,
         w.consecutive_failures,
         w.last_error_summary
       FROM ingestion_watermarks w
       WHERE w.connected_resource_id = cr.id
         AND w.workspace_id = rm.workspace_id
       ORDER BY w.updated_at DESC
       LIMIT 1
     ) iw ON true
     WHERE rm.workspace_id = $1
     ORDER BY rm.created_at ASC`,
    [access.workspaceId],
    pool,
  );

  const earliestQueryDate = dateWindow.compareStartDate ?? dateWindow.startDate;
  let allObservations = (
    await queryMetricObservations(
      {
        organizationId: access.organizationId,
        workspaceId: access.workspaceId,
        periodStartDate: earliestQueryDate,
        periodEndDate: dateWindow.endDate,
      },
      { executor: pool },
    )
  ).filter(isSummaryObservation);

  if (query?.autoHydrateIfEmpty !== false && mappingsRes.rows.length > 0) {
    const hydrated = await maybeHydrateEmptyMappedResources({
      organizationId: access.organizationId,
      workspaceId: access.workspaceId,
      mappings: mappingsRes.rows,
      existingObservations: allObservations,
      connectionString: options?.connectionString,
    });
    if (hydrated) {
      allObservations = (
        await queryMetricObservations(
          {
            organizationId: access.organizationId,
            workspaceId: access.workspaceId,
            periodStartDate: earliestQueryDate,
            periodEndDate: dateWindow.endDate,
          },
          { executor: pool },
        )
      ).filter(isSummaryObservation);
    }
  }

  const activeProjectIds = new Set(activeProjects.map((p: LogicalProjectSummary) => p.id));
  const currentPeriodObs = allObservations.filter(
    (o) =>
      (!o.projectId || activeProjectIds.has(o.projectId)) &&
      o.periodStartDate >= dateWindow.startDate &&
      o.periodEndDate <= dateWindow.endDate,
  );
  const compareStart = dateWindow.compareStartDate;
  const compareEnd = dateWindow.compareEndDate;
  const comparePeriodObs =
    dateWindow.compareEnabled && compareStart && compareEnd
      ? allObservations.filter(
          (o) =>
            (!o.projectId || activeProjectIds.has(o.projectId)) &&
            o.periodStartDate >= compareStart &&
            o.periodEndDate <= compareEnd,
        )
      : [];

  const computePortfolioAgg = (
    metricKey: string,
    obs: readonly StoredMetricObservation[],
    reqStart: string,
    reqEnd: string,
  ): AggregatedMetricResult => {
    const dailyOnly = obs.filter((o) => o.granularity === "DAILY");
    const sourceObs =
      metricKey === "ga4.active_users" || metricKey === "ga4.total_users" ? obs : dailyOnly;
    return aggregateMetricObservations({
      canonicalMetricKey: metricKey,
      observations: sourceObs,
      requestedStartDate: reqStart,
      requestedEndDate: reqEnd,
    });
  };

  const portfolioMetrics = {
    sessions: computePortfolioAgg(
      "ga4.sessions",
      currentPeriodObs,
      dateWindow.startDate,
      dateWindow.endDate,
    ),
    activeUsers: computePortfolioAgg(
      "ga4.active_users",
      currentPeriodObs,
      dateWindow.startDate,
      dateWindow.endDate,
    ),
    engagedSessions: computePortfolioAgg(
      "ga4.engaged_sessions",
      currentPeriodObs,
      dateWindow.startDate,
      dateWindow.endDate,
    ),
    engagementRate: computePortfolioAgg(
      "ga4.engagement_rate",
      currentPeriodObs,
      dateWindow.startDate,
      dateWindow.endDate,
    ),
    keyEvents: computePortfolioAgg(
      "ga4.key_events",
      currentPeriodObs,
      dateWindow.startDate,
      dateWindow.endDate,
    ),
    gscClicks: computePortfolioAgg(
      "gsc.clicks",
      currentPeriodObs,
      dateWindow.startDate,
      dateWindow.endDate,
    ),
    gscImpressions: computePortfolioAgg(
      "gsc.impressions",
      currentPeriodObs,
      dateWindow.startDate,
      dateWindow.endDate,
    ),
    gscCtr: computePortfolioAgg(
      "gsc.ctr",
      currentPeriodObs,
      dateWindow.startDate,
      dateWindow.endDate,
    ),
    gscAveragePosition: computePortfolioAgg(
      "gsc.average_position",
      currentPeriodObs,
      dateWindow.startDate,
      dateWindow.endDate,
    ),
  };

  const priorStart = dateWindow.compareStartDate ?? dateWindow.startDate;
  const priorEnd = dateWindow.compareEndDate ?? dateWindow.endDate;
  const priorSessions = computePortfolioAgg("ga4.sessions", comparePeriodObs, priorStart, priorEnd);
  const priorEngaged = computePortfolioAgg(
    "ga4.engaged_sessions",
    comparePeriodObs,
    priorStart,
    priorEnd,
  );
  const priorClicks = computePortfolioAgg("gsc.clicks", comparePeriodObs, priorStart, priorEnd);
  const priorImpressions = computePortfolioAgg(
    "gsc.impressions",
    comparePeriodObs,
    priorStart,
    priorEnd,
  );
  const priorCtr = computePortfolioAgg("gsc.ctr", comparePeriodObs, priorStart, priorEnd);
  const priorPos = computePortfolioAgg(
    "gsc.average_position",
    comparePeriodObs,
    priorStart,
    priorEnd,
  );

  const portfolioComparisons = {
    sessions: computeMetricDeltaComparison(portfolioMetrics.sessions.value, priorSessions.value),
    engagedSessions: computeMetricDeltaComparison(
      portfolioMetrics.engagedSessions.value,
      priorEngaged.value,
    ),
    gscClicks: computeMetricDeltaComparison(portfolioMetrics.gscClicks.value, priorClicks.value),
    gscImpressions: computeMetricDeltaComparison(
      portfolioMetrics.gscImpressions.value,
      priorImpressions.value,
    ),
    gscCtr: computeMetricDeltaComparison(portfolioMetrics.gscCtr.value, priorCtr.value),
    gscAveragePosition: computeMetricDeltaComparison(
      portfolioMetrics.gscAveragePosition.value,
      priorPos.value,
      { invertPolarity: true },
    ),
  };

  const activeMappings = mappingsRes.rows.filter((m) => activeProjectIds.has(m.project_id));
  const distinctGa4Properties = new Set(
    activeMappings
      .filter((m) => isGa4ProviderKey(m.provider_key))
      .map((m) => m.external_resource_id),
  );
  const distinctGscProperties = new Set(
    activeMappings
      .filter((m) => isGscProviderKey(m.provider_key))
      .map((m) => m.external_resource_id),
  );

  const nonAdditiveNotices: string[] = [];
  if (distinctGa4Properties.size > 1) {
    nonAdditiveNotices.push(
      `Active Users (ga4.active_users) is non-additive across ${distinctGa4Properties.size} distinct GA4 properties (${Array.from(distinctGa4Properties).join(", ")}) because visitors may overlap across products. Inspect individual products for property-scoped deduplicated user counts.`,
    );
  } else if (
    portfolioMetrics.activeUsers.status === "non_additive_unavailable" ||
    portfolioMetrics.activeUsers.status === "cross_resource_rejected"
  ) {
    nonAdditiveNotices.push(portfolioMetrics.activeUsers.explanation);
  }
  if (distinctGscProperties.size > 1) {
    nonAdditiveNotices.push(
      `Average Search Position (gsc.average_position) is non-additive across ${distinctGscProperties.size} Search Console properties (${Array.from(distinctGscProperties).join(", ")}). Per-product positions are weighted by impressions.`,
    );
  }

  const datesInWindow = enumerateDatesBetween(dateWindow.startDate, dateWindow.endDate);
  const dailyTrend = buildDailyTrendFromObservations(datesInWindow, currentPeriodObs);

  const products: PortfolioProductPerformanceRow[] = activeProjects.map(
    (project: LogicalProjectSummary) => {
      const projMappings = activeMappings.filter((m) => m.project_id === project.id);
      const mappedBadges: PortfolioMappedResourceBadge[] = projMappings.map((m) => ({
        connectedResourceId: m.connected_resource_id,
        providerConnectionId: m.provider_connection_id,
        providerKey: m.provider_key,
        externalResourceId: m.external_resource_id,
        displayName: m.display_name,
        environmentId: m.environment_id,
        environmentType: m.environment_type,
        connectionStatus: m.connection_status,
        syncState:
          m.sync_state ??
          (m.connection_status === "HEALTHY" ? "COMPLETED" : "CONNECTION_REVOKED"),
        reportingTimezone: isGscProviderKey(m.provider_key)
          ? "America/Los_Angeles"
          : typeof m.metadata?.timeZone === "string"
            ? m.metadata.timeZone
            : ws.default_timezone,
        lastSyncedAtIso: m.last_succeeded_at ? new Date(m.last_succeeded_at).toISOString() : null,
        sourceLagNotice: isGscProviderKey(m.provider_key)
          ? "GSC finalizes data ~48h after Pacific day end"
          : null,
      }));

      const projCurrentObs = currentPeriodObs.filter((o) => o.projectId === project.id);
      const projPriorObs = comparePeriodObs.filter((o) => o.projectId === project.id);

      const sessions = computePortfolioAgg(
        "ga4.sessions",
        projCurrentObs,
        dateWindow.startDate,
        dateWindow.endDate,
      );
      const activeUsers = computePortfolioAgg(
        "ga4.active_users",
        projCurrentObs,
        dateWindow.startDate,
        dateWindow.endDate,
      );
      const engagementRate = computePortfolioAgg(
        "ga4.engagement_rate",
        projCurrentObs,
        dateWindow.startDate,
        dateWindow.endDate,
      );
      const keyEvents = computePortfolioAgg(
        "ga4.key_events",
        projCurrentObs,
        dateWindow.startDate,
        dateWindow.endDate,
      );
      const gscClicks = computePortfolioAgg(
        "gsc.clicks",
        projCurrentObs,
        dateWindow.startDate,
        dateWindow.endDate,
      );
      const gscImpressions = computePortfolioAgg(
        "gsc.impressions",
        projCurrentObs,
        dateWindow.startDate,
        dateWindow.endDate,
      );
      const gscCtr = computePortfolioAgg(
        "gsc.ctr",
        projCurrentObs,
        dateWindow.startDate,
        dateWindow.endDate,
      );
      const gscAveragePosition = computePortfolioAgg(
        "gsc.average_position",
        projCurrentObs,
        dateWindow.startDate,
        dateWindow.endDate,
      );

      const projPriorSessions = computePortfolioAgg(
        "ga4.sessions",
        projPriorObs,
        priorStart,
        priorEnd,
      );
      const projPriorClicks = computePortfolioAgg("gsc.clicks", projPriorObs, priorStart, priorEnd);
      const projPriorImpressions = computePortfolioAgg(
        "gsc.impressions",
        projPriorObs,
        priorStart,
        priorEnd,
      );
      const projPriorCtr = computePortfolioAgg("gsc.ctr", projPriorObs, priorStart, priorEnd);

      const ga4CountForProj = new Set(
        projMappings
          .filter((m) => isGa4ProviderKey(m.provider_key))
          .map((m) => m.external_resource_id),
      ).size;
      const gscCountForProj = new Set(
        projMappings
          .filter((m) => isGscProviderKey(m.provider_key))
          .map((m) => m.external_resource_id),
      ).size;
      const hasMultiPropertyWarning = ga4CountForProj > 1 || gscCountForProj > 1;
      const multiPropertyNotice = hasMultiPropertyWarning
        ? `Multiple properties mapped (${ga4CountForProj} GA4, ${gscCountForProj} GSC). Non-additive metrics require property-scoped filtering.`
        : null;

      let uxState: AvenorUxState = "unconnected";
      if (mappedBadges.length > 0) {
        if (
          mappedBadges.some(
            (b) =>
              b.connectionStatus === "TOKEN_EXPIRED" ||
              b.connectionStatus === "EXPIRED" ||
              b.connectionStatus === "REVOKED" ||
              b.connectionStatus === "PERMISSION_MISSING",
          )
        ) {
          uxState = "permission_insufficient";
        } else if (mappedBadges.some((b) => b.syncState === "RATE_LIMITED")) {
          uxState = "rate_limited";
        } else if (mappedBadges.some((b) => b.syncState === "FAILED")) {
          uxState = "provider_error";
        } else if (projCurrentObs.length === 0) {
          uxState = "empty_first_use";
        } else if (
          sessions.uxState === "partial_coverage" ||
          gscClicks.uxState === "partial_coverage"
        ) {
          uxState = "partial_coverage";
        } else {
          uxState = "connected_healthy";
        }
      }

      const syncedDates = mappedBadges
        .map((b) => b.lastSyncedAtIso)
        .filter((v): v is string => Boolean(v))
        .sort();
      const lastSyncedAtIso = syncedDates[syncedDates.length - 1] ?? null;
      const freshnessLabel =
        uxState === "unconnected"
          ? "No sources mapped"
          : lastSyncedAtIso
            ? `Synced ${lastSyncedAtIso.slice(0, 16).replace("T", " ")} UTC`
            : projCurrentObs.length > 0
              ? "Canonical observations stored"
              : "Awaiting initial sync";

      return {
        project,
        mappedResources: mappedBadges,
        uxState,
        freshnessLabel,
        lastSyncedAtIso,
        hasMultiPropertyWarning,
        multiPropertyNotice,
        metrics: {
          sessions,
          activeUsers,
          engagementRate,
          keyEvents,
          gscClicks,
          gscImpressions,
          gscCtr,
          gscAveragePosition,
        },
        comparisons: {
          sessions: computeMetricDeltaComparison(sessions.value, projPriorSessions.value),
          gscClicks: computeMetricDeltaComparison(gscClicks.value, projPriorClicks.value),
          gscImpressions: computeMetricDeltaComparison(
            gscImpressions.value,
            projPriorImpressions.value,
          ),
          gscCtr: computeMetricDeltaComparison(gscCtr.value, projPriorCtr.value),
        },
      };
    },
  );

  // Attention items
  const attentionItems: PortfolioAttentionItem[] = [];
  for (const m of activeMappings) {
    const project = activeProjects.find((p: LogicalProjectSummary) => p.id === m.project_id);
    if (
      m.connection_status === "TOKEN_EXPIRED" ||
      m.connection_status === "EXPIRED" ||
      m.connection_status === "REVOKED" ||
      m.connection_status === "PERMISSION_MISSING"
    ) {
      attentionItems.push({
        id: `attn-conn-${m.mapping_id}`,
        severity: "critical",
        category: "expired_or_revoked",
        title: `${m.display_name} credential is ${m.connection_status.toLowerCase()}`,
        description:
          "Read-only OAuth access was revoked or expired. Re-authenticate to resume scheduled collection.",
        projectId: m.project_id,
        projectName: project?.name ?? null,
        providerKey: m.provider_key,
        ctaLabel: "Reconnect in Connections",
        ctaHref: "/connections",
      });
    } else if (m.sync_state === "RATE_LIMITED") {
      attentionItems.push({
        id: `attn-rl-${m.mapping_id}`,
        severity: "warning",
        category: "rate_limited",
        title: `${m.display_name} is rate-limited by provider quota`,
        description:
          m.last_error_summary ??
          "Scheduled collection paused until quota backoff window elapses. Cached observations remain available.",
        projectId: m.project_id,
        projectName: project?.name ?? null,
        providerKey: m.provider_key,
        ctaLabel: "Inspect Sync Status",
        ctaHref: `/projects/${m.project_id}`,
      });
    } else if (m.sync_state === "FAILED") {
      attentionItems.push({
        id: `attn-fail-${m.mapping_id}`,
        severity: "critical",
        category: "sync_failed",
        title: `${m.display_name} ingestion run failed`,
        description:
          m.last_error_summary ??
          `Consecutive failures: ${m.consecutive_failures ?? 1}. Retry from the Project Control Center.`,
        projectId: m.project_id,
        projectName: project?.name ?? null,
        providerKey: m.provider_key,
        ctaLabel: "Open Control Center",
        ctaHref: `/projects/${m.project_id}`,
      });
    }
  }

  for (const row of products) {
    if (row.mappedResources.length === 0) {
      attentionItems.push({
        id: `attn-unmapped-${row.project.id}`,
        severity: "info",
        category: "unmapped_project",
        title: `${row.project.name} has no mapped GA4 or Search Console sources`,
        description:
          "Map a read-only Google Analytics 4 or Search Console property to populate traffic and search intelligence.",
        projectId: row.project.id,
        projectName: row.project.name,
        providerKey: null,
        ctaLabel: "Map Sources",
        ctaHref: "/connections",
      });
    }
    if (row.hasMultiPropertyWarning && row.multiPropertyNotice) {
      attentionItems.push({
        id: `attn-overlap-${row.project.id}`,
        severity: "warning",
        category: "multi_property_overlap",
        title: `${row.project.name} has multiple overlapping properties mapped`,
        description: row.multiPropertyNotice,
        projectId: row.project.id,
        projectName: row.project.name,
        providerKey: null,
        ctaLabel: "Review Environment Mappings",
        ctaHref: `/projects/${row.project.id}`,
      });
    }
  }

  if (distinctGscProperties.size > 0) {
    attentionItems.push({
      id: "attn-gsc-lag-notice",
      severity: "info",
      category: "gsc_lag_notice",
      title: "Search Console publication lag (~48 hours)",
      description:
        "Most recent 2 calendar days of Search Console impressions, clicks, and CTR are marked PROVISIONAL until Google finalizes Pacific-time search tables.",
      projectId: null,
      projectName: null,
      providerKey: "gsc",
      ctaLabel: "View Search Console Provenance",
      ctaHref: "/connections",
    });
  }

  // Recent ingestion runs matching 0003_milestone_04_metrics_pipeline.sql schema
  const runsRes = await dbQuery<{
    id: string;
    organization_id: string;
    workspace_id: string;
    project_id: string | null;
    environment_id: string | null;
    provider_connection_id: string;
    connected_resource_id: string;
    provider_key: string;
    external_resource_id: string;
    run_type: string;
    job_idempotency_key: string;
    query_fingerprint: string;
    period_start_date: string;
    period_end_date: string;
    reporting_timezone: string;
    status: string;
    attempt_number: number;
    max_attempts: number;
    records_processed: number;
    records_inserted: number;
    records_updated: number;
    records_unchanged: number;
    last_successful_interval: string | null;
    retry_eligible: boolean;
    next_retry_at: Date | null;
    error_code: string | null;
    error_category: string | null;
    error_summary: string | null;
    quota_snapshot: Record<string, unknown>;
    metadata: Record<string, unknown>;
    started_at: Date;
    completed_at: Date | null;
    created_at: Date;
    updated_at: Date;
    project_name: string | null;
    resource_display_name: string;
  }>(
    `SELECT
       ir.*,
       lp.name AS project_name,
       cr.display_name AS resource_display_name
     FROM ingestion_runs ir
     INNER JOIN connected_resources cr ON cr.id = ir.connected_resource_id
     LEFT JOIN logical_projects lp ON lp.id = ir.project_id
     WHERE ir.organization_id = $1 AND ir.workspace_id = $2
     ORDER BY ir.started_at DESC
     LIMIT 8`,
    [access.organizationId, access.workspaceId],
    pool,
  );

  const recentSyncRuns = runsRes.rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    workspaceId: r.workspace_id,
    projectId: r.project_id,
    environmentId: r.environment_id,
    providerConnectionId: r.provider_connection_id,
    connectedResourceId: r.connected_resource_id,
    providerKey: r.provider_key,
    externalResourceId: r.external_resource_id,
    runType: r.run_type as IngestionRunType,
    jobIdempotencyKey: r.job_idempotency_key,
    queryFingerprint: r.query_fingerprint,
    periodStartDate: r.period_start_date,
    periodEndDate: r.period_end_date,
    reportingTimezone: r.reporting_timezone,
    status: r.status as IngestionRunStatus,
    attemptNumber: r.attempt_number,
    maxAttempts: r.max_attempts,
    recordsProcessed: r.records_processed,
    recordsInserted: r.records_inserted,
    recordsUpdated: r.records_updated,
    recordsUnchanged: r.records_unchanged,
    lastSuccessfulInterval: r.last_successful_interval,
    retryEligible: r.retry_eligible,
    nextRetryAtIso: r.next_retry_at ? new Date(r.next_retry_at).toISOString() : null,
    errorCode: r.error_code,
    errorCategory: r.error_category,
    errorSummary: r.error_summary,
    quotaSnapshot: r.quota_snapshot ?? {},
    metadata: r.metadata ?? {},
    startedAtIso: new Date(r.started_at).toISOString(),
    completedAtIso: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    createdAtIso: new Date(r.created_at).toISOString(),
    updatedAtIso: new Date(r.updated_at).toISOString(),
    projectName: r.project_name,
    resourceDisplayName: r.resource_display_name,
  }));

  const configuredEnvironmentCount = activeProjects.reduce(
    (sum: number, p: LogicalProjectSummary) => sum + p.environments.length,
    0,
  );
  const mappedProjectCount = products.filter((p) => p.mappedResources.length > 0).length;
  const healthyConnectionCount = activeMappings.filter(
    (m) =>
      m.connection_status === "HEALTHY" &&
      m.sync_state !== "FAILED" &&
      m.sync_state !== "RATE_LIMITED",
  ).length;
  const degradedConnectionCount = activeMappings.length - healthyConnectionCount;

  return {
    organizationId: access.organizationId,
    workspaceId: access.workspaceId,
    workspaceName: ws.name,
    defaultTimezone: ws.default_timezone,
    defaultCurrency: ws.default_currency,
    dateWindow,
    summaryCounts: {
      activeProjectCount: activeProjects.length,
      archivedProjectCount: archivedProjects.length,
      configuredEnvironmentCount,
      mappedProjectCount,
      healthyConnectionCount,
      degradedConnectionCount,
      distinctGa4PropertyCount: distinctGa4Properties.size,
      distinctGscPropertyCount: distinctGscProperties.size,
    },
    portfolioMetrics,
    portfolioComparisons,
    nonAdditiveNotices,
    dailyTrend,
    products,
    attentionItems,
    recentSyncRuns,
  };
}

/**
 * Loads the Individual Project Control Center overview for a specific logical project and
 * environment lens, backed by stored canonical `metric_observations` and `ingestion_watermarks`.
 */
export async function getProjectControlCenterOverview(
  session: AuthenticatedSessionContext | null,
  projectId: string,
  query?: {
    environmentId?: string | null;
    environmentType?: EnvironmentType | null;
    preset?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    compare?: boolean;
    autoHydrateIfEmpty?: boolean;
    bypassCache?: boolean;
    now?: Date;
  },
  options?: { connectionString?: string },
): Promise<ProjectControlCenterOverviewDto> {
  assertServerRuntime("getProjectControlCenterOverview");

  const access = await authorizeProjectAccess({
    session,
    projectId,
    expectedWorkspaceId: session?.activeWorkspace.id,
    requiredPermission: "project:read",
  });

  const pool = getDatabasePool(options?.connectionString);
  const allProjects = await listWorkspaceProjects(session, access.workspaceId, {
    includeArchived: true,
  });
  const project = allProjects.find((p: LogicalProjectSummary) => p.id === access.projectId);
  if (!project) {
    throw new Error(`Logical project ${access.projectId} not found.`);
  }

  const wsRes = await dbQuery<{ default_timezone: string }>(
    `SELECT default_timezone FROM workspaces WHERE id = $1 LIMIT 1`,
    [access.workspaceId],
    pool,
  );
  const defaultTimezone = wsRes.rows[0]?.default_timezone ?? "UTC";

  const selectedEnvironment =
    (query?.environmentId
      ? project.environments.find((e) => e.id === query.environmentId)
      : null) ??
    (query?.environmentType
      ? project.environments.find((e) => e.type === query.environmentType)
      : null) ??
    project.environments.find((e) => e.isDefault) ??
    project.environments[0] ??
    null;

  const selectedEnvironmentId = selectedEnvironment?.id ?? null;
  const selectedEnvironmentType: EnvironmentType = selectedEnvironment?.type ?? "PRODUCTION";

  const dateWindow = resolvePortfolioDateWindow({
    preset: query?.preset,
    startDate: query?.startDate,
    endDate: query?.endDate,
    compare: query?.compare ?? true,
    timeZone: defaultTimezone,
    now: query?.now,
  });

  const cached = await sharedReportCache.getOrLoad(
    {
      organizationId: access.organizationId,
      workspaceId: access.workspaceId,
      projectId: access.projectId,
      environmentId: selectedEnvironmentId,
      role: access.role,
      surface: "project_control_center",
      startDate: dateWindow.startDate,
      endDate: dateWindow.endDate,
      compareEnabled: dateWindow.compareEnabled,
      filters: {
        preset: dateWindow.preset,
        environmentType: selectedEnvironmentType,
      },
    },
    async () => {
      return computeProjectControlCenterUncached({
        session,
        access,
        project,
        selectedEnvironmentId,
        selectedEnvironmentType,
        dateWindow,
        query,
        options,
      });
    },
    {
      bypassCache: query?.bypassCache,
    },
  );

  const freshnessClassification = classifyReportDataFreshness({
    lastSuccessfulSyncIso: cached.value.syncStatus.lastSyncedAtIso,
    completenessState: cached.value.metrics.sessions.completenessState,
    syncState: cached.value.syncStatus.overallState,
    isStaleFallback: cached.metadata.cacheStatus === "STALE_FALLBACK",
  });

  return {
    ...cached.value,
    cacheMetadata: cached.metadata,
    freshnessClassification,
  };
}

async function computeProjectControlCenterUncached(input: {
  session: AuthenticatedSessionContext | null;
  access: { organizationId: string; workspaceId: string; projectId: string };
  project: LogicalProjectSummary;
  selectedEnvironmentId: string | null;
  selectedEnvironmentType: EnvironmentType;
  dateWindow: ResolvedPortfolioDateWindow;
  query?: {
    autoHydrateIfEmpty?: boolean;
  };
  options?: { connectionString?: string };
}): Promise<ProjectControlCenterOverviewDto> {
  const {
    session,
    access,
    project,
    selectedEnvironmentId,
    selectedEnvironmentType,
    dateWindow,
    query,
    options,
  } = input;
  const pool = getDatabasePool(options?.connectionString);

  const mappingsRes = await dbQuery<DbWorkspaceMappedResourceRow>(
    `SELECT
       rm.id AS mapping_id,
       rm.project_id,
       rm.environment_id,
       pe.environment_type,
       cr.id AS connected_resource_id,
       cr.provider_connection_id,
       pc.provider_key,
       cr.external_resource_id,
       cr.display_name,
       cr.metadata,
       pc.status AS connection_status,
       iw.sync_state,
       iw.last_succeeded_at,
       iw.rate_limit_reset_at,
       iw.consecutive_failures,
       iw.last_error_summary
     FROM resource_mappings rm
     INNER JOIN connected_resources cr ON cr.id = rm.connected_resource_id
     INNER JOIN provider_connections pc ON pc.id = cr.provider_connection_id
     LEFT JOIN project_environments pe ON pe.id = rm.environment_id
     LEFT JOIN LATERAL (
       SELECT
         w.sync_state,
         w.last_succeeded_at,
         w.rate_limit_reset_at,
         w.consecutive_failures,
         w.last_error_summary
       FROM ingestion_watermarks w
       WHERE w.connected_resource_id = cr.id
         AND w.workspace_id = rm.workspace_id
       ORDER BY w.updated_at DESC
       LIMIT 1
     ) iw ON true
     WHERE rm.project_id = $1 AND rm.workspace_id = $2
     ORDER BY rm.created_at ASC`,
    [access.projectId, access.workspaceId],
    pool,
  );

  // Filter mappings matching selected environment lens (or project-wide mappings where environment_id is null)
  const scopedMappings = mappingsRes.rows.filter(
    (m) => !m.environment_id || !selectedEnvironmentId || m.environment_id === selectedEnvironmentId,
  );

  const earliestQueryDate = dateWindow.compareStartDate ?? dateWindow.startDate;
  let allProjectObs = await queryMetricObservations(
    {
      organizationId: access.organizationId,
      workspaceId: access.workspaceId,
      projectId: access.projectId,
      periodStartDate: earliestQueryDate,
      periodEndDate: dateWindow.endDate,
    },
    { executor: pool },
  );

  if (query?.autoHydrateIfEmpty !== false && scopedMappings.length > 0) {
    const hydrated = await maybeHydrateEmptyMappedResources({
      organizationId: access.organizationId,
      workspaceId: access.workspaceId,
      mappings: scopedMappings,
      existingObservations: allProjectObs,
      connectionString: options?.connectionString,
    });
    if (hydrated) {
      allProjectObs = await queryMetricObservations(
        {
          organizationId: access.organizationId,
          workspaceId: access.workspaceId,
          projectId: access.projectId,
          periodStartDate: earliestQueryDate,
          periodEndDate: dateWindow.endDate,
        },
        { executor: pool },
      );
    }
  }

  const scopedResourceIds = new Set(scopedMappings.map((m) => m.connected_resource_id));
  const scopedObs = allProjectObs.filter(
    (o) =>
      scopedResourceIds.has(o.connectedResourceId) &&
      (!o.environmentId || !selectedEnvironmentId || o.environmentId === selectedEnvironmentId),
  );

  const currentObsAllDims = scopedObs.filter(
    (o) => o.periodStartDate >= dateWindow.startDate && o.periodEndDate <= dateWindow.endDate,
  );
  const currentObsSummary = currentObsAllDims.filter(isSummaryObservation);
  const projCompareStart = dateWindow.compareStartDate;
  const projCompareEnd = dateWindow.compareEndDate;
  const priorObsSummary =
    dateWindow.compareEnabled && projCompareStart && projCompareEnd
      ? scopedObs.filter(
          (o) =>
            isSummaryObservation(o) &&
            o.periodStartDate >= projCompareStart &&
            o.periodEndDate <= projCompareEnd,
        )
      : [];

  const computeProjAgg = (
    metricKey: string,
    obs: readonly StoredMetricObservation[],
    reqStart: string,
    reqEnd: string,
  ): AggregatedMetricResult => {
    const dailyOnly = obs.filter((o) => o.granularity === "DAILY");
    const sourceObs =
      metricKey === "ga4.active_users" || metricKey === "ga4.total_users" ? obs : dailyOnly;
    return aggregateMetricObservations({
      canonicalMetricKey: metricKey,
      observations: sourceObs,
      requestedStartDate: reqStart,
      requestedEndDate: reqEnd,
    });
  };

  const metrics = {
    sessions: computeProjAgg(
      "ga4.sessions",
      currentObsSummary,
      dateWindow.startDate,
      dateWindow.endDate,
    ),
    activeUsers: computeProjAgg(
      "ga4.active_users",
      currentObsSummary,
      dateWindow.startDate,
      dateWindow.endDate,
    ),
    engagedSessions: computeProjAgg(
      "ga4.engaged_sessions",
      currentObsSummary,
      dateWindow.startDate,
      dateWindow.endDate,
    ),
    engagementRate: computeProjAgg(
      "ga4.engagement_rate",
      currentObsSummary,
      dateWindow.startDate,
      dateWindow.endDate,
    ),
    pageViews: computeProjAgg(
      "ga4.screen_page_views",
      currentObsSummary,
      dateWindow.startDate,
      dateWindow.endDate,
    ),
    keyEvents: computeProjAgg(
      "ga4.key_events",
      currentObsSummary,
      dateWindow.startDate,
      dateWindow.endDate,
    ),
    eventCount: computeProjAgg(
      "ga4.event_count",
      currentObsSummary,
      dateWindow.startDate,
      dateWindow.endDate,
    ),
    gscClicks: computeProjAgg(
      "gsc.clicks",
      currentObsSummary,
      dateWindow.startDate,
      dateWindow.endDate,
    ),
    gscImpressions: computeProjAgg(
      "gsc.impressions",
      currentObsSummary,
      dateWindow.startDate,
      dateWindow.endDate,
    ),
    gscCtr: computeProjAgg(
      "gsc.ctr",
      currentObsSummary,
      dateWindow.startDate,
      dateWindow.endDate,
    ),
    gscAveragePosition: computeProjAgg(
      "gsc.average_position",
      currentObsSummary,
      dateWindow.startDate,
      dateWindow.endDate,
    ),
  };

  const priorStart = dateWindow.compareStartDate ?? dateWindow.startDate;
  const priorEnd = dateWindow.compareEndDate ?? dateWindow.endDate;
  const comparisons = {
    sessions: computeMetricDeltaComparison(
      metrics.sessions.value,
      computeProjAgg("ga4.sessions", priorObsSummary, priorStart, priorEnd).value,
    ),
    activeUsers: computeMetricDeltaComparison(
      metrics.activeUsers.value,
      computeProjAgg("ga4.active_users", priorObsSummary, priorStart, priorEnd).value,
    ),
    engagementRate: computeMetricDeltaComparison(
      metrics.engagementRate.value,
      computeProjAgg("ga4.engagement_rate", priorObsSummary, priorStart, priorEnd).value,
    ),
    pageViews: computeMetricDeltaComparison(
      metrics.pageViews.value,
      computeProjAgg("ga4.screen_page_views", priorObsSummary, priorStart, priorEnd).value,
    ),
    gscClicks: computeMetricDeltaComparison(
      metrics.gscClicks.value,
      computeProjAgg("gsc.clicks", priorObsSummary, priorStart, priorEnd).value,
    ),
    gscImpressions: computeMetricDeltaComparison(
      metrics.gscImpressions.value,
      computeProjAgg("gsc.impressions", priorObsSummary, priorStart, priorEnd).value,
    ),
    gscCtr: computeMetricDeltaComparison(
      metrics.gscCtr.value,
      computeProjAgg("gsc.ctr", priorObsSummary, priorStart, priorEnd).value,
    ),
    gscAveragePosition: computeMetricDeltaComparison(
      metrics.gscAveragePosition.value,
      computeProjAgg("gsc.average_position", priorObsSummary, priorStart, priorEnd).value,
      { invertPolarity: true },
    ),
  };

  const mappedResources: PortfolioMappedResourceBadge[] = scopedMappings.map((m) => ({
    connectedResourceId: m.connected_resource_id,
    providerConnectionId: m.provider_connection_id,
    providerKey: m.provider_key,
    externalResourceId: m.external_resource_id,
    displayName: m.display_name,
    environmentId: m.environment_id,
    environmentType: m.environment_type,
    connectionStatus: m.connection_status,
    syncState:
      m.sync_state ?? (m.connection_status === "HEALTHY" ? "COMPLETED" : "CONNECTION_REVOKED"),
    reportingTimezone: isGscProviderKey(m.provider_key)
      ? "America/Los_Angeles"
      : typeof m.metadata?.timeZone === "string"
        ? m.metadata.timeZone
        : dateWindow.timeZone,
    lastSyncedAtIso: m.last_succeeded_at ? new Date(m.last_succeeded_at).toISOString() : null,
    sourceLagNotice: isGscProviderKey(m.provider_key)
      ? "GSC finalizes data ~48h after Pacific day end"
      : null,
  }));

  const ga4Resources = mappedResources.filter((r) => isGa4ProviderKey(r.providerKey));
  const gscResources = mappedResources.filter((r) => isGscProviderKey(r.providerKey));
  const hasOverlappingGa4Properties =
    new Set(ga4Resources.map((r) => r.externalResourceId)).size > 1;
  const hasOverlappingGscProperties =
    new Set(gscResources.map((r) => r.externalResourceId)).size > 1;

  const overlapWarnings: string[] = [];
  if (hasOverlappingGa4Properties) {
    overlapWarnings.push(
      `Multiple GA4 properties (${ga4Resources.map((r) => r.externalResourceId).join(", ")}) are mapped to this environment lens. Active Users (ga4.active_users) cannot be summed across overlapping properties.`,
    );
  }
  if (hasOverlappingGscProperties) {
    overlapWarnings.push(
      `Multiple Search Console properties (${gscResources.map((r) => r.externalResourceId).join(", ")}) are mapped to this environment lens. Average Position (gsc.average_position) cannot be merged across overlapping properties.`,
    );
  }

  const deriveProviderUxState = (
    resources: PortfolioMappedResourceBadge[],
    primaryMetric: AggregatedMetricResult,
  ): AvenorUxState => {
    if (resources.length === 0) return "unconnected";
    if (
      resources.some(
        (r) =>
          r.connectionStatus === "TOKEN_EXPIRED" ||
          r.connectionStatus === "EXPIRED" ||
          r.connectionStatus === "REVOKED" ||
          r.connectionStatus === "PERMISSION_MISSING",
      )
    ) {
      return "permission_insufficient";
    }
    if (resources.some((r) => r.syncState === "RATE_LIMITED")) {
      return "rate_limited";
    }
    if (resources.some((r) => r.syncState === "FAILED")) {
      return "provider_error";
    }
    if (primaryMetric.observationCount === 0) {
      return "empty_first_use";
    }
    return primaryMetric.uxState;
  };

  const audienceUxState = deriveProviderUxState(ga4Resources, metrics.sessions);
  const searchUxState = deriveProviderUxState(gscResources, metrics.gscClicks);
  const uxState: AvenorUxState =
    mappedResources.length === 0
      ? "unconnected"
      : audienceUxState === "provider_error" || searchUxState === "provider_error"
        ? "provider_error"
        : audienceUxState === "rate_limited" || searchUxState === "rate_limited"
          ? "rate_limited"
          : audienceUxState === "connected_healthy" || searchUxState === "connected_healthy"
            ? "connected_healthy"
            : "partial_coverage";

  const datesInWindow = enumerateDatesBetween(dateWindow.startDate, dateWindow.endDate);
  const dailyTrend = buildDailyTrendFromObservations(datesInWindow, currentObsSummary);

  // Dimensional breakdowns from stored observations (supporting both normalized & raw dimension keys)
  const extractChannelDim = (o: StoredMetricObservation) =>
    o.dimensions.sessionDefaultChannelGroup ?? o.dimensions.channel_group ?? null;
  const channelObs = currentObsAllDims.filter((o) => Boolean(extractChannelDim(o)));
  const channelNames = Array.from(
    new Set(channelObs.map(extractChannelDim).filter((v): v is string => Boolean(v))),
  );
  const topChannels: ProjectDimensionBreakdownItem[] = channelNames
    .map((ch) => {
      const subset = channelObs.filter((o) => extractChannelDim(o) === ch);
      const sess = aggregateMetricObservations({
        canonicalMetricKey: "ga4.sessions",
        observations: subset,
      }).value;
      const eng = aggregateMetricObservations({
        canonicalMetricKey: "ga4.engagement_rate",
        observations: subset,
      }).value;
      const keyEv = aggregateMetricObservations({
        canonicalMetricKey: "ga4.key_events",
        observations: subset,
      }).value;
      return {
        dimensionValue: ch,
        primaryMetricValue: sess,
        secondaryMetricValue: eng,
        tertiaryMetricValue: keyEv,
      };
    })
    .sort((a, b) => (b.primaryMetricValue ?? 0) - (a.primaryMetricValue ?? 0))
    .slice(0, 6);

  const extractGa4PageDim = (o: StoredMetricObservation) =>
    o.dimensions.landingPagePlusQueryString ?? o.dimensions.pagePath ?? o.dimensions.page_path ?? null;
  const ga4PageObs = currentObsAllDims.filter(
    (o) => isGa4ProviderKey(o.providerKey) && Boolean(extractGa4PageDim(o)),
  );
  const pagePaths = Array.from(
    new Set(ga4PageObs.map(extractGa4PageDim).filter((v): v is string => Boolean(v))),
  );
  const topPages: ProjectDimensionBreakdownItem[] = pagePaths
    .map((pagePath) => {
      const subset = ga4PageObs.filter((o) => extractGa4PageDim(o) === pagePath);
      const sess = aggregateMetricObservations({
        canonicalMetricKey: "ga4.sessions",
        observations: subset,
      }).value;
      const views = aggregateMetricObservations({
        canonicalMetricKey: "ga4.screen_page_views",
        observations: subset,
      }).value;
      return {
        dimensionValue: pagePath,
        secondaryValue: subset[0]?.dimensions.page_title ?? null,
        primaryMetricValue: sess ?? views,
        secondaryMetricValue: views ?? sess,
      };
    })
    .sort((a, b) => (b.primaryMetricValue ?? 0) - (a.primaryMetricValue ?? 0))
    .slice(0, 6);

  const queryObs = currentObsAllDims.filter(
    (o) => isGscProviderKey(o.providerKey) && Boolean(o.dimensions.query),
  );
  const queries = Array.from(
    new Set(queryObs.map((o) => o.dimensions.query).filter((v): v is string => Boolean(v))),
  );
  const topQueries: ProjectDimensionBreakdownItem[] = queries
    .map((q) => {
      const subset = queryObs.filter((o) => o.dimensions.query === q);
      const clicks = aggregateMetricObservations({
        canonicalMetricKey: "gsc.clicks",
        observations: subset,
      }).value;
      const impressions = aggregateMetricObservations({
        canonicalMetricKey: "gsc.impressions",
        observations: subset,
      }).value;
      const ctr =
        clicks !== null && impressions !== null && impressions > 0 ? clicks / impressions : null;
      return {
        dimensionValue: q,
        primaryMetricValue: clicks,
        secondaryMetricValue: impressions,
        tertiaryMetricValue: ctr,
      };
    })
    .sort((a, b) => (b.primaryMetricValue ?? 0) - (a.primaryMetricValue ?? 0))
    .slice(0, 6);

  const extractGscPageDim = (o: StoredMetricObservation) =>
    o.dimensions.page ?? o.dimensions.page_path ?? null;
  const gscPageObs = currentObsAllDims.filter(
    (o) => isGscProviderKey(o.providerKey) && Boolean(extractGscPageDim(o)),
  );
  const gscPages = Array.from(
    new Set(gscPageObs.map(extractGscPageDim).filter((v): v is string => Boolean(v))),
  );
  const topSearchPages: ProjectDimensionBreakdownItem[] = gscPages
    .map((p) => {
      const subset = gscPageObs.filter((o) => extractGscPageDim(o) === p);
      const clicks = aggregateMetricObservations({
        canonicalMetricKey: "gsc.clicks",
        observations: subset,
      }).value;
      const impressions = aggregateMetricObservations({
        canonicalMetricKey: "gsc.impressions",
        observations: subset,
      }).value;
      const ctr =
        clicks !== null && impressions !== null && impressions > 0 ? clicks / impressions : null;
      return {
        dimensionValue: p,
        primaryMetricValue: clicks,
        secondaryMetricValue: impressions,
        tertiaryMetricValue: ctr,
      };
    })
    .sort((a, b) => (b.primaryMetricValue ?? 0) - (a.primaryMetricValue ?? 0))
    .slice(0, 6);

  const syncStatus = await getProjectSyncStatusSummary(session, access.projectId, options);
  const freshnessLabel = syncStatus.lastSyncedAtIso
    ? `Synced ${syncStatus.lastSyncedAtIso.slice(0, 16).replace("T", " ")} UTC`
    : mappedResources.length > 0
      ? "Canonical observations stored"
      : "No sources mapped";

  return {
    organizationId: access.organizationId,
    workspaceId: access.workspaceId,
    project,
    selectedEnvironmentId,
    selectedEnvironmentType,
    dateWindow,
    mappedResources,
    hasOverlappingGa4Properties,
    hasOverlappingGscProperties,
    overlapWarnings,
    uxState,
    audienceUxState,
    searchUxState,
    freshnessLabel,
    metrics,
    comparisons,
    dailyTrend,
    breakdowns: {
      topChannels,
      topPages,
      topQueries,
      topSearchPages,
    },
    syncStatus,
  };
}
