import { Badge, PageHeader } from "@avenor/ui";
import * as React from "react";
import { ConnectionsConsole } from "@/components/connections/connections-console";
import { listWorkspaceConnections } from "@/lib/connections";
import { PROVIDER_CATALOG } from "@/lib/providers";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

async function ConnectionsPageContent() {
  const { session, governance, projects } = await requireAuthenticatedAppContext();
  const activeProjects = projects.filter((p) => p.status === "ACTIVE");
  const { connections, canManageConnections } = await listWorkspaceConnections(
    session,
    governance.workspace.id,
  );

  return (
    <div className="space-y-8" data-testid="connections-readiness-page">
      <PageHeader
        breadcrumbs={[
          { label: governance.organization.name },
          { label: governance.workspace.name, href: "/dashboard" },
          { label: "Connections" },
        ]}
        title="Read-Only Provider Connections"
        description="Connect analytics, search, and engineering platforms using strictly scoped viewer credentials. Credentials are sealed in Avenor’s AES-256-GCM vault and mapped directly to your logical products and environments."
        badges={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="read-only">Read-Only Architecture</Badge>
            <Badge tone="indigo">PKCE S256 + AES-256-GCM Vault</Badge>
          </div>
        }
      />

      <ConnectionsConsole
        workspaceId={governance.workspace.id}
        workspaceName={governance.workspace.name}
        userRole={session.activeWorkspace.role}
        canManageConnections={canManageConnections}
        catalog={PROVIDER_CATALOG}
        initialConnections={connections}
        projects={activeProjects}
      />
    </div>
  );
}

export default function ConnectionsPage() {
  return (
    <React.Suspense fallback={<div className="min-h-[480px]" />}>
      <ConnectionsPageContent />
    </React.Suspense>
  );
}
