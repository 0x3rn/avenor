import { Badge, PageHeader } from "@avenor/ui";
import * as React from "react";
import { ReportBuilderView } from "@/components/reports/report-builder-view";
import { listSavedReports } from "@/lib/reports/custom-reports";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

async function WorkspaceReportsPageContent() {
  const { session, governance, projects } = await requireAuthenticatedAppContext();
  const reports = await listSavedReports(session, governance.workspace.id);

  return (
    <div className="space-y-6" data-testid="workspace-reports-page">
      <PageHeader
        breadcrumbs={[
          { label: governance.organization.name },
          { label: governance.workspace.name, href: "/dashboard" },
          { label: "Reports" },
        ]}
        title="Custom Reports & Cross-Project Benchmarking"
        description="Build saved comparison views across authorized products, enforce semantic compatibility rules, and export formula-safe CSV or printable reports with full provenance."
        badges={<Badge tone="indigo">{reports.length} Saved Reports</Badge>}
      />

      <ReportBuilderView projects={projects} initialReports={reports} />
    </div>
  );
}

export default function WorkspaceReportsPage() {
  return (
    <React.Suspense fallback={<div className="min-h-[480px]" />}>
      <WorkspaceReportsPageContent />
    </React.Suspense>
  );
}
