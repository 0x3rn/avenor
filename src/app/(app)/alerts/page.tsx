import * as React from "react";
import { AlertsInboxView } from "@/components/alerts/alerts-inbox-view";
import { listWorkspaceAlertsAndNotifications } from "@/lib/alerts/service";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

async function AlertsPageContent() {
  const { session, governance } = await requireAuthenticatedAppContext();
  const data = await listWorkspaceAlertsAndNotifications(session, governance.workspace.id);

  return (
    <AlertsInboxView
      workspaceName={governance.workspace.name}
      organizationName={governance.organization.name}
      initialRules={data.rules}
      initialIncidents={data.incidents}
      initialNotifications={data.notifications}
      initialDeliveries={data.deliveries}
      initialPreferences={data.preferences}
    />
  );
}

export default function AlertsPage() {
  return (
    <React.Suspense fallback={<div className="min-h-[480px]" />}>
      <AlertsPageContent />
    </React.Suspense>
  );
}
