import {
  Badge,
  Card,
  EmptyState,
  MetricCard,
  PageHeader,
  SectionHeader,
  StatusIndicator,
} from "@avenor/ui";
import { ArrowRight, Compass, FolderKanban, Globe, Layers, Plus, ShieldCheck } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

async function DashboardPageContent() {
  const { session, governance, projects } = await requireAuthenticatedAppContext();

  const activeProjects = projects.filter((p) => p.status === "ACTIVE");
  const archivedProjects = projects.filter((p) => p.status === "ARCHIVED");
  const totalEnvironments = activeProjects.reduce(
    (sum, project) => sum + project.environments.length,
    0,
  );

  return (
    <div className="space-y-8" data-testid="dashboard-overview">
      <PageHeader
        breadcrumbs={[
          { label: governance.organization.name },
          { label: governance.workspace.name },
        ]}
        title="Portfolio Signal Atlas"
        description="Unified product-centered overview of the logical websites and applications in this workspace, their environment tiers, and read-only telemetry readiness."
        badges={
          <Badge tone="indigo">
            {governance.workspace.defaultTimezone} • {governance.workspace.defaultCurrency}
          </Badge>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              href="/onboarding"
              className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#C7D2E3] bg-[#FFFFFF] px-3.5 text-[14px] font-medium text-[#17243A] hover:bg-[#F0F4FA]"
            >
              <Compass className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
              <span>Guided Setup</span>
            </Link>
            <Link
              href="/projects/new"
              data-testid="dashboard-create-project-cta"
              className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#5157D9] px-4 text-[14px] font-medium text-white hover:bg-[#4047BD]"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>New Logical Product</span>
            </Link>
          </div>
        }
      />

      {/* Onboarding Banner if not completed or zero projects */}
      {!session.user.onboardingCompletedAt || activeProjects.length === 0 ? (
        <Card className="p-5 sm:p-6 border-[#CED3FF] bg-[#ECEEFF]/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge tone="indigo">Onboarding Progress</Badge>
              <span className="text-[13px] font-semibold text-[#17243A]">
                {activeProjects.length === 0
                  ? "Register your first logical digital product"
                  : "Finish guided workspace onboarding"}
              </span>
            </div>
            <p className="text-[13px] text-[#30415D]">
              Define your logical applications and their Production, Staging, and Development
              environments so external read-only signals map cleanly.
            </p>
          </div>
          <Link
            href="/onboarding"
            data-testid="dashboard-continue-onboarding-link"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-[#5157D9] px-3.5 text-[13px] font-medium text-white hover:bg-[#4047BD]"
          >
            <span>Open Guided Setup</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Card>
      ) : null}

      {/* 4-Column Signal Atlas KPI Grid (Real DB counts + Honest Unconnected States) */}
      <section
        aria-label="Workspace portfolio summary metrics"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <MetricCard
          title="Active Logical Products"
          definition="Registered websites, SaaS applications, and digital products in this workspace."
          value={activeProjects.length > 0 ? activeProjects.length : null}
          unit={archivedProjects.length > 0 ? `(${archivedProjects.length} archived)` : "products"}
          state={activeProjects.length > 0 ? "connected_healthy" : "empty_first_use"}
          sourceLabel="Product Registry"
          freshnessLabel="Live PostgreSQL state"
        />

        <MetricCard
          title="Configured Environments"
          definition="Production, Staging, and Development tiers isolated across active products."
          value={totalEnvironments > 0 ? totalEnvironments : null}
          unit="tiers"
          state={totalEnvironments > 0 ? "connected_healthy" : "empty_first_use"}
          sourceLabel="Env Matrix"
          freshnessLabel="Scoped per product"
        />

        <MetricCard
          title="Audience & Search Signals"
          definition="Sessions, organic search queries, clicks, and CTR across mapped properties."
          state="unconnected"
          sourceLabel="GA4 & GSC"
          freshnessLabel="Unlocks in M02–M03"
        />

        <MetricCard
          title="Cloud Cost & Infra Signals"
          definition="Normalized cloud billing spend, database storage, and deployment reliability."
          state="unconnected"
          sourceLabel="Billing & Infra"
          freshnessLabel="Unlocks in M05–M08"
        />
      </section>

      {/* Main 12-Column Grid: 8 Columns Portfolio / 4 Columns Governance & Audit */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left 8 Columns: Logical Product Portfolio */}
        <div className="space-y-4 lg:col-span-8">
          <SectionHeader
            title="Logical Product Portfolio"
            description="Websites, SaaS applications, and digital services tracked in this workspace."
            actions={
              <Link
                href="/projects"
                className="text-[13px] font-medium text-[#5157D9] hover:text-[#4047BD]"
              >
                View all products ({projects.length}) →
              </Link>
            }
          />

          {activeProjects.length === 0 ? (
            <EmptyState
              title="No logical products registered in this workspace"
              description="Create your first logical product to organize Production, Staging, and Development environments under a single product identity."
              primaryAction={
                <Link
                  href="/projects/new"
                  className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#5157D9] px-4 text-[14px] font-medium text-white hover:bg-[#4047BD]"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>Create Logical Product</span>
                </Link>
              }
              secondaryAction={
                <Link
                  href="/onboarding"
                  className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#C7D2E3] bg-[#FFFFFF] px-4 text-[14px] font-medium text-[#17243A] hover:bg-[#F0F4FA]"
                >
                  <span>Guided Setup</span>
                </Link>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4" data-testid="dashboard-projects-list">
              {activeProjects.map((project) => (
                <Card
                  key={project.id}
                  className="p-5 sm:p-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center"
                >
                  <div className="space-y-2 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/projects/${project.id}`}
                        className="text-[17px] font-semibold text-[#17243A] hover:text-[#5157D9]"
                      >
                        {project.name}
                      </Link>
                      <span className="rounded-[6px] bg-[#F0F4FA] px-2 py-0.5 font-mono text-[12px] text-[#30415D]">
                        {project.slug}
                      </span>
                      <StatusIndicator tone="neutral" label="Not connected" />
                    </div>

                    {project.description ? (
                      <p className="text-[14px] text-[#30415D] line-clamp-2">
                        {project.description}
                      </p>
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

                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      href={`/projects/${project.id}`}
                      data-testid={`inspect-project-${project.slug}`}
                      className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-[#C7D2E3] bg-[#FFFFFF] px-3.5 text-[13px] font-medium text-[#17243A] hover:bg-[#F0F4FA]"
                    >
                      <FolderKanban className="h-3.5 w-3.5 text-[#5157D9]" />
                      <span>Inspect product</span>
                    </Link>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Right 4 Columns: Workspace Context & Immutable Audit Trail */}
        <div className="space-y-6 lg:col-span-4">
          <Card className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-semibold text-[#17243A]">
                Workspace Isolation & Governance
              </h2>
              <Badge tone="indigo">{governance.workspace.role}</Badge>
            </div>

            <dl className="space-y-2.5 text-[13px]">
              <div className="flex items-center justify-between border-b border-[#DFE6F0] pb-2">
                <dt className="text-[#64748B]">Organization</dt>
                <dd className="font-medium text-[#17243A]">{governance.organization.name}</dd>
              </div>
              <div className="flex items-center justify-between border-b border-[#DFE6F0] pb-2">
                <dt className="text-[#64748B]">Workspace slug</dt>
                <dd className="font-mono text-[12px] text-[#30415D]">
                  {governance.workspace.slug}
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-[#DFE6F0] pb-2">
                <dt className="text-[#64748B]">Reporting timezone</dt>
                <dd className="font-medium text-[#17243A] tabular-nums">
                  {governance.workspace.defaultTimezone}
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-[#DFE6F0] pb-2">
                <dt className="text-[#64748B]">Reporting currency</dt>
                <dd className="font-medium text-[#17243A] tabular-nums">
                  {governance.workspace.defaultCurrency}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-[#64748B]">Authorized members</dt>
                <dd className="font-medium text-[#17243A] tabular-nums">
                  {governance.members.length}
                </dd>
              </div>
            </dl>

            <div className="rounded-[10px] border border-[#DFE6F0] bg-[#E7F6F7]/50 p-3 text-[12px] text-[#30415D] flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#168E99]" aria-hidden="true" />
              <span>
                External provider write operations are architecturally disabled. Avenor only
                modifies its own workspace, project, and alert metadata.
              </span>
            </div>

            <Link
              href="/settings"
              className="inline-flex w-full items-center justify-center rounded-[10px] border border-[#C7D2E3] bg-[#FFFFFF] py-2 text-[13px] font-medium text-[#17243A] hover:bg-[#F0F4FA]"
            >
              Manage workspace settings
            </Link>
          </Card>

          <Card className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-semibold text-[#17243A]">Recent Audit Ledger</h2>
              <span className="text-[12px] text-[#64748B] tabular-nums">
                {governance.auditLogs.length} events
              </span>
            </div>

            <div className="space-y-3">
              {governance.auditLogs.slice(0, 6).map((log) => (
                <div
                  key={log.id}
                  className="rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC] px-3 py-2.5 text-[12px] space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-[#17243A]">{log.action}</span>
                    <span className="text-[11px] text-[#64748B] tabular-nums">
                      {new Date(log.createdAt).toISOString().slice(0, 16).replace("T", " ")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[#64748B]">
                    <span className="shrink-0">{log.entityType}</span>
                    <span className="truncate">{log.actorEmail ?? "system"}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <React.Suspense fallback={<div className="min-h-[480px]" />}>
      <DashboardPageContent />
    </React.Suspense>
  );
}
