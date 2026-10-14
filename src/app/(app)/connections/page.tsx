import { Badge, Card, PageHeader, SectionHeader, StatusIndicator } from "@avenor/ui";
import { CheckCircle2, Lock, ShieldCheck, XCircle } from "lucide-react";
import * as React from "react";

import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

const PLANNED_CONNECTORS = [
  {
    name: "Google Analytics 4",
    category: "Audience & Acquisition",
    milestone: "M02–M03",
    scope: "analytics.readonly",
    boundary:
      "Reads property metadata, sessions, active users, channels, and conversion events. Never creates or modifies GA4 streams or configurations.",
  },
  {
    name: "Google Search Console",
    category: "Organic Search Visibility",
    milestone: "M02–M03",
    scope: "webmasters.readonly",
    boundary:
      "Reads search queries, impressions, clicks, CTR, and average position. Never submits sitemaps or modifies site ownership.",
  },
  {
    name: "Google Cloud Billing (BigQuery Export)",
    category: "Cloud Spend & FinOps",
    milestone: "M05",
    scope: "bigquery.readonly (scoped billing dataset)",
    boundary:
      "Reads billing export rows for cost attribution and budget alerts. Never modifies cloud resources, budgets, or IAM policies.",
  },
  {
    name: "Neon & Supabase",
    category: "Database & Backend Health",
    milestone: "M06",
    scope: "Read-only management API / system telemetry",
    boundary:
      "Reads compute hours, storage size, connection counts, and project health. Never executes arbitrary user SQL or mutates rows.",
  },
  {
    name: "Cloudflare, Vercel & GitHub",
    category: "Hosting, Reliability & Deployments",
    milestone: "M08",
    scope: "Read-only deployment & workflow metadata",
    boundary:
      "Reads deployment timestamps, build outcomes, and edge traffic summaries. Never triggers redeployments or edits DNS records.",
  },
];

async function ConnectionsPageContent() {
  const { governance, projects } = await requireAuthenticatedAppContext();
  const activeProjects = projects.filter((p) => p.status === "ACTIVE");

  return (
    <div className="space-y-8" data-testid="connections-readiness-page">
      <PageHeader
        breadcrumbs={[
          { label: governance.organization.name },
          { label: governance.workspace.name, href: "/dashboard" },
          { label: "Connections" },
        ]}
        title="Read-Only Provider Connections"
        description="Avenor connects to external analytics, search, cloud billing, database, and hosting platforms using strictly scoped viewer credentials. Remote mutation APIs are architecturally prohibited."
        badges={<Badge tone="read-only">Read-Only Architecture</Badge>}
      />

      {/* Security & Boundary Comparison */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5 sm:p-6 space-y-3 border-[#147D63]/30">
          <div className="flex items-center gap-2 text-[#147D63]">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            <h2 className="text-[17px] font-semibold text-[#17243A]">
              Permitted Read-Only Operations
            </h2>
          </div>
          <ul className="space-y-2 text-[13px] text-[#30415D]">
            <li>• Discovering accessible properties, projects, and read-only billing exports.</li>
            <li>
              • Mapping external read-only resources to{" "}
              <strong className="font-semibold text-[#17243A]">
                {activeProjects.length} active logical product(s)
              </strong>{" "}
              and their Production, Staging, and Development environments.
            </li>
            <li>
              • Scheduled, quota-guarded metric ingestion with explicit data freshness and
              provenance metadata.
            </li>
          </ul>
        </Card>

        <Card className="p-5 sm:p-6 space-y-3 border-[#BF4256]/30">
          <div className="flex items-center gap-2 text-[#BF4256]">
            <XCircle className="h-5 w-5" aria-hidden="true" />
            <h2 className="text-[17px] font-semibold text-[#17243A]">
              Prohibited External Write Actions
            </h2>
          </div>
          <ul className="space-y-2 text-[13px] text-[#30415D]">
            <li>
              • No SQL query console, row editing, schema migrations, or auth user deletion on
              connected databases.
            </li>
            <li>
              • No DNS record changes, firewall edits, or deployment triggers on connected hosting
              providers.
            </li>
            <li>
              • No acceptance of broadly privileged write/admin tokens when a scoped viewer role is
              available.
            </li>
          </ul>
        </Card>
      </div>

      {/* Connector Catalog */}
      <div className="space-y-4">
        <SectionHeader
          title="Signal Atlas Connector Catalog"
          description="Provider adapters unlock in Milestone 02+ and map directly to your logical products and environments."
          actions={
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#168E99]">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Encrypted server-side vault (Milestone 02)</span>
            </span>
          }
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {PLANNED_CONNECTORS.map((connector) => (
            <Card key={connector.name} className="p-5 sm:p-6 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[12px] font-medium text-[#5157D9]">{connector.category}</p>
                  <h3 className="text-[17px] font-semibold text-[#17243A]">{connector.name}</h3>
                </div>
                <StatusIndicator tone="neutral" label="Not connected" />
              </div>

              <p className="text-[13px] text-[#30415D]">{connector.boundary}</p>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#DFE6F0] pt-3 text-[12px]">
                <span className="inline-flex items-center gap-1.5 font-mono text-[#64748B]">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#168E99]" aria-hidden="true" />
                  <span>Scope: {connector.scope}</span>
                </span>
                <Badge tone="planned">Roadmap {connector.milestone}</Badge>
              </div>
            </Card>
          ))}
        </div>
      </div>
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
