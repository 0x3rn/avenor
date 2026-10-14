import { roleHasPermission } from "@avenor/types";
import * as React from "react";

import { WorkspaceSettingsView } from "@/components/settings/workspace-settings-view";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

async function SettingsPageContent() {
  const { governance } = await requireAuthenticatedAppContext();

  return (
    <WorkspaceSettingsView
      governance={governance}
      canUpdateWorkspace={roleHasPermission(governance.workspace.role, "workspace:update")}
    />
  );
}

export default function SettingsPage() {
  return (
    <React.Suspense fallback={<div className="min-h-[480px]" />}>
      <SettingsPageContent />
    </React.Suspense>
  );
}
