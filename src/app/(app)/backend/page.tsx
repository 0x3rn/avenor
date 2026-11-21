import { Badge, Card, EmptyState, MetricCard, PageHeader, WarningBanner } from "@avenor/ui";
import { Database, FolderKanban, Server } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { getWorkspaceBackendIntelligenceReport } from "@/lib/reports/backend-service";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

function formatBytes(bytes: number | null): string | undefined {
  if (bytes === null || !Number.isFinite(bytes)) return undefined;
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

function formatCount(value: number | null): string | undefined {
  if (value === null || !Number.isFinite(value)) return undefined;
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

async function WorkspaceBackendPageContent() {
  const { session, governance } = await requireAuthenticatedAppContext();
  const report = await getWorkspaceBackendIntelligenceReport(session, { preset: "28d" });

  return (
    <div className="space-y-6" data-testid="workspace-backend-page">
      <PageHeader
        breadcrumbs={[
          { label: governance.organization.name },
          { label: governance.workspace.name, href: "/dashboard" },
          { label: "Backend & Databases" },
        ]}
        title="Portfolio Backend & Database Intelligence"
        description="Read-only database storage, Neon compute utilization, Supabase gateway/auth telemetry, and Firebase Cloud Monitoring health across your workspace products."
        badges={
          <Badge tone="indigo">
            {report.connectedProjectCount} / {report.totalProjectCount} Products Connected
          </Badge>
        }
      />

      <WarningBanner
        tone="signal"
        title="Provider-Specific Unit Integrity"
        description={report.unitSeparationNotice}
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Neon Compute-Unit Seconds"
          definition="Sum of allocated Neon CU-seconds across connected workspace products (never CPU %)."
          state={
            report.summary.totalNeonComputeUnitSeconds !== null
              ? "connected_healthy"
              : "unconnected"
          }
          value={report.summary.totalNeonComputeUnitSeconds}
          formattedValue={formatCount(report.summary.totalNeonComputeUnitSeconds)}
          unit="CU-s"
          sourceLabel="Neon Control Plane"
          freshnessLabel={`${report.dateWindow.startDate} → ${report.dateWindow.endDate}`}
        />
        <MetricCard
          title="Supabase Database Footprint"
          definition="Latest instantaneous Postgres DB bytes across connected Supabase projects."
          state={
            report.summary.totalSupabaseDbSizeBytes !== null ? "connected_healthy" : "unconnected"
          }
          value={report.summary.totalSupabaseDbSizeBytes}
          formattedValue={formatBytes(report.summary.totalSupabaseDbSizeBytes)}
          unit="bytes"
          sourceLabel="Supabase Management"
          freshnessLabel="Latest gauge"
        />
        <MetricCard
          title="Firestore Document Reads"
          definition="DELTA sum of Firestore reads via Google Cloud Monitoring (monitoring.read)."
          state={
            report.summary.totalFirebaseFirestoreReads !== null
              ? "connected_healthy"
              : "unconnected"
          }
          value={report.summary.totalFirebaseFirestoreReads}
          formattedValue={formatCount(report.summary.totalFirebaseFirestoreReads)}
          unit="reads"
          sourceLabel="Cloud Monitoring v3"
          freshnessLabel="DELTA sum"
        />
        <MetricCard
          title="Cloud Functions Invocations"
          definition="DELTA sum of Cloud Functions executions across monitored Firebase/GCP projects."
          state={
            report.summary.totalFirebaseFunctionInvocations !== null
              ? "connected_healthy"
              : "unconnected"
          }
          value={report.summary.totalFirebaseFunctionInvocations}
          formattedValue={formatCount(report.summary.totalFirebaseFunctionInvocations)}
          unit="invocations"
          sourceLabel="Cloud Monitoring v3"
          freshnessLabel={
            report.summary.totalFirebaseFunctionErrors !== null
              ? `${formatCount(report.summary.totalFirebaseFunctionErrors)} errors`
              : "DELTA sum"
          }
        />
      </section>

      {report.projects.length === 0 ? (
        <EmptyState
          icon={<Database className="h-5 w-5" aria-hidden="true" />}
          title="No Logical Products Configured"
          description="Create a logical product and map a Neon, Supabase, or Firebase/GCP Cloud Monitoring resource to inspect backend health and database growth."
        />
      ) : (
        <Card className="p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
            <h2 className="text-[16px] font-semibold text-[#17243A]">
              Product Backend Health & Storage Matrix
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {report.projects.map((proj) => (
              <div
                key={proj.projectId}
                className="rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC] p-4 flex items-center justify-between gap-3"
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[#17243A]">{proj.projectName}</span>
                    {proj.connectedBackendProviders.length > 0 ? (
                      proj.connectedBackendProviders.map((prov) => (
                        <Badge key={prov} tone="indigo">
                          {prov}
                        </Badge>
                      ))
                    ) : (
                      <Badge tone="neutral">Not connected</Badge>
                    )}
                  </div>
                  <div className="font-mono text-[12px] text-[#64748B]">
                    Neon: {formatBytes(proj.neonInstantaneousStorageBytes) ?? "—"} • Supabase DB:{" "}
                    {formatBytes(proj.supabaseDbSizeBytes) ?? "—"} • Firebase Storage:{" "}
                    {formatBytes(proj.firebaseStorageBytes) ?? "—"}
                  </div>
                </div>
                <Link
                  href={`/projects/${proj.projectId}/backend`}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] border border-[#C7D2E3] bg-[#FFFFFF] px-3 text-[12.5px] font-medium text-[#17243A] hover:bg-[#F0F4FA]"
                >
                  <FolderKanban className="h-3.5 w-3.5 text-[#5157D9]" />
                  <span>Backend Report</span>
                </Link>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

export default function WorkspaceBackendPage() {
  return (
    <React.Suspense fallback={<div className="min-h-[480px]" />}>
      <WorkspaceBackendPageContent />
    </React.Suspense>
  );
}
