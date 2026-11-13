"use client";

import type { LogicalProjectSummary } from "@avenor/types";
import {
  Badge,
  Button,
  Card,
  DataTable,
  type DataTableColumn,
  MetricCard,
  SearchInput,
  SegmentedControl,
  Select,
} from "@avenor/ui";
import { Clock, Globe, Info, SearchCheck } from "lucide-react";
import * as React from "react";
import {
  GSC_REPORTING_TIMEZONE,
  type GscDataState,
  type GscSearchAnalyticsRow,
  type GscSearchType,
} from "@/lib/providers/google-search-console/types";
import {
  formatComparisonDelta,
  formatIntegerCount,
  formatPositionRank,
  formatRatioPercent,
} from "@/lib/reports/date-window";
import type { ProjectSearchConsoleResponseDto } from "@/lib/reports/search-console-service";
import { Ga4VsGscReconciliationPanel } from "./reconciliation-panel";
import {
  ReportBlockedStateCard,
  ReportContextToolbar,
  ReportDegradedBanner,
} from "./report-state-banner";
import { TrendChartCard, type TrendSeriesPoint } from "./trend-chart-card";

type SearchBreakdownTab = "queries" | "pages" | "countries" | "devices" | "appearance";
type SearchSortField = "clicks" | "impressions" | "ctr" | "position";

function sortGscRows(
  rows: GscSearchAnalyticsRow[],
  sortBy: SearchSortField,
): GscSearchAnalyticsRow[] {
  return [...rows].sort((a, b) => {
    if (sortBy === "position") {
      return (a.position ?? 9999) - (b.position ?? 9999);
    }
    return (b[sortBy] ?? 0) - (a[sortBy] ?? 0);
  });
}

