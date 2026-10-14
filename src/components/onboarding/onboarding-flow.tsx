"use client";

import type { WorkspaceGovernanceDetails } from "@avenor/auth";
import type { EnvironmentType, LogicalProjectSummary } from "@avenor/types";
import {
  Badge,
  Button,
  Card,
  FormField,
  PageHeader,
  ProgressIndicator,
  Select,
  StatusIndicator,
  Textarea,
  TextInput,
} from "@avenor/ui";
import { ArrowRight, CheckCircle2, FolderKanban, Globe, Layers, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

export interface OnboardingFlowProps {
  governance: WorkspaceGovernanceDetails;
  onboardingCompletedAt: string | null;
  initialProjects: LogicalProjectSummary[];
}

export function OnboardingFlow({
  governance,
  onboardingCompletedAt,
  initialProjects,
}: OnboardingFlowProps) {
  const router = useRouter();

  // Step 1: Workspace Identity
  const [workspaceName, setWorkspaceName] = React.useState(governance.workspace.name);
  const [timezone, setTimezone] = React.useState(governance.workspace.defaultTimezone);
  const [currency, setCurrency] = React.useState(governance.workspace.defaultCurrency);
  const [savingWorkspace, setSavingWorkspace] = React.useState(false);
  const [workspaceSavedMessage, setWorkspaceSavedMessage] = React.useState<string | null>(null);

  // Step 2: Create Logical Project
  const [projectName, setProjectName] = React.useState("");
  const [projectSlug, setProjectSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [primaryDomain, setPrimaryDomain] = React.useState("");
  const [projectDescription, setProjectDescription] = React.useState("");
  const [includeStaging, setIncludeStaging] = React.useState(true);
  const [includeDevelopment, setIncludeDevelopment] = React.useState(true);
  const [creatingProject, setCreatingProject] = React.useState(false);
  const [projectError, setProjectError] = React.useState<string | null>(null);

  // Step 3: Add / Configure Environment on Selected Project
  const activeProjects = initialProjects.filter((p) => p.status === "ACTIVE");
  const [selectedProjectId, setSelectedProjectId] = React.useState<string>(
    activeProjects[0]?.id ?? "",
  );
  const [envKind, setEnvKind] = React.useState<EnvironmentType>("STAGING");
  const [envName, setEnvName] = React.useState("Staging");
  const [envDomain, setEnvDomain] = React.useState("");
  const [savingEnv, setSavingEnv] = React.useState(false);
  const [envFeedback, setEnvFeedback] = React.useState<string | null>(null);
  const [envError, setEnvError] = React.useState<string | null>(null);

  // Step 4: Complete Onboarding
  const [completingOnboarding, setCompletingOnboarding] = React.useState(false);
  const [completeError, setCompleteError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!selectedProjectId && activeProjects[0]?.id) {
      setSelectedProjectId(activeProjects[0].id);
    }
  }, [activeProjects, selectedProjectId]);

  const selectedProject =
    activeProjects.find((p) => p.id === selectedProjectId) ?? activeProjects[0];

  const hasProject = activeProjects.length > 0;
  const hasMultipleEnvironments = activeProjects.some((p) => p.environments.length >= 2);
  const isCompleted = Boolean(onboardingCompletedAt);

  const steps = [
    {
      id: "workspace",
      title: "Workspace Identity",
      description: "Timezone, currency, and tenant defaults",
      status: "completed" as const,
    },
    {
      id: "project",
      title: "First Logical Product",
      description: "Register your website or application",
      status: hasProject ? ("completed" as const) : ("current" as const),
    },
    {
      id: "environments",
      title: "Environment Matrix",
      description: "Production, Staging & Development tiers",
      status: hasMultipleEnvironments
        ? ("completed" as const)
        : hasProject
          ? ("current" as const)
          : ("upcoming" as const),
    },
    {
      id: "launch",
      title: "Read-Only Boundary",
      description: "Verify scope rules and launch portfolio",
      status: isCompleted
        ? ("completed" as const)
        : hasProject
          ? ("current" as const)
          : ("upcoming" as const),
    },
  ];

  function deriveSlug(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  async function handleSaveWorkspaceIdentity(event: React.FormEvent) {
    event.preventDefault();
    setSavingWorkspace(true);
    setWorkspaceSavedMessage(null);
    try {
      const response = await fetch("/api/workspaces", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: governance.workspace.id,
          name: workspaceName.trim(),
          defaultTimezone: timezone,
          defaultCurrency: currency,
        }),
      });
      if (response.ok) {
        setWorkspaceSavedMessage("Workspace defaults saved.");
        router.refresh();
      }
    } finally {
      setSavingWorkspace(false);
    }
  }

  async function handleCreateFirstProject(event: React.FormEvent) {
    event.preventDefault();
    setProjectError(null);
    if (projectName.trim().length < 2) {
      setProjectError("Enter a logical product name (at least 2 characters).");
      return;
    }

    const initialEnvironments: EnvironmentType[] = ["PRODUCTION"];
    if (includeStaging) {
      initialEnvironments.push("STAGING");
    }
    if (includeDevelopment) {
      initialEnvironments.push("DEVELOPMENT");
    }

    setCreatingProject(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: governance.workspace.id,
          name: projectName.trim(),
          slug: projectSlug.trim() || undefined,
          primaryDomain: primaryDomain.trim() || null,
          description: projectDescription.trim() || null,
          initialEnvironments,
        }),
      });
      const payload = (await response.json()) as {
        project?: { id: string };
        error?: { message?: string };
      };
      if (!response.ok || !payload.project) {
        setProjectError(payload.error?.message ?? "Unable to create logical project.");
        return;
      }

      setProjectName("");
      setProjectSlug("");
      setPrimaryDomain("");
      setProjectDescription("");
      setSelectedProjectId(payload.project.id);
      router.refresh();
    } catch {
      setProjectError("Network error while creating project.");
    } finally {
      setCreatingProject(false);
    }
  }

  async function handleUpsertEnvironment(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedProject) {
      return;
    }
    setEnvError(null);
    setEnvFeedback(null);
    setSavingEnv(true);
    try {
      const existingEnv = selectedProject.environments.find((e) => e.type === envKind);
      const response = existingEnv
        ? await fetch(`/api/projects/${selectedProject.id}/environments`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              environmentId: existingEnv.id,
              name: envName.trim() || undefined,
              primaryDomain: envDomain.trim() || null,
            }),
          })
        : await fetch(`/api/projects/${selectedProject.id}/environments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              environmentType: envKind,
              name: envName.trim() || undefined,
              primaryDomain: envDomain.trim() || null,
            }),
          });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setEnvError(payload.error?.message ?? "Unable to save environment.");
        return;
      }
      setEnvFeedback(`${envKind} environment saved for ${selectedProject.name}.`);
      setEnvDomain("");
      router.refresh();
    } catch {
      setEnvError("Network error while saving environment.");
    } finally {
      setSavingEnv(false);
    }
  }

  async function handleCompleteOnboarding() {
    setCompleteError(null);
    setCompletingOnboarding(true);
    try {
      const response = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        const payload = (await response.json()) as {
          error?: { message?: string };
        };
        setCompleteError(payload.error?.message ?? "Unable to complete onboarding.");
        return;
      }
      window.location.assign("/dashboard");
    } finally {
      setCompletingOnboarding(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={[
          { label: governance.organization.name },
          { label: governance.workspace.name, href: "/dashboard" },
          { label: "Guided Setup" },
        ]}
        title="Signal Atlas Guided Setup"
        description="Structure your workspace, define your first logical digital product, and map Production, Staging, and Development environments before connecting read-only telemetry."
        badges={
          <Badge tone={isCompleted ? "success" : "signal"}>
            {isCompleted ? "Onboarding Completed" : "In Progress"}
          </Badge>
        }
        actions={
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#C7D2E3] bg-[#FFFFFF] px-4 text-[14px] font-medium text-[#17243A] hover:bg-[#F0F4FA]"
          >
            <span>Open Portfolio Overview</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        }
      />

      <Card className="p-5 sm:p-6 bg-[#FFFFFF]">
        <ProgressIndicator steps={steps} />
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left 7 Columns: Interactive Setup Steps */}
        <div className="space-y-6 lg:col-span-7">
          {/* Step 1: Workspace Identity */}
          <Card className="p-5 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wider text-[#5157D9]">
                  Step 01 • Tenant & Reporting Defaults
                </p>
                <h2 className="mt-1 text-[20px] font-semibold text-[#17243A]">
                  Confirm Workspace Reporting Context
                </h2>
                <p className="mt-1 text-[14px] text-[#64748B]">
                  All metric aggregations, date boundaries, and cost summaries in{" "}
                  <strong className="font-medium text-[#17243A]">
                    {governance.workspace.name}
                  </strong>{" "}
                  align to your workspace timezone and currency.
                </p>
              </div>
              <Badge tone="success">Configured</Badge>
            </div>

            <form
              onSubmit={handleSaveWorkspaceIdentity}
              className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-3"
              data-testid="onboarding-workspace-form"
            >
              <FormField id="onboarding-ws-name" label="Workspace name" required>
                <TextInput
                  id="onboarding-ws-name"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  required
                />
              </FormField>

              <FormField id="onboarding-ws-tz" label="Default timezone">
                <Select
                  id="onboarding-ws-tz"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                >
                  <option value="UTC">UTC</option>
                  <option value="America/New_York">America/New_York</option>
                  <option value="America/Los_Angeles">America/Los_Angeles</option>
                  <option value="Europe/London">Europe/London</option>
                  <option value="Europe/Berlin">Europe/Berlin</option>
                  <option value="Asia/Tokyo">Asia/Tokyo</option>
                </Select>
              </FormField>

              <FormField id="onboarding-ws-currency" label="Default currency">
                <Select
                  id="onboarding-ws-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="CAD">CAD ($)</option>
                  <option value="AUD">AUD ($)</option>
                  <option value="JPY">JPY (¥)</option>
                </Select>
              </FormField>

              <div className="sm:col-span-3 flex items-center justify-between gap-3 pt-1">
                {workspaceSavedMessage ? (
                  <span className="text-[13px] font-medium text-[#147D63]">
                    {workspaceSavedMessage}
                  </span>
                ) : (
                  <span className="text-[12px] text-[#64748B]">
                    Organization:{" "}
                    <strong className="font-medium text-[#17243A]">
                      {governance.organization.name}
                    </strong>{" "}
                    ({governance.organization.slug})
                  </span>
                )}
                <Button type="submit" variant="secondary" size="sm" disabled={savingWorkspace}>
                  {savingWorkspace ? "Saving..." : "Update workspace defaults"}
                </Button>
              </div>
            </form>
          </Card>

          {/* Step 2: Create Logical Product */}
          <Card className="p-5 sm:p-6 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wider text-[#5157D9]">
                  Step 02 • Product-Centered Model
                </p>
                <h2 className="mt-1 text-[20px] font-semibold text-[#17243A]">
                  Create a Logical Digital Product
                </h2>
                <p className="mt-1 text-[14px] text-[#64748B]">
                  Avenor organizes intelligence around the websites and applications you run—not
                  scattered third-party dashboards.
                </p>
              </div>
              <Badge tone={hasProject ? "success" : "indigo"}>
                {hasProject ? `${activeProjects.length} Active` : "Action Required"}
              </Badge>
            </div>

            {projectError ? (
              <div
                role="alert"
                className="rounded-[10px] border border-[#BF4256]/30 bg-[#FDECEF] px-3.5 py-2.5 text-[13px] font-medium text-[#BF4256]"
              >
                {projectError}
              </div>
            ) : null}

            <form
              onSubmit={handleCreateFirstProject}
              className="space-y-4"
              data-testid="onboarding-create-project-form"
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  id="onboarding-project-name"
                  label="Product name"
                  required
                  hint="Example: Avenor Marketing Site or Customer Portal."
                >
                  <TextInput
                    id="onboarding-project-name"
                    data-testid="onboarding-project-name-input"
                    value={projectName}
                    onChange={(event) => {
                      const nextName = event.target.value;
                      setProjectName(nextName);
                      if (!slugTouched) {
                        setProjectSlug(deriveSlug(nextName));
                      }
                    }}
                    placeholder="Avenor Web Platform"
                    required
                  />
                </FormField>

                <FormField
                  id="onboarding-project-slug"
                  label="Workspace-scoped slug"
                  hint="Unique within this workspace."
                >
                  <TextInput
                    id="onboarding-project-slug"
                    data-testid="onboarding-project-slug-input"
                    value={projectSlug}
                    onChange={(event) => {
                      setSlugTouched(true);
                      setProjectSlug(event.target.value);
                    }}
                    placeholder="avenor-web-platform"
                  />
                </FormField>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  id="onboarding-project-domain"
                  label="Primary production domain (optional)"
                >
                  <TextInput
                    id="onboarding-project-domain"
                    data-testid="onboarding-project-domain-input"
                    value={primaryDomain}
                    onChange={(event) => setPrimaryDomain(event.target.value)}
                    placeholder="https://avenor.dev"
                  />
                </FormField>

                <div className="space-y-2">
                  <span className="block text-[13px] font-medium text-[#17243A]">
                    Initial environments
                  </span>
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <label className="inline-flex items-center gap-2 text-[13px] text-[#30415D]">
                      <input
                        type="checkbox"
                        checked
                        disabled
                        className="h-4 w-4 rounded accent-[#5157D9]"
                      />
                      <span>Production (Default)</span>
                    </label>
                    <label className="inline-flex items-center gap-2 text-[13px] text-[#30415D]">
                      <input
                        type="checkbox"
                        data-testid="onboarding-env-staging-checkbox"
                        checked={includeStaging}
                        onChange={(e) => setIncludeStaging(e.target.checked)}
                        className="h-4 w-4 rounded accent-[#5157D9]"
                      />
                      <span>Staging</span>
                    </label>
                    <label className="inline-flex items-center gap-2 text-[13px] text-[#30415D]">
                      <input
                        type="checkbox"
                        data-testid="onboarding-env-development-checkbox"
                        checked={includeDevelopment}
                        onChange={(e) => setIncludeDevelopment(e.target.checked)}
                        className="h-4 w-4 rounded accent-[#5157D9]"
                      />
                      <span>Development</span>
                    </label>
                  </div>
                </div>
              </div>

              <FormField id="onboarding-project-description" label="Product summary (optional)">
                <Textarea
                  id="onboarding-project-description"
                  data-testid="onboarding-project-description-input"
                  value={projectDescription}
                  onChange={(event) => setProjectDescription(event.target.value)}
                  placeholder="Core web application, public documentation, and API gateway."
                  rows={2}
                />
              </FormField>

              <div className="flex items-center justify-end">
                <Button
                  type="submit"
                  variant="primary"
                  data-testid="onboarding-create-project-submit"
                  disabled={creatingProject}
                >
                  {creatingProject ? "Provisioning product..." : "Create logical product"}
                </Button>
              </div>
            </form>
          </Card>

          {/* Step 3: Environment Matrix */}
          <Card className="p-5 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wider text-[#5157D9]">
                  Step 03 • Environment Separation
                </p>
                <h2 className="mt-1 text-[20px] font-semibold text-[#17243A]">
                  Verify Production, Staging & Development Environments
                </h2>
                <p className="mt-1 text-[14px] text-[#64748B]">
                  Keep staging and development telemetry strictly separated from production customer
                  traffic and cloud costs.
                </p>
              </div>
              <Badge tone={hasMultipleEnvironments ? "success" : "neutral"}>
                {hasMultipleEnvironments ? "Multi-Env Ready" : "Configurable"}
              </Badge>
            </div>

            {selectedProject ? (
              <form
                onSubmit={handleUpsertEnvironment}
                className="space-y-4 pt-2"
                data-testid="onboarding-environment-form"
              >
                {envError ? (
                  <div
                    role="alert"
                    className="rounded-[10px] border border-[#BF4256]/30 bg-[#FDECEF] px-3.5 py-2.5 text-[13px] font-medium text-[#BF4256]"
                  >
                    {envError}
                  </div>
                ) : null}
                {envFeedback ? (
                  <div className="rounded-[10px] border border-[#147D63]/30 bg-[#E7F6EF] px-3.5 py-2.5 text-[13px] font-medium text-[#147D63]">
                    {envFeedback}
                  </div>
                ) : null}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <FormField id="onboarding-target-project" label="Product">
                    <Select
                      id="onboarding-target-project"
                      value={selectedProject.id}
                      onChange={(e) => setSelectedProjectId(e.target.value)}
                    >
                      {activeProjects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>

                  <FormField id="onboarding-env-kind" label="Environment tier">
                    <Select
                      id="onboarding-env-kind"
                      data-testid="onboarding-env-kind-select"
                      value={envKind}
                      onChange={(e) => {
                        const nextKind = e.target.value as EnvironmentType;
                        setEnvKind(nextKind);
                        setEnvName(
                          nextKind === "PRODUCTION"
                            ? "Production"
                            : nextKind === "STAGING"
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

                  <FormField id="onboarding-env-domain" label="Environment URL (optional)">
                    <TextInput
                      id="onboarding-env-domain"
                      data-testid="onboarding-env-domain-input"
                      value={envDomain}
                      onChange={(e) => setEnvDomain(e.target.value)}
                      placeholder="https://staging.avenor.dev"
                    />
                  </FormField>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px] text-[#64748B]">
                      Current environments on{" "}
                      <strong className="font-medium text-[#17243A]">{selectedProject.name}</strong>
                      :
                    </span>
                    {selectedProject.environments.map((env) => (
                      <Badge key={env.id} tone={env.isDefault ? "indigo" : "neutral"}>
                        {env.type}
                      </Badge>
                    ))}
                  </div>
                  <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    data-testid="onboarding-save-env-button"
                    disabled={savingEnv}
                  >
                    {savingEnv ? "Saving..." : "Save environment"}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="rounded-[12px] border border-[#DFE6F0] bg-[#F7F9FC] p-4 text-[13px] text-[#64748B]">
                Create your first logical product in Step 02 above to configure its `PRODUCTION`,
                `STAGING`, and `DEVELOPMENT` environments.
              </div>
            )}
          </Card>
        </div>

        {/* Right 5 Columns: Portfolio Snapshot & Step 4 Launch */}
        <div className="space-y-6 lg:col-span-5">
          <Card className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[18px] font-semibold text-[#17243A]">
                Provisioned Logical Products
              </h2>
              <span className="text-[13px] font-semibold text-[#5157D9] tabular-nums">
                {activeProjects.length} total
              </span>
            </div>

            {activeProjects.length === 0 ? (
              <div className="rounded-[12px] border border-dashed border-[#C7D2E3] bg-[#F7F9FC] p-5 text-center space-y-2">
                <FolderKanban className="mx-auto h-6 w-6 text-[#64748B]" aria-hidden="true" />
                <p className="text-[14px] font-medium text-[#17243A]">
                  No logical products registered yet
                </p>
                <p className="text-[13px] text-[#64748B]">
                  Use the Step 02 form to register your first website, SaaS application, or API
                  product.
                </p>
              </div>
            ) : (
              <div className="space-y-3" data-testid="onboarding-project-list">
                {activeProjects.map((project) => (
                  <div
                    key={project.id}
                    className="rounded-[12px] border border-[#DFE6F0] bg-[#F7F9FC] p-4 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <Link
                          href={`/projects/${project.id}`}
                          className="text-[15px] font-semibold text-[#17243A] hover:text-[#5157D9]"
                        >
                          {project.name}
                        </Link>
                        <p className="text-[12px] font-mono text-[#64748B]">{project.slug}</p>
                      </div>
                      <Link
                        href={`/projects/${project.id}`}
                        className="text-[12px] font-medium text-[#5157D9] hover:text-[#4047BD]"
                      >
                        Manage →
                      </Link>
                    </div>

                    {project.primaryDomain ? (
                      <div className="flex items-center gap-1.5 text-[12px] text-[#30415D]">
                        <Globe className="h-3.5 w-3.5 text-[#168E99]" />
                        <span>{project.primaryDomain}</span>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <Layers className="h-3.5 w-3.5 text-[#64748B] mr-1" />
                      {project.environments.map((env) => (
                        <Badge key={env.id} tone={env.isDefault ? "indigo" : "neutral"}>
                          {env.type}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Step 4: Read-Only Guarantee & Complete Onboarding */}
          <Card className="p-5 sm:p-6 space-y-4 border-[#CED3FF] bg-[#FFFFFF]">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#E7F6F7] text-[#168E99]">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wider text-[#168E99]">
                  Step 04 • Architectural Boundary
                </p>
                <h2 className="mt-0.5 text-[18px] font-semibold text-[#17243A]">
                  Read-Only Intelligence Ready
                </h2>
              </div>
            </div>

            <ul className="space-y-2 text-[13px] text-[#30415D]">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#147D63]" />
                <span>
                  <strong>Product-centered isolation:</strong> Every workspace, logical product, and
                  environment enforces role-based access control (`OWNER`, `ADMIN`, `ANALYST`,
                  `VIEWER`).
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#147D63]" />
                <span>
                  <strong>No fabricated metrics:</strong> Unconnected external providers explicitly
                  show{" "}
                  <StatusIndicator tone="neutral" label="Not connected" className="inline-flex" />{" "}
                  rather than misleading zero values.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#147D63]" />
                <span>
                  <strong>Immutable audit trail:</strong> Every workspace, project, and environment
                  mutation is recorded transactionally.
                </span>
              </li>
            </ul>

            {completeError ? (
              <div
                role="alert"
                className="rounded-[10px] border border-[#BF4256]/30 bg-[#FDECEF] px-3.5 py-2.5 text-[13px] font-medium text-[#BF4256]"
              >
                {completeError}
              </div>
            ) : null}

            <Button
              type="button"
              variant="primary"
              className="w-full"
              data-testid="complete-onboarding-button"
              onClick={handleCompleteOnboarding}
              disabled={completingOnboarding}
            >
              {completingOnboarding
                ? "Finalizing setup..."
                : "Complete onboarding & open portfolio"}
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
