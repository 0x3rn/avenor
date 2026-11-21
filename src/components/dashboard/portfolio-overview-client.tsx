"use client";

import type { WorkspaceGovernanceDetails } from "@avenor/auth";
import type { SemanticTone } from "@avenor/types";
import type { BadgeTone } from "@avenor/ui";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  MetricCard,
  PageHeader,
  SectionHeader,
  SegmentedControl,
  StatusIndicator,
  WarningBanner,
} from "@avenor/ui";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Compass,
  FolderKanban,
  Globe,
  Layers,
  Plus,
  RefreshCw,
  ShieldCheck,
  Table2,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import {
  MetricDefinitionTrigger,
  type MetricProvenanceContext,
  MetricProvenanceDrawer,
} from "@/components/reports/metric-provenance-drawer";
import type {
  PortfolioDatePreset,
  WorkspacePortfolioOverviewDto,
} from "@/lib/reports/portfolio-service";

export interface PortfolioOverviewClientProps {
  initialOverview: WorkspacePortfolioOverviewDto;
  governance: WorkspaceGovernanceDetails;
  onboardingCompletedAt: string | null;
}

function formatCompactNumber(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value < 100 && !Number.isInteger(value) ? 2 : 0,
  }).format(value);
}

function formatRatioPercentage(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return `${(value * 100).toFixed(1)}%`;
}

