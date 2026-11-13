import { Badge, Button, PageHeader } from "@avenor/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import * as React from "react";
import { SearchReportView } from "@/components/reports/search-report-view";
import { getProjectSearchConsoleTelemetry } from "@/lib/reports/search-console-service";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

async function ProjectSearchPageContent({
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

  const telemetry = await getProjectSearchConsoleTelemetry(session, project.id, {
    environmentId: resolvedQuery.environmentId ?? null,
    preset: "28d",
    compare: true,
    searchType: "WEB",
    dataState: "final",
  });

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={[
          { label: governance.organization.name },
          { label: governance.workspace.name, href: "/dashboard" },
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${project.id}` },
          { label: "Search Visibility" },
        ]}
        title={`${project.name} — Search Visibility & SEO`}
        description="Google Search Console Search Analytics performance, privacy anonymization coverage, Pacific Time lag notices, and GA4 vs GSC semantic reconciliation."
        badges={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="read-only">Search Console Read-Only</Badge>
            <Badge tone="neutral">{project.slug}</Badge>
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/projects/${project.id}/audience`}>
              <Button type="button" variant="secondary" size="sm">
                Audience & Traffic →
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

      <SearchReportView
        projects={projects.filter((p) => p.status === "ACTIVE")}
        initialTelemetry={telemetry.payload}
        initialEnvironmentId={resolvedQuery.environmentId ?? ""}
      />
    </div>
  );
}

export default function ProjectSearchPage(props: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ environmentId?: string }>;
}) {
  return (
    <React.Suspense fallback={<div className="min-h-[480px]" />}>
      <ProjectSearchPageContent params={props.params} searchParams={props.searchParams} />
    </React.Suspense>
  );
}
