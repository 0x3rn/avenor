"use client";

import type { EnvironmentType, LogicalProjectSummary } from "@avenor/types";
import {
  Badge,
  Button,
  Card,
  Dialog,
  FormField,
  MetricCard,
  PageHeader,
  SegmentedControl,
  Select,
  StatusIndicator,
  Textarea,
  TextInput,
  WarningBanner,
} from "@avenor/ui";
import { Activity, Globe, Layers, RefreshCw, ShieldCheck, Table2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  MetricDefinitionTrigger,
  type MetricProvenanceContext,
  MetricProvenanceDrawer,
} from "@/components/reports/metric-provenance-drawer";
import { SourceReconciliationPanel } from "@/components/reports/source-reconciliation-panel";
import { SourceSyncStatusPanel } from "@/components/reports/source-sync-status-panel";
import type {
  PortfolioDatePreset,
  ProjectControlCenterOverviewDto,
} from "@/lib/reports/portfolio-service";

export interface ProjectDetailViewProps {
  workspaceName: string;
  organizationName: string;
  canUpdateProject: boolean;
  canArchiveProject: boolean;
  canManageEnvironments: boolean;
  project: LogicalProjectSummary;
  initialControlCenter?: ProjectControlCenterOverviewDto | null;
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

export function ProjectDetailView({
  workspaceName,
  organizationName,
  canUpdateProject,
  canArchiveProject,
  canManageEnvironments,
  project,
  initialControlCenter = null,
}: ProjectDetailViewProps) {
  const router = useRouter();

  const defaultEnvKind =
    initialControlCenter?.selectedEnvironmentType ??
    project.environments.find((e) => e.isDefault)?.type ??
    project.environments[0]?.type ??
    "PRODUCTION";

  const [selectedEnvKind, setSelectedEnvKind] = React.useState<EnvironmentType>(defaultEnvKind);
  const [controlCenter, setControlCenter] =
    React.useState<ProjectControlCenterOverviewDto | null>(initialControlCenter);
  const [preset, setPreset] = React.useState<PortfolioDatePreset>(
    initialControlCenter?.dateWindow.preset ?? "28d",
  );
  const [compareEnabled, _setCompareEnabled] = React.useState<boolean>(
    initialControlCenter?.dateWindow.compareEnabled ?? true,
  );
  const [loadingControlCenter, setLoadingControlCenter] = React.useState(false);
  const [showTrendTable, setShowTrendTable] = React.useState(false);
  const [provenanceContext, setProvenanceContext] = React.useState<MetricProvenanceContext | null>(
    null,
  );

  // Edit Project Metadata state
  const [name, setName] = React.useState(project.name);
  const [slug, setSlug] = React.useState(project.slug);
  const [primaryDomain, setPrimaryDomain] = React.useState(project.primaryDomain ?? "");
  const [description, setDescription] = React.useState(project.description ?? "");
  const [savingProject, setSavingProject] = React.useState(false);
  const [projectFeedback, setProjectFeedback] = React.useState<string | null>(null);
  const [projectError, setProjectError] = React.useState<string | null>(null);

  // Upsert Environment state
  const [envKind, setEnvKind] = React.useState<EnvironmentType>("STAGING");
  const [envName, setEnvName] = React.useState("Staging");
  const [envDomain, setEnvDomain] = React.useState("");
  const [envDefault, setEnvDefault] = React.useState(false);
  const [savingEnv, setSavingEnv] = React.useState(false);
  const [envFeedback, setEnvFeedback] = React.useState<string | null>(null);
  const [envError, setEnvError] = React.useState<string | null>(null);

  // Archive Confirmation Dialog
  const [archiveDialogOpen, setArchiveDialogOpen] = React.useState(false);
  const [togglingArchive, setTogglingArchive] = React.useState(false);

  React.useEffect(() => {
    setName(project.name);
    setSlug(project.slug);
    setPrimaryDomain(project.primaryDomain ?? "");
    setDescription(project.description ?? "");
  }, [project]);

  const activeEnvironment =
    project.environments.find((env) => env.type === selectedEnvKind) ?? project.environments[0];

  const refreshControlCenter = React.useCallback(
    async (
      nextEnvType: EnvironmentType,
      nextPreset: PortfolioDatePreset,
      nextCompare: boolean,
    ) => {
      setLoadingControlCenter(true);
      try {
        const envObj = project.environments.find((e) => e.type === nextEnvType);
        const params = new URLSearchParams({
          environmentType: nextEnvType,
          preset: nextPreset,
          compare: nextCompare ? "true" : "false",
        });
        if (envObj?.id) {
          params.set("environmentId", envObj.id);
        }
        const response = await fetch(
          `/api/projects/${encodeURIComponent(project.id)}/control-center?${params.toString()}`,
          { cache: "no-store" },
        );
        if (response.ok) {
          const payload = (await response.json()) as ProjectControlCenterOverviewDto;
          if (payload?.metrics) {
            setControlCenter(payload);
          }
        }
      } catch {
        // Non-fatal in isolated component tests
      } finally {
        setLoadingControlCenter(false);
      }
    },
    [project.environments, project.id],
  );

  function openMetricProvenance(canonicalMetricKey: string) {
    if (!controlCenter) return;
    const isGsc = canonicalMetricKey.startsWith("gsc.");
    const metricRes =
      canonicalMetricKey === "ga4.sessions"
        ? controlCenter.metrics.sessions
        : canonicalMetricKey === "ga4.active_users"
          ? controlCenter.metrics.activeUsers
          : canonicalMetricKey === "gsc.clicks"
            ? controlCenter.metrics.gscClicks
            : controlCenter.metrics.gscCtr;

    setProvenanceContext({
      canonicalMetricKey,
      externalResourceId:
        metricRes.resourcesIncluded.length > 0
          ? metricRes.resourcesIncluded.join(", ")
          : `${project.name} (${selectedEnvKind})`,
      reportingTimezone: isGsc
        ? "America/Los_Angeles"
        : (metricRes.reportingTimezones[0] ?? "UTC"),
      periodStartDate: controlCenter.dateWindow.startDate,
      periodEndDate: controlCenter.dateWindow.endDate,
      completenessState: metricRes.completenessState,
      lastCollectedAtIso: metricRes.latestCollectedAtIso,
      limitations: controlCenter.overlapWarnings,
    });
  }

  async function handleSaveProject(event: React.FormEvent) {
    event.preventDefault();
    setProjectError(null);
    setProjectFeedback(null);
    if (name.trim().length < 2) {
      setProjectError("Product name must be at least 2 characters.");
      return;
    }

    setSavingProject(true);
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          primaryDomain: primaryDomain.trim() || null,
          description: description.trim() || null,
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setProjectError(payload.error?.message ?? "Unable to update logical product.");
        return;
      }
      setProjectFeedback("Product metadata saved.");
      router.refresh();
    } catch {
      setProjectError("Network error while saving product metadata.");
    } finally {
      setSavingProject(false);
    }
  }

  async function handleSaveEnvironment(event: React.FormEvent) {
    event.preventDefault();
    setEnvError(null);
    setEnvFeedback(null);
    setSavingEnv(true);
    try {
      const existingEnv = project.environments.find((e) => e.type === envKind);
      const response = existingEnv
        ? await fetch(`/api/projects/${project.id}/environments`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              environmentId: existingEnv.id,
              name: envName.trim() || undefined,
              primaryDomain: envDomain.trim() || null,
              isDefault: envDefault,
            }),
          })
        : await fetch(`/api/projects/${project.id}/environments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              environmentType: envKind,
              name: envName.trim() || undefined,
              primaryDomain: envDomain.trim() || null,
              isDefault: envDefault,
            }),
          });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setEnvError(payload.error?.message ?? "Unable to save environment.");
        return;
      }
      setEnvFeedback(`${envKind} environment saved.`);
      setSelectedEnvKind(envKind);
      setEnvDomain("");
      setEnvDefault(false);
      router.refresh();
    } catch {
      setEnvError("Network error while saving environment.");
    } finally {
      setSavingEnv(false);
    }
  }

  async function handleArchiveStatusChange(nextStatus: "ACTIVE" | "ARCHIVED") {
    setTogglingArchive(true);
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (response.ok) {
        setArchiveDialogOpen(false);
        router.refresh();
      }
    } finally {
      setTogglingArchive(false);
    }
  }

  const audienceSessionsVal = controlCenter?.metrics.sessions.value ?? null;
  const audienceUsersVal = controlCenter?.metrics.activeUsers.value ?? null;
  const audienceEngRateVal = controlCenter?.metrics.engagementRate.value ?? null;
  const searchClicksVal = controlCenter?.metrics.gscClicks.value ?? null;
  const searchImprVal = controlCenter?.metrics.gscImpressions.value ?? null;
  const searchCtrVal = controlCenter?.metrics.gscCtr.value ?? null;
  const searchPosVal = controlCenter?.metrics.gscAveragePosition.value ?? null;

  const audienceState = controlCenter?.audienceUxState ?? "unconnected";
  const searchState = controlCenter?.searchUxState ?? "unconnected";

  const dailyTrend = controlCenter?.dailyTrend ?? [];
  const maxDailySessions = Math.max(1, ...dailyTrend.map((d) => d.sessions ?? 0));
  const maxDailyClicks = Math.max(1, ...dailyTrend.map((d) => d.gscClicks ?? 0));

  return (
    <div className="space-y-8" data-testid="project-detail-view">
      <PageHeader
        breadcrumbs={[
          { label: organizationName },
          { label: workspaceName, href: "/dashboard" },
          { label: "Projects", href: "/projects" },
          { label: project.name },
        ]}
        title={project.name}
        description={
          project.description ||
          "Logical digital product grouping Production, Staging, and Development environments."
        }
        badges={
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-[6px] bg-[#F0F4FA] px-2 py-0.5 font-mono text-[12px] text-[#30415D]">
              {project.slug}
            </span>
            <Badge tone={project.status === "ACTIVE" ? "success" : "neutral"}>
              {project.status}
            </Badge>
            {controlCenter ? (
              <Badge tone="signal" data-testid="control-center-date-window-badge">
                {controlCenter.dateWindow.startDate} → {controlCenter.dateWindow.endDate} (
                {controlCenter.dateWindow.dayCount}d)
              </Badge>
            ) : null}
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            {controlCenter ? (
              <MetricDefinitionTrigger
                canonicalMetricKey="ga4.sessions"
                onInspect={openMetricProvenance}
              />
            ) : null}
            {project.primaryDomain ? (
              <span className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-[#DFE6F0] bg-[#FFFFFF] px-3.5 text-[13px] font-medium text-[#30415D]">
                <Globe className="h-4 w-4 text-[#168E99]" aria-hidden="true" />
                <span>{project.primaryDomain}</span>
              </span>
            ) : null}

            {canArchiveProject ? (
              project.status === "ACTIVE" ? (
                <Button
                  type="button"
                  variant="secondary"
                  data-testid="project-archive-button"
                  onClick={() => setArchiveDialogOpen(true)}
                >
                  Archive Product
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  data-testid="project-restore-button"
                  disabled={togglingArchive}
                  onClick={() => handleArchiveStatusChange("ACTIVE")}
                >
                  {togglingArchive ? "Restoring..." : "Restore Product"}
                </Button>
              )
            ) : null}
          </div>
        }
      />

      <MetricProvenanceDrawer
        context={provenanceContext}
        onClose={() => setProvenanceContext(null)}
      />

      {project.status === "ARCHIVED" ? (
        <WarningBanner
          tone="warning"
          title="This logical product is currently archived"
          description="Archived products remain preserved in your workspace audit ledger and can be restored to active portfolio monitoring at any time."
        />
      ) : null}

      {/* Environment & Date Window Context Bar */}
      <Card
        className="p-4 sm:p-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"
        data-testid="project-control-center-bar"
      >
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Layers className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
            <span className="text-[14px] font-semibold text-[#17243A]">
              Active Environment Lens: {activeEnvironment?.name ?? selectedEnvKind}
            </span>
            {activeEnvironment?.isDefault ? <Badge tone="indigo">Default Tier</Badge> : null}
            {controlCenter ? (
              <span className="text-[12px] text-[#64748B] tabular-nums">
                • {controlCenter.freshnessLabel}
              </span>
            ) : null}
          </div>
          <p className="text-[13px] text-[#64748B]">
            {activeEnvironment?.primaryDomain
              ? `Environment URL: ${activeEnvironment.primaryDomain}`
              : "No dedicated environment domain configured yet."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <SegmentedControl
            ariaLabel="Switch active environment lens"
            value={selectedEnvKind}
            onChange={(nextEnv) => {
              const next = nextEnv as EnvironmentType;
              setSelectedEnvKind(next);
              if (controlCenter) {
                void refreshControlCenter(next, preset, compareEnabled);
              }
            }}
            options={project.environments.map((env) => ({
              value: env.type,
              label: env.type,
            }))}
          />

          {controlCenter ? (
            <>
              <SegmentedControl
                ariaLabel="Control center reporting date window"
                value={preset}
                onChange={(nextPreset) => {
                  const p = nextPreset as PortfolioDatePreset;
                  setPreset(p);
                  void refreshControlCenter(selectedEnvKind, p, compareEnabled);
                }}
                options={[
                  { value: "7d", label: "7d" },
                  { value: "28d", label: "28d" },
                  { value: "90d", label: "90d" },
                  { value: "mtd", label: "MTD" },
                ]}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="control-center-refresh-button"
                disabled={loadingControlCenter}
                onClick={() => void refreshControlCenter(selectedEnvKind, preset, compareEnabled)}
              >
                <RefreshCw
                  className={`mr-1.5 h-3.5 w-3.5 ${loadingControlCenter ? "animate-spin" : ""}`}
                />
                <span>{loadingControlCenter ? "Refreshing..." : "Refresh"}</span>
              </Button>
            </>
          ) : null}
        </div>
      </Card>

      {/* Mapped Resource Badges & Overlapping Property Guardrails */}
      {controlCenter && controlCenter.mappedResources.length > 0 ? (
        <Card className="p-4 sm:p-5 space-y-3" data-testid="project-mapped-resources-strip">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-[#17243A]">
              Mapped External Resources ({controlCenter.mappedResources.length})
            </span>
            <Link
              href="/connections"
              className="text-[12px] font-semibold text-[#5157D9] hover:underline"
            >
              Manage mappings in Connections →
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {controlCenter.mappedResources.map((res) => {
              const isGa4 =
                res.providerKey === "ga4" || res.providerKey === "google_analytics_4";
              return (
                <Badge
                  key={res.connectedResourceId}
                  tone={isGa4 ? "indigo" : "signal"}
                  data-testid={`mapped-resource-badge-${res.externalResourceId}`}
                >
                  {isGa4 ? "GA4" : "GSC"}: {res.displayName} ({res.externalResourceId} •{" "}
                  {res.reportingTimezone})
                </Badge>
              );
            })}
          </div>
        </Card>
      ) : null}

      {controlCenter && controlCenter.overlapWarnings.length > 0 ? (
        <div className="space-y-2" data-testid="project-overlap-warnings">
          {controlCenter.overlapWarnings.map((warning) => (
            <WarningBanner
              key={warning}
              tone="warning"
              title="Multi-Property Non-Additive Guardrail"
              description={warning}
            />
          ))}
        </div>
      ) : null}

      {/* Environment Signal Atlas Readiness & Stored Canonical KPI Cards */}
      <section
        aria-label={`Environment telemetry readiness for ${selectedEnvKind}`}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
        data-testid="project-control-center-kpi-grid"
      >
        <MetricCard
          title={`${selectedEnvKind} Audience`}
          definition="Sessions, users, and traffic acquisition for this environment."
          state={audienceState}
          value={audienceSessionsVal}
          formattedValue={formatCompactNumber(audienceSessionsVal) ?? undefined}
          unit={
            audienceUsersVal !== null
              ? `${formatCompactNumber(audienceUsersVal)} active users${
                  audienceEngRateVal !== null
                    ? ` • ${formatRatioPercentage(audienceEngRateVal)} eng.`
                    : ""
                }`
              : "sessions"
          }
          comparisonDeltaText={
            controlCenter?.comparisons.sessions.formattedDeltaLabel ?? undefined
          }
          sourceLabel="GA4"
          freshnessLabel={
            controlCenter?.metrics.sessions.latestCollectedAtIso
              ? `Collected ${controlCenter.metrics.sessions.latestCollectedAtIso.slice(0, 16).replace("T", " ")}`
              : "GA4 Data API + Realtime"
          }
          actionSlot={
            <Link
              href={`/projects/${project.id}/audience${
                activeEnvironment
                  ? `?environmentId=${encodeURIComponent(activeEnvironment.id)}`
                  : ""
              }`}
              data-testid="project-open-audience-report"
              className="text-[12px] font-semibold text-[#5157D9] hover:underline"
            >
              Open Audience Report →
            </Link>
          }
        />
        <MetricCard
          title={`${selectedEnvKind} Search Visibility`}
          definition="Organic search impressions, clicks, and average ranking position."
          state={searchState}
          value={searchClicksVal}
          formattedValue={formatCompactNumber(searchClicksVal) ?? undefined}
          unit={
            searchCtrVal !== null
              ? `${formatRatioPercentage(searchCtrVal)} CTR${
                  searchImprVal !== null ? ` • ${formatCompactNumber(searchImprVal)} impr.` : ""
                }${searchPosVal !== null ? ` • pos ${searchPosVal.toFixed(1)}` : ""}`
              : "clicks"
          }
          comparisonDeltaText={
            controlCenter?.comparisons.gscClicks.formattedDeltaLabel ?? undefined
          }
          sourceLabel="Search Console"
          freshnessLabel={
            controlCenter?.metrics.gscClicks.latestCollectedAtIso
              ? "GSC ~48h Pacific lag"
              : "Search Analytics v3"
          }
          actionSlot={
            <Link
              href={`/projects/${project.id}/search${
                activeEnvironment
                  ? `?environmentId=${encodeURIComponent(activeEnvironment.id)}`
                  : ""
              }`}
              data-testid="project-open-search-report"
              className="text-[12px] font-semibold text-[#168E99] hover:underline"
            >
              Open Search Report →
            </Link>
          }
        />
        <MetricCard
          title={`${selectedEnvKind} Cloud Spend`}
          definition="Attributed cloud billing spend and daily cost anomalies."
          state="unconnected"
          sourceLabel="Cloud Billing"
          freshnessLabel="Map BigQuery in Milestone 05"
        />
        <MetricCard
          title={`${selectedEnvKind} Reliability`}
          definition="Database storage, compute health, and deployment outcomes."
          state="unconnected"
          sourceLabel="Infra & DBs"
          freshnessLabel="Map adapters in M06–M08"
        />
      </section>

      {/* Historical Daily Trend & Breakdowns when Control Center data is present */}
      {controlCenter ? (
        <div className="space-y-6">
          <Card className="p-5 sm:p-6 space-y-4" data-testid="project-control-center-trend-card">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
                  <h2 className="text-[17px] font-semibold text-[#17243A]">
                    Historical Product Trajectory ({controlCenter.dateWindow.startDate} →{" "}
                    {controlCenter.dateWindow.endDate})
                  </h2>
                </div>
                <p className="mt-0.5 text-[13px] text-[#64748B]">
                  Daily stored canonical observations for {project.name} ({selectedEnvKind}).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/projects/${project.id}/audience${
                    activeEnvironment
                      ? `?environmentId=${encodeURIComponent(activeEnvironment.id)}`
                      : ""
                  }`}
                  className="text-[12px] font-semibold text-[#5157D9] hover:underline"
                >
                  Audience Report →
                </Link>
                <span className="text-[#C7D2E3]">•</span>
                <Link
                  href={`/projects/${project.id}/search${
                    activeEnvironment
                      ? `?environmentId=${encodeURIComponent(activeEnvironment.id)}`
                      : ""
                  }`}
                  className="text-[12px] font-semibold text-[#168E99] hover:underline"
                >
                  Search Report →
                </Link>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="project-trend-table-toggle"
                  onClick={() => setShowTrendTable((prev) => !prev)}
                >
                  <Table2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  <span>{showTrendTable ? "Show Visual Chart" : "Show Accessible Table"}</span>
                </Button>
              </div>
            </div>

            {dailyTrend.every((d) => d.sessions === null && d.gscClicks === null) ? (
              <div
                className="rounded-[10px] border border-dashed border-[#C7D2E3] bg-[#F7F9FC] p-6 text-center text-[13px] text-[#64748B]"
                data-testid="project-trend-empty"
              >
                No stored daily observations for {selectedEnvKind} in this window yet. Map a GA4 or
                Search Console property in Connections and run a sync below.
              </div>
            ) : showTrendTable ? (
              <div className="overflow-x-auto" data-testid="project-trend-table">
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
                    {dailyTrend.map((point) => (
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
              <div className="space-y-2" data-testid="project-trend-chart">
                <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-14 lg:grid-cols-28 items-end h-32 pt-4 px-2 rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC]">
                  {dailyTrend.slice(-28).map((point) => {
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
              </div>
            )}
          </Card>

          {/* Source Breakdowns Grid (Channels & Organic Queries) */}
          {controlCenter.breakdowns.topChannels.length > 0 ||
          controlCenter.breakdowns.topQueries.length > 0 ? (
            <div
              className="grid grid-cols-1 gap-6 lg:grid-cols-2"
              data-testid="project-control-center-breakdowns"
            >
              <Card className="p-5 sm:p-6 space-y-3">
                <h3 className="text-[16px] font-semibold text-[#17243A]">
                  Top Acquisition Channels (GA4)
                </h3>
                {controlCenter.breakdowns.topChannels.length === 0 ? (
                  <p className="text-[13px] text-[#64748B]">
                    No channel breakdown observations recorded in this window.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {controlCenter.breakdowns.topChannels.map((item) => (
                      <div
                        key={item.dimensionValue}
                        className="flex items-center justify-between rounded-[8px] border border-[#DFE6F0] bg-[#F7F9FC] px-3 py-2 text-[13px]"
                      >
                        <span className="font-medium text-[#17243A]">{item.dimensionValue}</span>
                        <span className="font-semibold tabular-nums text-[#30415D]">
                          {formatCompactNumber(item.primaryMetricValue) ?? "—"} sessions
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card className="p-5 sm:p-6 space-y-3">
                <h3 className="text-[16px] font-semibold text-[#17243A]">
                  Top Organic Search Queries (GSC)
                </h3>
                {controlCenter.breakdowns.topQueries.length === 0 ? (
                  <p className="text-[13px] text-[#64748B]">
                    No query breakdown observations recorded in this window.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {controlCenter.breakdowns.topQueries.map((item) => (
                      <div
                        key={item.dimensionValue}
                        className="flex items-center justify-between rounded-[8px] border border-[#DFE6F0] bg-[#F7F9FC] px-3 py-2 text-[13px]"
                      >
                        <span className="font-mono text-[12px] text-[#17243A] truncate pr-3">
                          {item.dimensionValue}
                        </span>
                        <span className="font-semibold tabular-nums text-[#30415D] shrink-0">
                          {formatCompactNumber(item.primaryMetricValue) ?? "—"} clicks (
                          {formatCompactNumber(item.secondaryMetricValue) ?? "—"} impr.)
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          ) : null}

          {/* Ingestion & Watermark Sync Status Panel */}
          <SourceSyncStatusPanel
            projectId={project.id}
            onSyncCompleted={() =>
              void refreshControlCenter(selectedEnvKind, preset, compareEnabled)
            }
          />

          {/* Date-Range Comparison, Capability Filtering & Provider Reconciliation Panel */}
          <SourceReconciliationPanel
            projectId={project.id}
            environmentId={activeEnvironment?.id ?? null}
            environmentType={selectedEnvKind}
            preset={preset}
          />
        </div>
      ) : null}

      {/* 12-Column Management Grid: 6 Columns Environments / 6 Columns Product Metadata */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left 6 Columns: Environment Management */}
        <Card
          className="p-5 sm:p-6 space-y-5 lg:col-span-6"
          data-testid="environment-management-card"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-[18px] font-semibold text-[#17243A]">
                Environment Tiers ({project.environments.length})
              </h2>
              <p className="mt-0.5 text-[13px] text-[#64748B]">
                Each logical product supports Production, Staging, and Development tiers so
                non-production traffic never pollutes executive reports.
              </p>
            </div>
          </div>

          <div className="space-y-2.5" data-testid="project-environments-list">
            {project.environments.map((env) => (
              <div
                key={env.id}
                data-testid={`environment-row-${env.type}`}
                className="flex items-center justify-between gap-3 rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC] px-3.5 py-2.5"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-[#17243A]">{env.name}</span>
                    <Badge tone={env.isDefault ? "indigo" : "neutral"}>{env.type}</Badge>
                    {env.isDefault ? <Badge tone="signal">Default</Badge> : null}
                  </div>
                  <p className="truncate text-[12px] text-[#64748B]">
                    {env.primaryDomain || "No environment-specific URL assigned"}
                  </p>
                </div>
                <StatusIndicator
                  tone={env.mappedResourceCount > 0 ? "success" : "neutral"}
                  label={
                    env.mappedResourceCount > 0
                      ? `${env.mappedResourceCount} mapped`
                      : "Not connected"
                  }
                />
              </div>
            ))}
          </div>

          {canManageEnvironments ? (
            <form
              onSubmit={handleSaveEnvironment}
              className="space-y-4 border-t border-[#DFE6F0] pt-4"
              data-testid="project-environment-form"
            >
              <p className="text-[14px] font-semibold text-[#17243A]">
                Add or Update Environment Tier
              </p>

              {envError ? (
                <div
                  role="alert"
                  className="rounded-[10px] border border-[#BF4256]/30 bg-[#FDECEF] px-3.5 py-2.5 text-[13px] font-medium text-[#BF4256]"
                >
                  {envError}
                </div>
              ) : null}
              {envFeedback ? (
                <div
                  data-testid="environment-feedback"
                  className="rounded-[10px] border border-[#147D63]/30 bg-[#E7F6EF] px-3.5 py-2.5 text-[13px] font-medium text-[#147D63]"
                >
                  {envFeedback}
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField id="detail-env-kind" label="Environment kind">
                  <Select
                    id="detail-env-kind"
                    data-testid="detail-env-kind-select"
                    value={envKind}
                    onChange={(event) => {
                      const next = event.target.value as EnvironmentType;
                      setEnvKind(next);
                      setEnvName(
                        next === "PRODUCTION"
                          ? "Production"
                          : next === "STAGING"
                            ? "Staging"
                            : "Development",
                      );
                    }}
                  >
                    <option value="PRODUCTION">PRODUCTION</option>
                    <option value="STAGING">STAGING</option>
                    <option value="DEVELOPMENT">DEVELOPMENT</option>
                  </Select>
                </FormField>

                <FormField id="detail-env-name" label="Display label">
                  <TextInput
                    id="detail-env-name"
                    data-testid="detail-env-name-input"
                    value={envName}
                    onChange={(event) => setEnvName(event.target.value)}
                    placeholder="Staging"
                  />
                </FormField>
              </div>

              <FormField id="detail-env-domain" label="Environment URL (optional)">
                <TextInput
                  id="detail-env-domain"
                  data-testid="detail-env-domain-input"
                  value={envDomain}
                  onChange={(event) => setEnvDomain(event.target.value)}
                  placeholder="https://staging.avenor.dev"
                />
              </FormField>

              <div className="flex items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-[13px] text-[#30415D]">
                  <input
                    type="checkbox"
                    checked={envDefault}
                    onChange={(e) => setEnvDefault(e.target.checked)}
                    className="h-4 w-4 rounded accent-[#5157D9]"
                  />
                  <span>Make default environment for this product</span>
                </label>

                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  data-testid="detail-save-env-button"
                  disabled={savingEnv}
                >
                  {savingEnv ? "Saving..." : "Save Environment"}
                </Button>
              </div>
            </form>
          ) : null}
        </Card>

        {/* Right 6 Columns: Edit Logical Product Metadata */}
        <Card className="p-5 sm:p-6 space-y-5 lg:col-span-6" data-testid="edit-project-card">
          <div>
            <h2 className="text-[18px] font-semibold text-[#17243A]">Logical Product Identity</h2>
            <p className="mt-0.5 text-[13px] text-[#64748B]">
              Update Avenor-owned product metadata, workspace-local slug, and canonical domain.
            </p>
          </div>

          <form onSubmit={handleSaveProject} className="space-y-4" data-testid="edit-project-form">
            {projectError ? (
              <div
                role="alert"
                className="rounded-[10px] border border-[#BF4256]/30 bg-[#FDECEF] px-3.5 py-2.5 text-[13px] font-medium text-[#BF4256]"
              >
                {projectError}
              </div>
            ) : null}
            {projectFeedback ? (
              <div
                data-testid="edit-project-feedback"
                className="rounded-[10px] border border-[#147D63]/30 bg-[#E7F6EF] px-3.5 py-2.5 text-[13px] font-medium text-[#147D63]"
              >
                {projectFeedback}
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField id="edit-project-name" label="Product name" required>
                <TextInput
                  id="edit-project-name"
                  data-testid="edit-project-name-input"
                  value={name}
                  disabled={!canUpdateProject}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </FormField>

              <FormField id="edit-project-slug" label="Workspace-scoped slug" required>
                <TextInput
                  id="edit-project-slug"
                  data-testid="edit-project-slug-input"
                  value={slug}
                  disabled={!canUpdateProject}
                  onChange={(e) => setSlug(e.target.value)}
                  required
                />
              </FormField>
            </div>

            <FormField id="edit-project-domain" label="Primary production domain">
              <TextInput
                id="edit-project-domain"
                data-testid="edit-project-domain-input"
                value={primaryDomain}
                disabled={!canUpdateProject}
                onChange={(e) => setPrimaryDomain(e.target.value)}
                placeholder="https://avenor.dev"
              />
            </FormField>

            <FormField id="edit-project-description" label="Product description">
              <Textarea
                id="edit-project-description"
                data-testid="edit-project-description-input"
                value={description}
                disabled={!canUpdateProject}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </FormField>

            <div className="flex items-center justify-between gap-3 pt-1">
              <Link
                href="/connections"
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#168E99] hover:underline"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                <span>Inspect read-only connector rules</span>
              </Link>

              {canUpdateProject ? (
                <Button
                  type="submit"
                  variant="primary"
                  data-testid="edit-project-submit"
                  disabled={savingProject}
                >
                  {savingProject ? "Saving changes..." : "Save Product Changes"}
                </Button>
              ) : null}
            </div>
          </form>
        </Card>
      </div>

      {/* Archive Confirmation Modal Dialog */}
      <Dialog
        open={archiveDialogOpen}
        onClose={() => setArchiveDialogOpen(false)}
        title={`Archive ${project.name}?`}
        description="Archiving hides this logical product from active portfolio KPI counts while preserving its environment mappings and audit trail. No external provider resources are modified."
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setArchiveDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive-avenor-only"
              data-testid="confirm-archive-project-button"
              disabled={togglingArchive}
              onClick={() => handleArchiveStatusChange("ARCHIVED")}
            >
              {togglingArchive ? "Archiving..." : "Confirm Archive"}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-[#30415D]">
          You can restore <strong className="font-semibold text-[#17243A]">{project.name}</strong>{" "}
          to `ACTIVE` status at any time from the Projects directory or this detail page.
        </p>
      </Dialog>
    </div>
  );
}
