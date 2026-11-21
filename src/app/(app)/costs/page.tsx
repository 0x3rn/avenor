import { Badge, Card, EmptyState, MetricCard, PageHeader, WarningBanner } from "@avenor/ui";
import { Coins, CreditCard, FolderKanban } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { getWorkspaceCostIntelligenceReport } from "@/lib/reports/cost-service";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

function formatMoney(value: number | null, currency: string | null): string | undefined {
  if (value === null || !Number.isFinite(value)) return undefined;
  const code = currency && /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${code} ${value.toFixed(2)}`;
  }
}

async function WorkspaceCostsPageContent() {
  const { session, governance } = await requireAuthenticatedAppContext();
  const report = await getWorkspaceCostIntelligenceReport(session, { preset: "28d" });
  const currency = report.primaryCurrency;

  return (
    <div className="space-y-6" data-testid="workspace-costs-page">
      <PageHeader
        breadcrumbs={[
          { label: governance.organization.name },
          { label: governance.workspace.name, href: "/dashboard" },
          { label: "Portfolio Cloud Costs" },
        ]}
        title="Portfolio Cloud Cost Intelligence"
        description="Cross-product Google Cloud Billing & BigQuery export spend comparison, credit reductions, and per-currency segmentation."
        badges={
          <Badge tone="indigo">
            {currency ? `Currency: ${currency}` : "Multi-Currency"}
          </Badge>
        }
      />

      {report.isMixedCurrency && report.mixedCurrencyWarning ? (
        <WarningBanner
          tone="warning"
          title="Multi-Currency Portfolio Guardrail"
          description={report.mixedCurrencyWarning}
        />
      ) : null}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          title="Workspace Net Cloud Cost"
          definition="Total net cloud spend after applicable usage credits across single-currency billing exports."
          state={report.uxState}
          value={report.totals.netCost}
          formattedValue={formatMoney(report.totals.netCost, currency)}
          unit={currency ?? "currency"}
          comparisonDeltaText={report.comparisons.netCost.formattedDeltaLabel ?? undefined}
          sourceLabel="BigQuery Export"
          freshnessLabel={`${report.dateWindow.startDate} → ${report.dateWindow.endDate}`}
        />
        <MetricCard
          title="Workspace Gross Cloud Cost"
          definition="Total usage charges before credits."
          state={report.uxState}
          value={report.totals.grossCost}
          formattedValue={formatMoney(report.totals.grossCost, currency)}
          unit={currency ?? "currency"}
          comparisonDeltaText={report.comparisons.grossCost.formattedDeltaLabel ?? undefined}
          sourceLabel="BigQuery Export"
          freshnessLabel="Before credits"
        />
        <MetricCard
          title="Workspace Applied Credits"
          definition="Sustained-use, committed-use, promotional, and free-tier credits."
          state={report.uxState}
          value={report.totals.creditsAmount}
          formattedValue={formatMoney(report.totals.creditsAmount, currency)}
          unit={currency ?? "currency"}
          sourceLabel="BigQuery Export"
          freshnessLabel="Amortized credits"
        />
      </section>

      {report.projectCosts.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="h-5 w-5" aria-hidden="true" />}
          title="No Logical Products Configured"
          description="Create a logical product and link a BigQuery Cloud Billing Export dataset to compare product infrastructure spend."
        />
      ) : (
        <Card className="p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
            <h2 className="text-[16px] font-semibold text-[#17243A]">
              Product Cloud Cost Comparison
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {report.projectCosts.map((proj) => (
              <div
                key={proj.projectId}
                className="rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC] p-4 flex items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="font-semibold text-[#17243A]">{proj.projectName}</div>
                  <div className="font-mono text-[12px] text-[#64748B]">
                    Net: {formatMoney(proj.netCost, proj.currency) ?? "Not linked"} • Gross:{" "}
                    {formatMoney(proj.grossCost, proj.currency) ?? "—"}
                  </div>
                </div>
                <Link
                  href={`/projects/${proj.projectId}/cost`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[#C7D2E3] bg-[#FFFFFF] px-3 text-[12.5px] font-medium text-[#17243A] hover:bg-[#F0F4FA]"
                >
                  <FolderKanban className="h-3.5 w-3.5 text-[#5157D9]" />
                  <span>Cost Report</span>
                </Link>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

export default function WorkspaceCostsPage() {
  return (
    <React.Suspense fallback={<div className="min-h-[480px]" />}>
      <WorkspaceCostsPageContent />
    </React.Suspense>
  );
}
