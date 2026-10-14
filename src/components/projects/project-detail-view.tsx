"use client";

import type { EnvironmentType, LogicalProjectSummary } from "@avenor/types";
import {
  Badge,
  Button,
  Card,
  Dialog,
  FormField,
  MetricCard,
  PageHeader,
  SegmentedControl,
  Select,
  StatusIndicator,
  Textarea,
  TextInput,
  WarningBanner,
} from "@avenor/ui";
import { Globe, Layers, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

export interface ProjectDetailViewProps {
  workspaceName: string;
  organizationName: string;
  canUpdateProject: boolean;
  canArchiveProject: boolean;
  canManageEnvironments: boolean;
  project: LogicalProjectSummary;
}

export function ProjectDetailView({
  workspaceName,
  organizationName,
  canUpdateProject,
  canArchiveProject,
  canManageEnvironments,
  project,
}: ProjectDetailViewProps) {
  const router = useRouter();

  const defaultEnvKind =
    project.environments.find((e) => e.isDefault)?.type ??
    project.environments[0]?.type ??
    "PRODUCTION";

  const [selectedEnvKind, setSelectedEnvKind] = React.useState<EnvironmentType>(defaultEnvKind);

  // Edit Project Metadata state
  const [name, setName] = React.useState(project.name);
  const [slug, setSlug] = React.useState(project.slug);
  const [primaryDomain, setPrimaryDomain] = React.useState(project.primaryDomain ?? "");
  const [description, setDescription] = React.useState(project.description ?? "");
  const [savingProject, setSavingProject] = React.useState(false);
  const [projectFeedback, setProjectFeedback] = React.useState<string | null>(null);
  const [projectError, setProjectError] = React.useState<string | null>(null);

  // Upsert Environment state
  const [envKind, setEnvKind] = React.useState<EnvironmentType>("STAGING");
  const [envName, setEnvName] = React.useState("Staging");
  const [envDomain, setEnvDomain] = React.useState("");
  const [envDefault, setEnvDefault] = React.useState(false);
  const [savingEnv, setSavingEnv] = React.useState(false);
  const [envFeedback, setEnvFeedback] = React.useState<string | null>(null);
  const [envError, setEnvError] = React.useState<string | null>(null);

  // Archive Confirmation Dialog
  const [archiveDialogOpen, setArchiveDialogOpen] = React.useState(false);
  const [togglingArchive, setTogglingArchive] = React.useState(false);

  React.useEffect(() => {
    setName(project.name);
    setSlug(project.slug);
    setPrimaryDomain(project.primaryDomain ?? "");
    setDescription(project.description ?? "");
  }, [project]);

  const activeEnvironment =
    project.environments.find((env) => env.type === selectedEnvKind) ?? project.environments[0];

  async function handleSaveProject(event: React.FormEvent) {
    event.preventDefault();
    setProjectError(null);
    setProjectFeedback(null);
    if (name.trim().length < 2) {
      setProjectError("Product name must be at least 2 characters.");
      return;
    }

    setSavingProject(true);
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          primaryDomain: primaryDomain.trim() || null,
          description: description.trim() || null,
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setProjectError(payload.error?.message ?? "Unable to update logical product.");
        return;
      }
      setProjectFeedback("Product metadata saved.");
      router.refresh();
    } catch {
      setProjectError("Network error while saving product metadata.");
    } finally {
      setSavingProject(false);
    }
  }

  async function handleSaveEnvironment(event: React.FormEvent) {
    event.preventDefault();
    setEnvError(null);
    setEnvFeedback(null);
    setSavingEnv(true);
    try {
      const existingEnv = project.environments.find((e) => e.type === envKind);
      const response = existingEnv
        ? await fetch(`/api/projects/${project.id}/environments`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              environmentId: existingEnv.id,
              name: envName.trim() || undefined,
              primaryDomain: envDomain.trim() || null,
              isDefault: envDefault,
            }),
          })
        : await fetch(`/api/projects/${project.id}/environments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              environmentType: envKind,
              name: envName.trim() || undefined,
              primaryDomain: envDomain.trim() || null,
              isDefault: envDefault,
            }),
          });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setEnvError(payload.error?.message ?? "Unable to save environment.");
        return;
      }
      setEnvFeedback(`${envKind} environment saved.`);
      setSelectedEnvKind(envKind);
      setEnvDomain("");
      setEnvDefault(false);
      router.refresh();
    } catch {
      setEnvError("Network error while saving environment.");
    } finally {
      setSavingEnv(false);
    }
  }

  async function handleArchiveStatusChange(nextStatus: "ACTIVE" | "ARCHIVED") {
    setTogglingArchive(true);
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (response.ok) {
        setArchiveDialogOpen(false);
        router.refresh();
      }
    } finally {
      setTogglingArchive(false);
    }
  }

  return (
    <div className="space-y-8" data-testid="project-detail-view">
      <PageHeader
        breadcrumbs={[
          { label: organizationName },
          { label: workspaceName, href: "/dashboard" },
          { label: "Projects", href: "/projects" },
          { label: project.name },
        ]}
        title={project.name}
        description={
          project.description ||
          "Logical digital product grouping Production, Staging, and Development environments."
        }
        badges={
          <div className="flex items-center gap-2">
            <span className="rounded-[6px] bg-[#F0F4FA] px-2 py-0.5 font-mono text-[12px] text-[#30415D]">
              {project.slug}
            </span>
            <Badge tone={project.status === "ACTIVE" ? "success" : "neutral"}>
              {project.status}
            </Badge>
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            {project.primaryDomain ? (
              <span className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-[#DFE6F0] bg-[#FFFFFF] px-3.5 text-[13px] font-medium text-[#30415D]">
                <Globe className="h-4 w-4 text-[#168E99]" aria-hidden="true" />
                <span>{project.primaryDomain}</span>
              </span>
            ) : null}

            {canArchiveProject ? (
              project.status === "ACTIVE" ? (
                <Button
                  type="button"
                  variant="secondary"
                  data-testid="project-archive-button"
                  onClick={() => setArchiveDialogOpen(true)}
                >
                  Archive Product
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  data-testid="project-restore-button"
                  disabled={togglingArchive}
                  onClick={() => handleArchiveStatusChange("ACTIVE")}
                >
                  {togglingArchive ? "Restoring..." : "Restore Product"}
                </Button>
              )
            ) : null}
          </div>
        }
      />

      {project.status === "ARCHIVED" ? (
        <WarningBanner
          tone="warning"
          title="This logical product is currently archived"
          description="Archived products remain preserved in your workspace audit ledger and can be restored to active portfolio monitoring at any time."
        />
      ) : null}

      {/* Environment Context Bar */}
      <Card className="p-4 sm:p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
            <span className="text-[14px] font-semibold text-[#17243A]">
              Active Environment Lens: {activeEnvironment?.name ?? selectedEnvKind}
            </span>
            {activeEnvironment?.isDefault ? <Badge tone="indigo">Default Tier</Badge> : null}
          </div>
          <p className="text-[13px] text-[#64748B]">
            {activeEnvironment?.primaryDomain
              ? `Environment URL: ${activeEnvironment.primaryDomain}`
              : "No dedicated environment domain configured yet."}
          </p>
        </div>

        <SegmentedControl
          ariaLabel="Switch active environment lens"
          value={selectedEnvKind}
          onChange={setSelectedEnvKind}
          options={project.environments.map((env) => ({
            value: env.type,
            label: env.type,
          }))}
        />
      </Card>

      {/* Environment Signal Atlas Readiness (4 KPI Cards in Honest Unconnected State) */}
      <section
        aria-label={`Environment telemetry readiness for ${selectedEnvKind}`}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <MetricCard
          title={`${selectedEnvKind} Audience`}
          definition="Sessions, users, and traffic acquisition for this environment."
          state="unconnected"
          sourceLabel="GA4"
          freshnessLabel="Map GA4 in Milestone 03"
        />
        <MetricCard
          title={`${selectedEnvKind} Search Visibility`}
          definition="Organic search impressions, clicks, and average ranking position."
          state="unconnected"
          sourceLabel="Search Console"
          freshnessLabel="Map GSC in Milestone 03"
        />
        <MetricCard
          title={`${selectedEnvKind} Cloud Spend`}
          definition="Attributed cloud billing spend and daily cost anomalies."
          state="unconnected"
          sourceLabel="Cloud Billing"
          freshnessLabel="Map BigQuery in Milestone 05"
        />
        <MetricCard
          title={`${selectedEnvKind} Reliability`}
          definition="Database storage, compute health, and deployment outcomes."
          state="unconnected"
          sourceLabel="Infra & DBs"
          freshnessLabel="Map adapters in M06–M08"
        />
      </section>

      {/* 12-Column Management Grid: 6 Columns Environments / 6 Columns Product Metadata */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left 6 Columns: Environment Management */}
        <Card
          className="p-5 sm:p-6 space-y-5 lg:col-span-6"
          data-testid="environment-management-card"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-[18px] font-semibold text-[#17243A]">
                Environment Tiers ({project.environments.length})
              </h2>
              <p className="mt-0.5 text-[13px] text-[#64748B]">
                Each logical product supports Production, Staging, and Development tiers so
                non-production traffic never pollutes executive reports.
              </p>
            </div>
          </div>

          <div className="space-y-2.5" data-testid="project-environments-list">
            {project.environments.map((env) => (
              <div
                key={env.id}
                data-testid={`environment-row-${env.type}`}
                className="flex items-center justify-between gap-3 rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC] px-3.5 py-2.5"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-[#17243A]">{env.name}</span>
                    <Badge tone={env.isDefault ? "indigo" : "neutral"}>{env.type}</Badge>
                    {env.isDefault ? <Badge tone="signal">Default</Badge> : null}
                  </div>
                  <p className="truncate text-[12px] text-[#64748B]">
                    {env.primaryDomain || "No environment-specific URL assigned"}
                  </p>
                </div>
                <StatusIndicator tone="neutral" label="Not connected" />
              </div>
            ))}
          </div>

          {canManageEnvironments ? (
            <form
              onSubmit={handleSaveEnvironment}
              className="space-y-4 border-t border-[#DFE6F0] pt-4"
              data-testid="project-environment-form"
            >
              <p className="text-[14px] font-semibold text-[#17243A]">
                Add or Update Environment Tier
              </p>

              {envError ? (
                <div
                  role="alert"
                  className="rounded-[10px] border border-[#BF4256]/30 bg-[#FDECEF] px-3.5 py-2.5 text-[13px] font-medium text-[#BF4256]"
                >
                  {envError}
                </div>
              ) : null}
              {envFeedback ? (
                <div
                  data-testid="environment-feedback"
                  className="rounded-[10px] border border-[#147D63]/30 bg-[#E7F6EF] px-3.5 py-2.5 text-[13px] font-medium text-[#147D63]"
                >
                  {envFeedback}
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField id="detail-env-kind" label="Environment kind">
                  <Select
                    id="detail-env-kind"
                    data-testid="detail-env-kind-select"
                    value={envKind}
                    onChange={(event) => {
                      const next = event.target.value as EnvironmentType;
                      setEnvKind(next);
                      setEnvName(
                        next === "PRODUCTION"
                          ? "Production"
                          : next === "STAGING"
                            ? "Staging"
                            : "Development",
                      );
                    }}
                  >
                    <option value="PRODUCTION">PRODUCTION</option>
                    <option value="STAGING">STAGING</option>
                    <option value="DEVELOPMENT">DEVELOPMENT</option>
                  </Select>
                </FormField>

                <FormField id="detail-env-name" label="Display label">
                  <TextInput
                    id="detail-env-name"
                    data-testid="detail-env-name-input"
                    value={envName}
                    onChange={(event) => setEnvName(event.target.value)}
                    placeholder="Staging"
                  />
                </FormField>
              </div>

              <FormField id="detail-env-domain" label="Environment URL (optional)">
                <TextInput
                  id="detail-env-domain"
                  data-testid="detail-env-domain-input"
                  value={envDomain}
                  onChange={(event) => setEnvDomain(event.target.value)}
                  placeholder="https://staging.avenor.dev"
                />
              </FormField>

              <div className="flex items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-[13px] text-[#30415D]">
                  <input
                    type="checkbox"
                    checked={envDefault}
                    onChange={(e) => setEnvDefault(e.target.checked)}
                    className="h-4 w-4 rounded accent-[#5157D9]"
                  />
                  <span>Make default environment for this product</span>
                </label>

                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  data-testid="detail-save-env-button"
                  disabled={savingEnv}
                >
                  {savingEnv ? "Saving..." : "Save Environment"}
                </Button>
              </div>
            </form>
          ) : null}
        </Card>

        {/* Right 6 Columns: Edit Logical Product Metadata */}
        <Card className="p-5 sm:p-6 space-y-5 lg:col-span-6" data-testid="edit-project-card">
          <div>
            <h2 className="text-[18px] font-semibold text-[#17243A]">Logical Product Identity</h2>
            <p className="mt-0.5 text-[13px] text-[#64748B]">
              Update Avenor-owned product metadata, workspace-local slug, and canonical domain.
            </p>
          </div>

          <form onSubmit={handleSaveProject} className="space-y-4" data-testid="edit-project-form">
            {projectError ? (
              <div
                role="alert"
                className="rounded-[10px] border border-[#BF4256]/30 bg-[#FDECEF] px-3.5 py-2.5 text-[13px] font-medium text-[#BF4256]"
              >
                {projectError}
              </div>
            ) : null}
            {projectFeedback ? (
              <div
                data-testid="edit-project-feedback"
                className="rounded-[10px] border border-[#147D63]/30 bg-[#E7F6EF] px-3.5 py-2.5 text-[13px] font-medium text-[#147D63]"
              >
                {projectFeedback}
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField id="edit-project-name" label="Product name" required>
                <TextInput
                  id="edit-project-name"
                  data-testid="edit-project-name-input"
                  value={name}
                  disabled={!canUpdateProject}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </FormField>

              <FormField id="edit-project-slug" label="Workspace-scoped slug" required>
                <TextInput
                  id="edit-project-slug"
                  data-testid="edit-project-slug-input"
                  value={slug}
                  disabled={!canUpdateProject}
                  onChange={(e) => setSlug(e.target.value)}
                  required
                />
              </FormField>
            </div>

            <FormField id="edit-project-domain" label="Primary production domain">
              <TextInput
                id="edit-project-domain"
                data-testid="edit-project-domain-input"
                value={primaryDomain}
                disabled={!canUpdateProject}
                onChange={(e) => setPrimaryDomain(e.target.value)}
                placeholder="https://avenor.dev"
              />
            </FormField>

            <FormField id="edit-project-description" label="Product description">
              <Textarea
                id="edit-project-description"
                data-testid="edit-project-description-input"
                value={description}
                disabled={!canUpdateProject}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </FormField>

            <div className="flex items-center justify-between gap-3 pt-1">
              <Link
                href="/connections"
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#168E99] hover:underline"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                <span>Inspect read-only connector rules</span>
              </Link>

              {canUpdateProject ? (
                <Button
                  type="submit"
                  variant="primary"
                  data-testid="edit-project-submit"
                  disabled={savingProject}
                >
                  {savingProject ? "Saving changes..." : "Save Product Changes"}
                </Button>
              ) : null}
            </div>
          </form>
        </Card>
      </div>

      {/* Archive Confirmation Modal Dialog */}
      <Dialog
        open={archiveDialogOpen}
        onClose={() => setArchiveDialogOpen(false)}
        title={`Archive ${project.name}?`}
        description="Archiving hides this logical product from active portfolio KPI counts while preserving its environment mappings and audit trail. No external provider resources are modified."
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setArchiveDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive-avenor-only"
              data-testid="confirm-archive-project-button"
              disabled={togglingArchive}
              onClick={() => handleArchiveStatusChange("ARCHIVED")}
            >
              {togglingArchive ? "Archiving..." : "Confirm Archive"}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-[#30415D]">
          You can restore <strong className="font-semibold text-[#17243A]">{project.name}</strong>{" "}
          to `ACTIVE` status at any time from the Projects directory or this detail page.
        </p>
      </Dialog>
    </div>
  );
}
