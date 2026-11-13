import { Badge, Button, EmptyState, PageHeader } from "@avenor/ui";
import { FolderKanban } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { TrafficReportView } from "@/components/reports/traffic-report-view";
import { getProjectGa4StandardTelemetry } from "@/lib/reports/ga4-service";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

async function AudiencePageContent({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; environmentId?: string }>;
}) {
  const [{ session, governance, projects }, query] = await Promise.all([
    requireAuthenticatedAppContext(),
    searchParams,
  ]);

  const activeProjects = projects.filter((p) => p.status === "ACTIVE");
  const selectedProject =
    activeProjects.find((p) => p.id === query.projectId) ?? activeProjects[0] ?? null;

  if (!selectedProject) {
    return (
      <div className="space-y-8" data-testid="audience-no-projects-page">
        <PageHeader
          breadcrumbs={[
            { label: governance.organization.name },
            { label: governance.workspace.name, href: "/dashboard" },
            { label: "Audience & Traffic" },
          ]}
          title="Audience & Traffic Intelligence"
          description="Google Analytics 4 overview, channel acquisition, landing pages, devices, geography, and rolling 30-minute realtime estimation scoped to your logical products."
          badges={<Badge tone="read-only">Read-Only GA4 Data API</Badge>}
        />
        <EmptyState
          title="Create a logical project first"
          description="GA4 properties are scoped to logical digital products and environment tiers (Production, Staging, Development)."
          icon={<FolderKanban className="h-5 w-5" aria-hidden="true" />}
          primaryAction={
            <Link href="/projects/new">
              <Button type="button" variant="primary">
                Create Logical Product
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  const telemetry = await getProjectGa4StandardTelemetry(session, selectedProject.id, {
    environmentId: query.environmentId ?? null,
    preset: "28d",
    compare: true,
    includeRealtime: true,
  });

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={[
          { label: governance.organization.name },
          { label: governance.workspace.name, href: "/dashboard" },
          { label: "Audience & Traffic" },
        ]}
        title="Audience & Traffic Intelligence"
        description="Read-only Google Analytics 4 traffic trends, channels, landing pages, key events, and rolling 30-minute realtime estimates in each property's configured timezone."
        badges={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="read-only">GA4 Read-Only</Badge>
            <Badge tone="indigo">Non-Additive Users Preserved</Badge>
          </div>
        }
        actions={
          <Link href={`/projects/${selectedProject.id}/search`}>
            <Button type="button" variant="secondary" size="sm">
              Compare with Search Visibility →
            </Button>
          </Link>
        }
      />

      <TrafficReportView
        projects={activeProjects}
        initialTelemetry={telemetry.payload}
        initialEnvironmentId={query.environmentId ?? ""}
      />
    </div>
  );
}

export default function AudiencePage(props: {
  searchParams: Promise<{ projectId?: string; environmentId?: string }>;
}) {
  return (
    <React.Suspense fallback={<div className="min-h-[480px]" />}>
      <AudiencePageContent searchParams={props.searchParams} />
    </React.Suspense>
  );
}
