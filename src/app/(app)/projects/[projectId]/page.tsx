import { getLogicalProjectById } from "@avenor/auth";
import { type LogicalProjectSummary, roleHasPermission } from "@avenor/types";
import { notFound } from "next/navigation";
import * as React from "react";

import { ProjectDetailView } from "@/components/projects/project-detail-view";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

async function ProjectDetailPageContent({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { session, governance } = await requireAuthenticatedAppContext();

  let project: LogicalProjectSummary;
  try {
    project = await getLogicalProjectById(session, projectId, governance.workspace.id);
  } catch {
    notFound();
  }

  const role = governance.workspace.role;

  return (
    <ProjectDetailView
      workspaceName={governance.workspace.name}
      organizationName={governance.organization.name}
      canUpdateProject={roleHasPermission(role, "project:update")}
      canArchiveProject={roleHasPermission(role, "project:archive")}
      canManageEnvironments={
        roleHasPermission(role, "environment:create") &&
        roleHasPermission(role, "environment:update")
      }
      project={project}
    />
  );
}

export default function ProjectDetailPage({ params }: { params: Promise<{ projectId: string }> }) {
  return (
    <React.Suspense fallback={<div className="min-h-[480px]" />}>
      <ProjectDetailPageContent params={params} />
    </React.Suspense>
  );
}
