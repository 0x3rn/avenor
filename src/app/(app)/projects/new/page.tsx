import * as React from "react";

import { CreateProjectForm } from "@/components/projects/create-project-form";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

async function NewProjectPageContent() {
  const { governance } = await requireAuthenticatedAppContext();
  return (
    <CreateProjectForm
      workspaceId={governance.workspace.id}
      workspaceName={governance.workspace.name}
      organizationName={governance.organization.name}
    />
  );
}

export default function NewProjectPage() {
  return (
    <React.Suspense fallback={<div className="min-h-[480px]" />}>
      <NewProjectPageContent />
    </React.Suspense>
  );
}
