"use client";

import type { LogicalProjectSummary } from "@avenor/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SearchInput,
  SegmentedControl,
  StatusIndicator,
} from "@avenor/ui";
import { FolderKanban, Globe, Layers, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

export interface ProjectsDirectoryProps {
  workspaceName: string;
  organizationName: string;
  canManageProjects: boolean;
  canArchiveProjects: boolean;
  projects: LogicalProjectSummary[];
}

export function ProjectsDirectory({
  workspaceName,
  organizationName,
  canManageProjects,
  canArchiveProjects,
  projects,
}: ProjectsDirectoryProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<"ACTIVE" | "ARCHIVED" | "ALL">("ACTIVE");
  const [updatingProjectId, setUpdatingProjectId] = React.useState<string | null>(null);

  const activeCount = projects.filter((p) => p.status === "ACTIVE").length;
  const archivedCount = projects.filter((p) => p.status === "ARCHIVED").length;

  const filteredProjects = React.useMemo(() => {
    return projects.filter((project) => {
      if (statusFilter !== "ALL" && project.status !== statusFilter) {
        return false;
      }
      if (!searchQuery.trim()) {
        return true;
      }
      const query = searchQuery.toLowerCase();
      return (
        project.name.toLowerCase().includes(query) ||
        project.slug.toLowerCase().includes(query) ||
        (project.primaryDomain?.toLowerCase().includes(query) ?? false)
      );
    });
  }, [projects, searchQuery, statusFilter]);

  async function handleToggleArchive(project: LogicalProjectSummary) {
    const nextStatus = project.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE";
    setUpdatingProjectId(project.id);
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (response.ok) {
        router.refresh();
      }
    } finally {
      setUpdatingProjectId(null);
    }
  }

  return (
    <div className="space-y-8" data-testid="projects-directory">
      <PageHeader
        breadcrumbs={[
          { label: organizationName },
          { label: workspaceName, href: "/dashboard" },
          { label: "Projects" },
        ]}
        title="Logical Digital Products"
        description="Manage the websites, web applications, and digital services tracked in this workspace, along with their Production, Staging, and Development environment mappings."
        badges={
          <Badge tone="indigo">
            {activeCount} active • {archivedCount} archived
          </Badge>
        }
        actions={
          canManageProjects ? (
            <Link
              href="/projects/new"
              data-testid="projects-new-project-cta"
              className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#5157D9] px-4 text-[14px] font-medium text-white hover:bg-[#4047BD]"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>New Logical Product</span>
            </Link>
          ) : null
        }
      />

      {/* Filter & Search Toolbar */}
      <Card className="p-4 sm:p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <SearchInput
            aria-label="Filter logical products"
            data-testid="projects-search-input"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Filter by product name, slug, or domain..."
          />
        </div>

        <SegmentedControl
          ariaLabel="Filter products by status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "ACTIVE", label: `Active (${activeCount})` },
            { value: "ARCHIVED", label: `Archived (${archivedCount})` },
            { value: "ALL", label: `All (${projects.length})` },
          ]}
        />
      </Card>

      {/* Project Cards List */}
      {filteredProjects.length === 0 ? (
        <EmptyState
          title={
            statusFilter === "ARCHIVED"
              ? "No archived products in this workspace"
              : "No matching logical products found"
          }
          description="Create a logical product to group Production, Staging, and Development environments under a recognizable application identity."
          primaryAction={
            canManageProjects ? (
              <Link
                href="/projects/new"
                className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#5157D9] px-4 text-[14px] font-medium text-white hover:bg-[#4047BD]"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Create Logical Product</span>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4" data-testid="projects-directory-list">
          {filteredProjects.map((project) => (
            <Card
              key={project.id}
              data-testid={`project-card-${project.slug}`}
              className="p-5 sm:p-6 flex flex-col justify-between gap-4 md:flex-row md:items-center"
            >
              <div className="space-y-2 min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <Link
                    href={`/projects/${project.id}`}
                    className="text-[18px] font-semibold text-[#17243A] hover:text-[#5157D9]"
                  >
                    {project.name}
                  </Link>
                  <span className="rounded-[6px] bg-[#F0F4FA] px-2 py-0.5 font-mono text-[12px] text-[#30415D]">
                    {project.slug}
                  </span>
                  <Badge tone={project.status === "ACTIVE" ? "success" : "neutral"}>
                    {project.status}
                  </Badge>
                  <StatusIndicator
                    tone="neutral"
                    label={project.status === "ARCHIVED" ? "Archived" : "Not connected"}
                  />
                </div>

                {project.description ? (
                  <p className="text-[14px] text-[#30415D]">{project.description}</p>
                ) : null}

                <div className="flex flex-wrap items-center gap-3 pt-1 text-[12px] text-[#64748B]">
                  {project.primaryDomain ? (
                    <span className="inline-flex items-center gap-1.5 text-[#30415D]">
                      <Globe className="h-3.5 w-3.5 text-[#168E99]" aria-hidden="true" />
                      <span>{project.primaryDomain}</span>
                    </span>
                  ) : null}

                  <span className="inline-flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-[#5157D9]" aria-hidden="true" />
                    <span className="tabular-nums">
                      {project.environments.length} environments:
                    </span>
                  </span>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {project.environments.map((env) => (
                      <Badge key={env.id} tone={env.isDefault ? "indigo" : "neutral"}>
                        {env.type}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {canArchiveProjects ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid={`toggle-archive-${project.slug}`}
                    disabled={updatingProjectId === project.id}
                    onClick={() => handleToggleArchive(project)}
                  >
                    {updatingProjectId === project.id
                      ? "Updating..."
                      : project.status === "ACTIVE"
                        ? "Archive"
                        : "Restore"}
                  </Button>
                ) : null}

                <Link
                  href={`/projects/${project.id}`}
                  data-testid={`manage-project-${project.slug}`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-[#5157D9] px-3.5 text-[13px] font-medium text-white hover:bg-[#4047BD]"
                >
                  <FolderKanban className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Manage Product</span>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
