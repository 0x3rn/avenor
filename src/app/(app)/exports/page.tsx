import { Badge, Card, PageHeader, WarningBanner } from "@avenor/ui";
import { Archive, ShieldCheck } from "lucide-react";
import * as React from "react";
import { getWorkspaceRetentionPolicy, listWorkspaceExportJobs } from "@/lib/exports/service";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

async function WorkspaceExportsPageContent() {
  const { session, governance } = await requireAuthenticatedAppContext();
  const [jobs, policy] = await Promise.all([
    listWorkspaceExportJobs(session, governance.workspace.id),
    getWorkspaceRetentionPolicy(session, governance.workspace.id),
  ]);

  return (
    <div className="space-y-6" data-testid="workspace-exports-page">
      <PageHeader
        breadcrumbs={[
          { label: governance.organization.name },
          { label: governance.workspace.name, href: "/dashboard" },
          { label: "Data Exports & Retention" },
        ]}
        title="Historical Data Exports & Retention Controls"
        description="Generate audit-friendly CSV/JSON exports with provenance headers, SHA-256 checksums, expiring signed download tokens, and configurable workspace retention limits."
        badges={<Badge tone="indigo">{jobs.length} Export Jobs</Badge>}
      />

      <WarningBanner
        tone="signal"
        title="Active Deletion vs Backup Retention Disclosure"
        description={policy.backupLimitationNote}
      />

      <Card className="p-5 sm:p-6 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
          <h2 className="text-[16px] font-semibold text-[#17243A]">
            Active Workspace Retention Policy
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-[13.5px]">
          <div className="rounded-[8px] border border-[#DFE6F0] bg-[#F7F9FC] p-3">
            <p className="text-[#64748B]">Historical Metrics</p>
            <p className="font-mono font-semibold text-[#17243A]">
              {policy.metricRetentionDays} days
            </p>
          </div>
          <div className="rounded-[8px] border border-[#DFE6F0] bg-[#F7F9FC] p-3">
            <p className="text-[#64748B]">Operational Events</p>
            <p className="font-mono font-semibold text-[#17243A]">
              {policy.eventRetentionDays} days
            </p>
          </div>
          <div className="rounded-[8px] border border-[#DFE6F0] bg-[#F7F9FC] p-3">
            <p className="text-[#64748B]">Signed Export Expiry</p>
            <p className="font-mono font-semibold text-[#17243A]">
              {policy.exportExpiryHours} hours
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Archive className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
          <h2 className="text-[16px] font-semibold text-[#17243A]">
            Recent Export Artifacts ({jobs.length})
          </h2>
        </div>
        {jobs.length === 0 ? (
          <p className="text-[13.5px] text-[#64748B]">
            No historical export jobs requested yet. Use the Reports page or API to create an
            expiring signed export.
          </p>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="rounded-[8px] border border-[#DFE6F0] bg-[#FFFFFF] px-4 py-3 flex flex-wrap items-center justify-between gap-2"
              >
                <div className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={job.status === "READY" ? "success" : "neutral"}>
                      {job.status}
                    </Badge>
                    <span className="font-medium text-[13.5px] text-[#17243A]">
                      {job.exportType}
                    </span>
                    <span className="font-mono text-[12px] text-[#64748B]">
                      {job.rowCount} rows
                    </span>
                  </div>
                  <p className="font-mono text-[11.5px] text-[#64748B]">
                    SHA-256: {job.checksumSha256.slice(0, 16)}… • Expires {job.expiresAtIso}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export default function WorkspaceExportsPage() {
  return (
    <React.Suspense fallback={<div className="min-h-[480px]" />}>
      <WorkspaceExportsPageContent />
    </React.Suspense>
  );
}