export function PortfolioOverviewClient({
  initialOverview,
  governance,
  onboardingCompletedAt,
}: PortfolioOverviewClientProps) {
  const [overview, setOverview] = React.useState<WorkspacePortfolioOverviewDto>(initialOverview);
  const [preset, setPreset] = React.useState<PortfolioDatePreset>(
    initialOverview.dateWindow.preset,
  );
  const [compareEnabled, setCompareEnabled] = React.useState<boolean>(
    initialOverview.dateWindow.compareEnabled,
  );
  const [loading, setLoading] = React.useState(false);
  const [showTrendTable, setShowTrendTable] = React.useState(false);
  const [provenanceContext, setProvenanceContext] = React.useState<MetricProvenanceContext | null>(
    null,
  );

  async function refreshPortfolio(nextPreset: PortfolioDatePreset, nextCompare: boolean) {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        preset: nextPreset,
        compare: nextCompare ? "true" : "false",
      });
      const response = await fetch(`/api/portfolio?${params.toString()}`, {
        cache: "no-store",
      });
      if (response.ok) {
        const data = (await response.json()) as WorkspacePortfolioOverviewDto;
        setOverview(data);
      }
    } catch {
      // Preserve current state on network hiccup
    } finally {
      setLoading(false);
    }
  }

  function openMetricProvenance(canonicalMetricKey: string) {
    const isGsc = canonicalMetricKey.startsWith("gsc.");
    const metricRes =
      canonicalMetricKey === "ga4.sessions"
        ? overview.portfolioMetrics.sessions
        : canonicalMetricKey === "ga4.active_users"
          ? overview.portfolioMetrics.activeUsers
          : canonicalMetricKey === "gsc.clicks"
            ? overview.portfolioMetrics.gscClicks
            : overview.portfolioMetrics.gscCtr;

    setProvenanceContext({
      canonicalMetricKey,
      externalResourceId:
        metricRes.resourcesIncluded.length > 0
          ? metricRes.resourcesIncluded.join(", ")
          : "Workspace portfolio rollup",
      reportingTimezone: isGsc ? "America/Los_Angeles" : governance.workspace.defaultTimezone,
      periodStartDate: overview.dateWindow.startDate,
      periodEndDate: overview.dateWindow.endDate,
      completenessState: metricRes.completenessState,
      lastCollectedAtIso: metricRes.latestCollectedAtIso,
      currency: governance.workspace.defaultCurrency,
      limitations: overview.nonAdditiveNotices,
    });
  }

  const activeProjectsCount = overview.summaryCounts.activeProjectCount;
  const archivedProjectsCount = overview.summaryCounts.archivedProjectCount;
  const totalEnvironments = overview.summaryCounts.configuredEnvironmentCount;

  const sessionsFormatted = formatCompactNumber(overview.portfolioMetrics.sessions.value);
  const clicksFormatted = formatCompactNumber(overview.portfolioMetrics.gscClicks.value);
  const impressionsFormatted = formatCompactNumber(overview.portfolioMetrics.gscImpressions.value);
  const ctrFormatted = formatRatioPercentage(overview.portfolioMetrics.gscCtr.value);
  const activeUsersFormatted = formatCompactNumber(overview.portfolioMetrics.activeUsers.value);

  const maxDailySessions = Math.max(1, ...overview.dailyTrend.map((d) => d.sessions ?? 0));
  const maxDailyClicks = Math.max(1, ...overview.dailyTrend.map((d) => d.gscClicks ?? 0));

  return (
    <div className="space-y-8" data-testid="dashboard-overview">
      <PageHeader
        breadcrumbs={[
          { label: governance.organization.name },
          { label: governance.workspace.name },
        ]}
        title="Portfolio Signal Atlas"
        description="Unified product-centered overview of the logical websites and applications in this workspace, their environment tiers, and read-only telemetry readiness."
        badges={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="indigo">
              {governance.workspace.defaultTimezone} • {governance.workspace.defaultCurrency}
            </Badge>
            <Badge tone="signal" data-testid="portfolio-date-window-badge">
              {overview.dateWindow.startDate} → {overview.dateWindow.endDate} (
              {overview.dateWindow.dayCount}d)
            </Badge>
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <MetricDefinitionTrigger
              canonicalMetricKey="ga4.sessions"
              onInspect={openMetricProvenance}
            />
            <Link
              href="/onboarding"
              className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#C7D2E3] bg-[#FFFFFF] px-3.5 text-[14px] font-medium text-[#17243A] hover:bg-[#F0F4FA]"
            >
              <Compass className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
              <span>Guided Setup</span>
            </Link>
            <Link
              href="/projects/new"
              data-testid="dashboard-create-project-cta"
              className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#5157D9] px-4 text-[14px] font-medium text-white hover:bg-[#4047BD]"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>New Logical Product</span>
            </Link>
          </div>
        }
      />

      <MetricProvenanceDrawer
        context={provenanceContext}
        onClose={() => setProvenanceContext(null)}
      />

      {/* Portfolio Filter & Date Window Bar */}
      <Card
        className="p-4 sm:p-5 flex flex-col gap-3.5 lg:flex-row lg:items-center lg:justify-between"
        data-testid="portfolio-controls-bar"
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[13px] font-semibold text-[#17243A]">Reporting Window:</span>
          <SegmentedControl
            ariaLabel="Portfolio reporting date window"
            value={preset}
            onChange={(next) => {
              const p = next as PortfolioDatePreset;
              setPreset(p);
              void refreshPortfolio(p, compareEnabled);
            }}
            options={[
              { value: "7d", label: "Last 7d" },
              { value: "28d", label: "Last 28d" },
              { value: "90d", label: "Last 90d" },
              { value: "mtd", label: "Month to Date" },
            ]}
          />
          <label className="inline-flex items-center gap-2 rounded-[8px] border border-[#DFE6F0] bg-[#F7F9FC] px-3 py-1.5 text-[12px] font-medium text-[#30415D]">
            <input
              type="checkbox"
              data-testid="portfolio-compare-toggle"
              checked={compareEnabled}
              onChange={(e) => {
                const next = e.target.checked;
                setCompareEnabled(next);
                void refreshPortfolio(preset, next);
              }}
              className="h-3.5 w-3.5 rounded accent-[#5157D9]"
            />
            <span>Compare vs preceding {overview.dateWindow.dayCount}d</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#64748B]">
          <span>
            Mapped products:{" "}
            <strong className="font-semibold text-[#17243A] tabular-nums">
              {overview.summaryCounts.mappedProjectCount}/{activeProjectsCount}
            </strong>
          </span>
          <span>•</span>
          <span>
            Properties:{" "}
            <strong className="font-semibold text-[#17243A] tabular-nums">
              {overview.summaryCounts.distinctGa4PropertyCount} GA4 /{" "}
              {overview.summaryCounts.distinctGscPropertyCount} GSC
            </strong>
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="portfolio-refresh-button"
            disabled={loading}
            onClick={() => void refreshPortfolio(preset, compareEnabled)}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>{loading ? "Refreshing..." : "Refresh"}</span>
          </Button>
        </div>
      </Card>

      {/* Onboarding Banner if not completed or zero projects */}
      {!onboardingCompletedAt || activeProjectsCount === 0 ? (
        <Card className="p-5 sm:p-6 border-[#CED3FF] bg-[#ECEEFF]/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge tone="indigo">Onboarding Progress</Badge>
              <span className="text-[13px] font-semibold text-[#17243A]">
                {activeProjectsCount === 0
                  ? "Register your first logical digital product"
                  : "Finish guided workspace onboarding"}
              </span>
            </div>
            <p className="text-[13px] text-[#30415D]">
              Define your logical applications and their Production, Staging, and Development
              environments so external read-only signals map cleanly.
            </p>
          </div>
          <Link
            href="/onboarding"
            data-testid="dashboard-continue-onboarding-link"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-[#5157D9] px-3.5 text-[13px] font-medium text-white hover:bg-[#4047BD]"
          >
            <span>Open Guided Setup</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Card>
      ) : null}

      {/* Non-additive cross-property guardrail notices */}
      {overview.nonAdditiveNotices.length > 0 ? (
        <div className="space-y-2" data-testid="portfolio-non-additive-notices">
          {overview.nonAdditiveNotices.map((notice) => (
            <WarningBanner
              key={notice}
              tone="signal"
              title="Canonical Aggregation Guardrail (Non-Additive Metric)"
              description={notice}
            />
          ))}
        </div>
      ) : null}

      {/* 4-Column Signal Atlas KPI Grid */}
      <section
        aria-label="Workspace portfolio summary metrics"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
        data-testid="portfolio-kpi-grid"
      >
        <MetricCard
          title="Active Logical Products"
          definition="Registered websites, SaaS applications, and digital products in this workspace."
          value={activeProjectsCount > 0 ? activeProjectsCount : null}
          unit={
            archivedProjectsCount > 0
              ? `(${archivedProjectsCount} archived • ${totalEnvironments} tiers)`
              : `products (${totalEnvironments} tiers)`
          }
          state={activeProjectsCount > 0 ? "connected_healthy" : "empty_first_use"}
          sourceLabel="Product Registry"
          freshnessLabel="Live PostgreSQL state"
        />

        <MetricCard
          title="Portfolio Sessions"
          definition="Total GA4 sessions summed across mapped active product properties in the selected window."
          value={overview.portfolioMetrics.sessions.value}
          formattedValue={sessionsFormatted ?? undefined}
          unit={activeUsersFormatted ? `${activeUsersFormatted} active users` : "sessions"}
          comparisonDeltaText={
            overview.portfolioComparisons.sessions.formattedDeltaLabel ?? undefined
          }
          state={
            overview.summaryCounts.distinctGa4PropertyCount === 0
              ? "unconnected"
              : overview.portfolioMetrics.sessions.uxState
          }
          sourceLabel="GA4 Canonical"
          freshnessLabel={
            overview.portfolioMetrics.sessions.latestCollectedAtIso
              ? `Collected ${overview.portfolioMetrics.sessions.latestCollectedAtIso.slice(0, 16).replace("T", " ")}`
              : "Map GA4 in Connections"
          }
        />

        <MetricCard
          title="Organic Search Clicks"
          definition="Total Google Search Console organic clicks and weighted CTR across mapped properties."
          value={overview.portfolioMetrics.gscClicks.value}
          formattedValue={clicksFormatted ?? undefined}
          unit={
            ctrFormatted
              ? `${ctrFormatted} CTR${impressionsFormatted ? ` • ${impressionsFormatted} impr.` : ""}`
              : "clicks"
          }
          comparisonDeltaText={
            overview.portfolioComparisons.gscClicks.formattedDeltaLabel ?? undefined
          }
          state={
            overview.summaryCounts.distinctGscPropertyCount === 0
              ? "unconnected"
              : overview.portfolioMetrics.gscClicks.uxState
          }
          sourceLabel="Search Console"
          freshnessLabel={
            overview.summaryCounts.distinctGscPropertyCount > 0
              ? "GSC ~48h Pacific lag window"
              : "Map GSC in Connections"
          }
        />

        <MetricCard
          title="Cloud Cost & Infra Signals"
          definition="Normalized cloud billing spend, database storage, and deployment reliability."
          state="unconnected"
          sourceLabel="Billing & Infra"
          freshnessLabel="Unlocks in M05–M08"
        />
      </section>

      {/* Historical Portfolio Trend Chart + Accessible Data Table Toggle */}
      <Card className="p-5 sm:p-6 space-y-4" data-testid="portfolio-trend-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
              <h2 className="text-[17px] font-semibold text-[#17243A]">
                Historical Portfolio Trajectory ({overview.dateWindow.startDate} →{" "}
                {overview.dateWindow.endDate})
              </h2>
            </div>
            <p className="mt-0.5 text-[13px] text-[#64748B]">
              Daily stored canonical observations for GA4 Sessions (indigo) and Search Console
              Organic Clicks (teal). Never fabricates zero when a source is unmapped.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="portfolio-trend-table-toggle"
            onClick={() => setShowTrendTable((prev) => !prev)}
          >
            <Table2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            <span>{showTrendTable ? "Show Visual Chart" : "Show Accessible Table"}</span>
          </Button>
        </div>

        {overview.dailyTrend.every((d) => d.sessions === null && d.gscClicks === null) ? (
          <div
            className="rounded-[10px] border border-dashed border-[#C7D2E3] bg-[#F7F9FC] p-6 text-center text-[13px] text-[#64748B]"
            data-testid="portfolio-trend-empty"
          >
            No stored daily metric observations in this window yet. Map a GA4 or Search Console
            resource and run a sync to populate historical time-series bars.
          </div>
        ) : showTrendTable ? (
          <div className="overflow-x-auto" data-testid="portfolio-trend-table">
            <table className="w-full border-collapse text-left text-[12px]">
              <thead>
                <tr className="border-b border-[#DFE6F0] text-[#64748B]">
                  <th className="py-2 pr-4 font-semibold">Date</th>
                  <th className="py-2 pr-4 font-semibold text-right">GA4 Sessions</th>
                  <th className="py-2 pr-4 font-semibold text-right">Engaged Sessions</th>
                  <th className="py-2 pr-4 font-semibold text-right">GSC Clicks</th>
                  <th className="py-2 pr-4 font-semibold text-right">GSC Impressions</th>
                  <th className="py-2 font-semibold text-right">Weighted CTR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF2F7]">
                {overview.dailyTrend.map((point) => (
                  <tr key={point.date}>
                    <td className="py-1.5 pr-4 font-mono text-[#17243A]">{point.date}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums text-[#30415D]">
                      {point.sessions !== null ? formatCompactNumber(point.sessions) : "—"}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums text-[#30415D]">
                      {point.engagedSessions !== null
                        ? formatCompactNumber(point.engagedSessions)
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums text-[#30415D]">
                      {point.gscClicks !== null ? formatCompactNumber(point.gscClicks) : "—"}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums text-[#30415D]">
                      {point.gscImpressions !== null
                        ? formatCompactNumber(point.gscImpressions)
                        : "—"}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-[#30415D]">
                      {point.gscCtr !== null ? formatRatioPercentage(point.gscCtr) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-2" data-testid="portfolio-trend-chart">
            <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-14 lg:grid-cols-28 items-end h-32 pt-4 px-2 rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC]">
              {overview.dailyTrend.slice(-28).map((point) => {
                const sPct =
                  point.sessions !== null
                    ? Math.max(8, Math.round((point.sessions / maxDailySessions) * 100))
                    : 0;
                const cPct =
                  point.gscClicks !== null
                    ? Math.max(8, Math.round((point.gscClicks / maxDailyClicks) * 100))
                    : 0;
                return (
                  <div
                    key={point.date}
                    className="flex flex-col items-center gap-1 h-full justify-end"
                    title={`${point.date} • Sessions: ${point.sessions ?? "—"} • GSC Clicks: ${point.gscClicks ?? "—"}`}
                  >
                    <div className="flex items-end gap-0.5 w-full justify-center h-24">
                      {point.sessions !== null ? (
                        <div
                          className="w-1.5 rounded-t bg-[#5157D9]"
                          style={{ height: `${sPct}%` }}
                        />
                      ) : null}
                      {point.gscClicks !== null ? (
                        <div
                          className="w-1.5 rounded-t bg-[#168E99]"
                          style={{ height: `${cPct}%` }}
                        />
                      ) : null}
                    </div>
                    <span className="text-[9px] font-mono text-[#64748B] truncate max-w-full">
                      {point.date.slice(8)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#64748B]">
              <div className="flex items-center gap-4">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#5157D9]" />
                  <span>GA4 Sessions (additive across dates &amp; properties)</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#168E99]" />
                  <span>Search Console Clicks (Pacific timezone)</span>
                </span>
              </div>
              <span>Showing up to 28 daily buckets</span>
            </div>
          </div>
        )}
      </Card>

      {/* Main 12-Column Grid: 8 Columns Portfolio / 4 Columns Attention, Sync & Governance */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left 8 Columns: Logical Product Portfolio */}
        <div className="space-y-4 lg:col-span-8">
          <SectionHeader
            title="Logical Product Portfolio"
            description="Websites, SaaS applications, and digital services tracked in this workspace."
            actions={
              <Link
                href="/projects"
                className="text-[13px] font-medium text-[#5157D9] hover:text-[#4047BD]"
              >
                View all products ({activeProjectsCount + archivedProjectsCount}) →
              </Link>
            }
          />

          {overview.products.length === 0 ? (
            <EmptyState
              title="No logical products registered in this workspace"
              description="Create your first logical product to organize Production, Staging, and Development environments under a single product identity."
              primaryAction={
                <Link
                  href="/projects/new"
                  className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#5157D9] px-4 text-[14px] font-medium text-white hover:bg-[#4047BD]"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>Create Logical Product</span>
                </Link>
              }
              secondaryAction={
                <Link
                  href="/onboarding"
                  className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#C7D2E3] bg-[#FFFFFF] px-4 text-[14px] font-medium text-[#17243A] hover:bg-[#F0F4FA]"
                >
                  <span>Guided Setup</span>
                </Link>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4" data-testid="dashboard-projects-list">
              {overview.products.map((row) => {
                const { project, mappedResources, metrics, comparisons } = row;
                const statusTone: SemanticTone =
                  row.uxState === "connected_healthy"
                    ? "success"
                    : row.uxState === "permission_insufficient" || row.uxState === "provider_error"
                      ? "critical"
                      : row.uxState === "rate_limited" || row.uxState === "partial_coverage"
                        ? "warning"
                        : "neutral";
                const statusLabel =
                  row.uxState === "unconnected"
                    ? "Not connected"
                    : row.uxState === "connected_healthy"
                      ? "Connected & synced"
                      : row.uxState === "permission_insufficient"
                        ? "Credential expired/revoked"
                        : row.uxState === "rate_limited"
                          ? "Rate-limited backoff"
                          : row.uxState === "provider_error"
                            ? "Sync error"
                            : "Connected";

                return (
                  <Card
                    key={project.id}
                    className="p-5 sm:p-6 space-y-4"
                    data-testid={`portfolio-product-card-${project.slug}`}
                  >
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                      <div className="space-y-2 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/projects/${project.id}`}
                            className="text-[17px] font-semibold text-[#17243A] hover:text-[#5157D9]"
                          >
                            {project.name}
                          </Link>
                          <span className="rounded-[6px] bg-[#F0F4FA] px-2 py-0.5 font-mono text-[12px] text-[#30415D]">
                            {project.slug}
                          </span>
                          <StatusIndicator tone={statusTone} label={statusLabel} />
                        </div>

                        {project.description ? (
                          <p className="text-[14px] text-[#30415D] line-clamp-2">
                            {project.description}
                          </p>
                        ) : null}

                        <div className="flex flex-wrap items-center gap-3 pt-1 text-[12px] text-[#64748B]">
                          {project.primaryDomain ? (
                            <span className="inline-flex items-center gap-1.5 text-[#30415D]">
                              <Globe className="h-3.5 w-3.5 text-[#168E99]" aria-hidden="true" />
                              <span>{project.primaryDomain}</span>
                            </span>
                          ) : null}

                          <span className="inline-flex items-center gap-1.5">
                            <Layers className="h-3.5 w-3.5 text-[#5157D9]" aria-hidden="true" />
                            <span className="tabular-nums">
                              {project.environments.length} environments:
                            </span>
                          </span>

                          <div className="flex flex-wrap items-center gap-1.5">
                            {project.environments.map((env) => (
                              <Badge key={env.id} tone={env.isDefault ? "indigo" : "neutral"}>
                                {env.type}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Link
                          href={`/projects/${project.id}`}
                          data-testid={`inspect-project-${project.slug}`}
                          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-[#C7D2E3] bg-[#FFFFFF] px-3.5 text-[13px] font-medium text-[#17243A] hover:bg-[#F0F4FA]"
                        >
                          <FolderKanban className="h-3.5 w-3.5 text-[#5157D9]" />
                          <span>Inspect product</span>
                        </Link>
                      </div>
                    </div>

                    {/* Mapped Resource Badges & Stored Canonical Metrics Strip */}
                    {mappedResources.length > 0 ? (
                      <div className="space-y-3 border-t border-[#DFE6F0] pt-3.5">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {mappedResources.map((res) => {
                              const isGa4 =
                                res.providerKey === "ga4" ||
                                res.providerKey === "google_analytics_4";
                              return (
                                <Badge
                                  key={res.connectedResourceId}
                                  tone={isGa4 ? "indigo" : "signal"}
                                >
                                  {isGa4 ? "GA4" : "GSC"}: {res.displayName} (
                                  {res.reportingTimezone})
                                </Badge>
                              );
                            })}
                          </div>
                          <span className="text-[11px] text-[#64748B] tabular-nums">
                            {row.freshnessLabel}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                          <div className="rounded-[8px] border border-[#DFE6F0] bg-[#F7F9FC] px-3 py-2">
                            <div className="text-[11px] text-[#64748B]">GA4 Sessions</div>
                            <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-[#17243A]">
                              {formatCompactNumber(metrics.sessions.value) ?? "—"}
                            </div>
                            {comparisons.sessions.formattedDeltaLabel ? (
                              <div className="text-[11px] text-[#64748B] tabular-nums">
                                {comparisons.sessions.formattedDeltaLabel}
                              </div>
                            ) : null}
                          </div>

                          <div className="rounded-[8px] border border-[#DFE6F0] bg-[#F7F9FC] px-3 py-2">
                            <div className="text-[11px] text-[#64748B]">Engagement Rate</div>
                            <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-[#17243A]">
                              {formatRatioPercentage(metrics.engagementRate.value) ?? "—"}
                            </div>
                            <div className="text-[11px] text-[#64748B]">
                              {metrics.activeUsers.value !== null
                                ? `${formatCompactNumber(metrics.activeUsers.value)} active users`
                                : "Weighted ratio"}
                            </div>
                          </div>

                          <div className="rounded-[8px] border border-[#DFE6F0] bg-[#F7F9FC] px-3 py-2">
                            <div className="text-[11px] text-[#64748B]">Search Clicks</div>
                            <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-[#17243A]">
                              {formatCompactNumber(metrics.gscClicks.value) ?? "—"}
                            </div>
                            {comparisons.gscClicks.formattedDeltaLabel ? (
                              <div className="text-[11px] text-[#64748B] tabular-nums">
                                {comparisons.gscClicks.formattedDeltaLabel}
                              </div>
                            ) : null}
                          </div>

                          <div className="rounded-[8px] border border-[#DFE6F0] bg-[#F7F9FC] px-3 py-2">
                            <div className="text-[11px] text-[#64748B]">Search CTR &amp; Pos.</div>
                            <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-[#17243A]">
                              {formatRatioPercentage(metrics.gscCtr.value) ?? "—"}
                            </div>
                            <div className="text-[11px] text-[#64748B] tabular-nums">
                              {metrics.gscAveragePosition.value !== null
                                ? `Avg pos ${metrics.gscAveragePosition.value.toFixed(1)}`
                                : "Weighted by impr."}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Right 4 Columns: Source Health & Attention Required + Sync Runs + Governance */}
        <div className="space-y-6 lg:col-span-4">
          {/* Attention Required & Source Health */}
          <Card className="p-5 sm:p-6 space-y-4" data-testid="portfolio-attention-required-card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-[#C67A19]" aria-hidden="true" />
                <h2 className="text-[16px] font-semibold text-[#17243A]">
                  Source Health &amp; Attention
                </h2>
              </div>
              <Badge tone={overview.attentionItems.length > 0 ? "warning" : "success"}>
                {overview.attentionItems.length} notices
              </Badge>
            </div>

            {overview.attentionItems.length === 0 ? (
              <p className="text-[13px] text-[#30415D]">
                All mapped GA4 and Search Console resources are healthy and within their expected
                freshness windows.
              </p>
            ) : (
              <div className="space-y-2.5">
                {overview.attentionItems.slice(0, 5).map((item) => {
                  const badgeTone: BadgeTone =
                    item.severity === "critical"
                      ? "critical"
                      : item.severity === "warning"
                        ? "warning"
                        : "indigo";
                  return (
                    <div
                      key={item.id}
                      className="rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC] p-3 text-[12px] space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[#17243A]">{item.title}</span>
                        <Badge tone={badgeTone}>{item.category}</Badge>
                      </div>
                      <p className="text-[#30415D]">{item.description}</p>
                      <Link
                        href={item.ctaHref}
                        className="inline-flex items-center gap-1 font-semibold text-[#5157D9] hover:underline"
                      >
                        <span>{item.ctaLabel}</span>
                        <ArrowRight className="h-3 w-3" aria-hidden="true" />
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Recent Ingestion & Sync Activity */}
          {overview.recentSyncRuns.length > 0 ? (
            <Card className="p-5 sm:p-6 space-y-4" data-testid="portfolio-recent-sync-runs-card">
              <div className="flex items-center justify-between">
                <h2 className="text-[16px] font-semibold text-[#17243A]">Recent Collection Runs</h2>
                <span className="text-[12px] text-[#64748B] tabular-nums">
                  {overview.recentSyncRuns.length} runs
                </span>
              </div>
              <div className="space-y-2.5">
                {overview.recentSyncRuns.slice(0, 5).map((run) => {
                  const runTone: BadgeTone =
                    run.status === "COMPLETED"
                      ? "success"
                      : run.status === "FAILED" || run.status === "CONNECTION_REVOKED"
                        ? "critical"
                        : "warning";
                  return (
                    <div
                      key={run.id}
                      className="rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC] px-3 py-2 text-[12px] space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[#17243A] truncate">
                          {run.resourceDisplayName}
                        </span>
                        <Badge tone={runTone}>{run.status}</Badge>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[#64748B] tabular-nums">
                        <span>
                          {run.periodStartDate} → {run.periodEndDate}
                        </span>
                        <span>{run.recordsInserted + run.recordsUpdated} upserted</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          ) : null}

          <Card className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-semibold text-[#17243A]">
                Workspace Isolation &amp; Governance
              </h2>
              <Badge tone="indigo">{governance.workspace.role}</Badge>
            </div>

            <dl className="space-y-2.5 text-[13px]">
              <div className="flex items-center justify-between border-b border-[#DFE6F0] pb-2">
                <dt className="text-[#64748B]">Organization</dt>
                <dd className="font-medium text-[#17243A]">{governance.organization.name}</dd>
              </div>
              <div className="flex items-center justify-between border-b border-[#DFE6F0] pb-2">
                <dt className="text-[#64748B]">Workspace slug</dt>
                <dd className="font-mono text-[12px] text-[#30415D]">
                  {governance.workspace.slug}
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-[#DFE6F0] pb-2">
                <dt className="text-[#64748B]">Reporting timezone</dt>
                <dd className="font-medium text-[#17243A] tabular-nums">
                  {governance.workspace.defaultTimezone}
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-[#DFE6F0] pb-2">
                <dt className="text-[#64748B]">Reporting currency</dt>
                <dd className="font-medium text-[#17243A] tabular-nums">
                  {governance.workspace.defaultCurrency}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-[#64748B]">Authorized members</dt>
                <dd className="font-medium text-[#17243A] tabular-nums">
                  {governance.members.length}
                </dd>
              </div>
            </dl>

            <div className="rounded-[10px] border border-[#DFE6F0] bg-[#E7F6F7]/50 p-3 text-[12px] text-[#30415D] flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#168E99]" aria-hidden="true" />
              <span>
                External provider write operations are architecturally disabled. Avenor only
                modifies its own workspace, project, and alert metadata.
              </span>
            </div>

            <Link
              href="/settings"
              className="inline-flex w-full items-center justify-center rounded-[10px] border border-[#C7D2E3] bg-[#FFFFFF] py-2 text-[13px] font-medium text-[#17243A] hover:bg-[#F0F4FA]"
            >
              Manage workspace settings
            </Link>
          </Card>

          <Card className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-semibold text-[#17243A]">Recent Audit Ledger</h2>
              <span className="text-[12px] text-[#64748B] tabular-nums">
                {governance.auditLogs.length} events
              </span>
            </div>

            <div className="space-y-3">
              {governance.auditLogs.slice(0, 6).map((log) => (
                <div
                  key={log.id}
                  className="rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC] px-3 py-2.5 text-[12px] space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-[#17243A]">{log.action}</span>
                    <span className="text-[11px] text-[#64748B] tabular-nums">
                      {new Date(log.createdAt).toISOString().slice(0, 16).replace("T", " ")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[#64748B]">
                    <span className="shrink-0">{log.entityType}</span>
                    <span className="truncate">{log.actorEmail ?? "system"}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
