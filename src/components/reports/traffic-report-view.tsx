"use client";

import type { LogicalProjectSummary } from "@avenor/types";
import {
  Badge,
  Button,
  Card,
  DataTable,
  type DataTableColumn,
  MetricCard,
  SegmentedControl,
} from "@avenor/ui";
import { Activity, Clock, Database, PauseCircle, RefreshCw, ShieldAlert } from "lucide-react";
import * as React from "react";
import { useGa4Realtime } from "@/lib/hooks/use-ga4-realtime";
import type { Ga4BreakdownRow } from "@/lib/providers/google-analytics/types";
import {
  formatComparisonDelta,
  formatDurationSeconds,
  formatIntegerCount,
  formatRatioPercent,
} from "@/lib/reports/date-window";
import type { ProjectGa4StandardResponseDto } from "@/lib/reports/ga4-service";
import {
  ReportBlockedStateCard,
  ReportContextToolbar,
  ReportDegradedBanner,
} from "./report-state-banner";
import { TrendChartCard, type TrendSeriesPoint } from "./trend-chart-card";

type TrafficBreakdownTab =
  | "channels"
  | "landingPages"
  | "topPages"
  | "devices"
  | "locations"
  | "events";

function renderGa4BreakdownMobileCards(rows: Ga4BreakdownRow[], dimensionLabel: string) {
  if (rows.length === 0) {
    return (
      <div className="rounded-[12px] border border-[#DFE6F0] bg-[#F7F9FC] p-4 text-[13px] text-[#64748B]">
        No {dimensionLabel.toLowerCase()} rows returned for this date range.
      </div>
    );
  }

  return (
    <div className="space-y-2.5 md:hidden">
      {rows.map((row) => (
        <div
          key={`${row.dimensionValue}::${row.secondaryDimensionValue ?? "base"}`}
          className="rounded-[12px] border border-[#DFE6F0] bg-[#FFFFFF] p-3.5 space-y-2"
        >
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-[#17243A] break-all m-0">
              {row.dimensionValue}
            </p>
            {row.secondaryDimensionValue ? (
              <p className="text-[12px] text-[#64748B] truncate m-0">
                {row.secondaryDimensionValue}
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-3 gap-2 text-[12px]">
            <div>
              <span className="text-[#64748B] block">Sessions</span>
              <span className="font-semibold text-[#17243A] tabular-nums">
                {formatIntegerCount(row.sessions)}
              </span>
            </div>
            <div>
              <span className="text-[#64748B] block">Active Users</span>
              <span className="font-semibold text-[#17243A] tabular-nums">
                {formatIntegerCount(row.activeUsers)}
              </span>
            </div>
            <div>
              <span className="text-[#64748B] block">Key Events</span>
              <span className="font-semibold text-[#17243A] tabular-nums">
                {formatIntegerCount(row.keyEvents)}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function TrafficReportView({
  projects,
  initialTelemetry,
  initialEnvironmentId = "",
}: {
  projects?: LogicalProjectSummary[];
  initialTelemetry: ProjectGa4StandardResponseDto;
  initialEnvironmentId?: string;
}) {
  const [telemetry, setTelemetry] = React.useState<ProjectGa4StandardResponseDto>(initialTelemetry);
  const [selectedProjectId, setSelectedProjectId] = React.useState<string>(
    initialTelemetry.projectId,
  );
  const [selectedEnvironmentId, setSelectedEnvironmentId] =
    React.useState<string>(initialEnvironmentId);
  const [customStartDate, setCustomStartDate] = React.useState<string>(
    initialTelemetry.window.startDate,
  );
  const [customEndDate, setCustomEndDate] = React.useState<string>(initialTelemetry.window.endDate);
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const [activeTrendMetric, setActiveTrendMetric] = React.useState<string>("sessions");
  const [activeTab, setActiveTab] = React.useState<TrafficBreakdownTab>("channels");

  React.useEffect(() => {
    setTelemetry(initialTelemetry);
    setSelectedProjectId(initialTelemetry.projectId);
    setSelectedEnvironmentId(initialEnvironmentId);
    setCustomStartDate(initialTelemetry.window.startDate);
    setCustomEndDate(initialTelemetry.window.endDate);
  }, [initialTelemetry, initialEnvironmentId]);

  const selectedProject = React.useMemo(
    () => projects?.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const initialRealtimeDto = React.useMemo(
    () =>
      telemetry.realtime
        ? {
            projectId: telemetry.projectId,
            projectName: telemetry.projectName,
            primaryDomain: telemetry.primaryDomain,
            status: "ready" as const,
            uxState: telemetry.realtime.rateLimited
              ? ("rate_limited" as const)
              : telemetry.realtime.stale
                ? ("stale_cached" as const)
                : ("connected_healthy" as const),
            message: null,
            actionLabel: null,
            actionHref: null,
            selectedBinding: telemetry.selectedBinding,
            availableBindings: telemetry.availableBindings,
            workspaceUnmappedCount: telemetry.workspaceUnmappedCount,
            realtime: telemetry.realtime,
          }
        : null,
    [telemetry],
  );

  const realtimeHook = useGa4Realtime({
    projectId: telemetry.status === "ready" ? telemetry.projectId : null,
    environmentId: selectedEnvironmentId || null,
    enabled: telemetry.status === "ready",
    initialData: initialRealtimeDto,
  });

  const loadAnalytics = React.useCallback(
    async (params: {
      projectId: string;
      environmentId: string;
      preset?: string;
      startDate?: string;
      endDate?: string;
      compare?: boolean;
      refresh?: boolean;
    }) => {
      setIsLoading(true);
      setFetchError(null);
      try {
        const search = new URLSearchParams();
        if (params.environmentId) search.set("environmentId", params.environmentId);
        if (params.preset) search.set("preset", params.preset);
        if (params.startDate) search.set("startDate", params.startDate);
        if (params.endDate) search.set("endDate", params.endDate);
        search.set("compare", params.compare === false ? "0" : "1");
        search.set("includeRealtime", "1");
        if (params.refresh) search.set("refresh", "1");

        const res = await fetch(
          `/api/projects/${encodeURIComponent(params.projectId)}/analytics?${search.toString()}`,
          { method: "GET", credentials: "same-origin", cache: "no-store" },
        );
        const payload = (await res.json()) as ProjectGa4StandardResponseDto & {
          error?: { message?: string };
        };
        if (!res.ok) {
          setFetchError(payload.error?.message ?? "Unable to load GA4 traffic telemetry.");
          return;
        }
        setTelemetry(payload);
        setCustomStartDate(payload.window.startDate);
        setCustomEndDate(payload.window.endDate);
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : "Network error reading GA4 telemetry.");
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const report = telemetry.report;
  const totals = report?.totals ?? null;
  const compareTotals = report?.comparisonTotals ?? null;

  const trendPoints = React.useMemo<TrendSeriesPoint[]>(() => {
    if (!report) return [];
    const compSeries = report.comparisonSeries ?? [];
    return report.dailySeries.map((pt, idx) => {
      const priorPt = compSeries[idx];
      const pick = (row: typeof pt | undefined): number | null => {
        if (!row) return null;
        if (activeTrendMetric === "activeUsers") return row.activeUsers;
        if (activeTrendMetric === "screenPageViews") return row.screenPageViews;
        if (activeTrendMetric === "keyEvents") return row.keyEvents;
        return row.sessions;
      };
      return {
        date: pt.date,
        primaryValue: pick(pt),
        secondaryValue: pt.activeUsers,
        comparisonValue: pick(priorPt),
      };
    });
  }, [activeTrendMetric, report]);

  const activeRows = React.useMemo<{
    dimensionHeader: string;
    secondaryHeader?: string;
    rows: Ga4BreakdownRow[];
  }>(() => {
    if (!report) {
      return { dimensionHeader: "Dimension", rows: [] };
    }
    switch (activeTab) {
      case "landingPages":
        return { dimensionHeader: "Landing Page", rows: report.landingPages };
      case "topPages":
        return {
          dimensionHeader: "Page Path",
          secondaryHeader: "Page Title",
          rows: report.topPages,
        };
      case "devices":
        return { dimensionHeader: "Device Category", rows: report.devices };
      case "locations":
        return {
          dimensionHeader: "Country",
          secondaryHeader: "City",
          rows: report.cities.length > 0 ? report.cities : report.countries,
        };
      case "events":
        return { dimensionHeader: "Event Name", rows: report.topEvents };
      default:
        return {
          dimensionHeader: "Channel Group",
          secondaryHeader: "Source / Medium",
          rows: report.channels.length > 0 ? report.channels : report.sourceMediums,
        };
    }
  }, [activeTab, report]);

  const breakdownColumns: DataTableColumn<Ga4BreakdownRow>[] = [
    {
      key: "dimension",
      header: activeRows.dimensionHeader,
      render: (row) => (
        <div className="space-y-0.5 max-w-[320px]">
          <p className="font-medium text-[#17243A] break-all m-0">{row.dimensionValue}</p>
          {row.secondaryDimensionValue ? (
            <p className="text-[12px] text-[#64748B] truncate m-0">{row.secondaryDimensionValue}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: "sessions",
      header: "Sessions",
      numeric: true,
      render: (row) => formatIntegerCount(row.sessions),
    },
    {
      key: "activeUsers",
      header: "Active Users",
      numeric: true,
      render: (row) => formatIntegerCount(row.activeUsers),
    },
    {
      key: "engagementRate",
      header: "Eng. Rate",
      numeric: true,
      render: (row) => formatRatioPercent(row.engagementRate),
    },
    {
      key: "screenPageViews",
      header: "Views",
      numeric: true,
      render: (row) => formatIntegerCount(row.screenPageViews),
    },
    {
      key: "keyEvents",
      header: "Key Events",
      numeric: true,
      render: (row) => formatIntegerCount(row.keyEvents),
    },
  ];

  const realtimeBundle = realtimeHook.data?.realtime ?? telemetry.realtime;
  const reportingTz = report?.reportingTimeZone ?? telemetry.window.timeZone;

  return (
    <div className="space-y-6 min-w-0" data-testid="audience-traffic-report-page">
      <ReportContextToolbar
        testIdPrefix="ga4"
        projects={projects}
        selectedProjectId={selectedProjectId}
        onProjectChange={(nextProjectId) => {
          setSelectedProjectId(nextProjectId);
          setSelectedEnvironmentId("");
          void loadAnalytics({
            projectId: nextProjectId,
            environmentId: "",
            preset: telemetry.window.preset === "custom" ? "28d" : telemetry.window.preset,
            compare: telemetry.window.compareEnabled,
          });
        }}
        environments={selectedProject?.environments}
        selectedEnvironmentId={selectedEnvironmentId}
        onEnvironmentChange={(nextEnvId) => {
          setSelectedEnvironmentId(nextEnvId);
          void loadAnalytics({
            projectId: selectedProjectId,
            environmentId: nextEnvId,
            preset: telemetry.window.preset,
            startDate:
              telemetry.window.preset === "custom" ? telemetry.window.startDate : undefined,
            endDate: telemetry.window.preset === "custom" ? telemetry.window.endDate : undefined,
            compare: telemetry.window.compareEnabled,
          });
        }}
        windowState={telemetry.window}
        onPresetChange={(preset) => {
          void loadAnalytics({
            projectId: selectedProjectId,
            environmentId: selectedEnvironmentId,
            preset,
            compare: telemetry.window.compareEnabled,
          });
        }}
        customStartDate={customStartDate}
        customEndDate={customEndDate}
        onCustomStartChange={setCustomStartDate}
        onCustomEndChange={setCustomEndDate}
        onApplyCustomDates={() => {
          void loadAnalytics({
            projectId: selectedProjectId,
            environmentId: selectedEnvironmentId,
            preset: "custom",
            startDate: customStartDate,
            endDate: customEndDate,
            compare: telemetry.window.compareEnabled,
          });
        }}
        onToggleCompare={() => {
          void loadAnalytics({
            projectId: selectedProjectId,
            environmentId: selectedEnvironmentId,
            preset: telemetry.window.preset,
            startDate:
              telemetry.window.preset === "custom" ? telemetry.window.startDate : undefined,
            endDate: telemetry.window.preset === "custom" ? telemetry.window.endDate : undefined,
            compare: !telemetry.window.compareEnabled,
          });
        }}
        onRefresh={() => {
          void loadAnalytics({
            projectId: selectedProjectId,
            environmentId: selectedEnvironmentId,
            preset: telemetry.window.preset,
            startDate:
              telemetry.window.preset === "custom" ? telemetry.window.startDate : undefined,
            endDate: telemetry.window.preset === "custom" ? telemetry.window.endDate : undefined,
            compare: telemetry.window.compareEnabled,
            refresh: true,
          });
        }}
        isLoading={isLoading}
      />

      {fetchError ? (
        <div
          role="alert"
          className="rounded-[12px] border border-[#BF4256]/30 bg-[#FDECEF] px-4 py-3 text-[13.5px] font-medium text-[#BF4256]"
        >
          {fetchError}
        </div>
      ) : null}

      {telemetry.status === "blocked" ? (
        <ReportBlockedStateCard
          testId="ga4-blocked-state"
          providerLabel="Google Analytics 4"
          uxState={telemetry.uxState}
          message={telemetry.message}
          actionLabel={telemetry.actionLabel}
          actionHref={telemetry.actionHref}
          workspaceUnmappedCount={telemetry.workspaceUnmappedCount}
        />
      ) : report ? (
        <>
          {/* Provenance & Quality Flag Strip */}
          <Card className="p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <Database className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
              <span className="font-mono font-semibold text-[#17243A]">{report.propertyName}</span>
              <Badge tone="neutral">
                <Clock className="h-3 w-3 mr-1" aria-hidden="true" />
                TZ: {reportingTz}
              </Badge>
              {report.currencyCode ? <Badge tone="neutral">{report.currencyCode}</Badge> : null}
              <Badge tone={report.sourceMode === "live" ? "success" : "indigo"}>
                {report.sourceMode === "live" ? "Live GA4 Data API" : "Sandbox Demo Mode"}
              </Badge>
              {report.dataQuality.isSampled ? (
                <Badge tone="warning">Sampled ({report.dataQuality.samplingRatePct ?? "?"}%)</Badge>
              ) : null}
              {report.dataQuality.isThresholded ? (
                <Badge tone="warning">Thresholding Applied</Badge>
              ) : null}
              {report.dataQuality.hasOtherRowTruncation ? (
                <Badge tone="warning">(other) Row Truncation</Badge>
              ) : null}
            </div>
            <div className="text-[12px] text-[#64748B] tabular-nums">
              {report.quota.tokensRemainingHour !== null
                ? `Quota hourly remaining: ${report.quota.tokensRemainingHour}`
                : `Cache: ${report.cacheStatus}`}
            </div>
          </Card>

          <ReportDegradedBanner
            testId="ga4-quality-banner"
            uxState={telemetry.uxState}
            message={telemetry.message}
            actionLabel={telemetry.actionLabel}
            actionHref={telemetry.actionHref}
          />

          {/* Primary KPI Strip */}
          <section
            aria-label="Google Analytics 4 overview metrics"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
            data-testid="ga4-kpi-grid"
          >
            <MetricCard
              title="Active Users"
              definition="Deduplicated per property (RESERVED_TOTAL). Never sum across distinct GA4 properties."
              state={telemetry.uxState}
              value={totals?.activeUsers ?? null}
              formattedValue={formatIntegerCount(totals?.activeUsers)}
              comparisonDeltaText={formatComparisonDelta(
                totals?.activeUsers,
                compareTotals?.activeUsers,
              )}
              sourceLabel="GA4 Property"
              freshnessLabel={`TZ: ${reportingTz}`}
            />
            <MetricCard
              title="Sessions"
              definition="GA4 session_start visits on this property (distinct from Search Console clicks)."
              state={telemetry.uxState}
              value={totals?.sessions ?? null}
              formattedValue={formatIntegerCount(totals?.sessions)}
              comparisonDeltaText={formatComparisonDelta(totals?.sessions, compareTotals?.sessions)}
              sourceLabel={`Engaged: ${formatIntegerCount(totals?.engagedSessions)}`}
              freshnessLabel={`Avg duration: ${formatDurationSeconds(totals?.averageSessionDuration)}`}
            />
            <MetricCard
              title="Engagement Rate"
              definition="Session-weighted ratio (engagedSessions / sessions). Never mean-averaged across rows."
              state={telemetry.uxState}
              value={totals?.engagementRate ?? null}
              formattedValue={formatRatioPercent(totals?.engagementRate)}
              comparisonDeltaText={formatComparisonDelta(
                totals?.engagementRate,
                compareTotals?.engagementRate,
                { isRatioPoints: true },
              )}
              sourceLabel={`New users: ${formatIntegerCount(totals?.newUsers)}`}
              freshnessLabel={`Total users: ${formatIntegerCount(totals?.totalUsers)}`}
            />
            <MetricCard
              title="Views & Key Events"
              definition="Screen/page views paired with GA4 Admin-configured Key Events (conversions)."
              state={telemetry.uxState}
              value={totals?.screenPageViews ?? null}
              formattedValue={formatIntegerCount(totals?.screenPageViews)}
              comparisonDeltaText={formatComparisonDelta(
                totals?.screenPageViews,
                compareTotals?.screenPageViews,
              )}
              sourceLabel={`Key Events: ${formatIntegerCount(totals?.keyEvents)}`}
              freshnessLabel={`Events: ${formatIntegerCount(totals?.eventCount)}`}
            />
          </section>

          {/* Daily Trend Chart / Accessible Table + Realtime Sidebar/Panel */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12 min-w-0">
            <div className="xl:col-span-8 min-w-0">
              <TrendChartCard
                testId="ga4-trend"
                title="Traffic Trend Over Time"
                subtitle="Daily GA4 property series in the property's configured timezone."
                timeZoneLabel={reportingTz}
                comparisonPeriodLabel={
                  report.compareStartDate && report.compareEndDate
                    ? `${report.compareStartDate}..${report.compareEndDate}`
                    : null
                }
                points={trendPoints}
                activeMetricKey={activeTrendMetric}
                onMetricChange={setActiveTrendMetric}
                metrics={[
                  {
                    key: "sessions",
                    label: "Sessions",
                    unitLabel: "sessions",
                    colorHex: "#5157D9",
                    formatValue: formatIntegerCount,
                  },
                  {
                    key: "activeUsers",
                    label: "Active Users",
                    unitLabel: "users",
                    colorHex: "#168E99",
                    formatValue: formatIntegerCount,
                  },
                  {
                    key: "screenPageViews",
                    label: "Views",
                    unitLabel: "views",
                    colorHex: "#4047BD",
                    formatValue: formatIntegerCount,
                  },
                  {
                    key: "keyEvents",
                    label: "Key Events",
                    unitLabel: "events",
                    colorHex: "#147D63",
                    formatValue: formatIntegerCount,
                  },
                ]}
                secondaryColumnHeader="Active Users"
                formatSecondaryValue={formatIntegerCount}
              />
            </div>

            {/* Live Realtime Panel (30-min rolling estimate via useGa4Realtime) */}
            <Card
              className="xl:col-span-4 p-5 sm:p-6 space-y-4 min-w-0"
              data-testid="ga4-realtime-panel"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Activity className="h-4 w-4 text-[#168E99]" aria-hidden="true" />
                    <h2 className="text-[17px] font-semibold text-[#17243A] m-0">
                      Realtime Activity
                    </h2>
                  </div>
                  <p className="text-[12px] text-[#64748B] m-0">
                    {realtimeBundle?.windowLabel ??
                      "Active users in the last 30 minutes (estimate)"}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  data-testid="ga4-realtime-refresh-button"
                  disabled={realtimeHook.isRefreshing}
                  leftIcon={
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${realtimeHook.isRefreshing ? "animate-spin" : ""}`}
                      aria-hidden="true"
                    />
                  }
                  onClick={() => void realtimeHook.refresh()}
                >
                  Poll
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="signal">30-min estimate</Badge>
                {realtimeHook.isPausedHidden ? (
                  <Badge tone="neutral">
                    <PauseCircle className="h-3 w-3 mr-1" aria-hidden="true" />
                    Paused (tab hidden)
                  </Badge>
                ) : null}
                {realtimeHook.isRateLimited ? (
                  <Badge tone="warning">
                    <ShieldAlert className="h-3 w-3 mr-1" aria-hidden="true" />
                    429 Backoff ({realtimeHook.retryAfterSeconds ?? 45}s)
                  </Badge>
                ) : realtimeHook.isStale ? (
                  <Badge tone="warning">Stale ({realtimeBundle?.freshnessSeconds ?? "?"}s)</Badge>
                ) : (
                  <Badge tone="success">Fresh ({realtimeBundle?.freshnessSeconds ?? 0}s)</Badge>
                )}
              </div>

              {realtimeBundle ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-2 rounded-[12px] border border-[#DFE6F0] bg-[#F7F9FC] p-3">
                    <div>
                      <span className="text-[11px] text-[#64748B] block">Active 30m</span>
                      <span
                        className="text-[20px] font-semibold text-[#17243A] tabular-nums"
                        data-testid="ga4-realtime-active-users"
                      >
                        {formatIntegerCount(realtimeBundle.activeUsersLast30m)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] text-[#64748B] block">Views 30m</span>
                      <span className="text-[16px] font-semibold text-[#17243A] tabular-nums">
                        {formatIntegerCount(realtimeBundle.screenPageViewsLast30m)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] text-[#64748B] block">Events 30m</span>
                      <span className="text-[16px] font-semibold text-[#17243A] tabular-nums">
                        {formatIntegerCount(realtimeBundle.eventCountLast30m)}
                      </span>
                    </div>
                  </div>

                  {realtimeBundle.byDevice.length > 0 ? (
                    <div className="space-y-1.5">
                      <p className="text-[11.5px] font-semibold uppercase tracking-wider text-[#64748B] m-0">
                        Active Devices (30m)
                      </p>
                      <div className="space-y-1">
                        {realtimeBundle.byDevice.slice(0, 4).map((row) => (
                          <div
                            key={`${row.dimensionValues.deviceCategory ?? "dev"}::${row.dimensionValues.platform ?? "all"}::${row.activeUsers ?? "na"}`}
                            className="flex items-center justify-between text-[12.5px] text-[#30415D]"
                          >
                            <span className="capitalize">
                              {row.dimensionValues.deviceCategory ?? "unknown"}
                            </span>
                            <span className="font-semibold text-[#17243A] tabular-nums">
                              {formatIntegerCount(row.activeUsers)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {realtimeBundle.byScreenOrPage.length > 0 ? (
                    <div className="space-y-1.5">
                      <p className="text-[11.5px] font-semibold uppercase tracking-wider text-[#64748B] m-0">
                        Top Active Screens / Titles
                      </p>
                      <div className="space-y-1">
                        {realtimeBundle.byScreenOrPage.slice(0, 4).map((row) => (
                          <div
                            key={`${row.dimensionValues.unifiedScreenName ?? "scr"}::${row.activeUsers ?? "na"}`}
                            className="flex items-center justify-between gap-2 text-[12px] text-[#30415D]"
                          >
                            <span className="truncate">
                              {row.dimensionValues.unifiedScreenName ?? "(not set)"}
                            </span>
                            <span className="font-semibold text-[#17243A] tabular-nums shrink-0">
                              {formatIntegerCount(row.activeUsers)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-[12px] border border-[#DFE6F0] bg-[#F7F9FC] p-4 text-[13px] text-[#64748B]">
                  {realtimeHook.errorMessage ??
                    "Realtime snapshot unavailable right now. Polling respects rate limits automatically."}
                </div>
              )}
            </Card>
          </div>

          {/* Acquisition, Pages, Devices, Geography, Events Breakdowns */}
          <Card className="p-5 sm:p-6 space-y-4 min-w-0" data-testid="ga4-breakdown-card">
            <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
              <div className="space-y-0.5">
                <h2 className="text-[18px] font-semibold text-[#17243A] m-0">
                  Acquisition, Pages, Devices & Key Events
                </h2>
                <p className="text-[13px] text-[#64748B] m-0">
                  Scoped strictly to {report.propertyName} ({reportingTz}). Metrics never carry
                  synthetic 0s for omitted or unpermitted fields.
                </p>
              </div>
              <div className="overflow-x-auto max-w-full">
                <SegmentedControl<TrafficBreakdownTab>
                  ariaLabel="Select GA4 breakdown dimension"
                  value={activeTab}
                  onChange={setActiveTab}
                  options={[
                    { value: "channels", label: "Channels", badge: String(report.channels.length) },
                    {
                      value: "landingPages",
                      label: "Landing Pages",
                      badge: String(report.landingPages.length),
                    },
                    {
                      value: "topPages",
                      label: "Top Pages",
                      badge: String(report.topPages.length),
                    },
                    { value: "devices", label: "Devices", badge: String(report.devices.length) },
                    {
                      value: "locations",
                      label: "Geography",
                      badge: String(report.countries.length),
                    },
                    { value: "events", label: "Events", badge: String(report.topEvents.length) },
                  ]}
                />
              </div>
            </div>

            {renderGa4BreakdownMobileCards(activeRows.rows, activeRows.dimensionHeader)}

            <div className="hidden md:block">
              <DataTable
                caption={`${activeRows.dimensionHeader} performance breakdown for ${report.propertyName}`}
                columns={breakdownColumns}
                rows={activeRows.rows}
                getRowKey={(row) =>
                  `${row.dimensionValue}::${row.secondaryDimensionValue ?? "base"}`
                }
                emptyState={
                  <div className="rounded-[12px] border border-[#DFE6F0] bg-[#F7F9FC] px-4 py-8 text-center text-[13.5px] text-[#64748B]">
                    No {activeRows.dimensionHeader.toLowerCase()} rows returned in this window.
                  </div>
                }
              />
            </div>

            {activeTab === "events" && report.keyEventDefinitions.length > 0 ? (
              <div className="border-t border-[#DFE6F0] pt-4 space-y-2">
                <p className="text-[12px] font-semibold uppercase tracking-wider text-[#64748B] m-0">
                  Admin Key Event (Conversion) Definitions
                </p>
                <div className="flex flex-wrap gap-2">
                  {report.keyEventDefinitions.map((ke) => (
                    <Badge key={ke.name} tone="signal">
                      {ke.eventName} ({ke.countingMethod ?? "ONCE_PER_EVENT"})
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>
        </>
      ) : null}
    </div>
  );
}