function renderGscMobileCards(
  rows: GscSearchAnalyticsRow[],
  labelForRow: (row: GscSearchAnalyticsRow) => string,
) {
  if (rows.length === 0) {
    return (
      <div className="rounded-[12px] border border-[#DFE6F0] bg-[#F7F9FC] p-4 text-[13px] text-[#64748B]">
        No matching Search Console rows in this window.
      </div>
    );
  }

  return (
    <div className="space-y-2.5 md:hidden">
      {rows.map((row) => (
        <div
          key={`${row.keys.join("::")}-${row.clicks}-${row.impressions}`}
          className="rounded-[12px] border border-[#DFE6F0] bg-[#FFFFFF] p-3.5 space-y-2"
        >
          <p className="text-[13.5px] font-semibold text-[#17243A] break-all m-0">
            {labelForRow(row)}
          </p>
          <div className="grid grid-cols-4 gap-2 text-[12px]">
            <div>
              <span className="text-[#64748B] block">Clicks</span>
              <span className="font-semibold text-[#17243A] tabular-nums">
                {formatIntegerCount(row.clicks)}
              </span>
            </div>
            <div>
              <span className="text-[#64748B] block">Impr.</span>
              <span className="font-semibold text-[#17243A] tabular-nums">
                {formatIntegerCount(row.impressions)}
              </span>
            </div>
            <div>
              <span className="text-[#64748B] block">CTR</span>
              <span className="font-semibold text-[#17243A] tabular-nums">
                {formatRatioPercent(row.ctr)}
              </span>
            </div>
            <div>
              <span className="text-[#64748B] block">Pos</span>
              <span className="font-semibold text-[#17243A] tabular-nums">
                {formatPositionRank(row.position)}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function SearchReportView({
  projects,
  initialTelemetry,
  initialEnvironmentId = "",
}: {
  projects?: LogicalProjectSummary[];
  initialTelemetry: ProjectSearchConsoleResponseDto;
  initialEnvironmentId?: string;
}) {
  const [telemetry, setTelemetry] =
    React.useState<ProjectSearchConsoleResponseDto>(initialTelemetry);
  const [selectedProjectId, setSelectedProjectId] = React.useState<string>(
    initialTelemetry.projectId,
  );
  const [selectedEnvironmentId, setSelectedEnvironmentId] =
    React.useState<string>(initialEnvironmentId);
  const [searchType, setSearchType] = React.useState<GscSearchType>(
    initialTelemetry.filters.searchType,
  );
  const [dataState, setDataState] = React.useState<GscDataState>(
    initialTelemetry.filters.dataState,
  );
  const [queryFilterInput, setQueryFilterInput] = React.useState<string>(
    initialTelemetry.filters.queryText ?? "",
  );
  const [pageFilterInput, setPageFilterInput] = React.useState<string>(
    initialTelemetry.filters.pageText ?? "",
  );
  const [customStartDate, setCustomStartDate] = React.useState<string>(
    initialTelemetry.window.startDate,
  );
  const [customEndDate, setCustomEndDate] = React.useState<string>(initialTelemetry.window.endDate);
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const [activeTrendMetric, setActiveTrendMetric] = React.useState<string>("clicks");
  const [activeTab, setActiveTab] = React.useState<SearchBreakdownTab>("queries");
  const [sortBy, setSortBy] = React.useState<SearchSortField>("clicks");

  React.useEffect(() => {
    setTelemetry(initialTelemetry);
    setSelectedProjectId(initialTelemetry.projectId);
    setSelectedEnvironmentId(initialEnvironmentId);
    setSearchType(initialTelemetry.filters.searchType);
    setDataState(initialTelemetry.filters.dataState);
    setQueryFilterInput(initialTelemetry.filters.queryText ?? "");
    setPageFilterInput(initialTelemetry.filters.pageText ?? "");
    setCustomStartDate(initialTelemetry.window.startDate);
    setCustomEndDate(initialTelemetry.window.endDate);
  }, [initialTelemetry, initialEnvironmentId]);

  const selectedProject = React.useMemo(
    () => projects?.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const isQueryUnavailable = searchType === "DISCOVER" || searchType === "GOOGLE_NEWS";

  React.useEffect(() => {
    if (isQueryUnavailable && activeTab === "queries") {
      setActiveTab("pages");
    }
  }, [activeTab, isQueryUnavailable]);

  const loadSearchReport = React.useCallback(
    async (params: {
      projectId: string;
      environmentId: string;
      preset?: string;
      startDate?: string;
      endDate?: string;
      compare?: boolean;
      nextSearchType?: GscSearchType;
      nextDataState?: GscDataState;
      nextQuery?: string;
      nextPage?: string;
      startRow?: number;
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
        search.set("searchType", params.nextSearchType ?? searchType);
        search.set("dataState", params.nextDataState ?? dataState);
        if (params.nextQuery?.trim()) search.set("query", params.nextQuery.trim());
        if (params.nextPage?.trim()) search.set("page", params.nextPage.trim());
        if (typeof params.startRow === "number" && params.startRow > 0) {
          search.set("startRow", String(params.startRow));
        }
        if (params.refresh) search.set("refresh", "1");

        const res = await fetch(
          `/api/projects/${encodeURIComponent(params.projectId)}/search-console?${search.toString()}`,
          { method: "GET", credentials: "same-origin", cache: "no-store" },
        );
        const payload = (await res.json()) as ProjectSearchConsoleResponseDto & {
          error?: { message?: string };
        };
        if (!res.ok) {
          setFetchError(payload.error?.message ?? "Unable to load Search Console telemetry.");
          return;
        }
        setTelemetry(payload);
        setCustomStartDate(payload.window.startDate);
        setCustomEndDate(payload.window.endDate);
      } catch (err) {
        setFetchError(
          err instanceof Error ? err.message : "Network error loading Search Console telemetry.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [dataState, searchType],
  );

  const report = telemetry.report;
  const totals = report?.totals ?? null;
  const compareTotals = report?.comparisonTotals ?? null;

  const trendPoints = React.useMemo<TrendSeriesPoint[]>(() => {
    if (!report) return [];
    const compSeries = report.comparisonDailySeries ?? [];
    return report.dailySeries.map((pt, idx) => {
      const priorPt = compSeries[idx];
      const pick = (row: typeof pt | undefined): number | null => {
        if (!row) return null;
        return activeTrendMetric === "impressions" ? row.impressions : row.clicks;
      };
      return {
        date: pt.date ?? pt.keys[0] ?? "",
        primaryValue: pick(pt),
        secondaryValue: pt.impressions,
        comparisonValue: pick(priorPt),
      };
    });
  }, [activeTrendMetric, report]);

  const rawRowsForTab = React.useMemo<GscSearchAnalyticsRow[]>(() => {
    if (!report) return [];
    switch (activeTab) {
      case "pages":
        return report.topPages;
      case "countries":
        return report.byCountry;
      case "devices":
        return report.byDevice;
      case "appearance":
        return report.bySearchAppearance;
      default:
        return report.topQueries;
    }
  }, [activeTab, report]);

  const filteredSortedRows = React.useMemo(() => {
    const q = queryFilterInput.trim().toLowerCase();
    const p = pageFilterInput.trim().toLowerCase();
    const filtered = rawRowsForTab.filter((row) => {
      if (activeTab === "queries" && q) {
        return (row.query ?? row.keys[0] ?? "").toLowerCase().includes(q);
      }
      if (activeTab === "pages" && p) {
        return (row.page ?? row.keys[0] ?? "").toLowerCase().includes(p);
      }
      return true;
    });
    return sortGscRows(filtered, sortBy);
  }, [activeTab, pageFilterInput, queryFilterInput, rawRowsForTab, sortBy]);

  const dimensionTitle =
    activeTab === "pages"
      ? "Landing Page URL"
      : activeTab === "countries"
        ? "Country"
        : activeTab === "devices"
          ? "Device"
          : activeTab === "appearance"
            ? "Search Appearance"
            : "Search Query";

  const labelForRow = (row: GscSearchAnalyticsRow): string =>
    row.query ??
    row.page ??
    row.country ??
    row.device ??
    row.searchAppearance ??
    row.keys[0] ??
    "(unknown)";

  const gscColumns: DataTableColumn<GscSearchAnalyticsRow>[] = [
    {
      key: "dimension",
      header: dimensionTitle,
      render: (row) => (
        <span className="font-medium text-[#17243A] break-all max-w-[380px] inline-block">
          {labelForRow(row)}
        </span>
      ),
    },
    {
      key: "clicks",
      header: "Clicks",
      numeric: true,
      render: (row) => formatIntegerCount(row.clicks),
    },
    {
      key: "impressions",
      header: "Impressions",
      numeric: true,
      render: (row) => formatIntegerCount(row.impressions),
    },
    {
      key: "ctr",
      header: "CTR",
      numeric: true,
      render: (row) => formatRatioPercent(row.ctr),
    },
    {
      key: "position",
      header: "Avg Position",
      numeric: true,
      render: (row) => formatPositionRank(row.position),
    },
  ];

  const privacyGap = report?.coverage.queryClicksVsTotalClicksGap ?? null;

  return (
    <div className="space-y-6 min-w-0" data-testid="search-visibility-report-page">
      <ReportContextToolbar
        testIdPrefix="gsc"
        projects={projects}
        selectedProjectId={selectedProjectId}
        onProjectChange={(nextProjectId) => {
          setSelectedProjectId(nextProjectId);
          setSelectedEnvironmentId("");
          void loadSearchReport({
            projectId: nextProjectId,
            environmentId: "",
            preset: telemetry.window.preset === "custom" ? "28d" : telemetry.window.preset,
            compare: telemetry.window.compareEnabled,
            startRow: 0,
          });
        }}
        environments={selectedProject?.environments}
        selectedEnvironmentId={selectedEnvironmentId}
        onEnvironmentChange={(nextEnvId) => {
          setSelectedEnvironmentId(nextEnvId);
          void loadSearchReport({
            projectId: selectedProjectId,
            environmentId: nextEnvId,
            preset: telemetry.window.preset,
            startDate:
              telemetry.window.preset === "custom" ? telemetry.window.startDate : undefined,
            endDate: telemetry.window.preset === "custom" ? telemetry.window.endDate : undefined,
            compare: telemetry.window.compareEnabled,
            startRow: 0,
          });
        }}
        windowState={telemetry.window}
        onPresetChange={(preset) => {
          void loadSearchReport({
            projectId: selectedProjectId,
            environmentId: selectedEnvironmentId,
            preset,
            compare: telemetry.window.compareEnabled,
            startRow: 0,
          });
        }}
        customStartDate={customStartDate}
        customEndDate={customEndDate}
        onCustomStartChange={setCustomStartDate}
        onCustomEndChange={setCustomEndDate}
        onApplyCustomDates={() => {
          void loadSearchReport({
            projectId: selectedProjectId,
            environmentId: selectedEnvironmentId,
            preset: "custom",
            startDate: customStartDate,
            endDate: customEndDate,
            compare: telemetry.window.compareEnabled,
            startRow: 0,
          });
        }}
        onToggleCompare={() => {
          void loadSearchReport({
            projectId: selectedProjectId,
            environmentId: selectedEnvironmentId,
            preset: telemetry.window.preset,
            startDate:
              telemetry.window.preset === "custom" ? telemetry.window.startDate : undefined,
            endDate: telemetry.window.preset === "custom" ? telemetry.window.endDate : undefined,
            compare: !telemetry.window.compareEnabled,
            startRow: 0,
          });
        }}
        onRefresh={() => {
          void loadSearchReport({
            projectId: selectedProjectId,
            environmentId: selectedEnvironmentId,
            preset: telemetry.window.preset,
            startDate:
              telemetry.window.preset === "custom" ? telemetry.window.startDate : undefined,
            endDate: telemetry.window.preset === "custom" ? telemetry.window.endDate : undefined,
            compare: telemetry.window.compareEnabled,
            nextQuery: queryFilterInput,
            nextPage: pageFilterInput,
            refresh: true,
          });
        }}
        isLoading={isLoading}
        extraControls={
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[140px]">
              <label
                htmlFor="gsc-search-type-select"
                className="block text-[11.5px] font-semibold uppercase tracking-wider text-[#64748B] mb-1"
              >
                Search Surface
              </label>
              <Select
                id="gsc-search-type-select"
                data-testid="gsc-search-type-select"
                value={searchType}
                onChange={(e) => {
                  const nextType = e.target.value as GscSearchType;
                  setSearchType(nextType);
                  void loadSearchReport({
                    projectId: selectedProjectId,
                    environmentId: selectedEnvironmentId,
                    preset: telemetry.window.preset,
                    startDate:
                      telemetry.window.preset === "custom" ? telemetry.window.startDate : undefined,
                    endDate:
                      telemetry.window.preset === "custom" ? telemetry.window.endDate : undefined,
                    compare: telemetry.window.compareEnabled,
                    nextSearchType: nextType,
                    startRow: 0,
                  });
                }}
              >
                <option value="WEB">Web Search</option>
                <option value="IMAGE">Image Search</option>
                <option value="VIDEO">Video Search</option>
                <option value="NEWS">News Search</option>
                <option value="DISCOVER">Discover (no queries)</option>
                <option value="GOOGLE_NEWS">Google News (no queries)</option>
              </Select>
            </div>

            <div className="min-w-[160px]">
              <label
                htmlFor="gsc-data-state-select"
                className="block text-[11.5px] font-semibold uppercase tracking-wider text-[#64748B] mb-1"
              >
                Freshness State
              </label>
              <Select
                id="gsc-data-state-select"
                data-testid="gsc-data-state-select"
                value={dataState}
                onChange={(e) => {
                  const nextState = e.target.value as GscDataState;
                  setDataState(nextState);
                  void loadSearchReport({
                    projectId: selectedProjectId,
                    environmentId: selectedEnvironmentId,
                    preset: telemetry.window.preset,
                    compare: telemetry.window.compareEnabled,
                    nextDataState: nextState,
                    startRow: 0,
                  });
                }}
              >
                <option value="final">Finalized (48–72h lag)</option>
                <option value="all">Include Fresh (preliminary)</option>
              </Select>
            </div>
          </div>
        }
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
          testId="gsc-blocked-state"
          providerLabel="Google Search Console"
          uxState={telemetry.uxState}
          message={telemetry.message}
          actionLabel={telemetry.actionLabel}
          actionHref={telemetry.actionHref}
          workspaceUnmappedCount={telemetry.workspaceUnmappedCount}
        />
      ) : report ? (
        <>
          {/* Canonical Property & Timezone Strip */}
          <Card className="p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <Globe className="h-4 w-4 text-[#168E99]" aria-hidden="true" />
              <span
                className="font-mono font-semibold text-[#17243A]"
                data-testid="gsc-canonical-site"
              >
                {report.siteUrl}
              </span>
              <Badge tone="indigo">
                {report.propertyKind === "DOMAIN" ? "Domain (sc-domain)" : "URL-Prefix"}
              </Badge>
              <Badge tone="neutral">
                <Clock className="h-3 w-3 mr-1" aria-hidden="true" />
                {GSC_REPORTING_TIMEZONE}
              </Badge>
              <Badge tone={report.sourceMode === "live" ? "success" : "indigo"}>
                {report.sourceMode === "live" ? "Live Search Analytics v3" : "Sandbox Demo Mode"}
              </Badge>
              {report.coverage.hasPreliminaryDatesInWindow ? (
                <Badge tone="warning">Contains 48–72h preliminary dates</Badge>
              ) : null}
              {report.coverage.isTopRowLimited ? (
                <Badge tone="warning">Top-row ceiling reached</Badge>
              ) : null}
            </div>
            <div className="text-[12px] text-[#64748B] tabular-nums">
              Finalized cutoff: {report.coverage.finalDataCutoffDate}
            </div>
          </Card>

          <ReportDegradedBanner
            testId="gsc-coverage-banner"
            uxState={telemetry.uxState}
            message={telemetry.message}
            actionLabel={telemetry.actionLabel}
            actionHref={telemetry.actionHref}
          />

          {/* KPI Strip */}
          <section
            aria-label="Google Search Console performance metrics"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
            data-testid="gsc-kpi-grid"
          >
            <MetricCard
              title="Search Clicks"
              definition="Pre-click SERP taps in Google Search (never summed with or treated as GA4 Sessions)."
              state={telemetry.uxState}
              value={totals?.clicks ?? null}
              formattedValue={formatIntegerCount(totals?.clicks)}
              comparisonDeltaText={formatComparisonDelta(totals?.clicks, compareTotals?.clicks)}
              sourceLabel="Search Console"
              freshnessLabel={`TZ: ${GSC_REPORTING_TIMEZONE}`}
            />
            <MetricCard
              title="Search Impressions"
              definition="Search result appearances on Google Search, Image, Video, News, or Discover."
              state={telemetry.uxState}
              value={totals?.impressions ?? null}
              formattedValue={formatIntegerCount(totals?.impressions)}
              comparisonDeltaText={formatComparisonDelta(
                totals?.impressions,
                compareTotals?.impressions,
              )}
              sourceLabel={`Surface: ${report.searchType}`}
              freshnessLabel={`State: ${report.dataState}`}
            />
            <MetricCard
              title="Weighted CTR"
              definition="True click-through rate (total clicks / total impressions), never mean of row CTRs."
              state={telemetry.uxState}
              value={totals?.ctr ?? null}
              formattedValue={formatRatioPercent(totals?.ctr, 2)}
              comparisonDeltaText={formatComparisonDelta(totals?.ctr, compareTotals?.ctr, {
                isRatioPoints: true,
              })}
              sourceLabel="Impression-weighted"
              freshnessLabel="SERP click ratio"
            />
            <MetricCard
              title="Weighted Avg Position"
              definition="Impression-weighted ranking position across all queries/pages (lower rank is higher on page)."
              state={telemetry.uxState}
              value={totals?.position ?? null}
              formattedValue={formatPositionRank(totals?.position)}
              comparisonDeltaText={formatComparisonDelta(
                totals?.position,
                compareTotals?.position,
                {
                  invertGoodBad: true,
                },
              )}
              sourceLabel="Impression-weighted"
              freshnessLabel={
                privacyGap?.omittedClicksEstimate
                  ? `${formatIntegerCount(privacyGap.omittedClicksEstimate)} long-tail clicks anonymized`
                  : "Privacy filters active"
              }
            />
          </section>

          {/* Privacy Anonymization Disclosure Card */}
          {privacyGap && (privacyGap.omittedClicksEstimate ?? 0) > 0 ? (
            <div
              className="flex items-start gap-2.5 rounded-[12px] border border-[#CED3FF] bg-[#ECEEFF] px-4 py-3 text-[13px] text-[#30415D]"
              data-testid="gsc-privacy-gap-notice"
            >
              <SearchCheck className="h-4 w-4 text-[#5157D9] shrink-0 mt-0.5" aria-hidden="true" />
              <p className="m-0">
                <strong>Rare-query privacy anonymization gap:</strong> Unsegmented property total is{" "}
                <span className="font-semibold tabular-nums">
                  {formatIntegerCount(privacyGap.unsegmentedClicks)}
                </span>{" "}
                clicks, while visible query rows sum to{" "}
                <span className="font-semibold tabular-nums">
                  {formatIntegerCount(privacyGap.returnedQueryClicks)}
                </span>{" "}
                clicks (
                <span className="font-semibold tabular-nums">
                  {formatIntegerCount(privacyGap.omittedClicksEstimate)}
                </span>{" "}
                clicks withheld by Google Search Console privacy thresholds).
              </p>
            </div>
          ) : null}

          {/* Daily Trend Chart / Accessible Table */}
          <TrendChartCard
            testId="gsc-trend"
            title="Search Performance Over Time"
            subtitle="Daily Clicks and Impressions reported in fixed Google Search Console Pacific Time."
            timeZoneLabel={GSC_REPORTING_TIMEZONE}
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
                key: "clicks",
                label: "Clicks",
                unitLabel: "clicks",
                colorHex: "#168E99",
                formatValue: formatIntegerCount,
              },
              {
                key: "impressions",
                label: "Impressions",
                unitLabel: "impressions",
                colorHex: "#5157D9",
                formatValue: formatIntegerCount,
              },
            ]}
            secondaryColumnHeader="Impressions"
            formatSecondaryValue={formatIntegerCount}
          />

          {/* Query, Landing Page, Country, Device, Appearance Breakdowns */}
          <Card className="p-5 sm:p-6 space-y-4 min-w-0" data-testid="gsc-breakdown-card">
            <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
              <div className="space-y-0.5">
                <h2 className="text-[18px] font-semibold text-[#17243A] m-0">
                  Search Queries, Landing Pages & Surfaces
                </h2>
                <p className="text-[13px] text-[#64748B] m-0">
                  Sorted by {sortBy} with pagination controls and Pacific Time attribution.
                </p>
              </div>
              <div className="overflow-x-auto max-w-full">
                <SegmentedControl<SearchBreakdownTab>
                  ariaLabel="Select Search Console dimension"
                  value={activeTab}
                  onChange={setActiveTab}
                  options={[
                    ...(isQueryUnavailable
                      ? []
                      : [
                          {
                            value: "queries" as const,
                            label: "Queries",
                            badge: String(report.topQueries.length),
                          },
                        ]),
                    { value: "pages", label: "Pages", badge: String(report.topPages.length) },
                    {
                      value: "countries",
                      label: "Countries",
                      badge: String(report.byCountry.length),
                    },
                    { value: "devices", label: "Devices", badge: String(report.byDevice.length) },
                    {
                      value: "appearance",
                      label: "Appearance",
                      badge: String(report.bySearchAppearance.length),
                    },
                  ]}
                />
              </div>
            </div>

            {isQueryUnavailable ? (
              <div className="flex items-start gap-2 rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC] px-3.5 py-2.5 text-[12.5px] text-[#64748B]">
                <Info className="h-4 w-4 text-[#5157D9] shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  Search Console does not expose search <code>query</code> attribution on{" "}
                  <strong>{searchType}</strong>; filter and table automatically focus on landing
                  pages, countries, devices, and appearance.
                </span>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
              <div>
                <label
                  htmlFor="gsc-query-filter-input"
                  className="block text-[11.5px] font-semibold uppercase tracking-wider text-[#64748B] mb-1"
                >
                  Filter Query
                </label>
                <SearchInput
                  id="gsc-query-filter-input"
                  data-testid="gsc-query-filter-input"
                  placeholder={isQueryUnavailable ? "Unavailable on this surface" : "e.g. avenor"}
                  disabled={isQueryUnavailable}
                  value={queryFilterInput}
                  onChange={(e) => setQueryFilterInput(e.target.value)}
                />
              </div>

              <div>
                <label
                  htmlFor="gsc-page-filter-input"
                  className="block text-[11.5px] font-semibold uppercase tracking-wider text-[#64748B] mb-1"
                >
                  Filter Page URL
                </label>
                <SearchInput
                  id="gsc-page-filter-input"
                  data-testid="gsc-page-filter-input"
                  placeholder="e.g. /pricing"
                  value={pageFilterInput}
                  onChange={(e) => setPageFilterInput(e.target.value)}
                />
              </div>

              <div>
                <label
                  htmlFor="gsc-sort-select"
                  className="block text-[11.5px] font-semibold uppercase tracking-wider text-[#64748B] mb-1"
                >
                  Sort Rows By
                </label>
                <Select
                  id="gsc-sort-select"
                  data-testid="gsc-sort-select"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SearchSortField)}
                >
                  <option value="clicks">Clicks (Highest)</option>
                  <option value="impressions">Impressions (Highest)</option>
                  <option value="ctr">CTR (Highest)</option>
                  <option value="position">Position (Best Rank)</option>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  data-testid="gsc-apply-filters-button"
                  onClick={() =>
                    void loadSearchReport({
                      projectId: selectedProjectId,
                      environmentId: selectedEnvironmentId,
                      preset: telemetry.window.preset,
                      startDate:
                        telemetry.window.preset === "custom"
                          ? telemetry.window.startDate
                          : undefined,
                      endDate:
                        telemetry.window.preset === "custom" ? telemetry.window.endDate : undefined,
                      compare: telemetry.window.compareEnabled,
                      nextQuery: queryFilterInput,
                      nextPage: pageFilterInput,
                      startRow: 0,
                    })
                  }
                >
                  Apply Server Filter
                </Button>
                {(queryFilterInput || pageFilterInput) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setQueryFilterInput("");
                      setPageFilterInput("");
                      void loadSearchReport({
                        projectId: selectedProjectId,
                        environmentId: selectedEnvironmentId,
                        preset: telemetry.window.preset,
                        compare: telemetry.window.compareEnabled,
                        nextQuery: "",
                        nextPage: "",
                        startRow: 0,
                      });
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>

            {renderGscMobileCards(filteredSortedRows, labelForRow)}

            <div className="hidden md:block">
              <DataTable
                caption={`${dimensionTitle} breakdown for ${report.siteUrl} (${GSC_REPORTING_TIMEZONE})`}
                columns={gscColumns}
                rows={filteredSortedRows}
                getRowKey={(row) => `${row.keys.join("::")}-${row.clicks}-${row.impressions}`}
                emptyState={
                  <div className="rounded-[12px] border border-[#DFE6F0] bg-[#F7F9FC] px-4 py-8 text-center text-[13.5px] text-[#64748B]">
                    No Search Console rows match the active filter criteria.
                  </div>
                }
              />
            </div>

            {/* Pagination bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#DFE6F0] pt-3 text-[12.5px] text-[#64748B]">
              <span className="tabular-nums">
                Offset row {report.pagination.startRow} • Showing {filteredSortedRows.length} rows
                (page cap {report.pagination.rowLimit})
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={isLoading || report.pagination.startRow === 0}
                  onClick={() =>
                    void loadSearchReport({
                      projectId: selectedProjectId,
                      environmentId: selectedEnvironmentId,
                      preset: telemetry.window.preset,
                      compare: telemetry.window.compareEnabled,
                      nextQuery: queryFilterInput,
                      nextPage: pageFilterInput,
                      startRow: Math.max(
                        0,
                        report.pagination.startRow - report.pagination.rowLimit,
                      ),
                    })
                  }
                >
                  Previous Page
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={isLoading || !report.pagination.hasMore}
                  onClick={() =>
                    void loadSearchReport({
                      projectId: selectedProjectId,
                      environmentId: selectedEnvironmentId,
                      preset: telemetry.window.preset,
                      compare: telemetry.window.compareEnabled,
                      nextQuery: queryFilterInput,
                      nextPage: pageFilterInput,
                      startRow: report.pagination.startRow + report.pagination.rowLimit,
                    })
                  }
                >
                  Next Page
                </Button>
              </div>
            </div>
          </Card>

          {telemetry.reconciliation ? (
            <Ga4VsGscReconciliationPanel reconciliation={telemetry.reconciliation} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
