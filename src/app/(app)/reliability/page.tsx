import { Badge, PageHeader } from "@avenor/ui";
import * as React from "react";
import { ReliabilityDashboardView } from "@/components/reliability/reliability-dashboard-view";
import { listWorkspaceReliabilitySnapshot } from "@/lib/reliability/uptime";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

async function WorkspaceReliabilityPageContent() {
  const { session, governance, projects } = await requireAuthenticatedAppContext();
  const snapshot = await listWorkspaceReliabilitySnapshot(session);

  return (
    <div className="space-y-6" data-testid="workspace-reliability-page">
      <PageHeader
        breadcrumbs={[
          { label: governance.organization.name },
          { label: governance.workspace.name, href: "/dashboard" },
          { label: "Hosting & Reliability" },
        ]}
        title="Hosting, Availability & Incident Reliability"
        description="Monitor authorized public HTTPS endpoints with SSRF/DNS-rebinding protection and review confirmed availability incidents across your workspace products."
        badges={<Badge tone="indigo">{snapshot.monitors.length} Active Monitors</Badge>}
      />

      <ReliabilityDashboardView
        projects={projects}
        initialMonitors={snapshot.monitors}
        initialIncidents={snapshot.incidents}
        singleRegionCaveat={snapshot.singleRegionCaveat}
      />
    </div>
  );
}

export default function WorkspaceReliabilityPage() {
  return (
    <React.Suspense fallback={<div className="min-h-[480px]" />}>
      <WorkspaceReliabilityPageContent />
    </React.Suspense>
  );
}
