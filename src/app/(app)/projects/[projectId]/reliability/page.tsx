import { getLogicalProjectById } from "@avenor/auth";
import { Badge, PageHeader } from "@avenor/ui";
import { notFound } from "next/navigation";
import * as React from "react";
import { ReliabilityDashboardView } from "@/components/reliability/reliability-dashboard-view";
import { listWorkspaceReliabilitySnapshot } from "@/lib/reliability/uptime";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

async function ProjectReliabilityPageContent({ projectId }: { projectId: string }) {
  const { session, governance, projects } = await requireAuthenticatedAppContext();
  const project = await getLogicalProjectById(session, projectId);
  if (!project) {
    notFound();
  }
  const snapshot = await listWorkspaceReliabilitySnapshot(session, { projectId });

  return (
    <div className="space-y-6" data-testid="project-reliability-page">
      <PageHeader
        breadcrumbs={[
          { label: governance.workspace.name, href: "/dashboard" },
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${project.id}` },
          { label: "Reliability" },
        ]}
        title={`${project.name} — Reliability & Uptime`}
        description="Authorized public HTTPS monitors, noise-resistant incident detection, and operational event context for this digital product."
        badges={<Badge tone="indigo">{snapshot.monitors.length} Monitors</Badge>}
      />

      <ReliabilityDashboardView
        projects={projects}
        initialMonitors={snapshot.monitors}
        initialIncidents={snapshot.incidents}
        singleRegionCaveat={snapshot.singleRegionCaveat}
        fixedProjectId={project.id}
      />
    </div>
  );
}

export default async function ProjectReliabilityPage(props: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await props.params;
  return (
    <React.Suspense fallback={<div className="min-h-[480px]" />}>
      <ProjectReliabilityPageContent projectId={projectId} />
    </React.Suspense>
  );
}
