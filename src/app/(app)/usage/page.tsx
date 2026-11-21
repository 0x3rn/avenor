import { Badge, Card, PageHeader, WarningBanner } from "@avenor/ui";
import Link from "next/link";
import * as React from "react";
import { getWorkspaceUsageAndQuotaReport } from "@/lib/billing/quotas";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

async function WorkspaceUsagePageContent() {
  const { session, governance } = await requireAuthenticatedAppContext();
  const report = await getWorkspaceUsageAndQuotaReport(session, governance.workspace.id);

  return (
    <div className="space-y-6" data-testid="workspace-usage-page">
      <PageHeader
        breadcrumbs={[
          { label: governance.organization.name },
          { label: governance.workspace.name, href: "/dashboard" },
          { label: "Usage & Quotas" },
        ]}
        title="Workspace Plan Usage & Fair-Use Quotas"
        description="Server-enforced resource capacities and monthly allowances for your active Avenor subscription plan."
        badges={<Badge tone="indigo">Plan: {report.effectivePlanCode}</Badge>}
        actions={
          <Link
            href="/billing"
            className="inline-flex h-9 items-center rounded-[8px] border border-[#C7D2E3] bg-[#FFFFFF] px-3.5 text-[13px] font-medium text-[#17243A] hover:bg-[#F0F4FA]"
          >
            Manage Plan & Billing
          </Link>
        }
      />

      <WarningBanner
        tone="signal"
        title="Predictable Flat-Rate Fair Use (Zero Automatic Overages)"
        description={report.noOverageNotice}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {report.quotas.map((q) => (
          <Card key={q.resourceKey} className="p-4 sm:p-5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-[14px] text-[#17243A]">{q.label}</span>
              <Badge
                tone={
                  q.status === "EXCEEDED"
                    ? "critical"
                    : q.status === "NEAR_LIMIT"
                      ? "warning"
                      : q.status === "UNAVAILABLE_ON_PLAN"
                        ? "neutral"
                        : "success"
                }
              >
                {q.status === "UNAVAILABLE_ON_PLAN" ? "Upgrade Required" : `${q.used} / ${q.limit}`}
              </Badge>
            </div>
            <div className="h-2 w-full rounded-full bg-[#E8EEF6] overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  q.status === "EXCEEDED"
                    ? "bg-[#DC2626]"
                    : q.status === "NEAR_LIMIT"
                      ? "bg-[#D97706]"
                      : "bg-[#5157D9]"
                }`}
                style={{ width: `${q.utilizationPct}%` }}
              />
            </div>
            <p className="font-mono text-[11.5px] text-[#64748B]">
              {q.category === "MONTHLY_ALLOWANCE"
                ? `Resets ${q.resetDateIso?.slice(0, 10)}`
                : "Hard workspace capacity"}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function WorkspaceUsagePage() {
  return (
    <React.Suspense fallback={<div className="min-h-[480px]" />}>
      <WorkspaceUsagePageContent />
    </React.Suspense>
  );
}
