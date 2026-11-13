import { Badge, Button, EmptyState, PageHeader } from "@avenor/ui";
import { FolderKanban } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { SearchReportView } from "@/components/reports/search-report-view";
import { getProjectSearchConsoleTelemetry } from "@/lib/reports/search-console-service";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

async function SearchVisibilityPageContent({
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
      <div className="space-y-8" data-testid="search-no-projects-page">
        <PageHeader
          breadcrumbs={[
            { label: governance.organization.name },
            { label: governance.workspace.name, href: "/dashboard" },
            { label: "Search Visibility" },
          ]}
          title="Search Visibility & SEO Intelligence"
          description="Google Search Console organic clicks, impressions, weighted CTR, and impression-weighted ranking positions reported in fixed Pacific Time."
          badges={<Badge tone="read-only">Read-Only Search Console v3</Badge>}
        />
        <EmptyState
          title="Create a logical project first"
          description="Map verified sc-domain or URL-prefix properties to a logical product before inspecting search queries."
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

  const telemetry = await getProjectSearchConsoleTelemetry(session, selectedProject.id, {
    environmentId: query.environmentId ?? null,
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
          { label: "Search Visibility" },
        ]}
        title="Search Visibility & SEO Intelligence"
        description="Search Console Clicks, Impressions, weighted CTR, and average ranking position across queries, pages, countries, and devices—never conflated with GA4 Sessions."
        badges={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="read-only">Search Console Read-Only</Badge>
            <Badge tone="neutral">America/Los_Angeles • 48–72h Lag</Badge>
          </div>
        }
        actions={
          <Link href={`/projects/${selectedProject.id}/audience`}>
            <Button type="button" variant="secondary" size="sm">
              View Audience & Traffic →
            </Button>
          </Link>
        }
      />

      <SearchReportView
        projects={activeProjects}
        initialTelemetry={telemetry.payload}
        initialEnvironmentId={query.environmentId ?? ""}
      />
    </div>
  );
}

export default function SearchPage(props: {
  searchParams: Promise<{ projectId?: string; environmentId?: string }>;
}) {
  return (
    <React.Suspense fallback={<div className="min-h-[480px]" />}>
      <SearchVisibilityPageContent searchParams={props.searchParams} />
    </React.Suspense>
  );
}
