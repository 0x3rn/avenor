import { roleHasPermission } from "@avenor/types";
import * as React from "react";

import { ProjectsDirectory } from "@/components/projects/projects-directory";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

async function ProjectsPageContent() {
  const { governance, projects } = await requireAuthenticatedAppContext();
  const role = governance.workspace.role;

  return (
    <ProjectsDirectory
      workspaceName={governance.workspace.name}
      organizationName={governance.organization.name}
      canManageProjects={roleHasPermission(role, "project:create")}
      canArchiveProjects={roleHasPermission(role, "project:archive")}
      projects={projects}
    />
  );
}

export default function ProjectsPage() {
  return (
    <React.Suspense fallback={<div className="min-h-[480px]" />}>
      <ProjectsPageContent />
    </React.Suspense>
  );
}
