"use client";

import { Badge, Card, EmptyState, MetricCard, PageHeader, Select, WarningBanner } from "@avenor/ui";
import { Activity, Database, Flame, HardDrive, ShieldAlert, Users } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import type { ProjectBackendIntelligenceReportDto } from "@/lib/reports/backend-service";

export interface BackendReportViewProps {
  initialReport: ProjectBackendIntelligenceReportDto;
  workspaceName: string;
  organizationName: string;
  securityPostureSlot?: React.ReactNode;
}

function formatBytes(bytes: number | null): string | undefined {
  if (bytes === null || !Number.isFinite(bytes)) return undefined;
  const abs = Math.abs(bytes);
  const sign = bytes < 0 ? "-" : "";
  if (abs >= 1_073_741_824) {
    return `${sign}${(abs / 1_073_741_824).toFixed(2)} GB`;
  }
  if (abs >= 1_048_576) {
    return `${sign}${(abs / 1_048_576).toFixed(2)} MB`;
  }
  if (abs >= 1024) {
    return `${sign}${(abs / 1024).toFixed(1)} KB`;
  }
  return `${sign}${Math.round(abs)} B`;
}

function formatCount(value: number | null): string | undefined {
  if (value === null || !Number.isFinite(value)) return undefined;
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function formatCuSeconds(seconds: number | null): string | undefined {
  if (seconds === null || !Number.isFinite(seconds)) return undefined;
  if (seconds >= 3600) {
    return `${(seconds / 3600).toFixed(1)} CU-h (${new Intl.NumberFormat("en-US").format(Math.round(seconds))}s)`;
  }
  return `${new Intl.NumberFormat("en-US").format(Math.round(seconds))} CU-s`;
}

function formatBytesMonth(bytesMonth: number | null): string | undefined {
  if (bytesMonth === null || !Number.isFinite(bytesMonth)) return undefined;
  if (bytesMonth >= 1_073_741_824) {
    return `${(bytesMonth / 1_073_741_824).toFixed(3)} GB-mo`;
  }
  if (bytesMonth >= 1_048_576) {
    return `${(bytesMonth / 1_048_576).toFixed(2)} MB-mo`;
  }
  return `${bytesMonth.toFixed(1)} B-mo`;
}

function getAuthStatusBadgeTone(
  status: ProjectBackendIntelligenceReportDto["authSemanticsPanel"][number]["status"],
): "success" | "neutral" | "warning" | "critical" {
  switch (status) {
    case "SUPPORTED":
      return "success";
    case "PLAN_RESTRICTED":
    case "MISSING_PERMISSION":
      return "warning";
    default:
      return "neutral";
  }
}

export function BackendReportView({
  initialReport,
  workspaceName,
  organizationName,
  securityPostureSlot,
}: BackendReportViewProps) {
  const [report, setReport] = React.useState<ProjectBackendIntelligenceReportDto>(initialReport);
  const [preset, setPreset] = React.useState<string>(initialReport.dateWindow.preset || "28d");
  const [environmentId, setEnvironmentId] = React.useState<string>(
    initialReport.environmentId ?? "all",
  );
  const [loading, setLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const reloadReport = React.useCallback(
    async (nextPreset: string, nextEnvId: string) => {
      setLoading(true);
      setErrorMessage(null);
      try {
        const params = new URLSearchParams();
        params.set("preset", nextPreset);
        if (nextEnvId !== "all") {
          params.set("environmentId", nextEnvId);
        }
        const res = await fetch(
          `/api/projects/${encodeURIComponent(report.project.id)}/backend?${params.toString()}`,
        );
        const body = await res.json();
        if (!res.ok) {
          throw new Error(body?.error?.message ?? "Failed to refresh backend intelligence report.");
        }
        setReport(body as ProjectBackendIntelligenceReportDto);
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : "Unable to load backend telemetry right now.",
        );
      } finally {
        setLoading(false);
      }
    },
    [report.project.id],
  );

  const anyConnected =
    report.neon.connected || report.supabase.connected || report.firebase.connected;

  return (
    <div className="space-y-6" data-testid="project-backend-report-view">
      <PageHeader
        breadcrumbs={[
          { label: organizationName },
          { label: workspaceName, href: "/dashboard" },
          { label: report.project.name, href: `/projects/${report.project.id}` },
          { label: "Backend & Databases" },
        ]}
        title={`${report.project.name} — Backend & Database Intelligence`}
        description="Read-only database growth, compute utilization, Firestore/Functions telemetry, and honest registered user posture across Neon, Supabase, and Firebase/GCP Cloud Monitoring."
        badges={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="indigo">Read-Only Control Plane</Badge>
            <Badge tone="neutral">{report.freshnessLabel}</Badge>
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Date window"
              value={preset}
              onChange={(event) => {
                const next = event.target.value;
                setPreset(next);
                void reloadReport(next, environmentId);
              }}
              className="w-[140px]"
            >
              <option value="7d">Last 7 days</option>
              <option value="28d">Last 28 days</option>
              <option value="90d">Last 90 days</option>
            </Select>
            <Select
              aria-label="Environment scope"
              value={environmentId}
              onChange={(event) => {
                const next = event.target.value;
                setEnvironmentId(next);
                void reloadReport(preset, next);
              }}
              className="w-[170px]"
            >
              <option value="all">All environments</option>
              {report.project.environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name} ({env.type})
                </option>
              ))}
            </Select>
          </div>
        }
      />

      {errorMessage ? (
        <WarningBanner
          tone="warning"
          title="Backend telemetry refresh error"
          description={errorMessage}
        />
      ) : null}

      {!anyConnected ? (
        <EmptyState
          icon={<Database className="h-5 w-5" aria-hidden="true" />}
          title="No Backend or Database Sources Mapped"
          description="Connect Neon Serverless Postgres, Supabase Management API, or Firebase / Google Cloud Monitoring (`monitoring.read`) and map a resource to this product to inspect read-only backend telemetry."
          primaryAction={
            <Link
              href="/connections"
              className="inline-flex h-9 items-center rounded-[8px] bg-[#17243A] px-4 text-[13px] font-medium text-white hover:bg-[#223556]"
            >
              Connect Backend Source
            </Link>
          }
        />
      ) : (
        <>
          {/* Neon Serverless Postgres Telemetry */}
          {report.neon.connected ? (
            <section className="space-y-3" data-testid="neon-backend-section">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
                  <h2 className="text-[16px] font-semibold text-[#17243A]">
                    Neon Serverless Postgres (Control Plane v2)
                  </h2>
                </div>
                <Badge tone="neutral">GET-Only Lock • Zero Customer SQL</Badge>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                  title="Neon Instantaneous DB Size"
                  definition="Point-in-time branch logical_size in bytes (GAUGE, never summed across dates)."
                  state={loading ? "loading_refresh" : report.neon.uxState}
                  value={report.neon.instantaneousStorageBytes}
                  formattedValue={formatBytes(report.neon.instantaneousStorageBytes)}
                  unit="bytes"
                  sourceLabel="Neon Branches API"
                  freshnessLabel="Latest gauge"
                />
                <MetricCard
                  title="Neon Storage Consumption"
                  definition="Billing-horizon storage consumption in bytes-month (distinct from instantaneous bytes)."
                  state={loading ? "loading_refresh" : report.neon.uxState}
                  value={report.neon.storageConsumptionBytesMonth}
                  formattedValue={formatBytesMonth(report.neon.storageConsumptionBytesMonth)}
                  unit="bytes_month"
                  comparisonDeltaText={
                    report.neon.comparisons.storageConsumptionBytesMonth.formattedDeltaLabel ??
                    undefined
                  }
                  sourceLabel="Neon Consumption v2"
                  freshnessLabel={`${report.dateWindow.startDate} → ${report.dateWindow.endDate}`}
                />
                <MetricCard
                  title="Neon Compute-Unit Seconds"
                  definition="Allocated compute capacity in CU-seconds (never mislabeled as CPU %)."
                  state={loading ? "loading_refresh" : report.neon.uxState}
                  value={report.neon.computeUnitSeconds}
                  formattedValue={formatCuSeconds(report.neon.computeUnitSeconds)}
                  unit="seconds"
                  comparisonDeltaText={
                    report.neon.comparisons.computeUnitSeconds.formattedDeltaLabel ?? undefined
                  }
                  sourceLabel="Neon Consumption v2"
                  freshnessLabel="Not CPU %"
                />
                <MetricCard
                  title="Neon Active Branches"
                  definition="Point-in-time count of active Neon branches (GAUGE)."
                  state={loading ? "loading_refresh" : report.neon.uxState}
                  value={report.neon.branchCount}
                  formattedValue={formatCount(report.neon.branchCount)}
                  unit="branches"
                  sourceLabel="Neon Branches API"
                  freshnessLabel="Latest gauge"
                />
              </div>
              <p className="text-[12px] text-[#64748B]">{report.neon.unitDisclaimer}</p>
            </section>
          ) : null}

          {/* Supabase Management API Telemetry */}
          {report.supabase.connected ? (
            <section className="space-y-3" data-testid="supabase-backend-section">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-[#0D9488]" aria-hidden="true" />
                  <h2 className="text-[16px] font-semibold text-[#17243A]">
                    Supabase (Management API v1)
                  </h2>
                </div>
                <Badge tone="success">service_role Rejected • Zero Raw auth.users</Badge>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                  title="Supabase Database Size"
                  definition="Point-in-time Postgres database footprint in bytes (GAUGE)."
                  state={loading ? "loading_refresh" : report.supabase.uxState}
                  value={report.supabase.dbSizeBytes}
                  formattedValue={formatBytes(report.supabase.dbSizeBytes)}
                  unit="bytes"
                  sourceLabel="Supabase Management"
                  freshnessLabel="Latest gauge"
                />
                <MetricCard
                  title="Supabase Storage Size"
                  definition="Point-in-time object storage footprint in bytes (zero object inspection)."
                  state={loading ? "loading_refresh" : report.supabase.uxState}
                  value={report.supabase.storageSizeBytes}
                  formattedValue={formatBytes(report.supabase.storageSizeBytes)}
                  unit="bytes"
                  sourceLabel="Supabase Management"
                  freshnessLabel="Latest gauge"
                />
                <MetricCard
                  title="Active DB Connections"
                  definition="Point-in-time active Postgres connections gauge (never summed across dates)."
                  state={loading ? "loading_refresh" : report.supabase.uxState}
                  value={report.supabase.activeConnections}
                  formattedValue={formatCount(report.supabase.activeConnections)}
                  unit="connections"
                  sourceLabel="Supabase Management"
                  freshnessLabel="Latest gauge"
                />
                <MetricCard
                  title="Supabase API Requests"
                  definition="Aggregate REST, GraphQL, Storage, and Realtime gateway requests."
                  state={loading ? "loading_refresh" : report.supabase.uxState}
                  value={report.supabase.apiRequests}
                  formattedValue={formatCount(report.supabase.apiRequests)}
                  unit="requests"
                  comparisonDeltaText={
                    report.supabase.comparisons.apiRequests.formattedDeltaLabel ?? undefined
                  }
                  sourceLabel="Supabase Analytics"
                  freshnessLabel={`${report.dateWindow.startDate} → ${report.dateWindow.endDate}`}
                />
              </div>
            </section>
          ) : null}

          {/* Firebase / Google Cloud Monitoring Telemetry */}
          {report.firebase.connected ? (
            <section className="space-y-3" data-testid="firebase-backend-section">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Flame className="h-4 w-4 text-[#D97706]" aria-hidden="true" />
                  <h2 className="text-[16px] font-semibold text-[#17243A]">
                    Firebase / Google Cloud Monitoring (monitoring.read)
                  </h2>
                </div>
                <Badge tone="success">IAM Read-Only • Admin SDK Prohibited</Badge>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                  title="Firestore Document Reads"
                  definition="DELTA sum of Firestore document read operations."
                  state={loading ? "loading_refresh" : report.firebase.uxState}
                  value={report.firebase.firestoreReads}
                  formattedValue={formatCount(report.firebase.firestoreReads)}
                  unit="reads"
                  comparisonDeltaText={
                    report.firebase.comparisons.firestoreReads.formattedDeltaLabel ?? undefined
                  }
                  sourceLabel="Cloud Monitoring v3"
                  freshnessLabel="DELTA sum"
                />
                <MetricCard
                  title="Firestore Active Listeners"
                  definition="GAUGE count of active realtime listeners (never summed across samples)."
                  state={loading ? "loading_refresh" : report.firebase.uxState}
                  value={report.firebase.firestoreActiveListeners}
                  formattedValue={formatCount(report.firebase.firestoreActiveListeners)}
                  unit="listeners"
                  sourceLabel="Cloud Monitoring v3"
                  freshnessLabel="Latest gauge"
                />
                <MetricCard
                  title="Cloud Functions Invocations"
                  definition="DELTA sum of Cloud Functions executions and non-ok error ratio."
                  state={loading ? "loading_refresh" : report.firebase.uxState}
                  value={report.firebase.functionInvocations}
                  formattedValue={formatCount(report.firebase.functionInvocations)}
                  unit="invocations"
                  comparisonDeltaText={
                    report.firebase.functionErrorRatePercent !== null
                      ? `Error rate: ${report.firebase.functionErrorRatePercent.toFixed(2)}%`
                      : undefined
                  }
                  sourceLabel="Cloud Monitoring v3"
                  freshnessLabel={
                    report.firebase.functionMeanExecutionTimeMs !== null
                      ? `Mean ${report.firebase.functionMeanExecutionTimeMs.toFixed(1)} ms`
                      : "DELTA sum"
                  }
                />
                <MetricCard
                  title="Cloud Storage Footprint"
                  definition="GAUGE total bytes stored across monitored buckets (never summed)."
                  state={loading ? "loading_refresh" : report.firebase.uxState}
                  value={report.firebase.storageBytes}
                  formattedValue={formatBytes(report.firebase.storageBytes)}
                  unit="bytes"
                  sourceLabel="Cloud Monitoring v3"
                  freshnessLabel="Latest gauge"
                />
              </div>
            </section>
          ) : null}

          {/* Database & Storage Growth Trajectory */}
          {report.storageGrowth.length > 0 ? (
            <Card className="p-5 sm:p-6 space-y-4" data-testid="storage-growth-panel">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
                <h2 className="text-[16px] font-semibold text-[#17243A]">
                  Database & Storage Growth Over Window
                </h2>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {report.storageGrowth.map((series) => (
                  <div
                    key={series.metricKey}
                    className="rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC] p-4 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13.5px] font-semibold text-[#17243A]">
                        {series.label}
                      </span>
                      <Badge
                        tone={
                          series.growthPercent !== null && series.growthPercent > 15
                            ? "warning"
                            : "neutral"
                        }
                      >
                        {series.growthPercent !== null
                          ? `${series.growthPercent >= 0 ? "+" : ""}${series.growthPercent.toFixed(2)}%`
                          : `${series.sampleDays}d observed`}
                      </Badge>
                    </div>
                    <div className="font-mono text-[13px] text-[#17243A]">
                      Current: {formatBytes(series.latestBytes) ?? "No gauge reading"}
                      {series.growthBytes !== null
                        ? ` (${series.growthBytes >= 0 ? "+" : ""}${formatBytes(series.growthBytes)})`
                        : ""}
                    </div>
                    <p className="text-[12px] text-[#64748B]">{series.note}</p>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {/* Auth Accounts vs Auth Requests vs GA4 Visitors Semantic Separation */}
          <Card className="p-5 sm:p-6 space-y-4" data-testid="auth-semantics-panel">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
                <h2 className="text-[16px] font-semibold text-[#17243A]">
                  Registered Auth Accounts vs Auth Traffic vs Web Visitors
                </h2>
              </div>
              <Badge tone="indigo">Zero Raw PII • Semantic Separation</Badge>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {report.authSemanticsPanel.map((item) => (
                <div
                  key={item.key}
                  data-testid={`auth-semantics-${item.key}`}
                  className="rounded-[10px] border border-[#DFE6F0] bg-[#FFFFFF] p-4 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[13px] font-semibold text-[#17243A]">{item.label}</div>
                    <Badge tone={getAuthStatusBadgeTone(item.status)}>{item.status}</Badge>
                  </div>
                  <div className="font-mono text-[20px] font-semibold text-[#17243A]">
                    {item.value !== null ? formatCount(item.value) : "Unavailable"}
                    <span className="ml-1.5 text-[12px] font-normal text-[#64748B]">
                      {item.unit}
                    </span>
                  </div>
                  <p className="text-[12px] text-[#64748B] leading-relaxed">
                    {item.semanticClarification}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {/* Optional Passive Security Posture Slot (THE-143) */}
      {securityPostureSlot}

      {/* Read-Only Guardrails & Data Quality Disclosure */}
      <Card className="p-4 sm:p-5 bg-[#F7F9FC] border-[#DFE6F0] space-y-2">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-[#17243A]">
          <ShieldAlert className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
          <span>Backend Telemetry Boundaries & Honest Metric Rules</span>
        </div>
        <ul className="list-disc pl-5 space-y-1 text-[12px] text-[#475569]">
          {report.limitations.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
