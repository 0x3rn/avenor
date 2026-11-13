import { Badge, Button, PageHeader } from "@avenor/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import * as React from "react";
import { TrafficReportView } from "@/components/reports/traffic-report-view";
import { getProjectGa4StandardTelemetry } from "@/lib/reports/ga4-service";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

async function ProjectAudiencePageContent({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ environmentId?: string }>;
}) {
  const [{ session, governance, projects }, resolvedParams, resolvedQuery] = await Promise.all([
    requireAuthenticatedAppContext(),
    params,
    searchParams,
  ]);

  const project = projects.find((p) => p.id === resolvedParams.projectId);
  if (!project) {
    notFound();
  }

  const telemetry = await getProjectGa4StandardTelemetry(session, project.id, {
    environmentId: resolvedQuery.environmentId ?? null,
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
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${project.id}` },
          { label: "Audience & Traffic" },
        ]}
        title={`${project.name} — Audience & Traffic`}
        description="Read-only Google Analytics 4 standard telemetry and 30-minute rolling realtime estimation scoped specifically to this logical product."
        badges={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="read-only">GA4 Read-Only</Badge>
            <Badge tone="neutral">{project.slug}</Badge>
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/projects/${project.id}/search`}>
              <Button type="button" variant="secondary" size="sm">
                Search Visibility →
              </Button>
            </Link>
            <Link href={`/projects/${project.id}`}>
              <Button type="button" variant="subtle" size="sm">
                Back to Product
              </Button>
            </Link>
          </div>
        }
      />

      <TrafficReportView
        projects={projects.filter((p) => p.status === "ACTIVE")}
        initialTelemetry={telemetry.payload}
        initialEnvironmentId={resolvedQuery.environmentId ?? ""}
      />
    </div>
  );
}

export default function ProjectAudiencePage(props: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ environmentId?: string }>;
}) {
  return (
    <React.Suspense fallback={<div className="min-h-[480px]" />}>
      <ProjectAudiencePageContent params={props.params} searchParams={props.searchParams} />
    </React.Suspense>
  );
}
