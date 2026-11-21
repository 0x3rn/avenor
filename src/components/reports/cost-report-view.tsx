"use client";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  MetricCard,
  PageHeader,
  SegmentedControl,
  WarningBanner,
} from "@avenor/ui";
import {
  Coins,
  CreditCard,
  Database,
  Layers,
  RefreshCw,
  Table2,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import {
  MetricDefinitionTrigger,
  type MetricProvenanceContext,
  MetricProvenanceDrawer,
} from "@/components/reports/metric-provenance-drawer";
import type { ProjectCostIntelligenceReportDto } from "@/lib/reports/cost-service";
import type { PortfolioDatePreset } from "@/lib/reports/portfolio-service";

export interface CostReportViewProps {
  initialReport: ProjectCostIntelligenceReportDto;
  workspaceName: string;
  organizationName: string;
  canManageConnections: boolean;
  thresholdsSlot?: React.ReactNode;
}

function formatCurrencyValue(value: number | null, currency: string | null): string | undefined {
  if (value === null || !Number.isFinite(value)) {
    return undefined;
  }
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

export function CostReportView({
  initialReport,
  workspaceName,
  organizationName,
  canManageConnections,
  thresholdsSlot,
}: CostReportViewProps) {
  const [report, setReport] = React.useState<ProjectCostIntelligenceReportDto>(initialReport);
  const [preset, setPreset] = React.useState<PortfolioDatePreset>(initialReport.dateWindow.preset);
  const [currencyFilter, setCurrencyFilter] = React.useState<string>("");
  const [loading, setLoading] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [showTrendTable, setShowTrendTable] = React.useState(false);
  const [provenanceContext, setProvenanceContext] =
    React.useState<MetricProvenanceContext | null>(null);

  async function refreshCostReport(nextPreset: PortfolioDatePreset, nextCurrency: string) {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        preset: nextPreset,
        compare: "true",
      });
      if (report.selectedEnvironmentId) {
        params.set("environmentId", report.selectedEnvironmentId);
      }
      if (nextCurrency) {
        params.set("currency", nextCurrency);
      }

      const res = await fetch(
        `/api/projects/${encodeURIComponent(report.project.id)}/cost?${params.toString()}`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const payload = (await res.json()) as ProjectCostIntelligenceReportDto;
        if (payload?.totals) {
          setReport(payload);
        }
      }
    } catch {
      // Safe no-op in isolated component tests
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncExport() {
    if (!report.sourceStatus.connectedResourceId || !canManageConnections) return;
    setSyncing(true);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(report.project.id)}/cost`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            connectedResourceId: report.sourceStatus.connectedResourceId,
            environmentId: report.selectedEnvironmentId,
            startDate: report.dateWindow.startDate,
            endDate: report.dateWindow.endDate,
          }),
        },
      );
      if (res.ok) {
        const payload = await res.json();
        if (payload?.report) {
          setReport(payload.report as ProjectCostIntelligenceReportDto);
        }
      }
    } catch {
      // Safe no-op in isolated tests
    } finally {
      setSyncing(false);
    }
  }

  function openMetricProvenance(canonicalMetricKey: string) {
    setProvenanceContext({
      canonicalMetricKey,
      externalResourceId:
        report.sourceStatus.externalResourceId ?? "BigQuery Cloud Billing Export",
      reportingTimezone: "UTC (Billing Account Local)",
      periodStartDate: report.dateWindow.startDate,
      periodEndDate: report.dateWindow.endDate,
      completenessState: report.completenessState,
      lastCollectedAtIso: report.sourceStatus.lastExportTimeIso,
      currency: report.primaryCurrency,
    });
  }

  const currency = report.primaryCurrency;

  return (
    <div className="space-y-6" data-testid="cost-report-view">
      <PageHeader
        breadcrumbs={[
          { label: organizationName },
          { label: workspaceName, href: "/dashboard" },
          { label: report.project.name, href: `/projects/${report.project.id}` },
          { label: "Cloud Cost Intelligence" },
        ]}
        title={`${report.project.name} — Cloud Cost Intelligence`}
        description="Read-only Google Cloud Billing & BigQuery export spend ledger with credit amortization, service/SKU attribution, invoice finalization status, and GA4 traffic efficiency."
        badges={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="indigo">
              {currency ? `Currency: ${currency}` : "Multi-Currency"}
            </Badge>
            <Badge
              tone={report.completenessState === "COMPLETE" ? "success" : "signal"}
              data-testid="cost-completeness-badge"
            >
              {report.completenessState === "COMPLETE"
                ? "Finalized Invoice Scope"
                : "Estimated / Open Invoice Window"}
            </Badge>
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <SegmentedControl
              ariaLabel="Cost reporting window"
              value={preset}
              onChange={(val) => {
                const next = val as PortfolioDatePreset;
                setPreset(next);
                void refreshCostReport(next, currencyFilter);
              }}
              options={[
                { value: "7d", label: "7D" },
                { value: "28d", label: "28D" },
                { value: "90d", label: "90D" },
                { value: "mtd", label: "MTD" },
              ]}
            />

            {report.currencies.length > 1 || currencyFilter ? (
              <select
                aria-label="Filter by billing currency"
                data-testid="cost-currency-filter-select"
                value={currencyFilter}
                onChange={(e) => {
                  const next = e.target.value;
                  setCurrencyFilter(next);
                  void refreshCostReport(preset, next);
                }}
                className="h-9 rounded-[8px] border border-[#C7D2E3] bg-[#FFFFFF] px-2.5 text-[12px] text-[#17243A]"
              >
                <option value="">All Currencies ({report.currencies.join(", ")})</option>
                {report.currencies.map((c) => (
                  <option key={c} value={c}>
                    {c} Only
                  </option>
                ))}
              </select>
            ) : null}

            {report.sourceStatus.connectedResourceId && canManageConnections ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={syncing || loading}
                data-testid="cost-sync-export-btn"
                onClick={() => void handleSyncExport()}
              >
                <RefreshCw
                  className={`mr-1.5 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                <span>{syncing ? "Syncing BigQuery..." : "Sync Billing Export"}</span>
              </Button>
            ) : null}
          </div>
        }
      />

      {/* Mixed-Currency Guardrail Banner */}
      {report.isMixedCurrency && report.mixedCurrencyWarning ? (
        <div data-testid="cost-mixed-currency-banner">
          <WarningBanner
            tone="warning"
            title="Multi-Currency Aggregation Guardrail"
            description={report.mixedCurrencyWarning}
          />
        </div>
      ) : null}

      {/* Other Warnings (Metadata-only or Empty Export) */}
      {report.warnings
        .filter((w) => w !== report.mixedCurrencyWarning)
        .map((warning) => (
          <div key={warning} data-testid="cost-source-warning-banner">
            <WarningBanner
              tone="signal"
              title="Cloud Billing Export Availability Notice"
              description={warning}
            />
          </div>
        ))}

      {/* 4-Card Cost Intelligence KPI Row */}
      <section
        aria-label="Cloud Cost Intelligence KPIs"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
        data-testid="cost-kpi-grid"
      >
        <MetricCard
          title="Net Cloud Cost (After Credits)"
          definition="Actual cloud spend after subtracting sustained-use, committed-use, promotional, and free-tier credits."
          state={report.uxState}
          value={report.totals.netCost}
          formattedValue={formatCurrencyValue(report.totals.netCost, currency)}
          unit={currency ?? "currency"}
          comparisonDeltaText={report.comparisons.netCost.formattedDeltaLabel ?? undefined}
          sourceLabel="BigQuery Export"
          freshnessLabel={
            report.sourceStatus.datasetLocation
              ? `Dataset (${report.sourceStatus.datasetLocation}) • ${report.completenessState}`
              : "BigQuery Cloud Billing"
          }
          actionSlot={
            <MetricDefinitionTrigger
              canonicalMetricKey="gcp_billing.net_cost"
              onInspect={openMetricProvenance}
            />
          }
        />

        <MetricCard
          title="Gross Cloud Cost (Before Credits)"
          definition="Total usage charges at list/contract rates prior to credit reductions."
          state={report.uxState}
          value={report.totals.grossCost}
          formattedValue={formatCurrencyValue(report.totals.grossCost, currency)}
          unit={currency ?? "currency"}
          comparisonDeltaText={report.comparisons.grossCost.formattedDeltaLabel ?? undefined}
          sourceLabel="BigQuery Export"
          freshnessLabel={
            report.totals.taxAndAdjustmentsCost
              ? `Includes ${formatCurrencyValue(report.totals.taxAndAdjustmentsCost, currency)} tax/adj.`
              : "Usage charges"
          }
          actionSlot={
            <MetricDefinitionTrigger
              canonicalMetricKey="gcp_billing.gross_cost"
              onInspect={openMetricProvenance}
            />
          }
        />

        <MetricCard
          title="Applied Credits & Discounts"
          definition="Signed credit reductions (SUDs, CUDs, promotions, free tier) applied to gross usage."
          state={report.uxState}
          value={report.totals.creditsAmount}
          formattedValue={formatCurrencyValue(report.totals.creditsAmount, currency)}
          unit={currency ?? "currency"}
          sourceLabel="BigQuery Export"
          freshnessLabel="Amortized export credits"
          actionSlot={
            <MetricDefinitionTrigger
              canonicalMetricKey="gcp_billing.credits"
              onInspect={openMetricProvenance}
            />
          }
        />

        <MetricCard
          title="Cost per 1,000 GA4 Sessions"
          definition="Cross-provider unit economics: Net Cloud Cost divided by stored GA4 Sessions (× 1,000) for the aligned date window."
          state={report.efficiency.available ? "connected_healthy" : "partial_coverage"}
          value={report.efficiency.costPer1kSessions}
          formattedValue={
            report.efficiency.available
              ? formatCurrencyValue(report.efficiency.costPer1kSessions, currency)
              : undefined
          }
          unit={
            report.efficiency.denominatorSessions
              ? `per 1k of ${report.efficiency.denominatorSessions.toLocaleString()} sessions`
              : "per 1k sessions"
          }
          sourceLabel="BigQuery + GA4"
          freshnessLabel={report.efficiency.provenanceExplanation}
        />
      </section>

      {/* Per-Currency Buckets when Mixed Currency is Present */}
      {report.isMixedCurrency && report.currencyBuckets.length > 0 ? (
        <Card className="p-5 sm:p-6 space-y-3" data-testid="cost-currency-buckets-card">
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
            <h2 className="text-[16px] font-semibold text-[#17243A]">
              Segmented Spend by Billing Currency
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {report.currencyBuckets.map((b) => (
              <div
                key={b.currency}
                className="rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC] p-3.5 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <Badge tone="indigo">{b.currency}</Badge>
                  <span className="text-[11px] text-[#64748B]">{b.rowCount} ledger rows</span>
                </div>
                <div className="text-[18px] font-semibold font-mono tabular-nums text-[#17243A]">
                  {formatCurrencyValue(b.netCost, b.currency)} net
                </div>
                <div className="text-[12px] text-[#64748B] font-mono tabular-nums">
                  Gross: {formatCurrencyValue(b.grossCost, b.currency)} • Credits:{" "}
                  {formatCurrencyValue(b.creditsAmount, b.currency)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Unconnected / Onboarding Prompt when no BigQuery Export Dataset is Linked */}
      {!report.sourceStatus.hasBigQueryExportDataset && report.serviceBreakdown.length === 0 ? (
        <EmptyState
          icon={<Database className="h-5 w-5" aria-hidden="true" />}
          title="BigQuery Cloud Billing Export Not Linked Yet"
          description="Cloud Billing metadata discovery identifies your billing accounts and linked GCP projects, but historical spend requires linking a customer-managed BigQuery Cloud Billing Export dataset. Avenor never reports $0.00 spend when the export is unconfigured."
          primaryAction={
            <Link
              href="/connections"
              className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#5157D9] px-4 text-[14px] font-medium text-[#FFFFFF] hover:bg-[#454AC7]"
            >
              <span>Complete Guided BigQuery Export Setup</span>
            </Link>
          }
        />
      ) : (
        <>
          {/* Daily Spend Trajectory */}
          <Card className="p-5 sm:p-6 space-y-4" data-testid="cost-daily-trend-card">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
                  <h2 className="text-[16px] font-semibold text-[#17243A]">
                    Daily Cloud Spend Trajectory ({report.dateWindow.startDate} →{" "}
                    {report.dateWindow.endDate})
                  </h2>
                </div>
                <p className="text-[12.5px] text-[#64748B]">
                  Gross usage cost vs net cost after applied credits in billing account currency.
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="cost-trend-table-toggle"
                onClick={() => setShowTrendTable((prev) => !prev)}
              >
                <Table2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                <span>{showTrendTable ? "Show Visual Bars" : "Show Accessible Table"}</span>
              </Button>
            </div>

            {report.dailyTrend.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-[#C7D2E3] bg-[#F7F9FC] p-5 text-center text-[13px] text-[#64748B]">
                {report.isMixedCurrency
                  ? "Select a single billing currency above to render the unified daily cost trajectory."
                  : "No daily cost rows recorded in this date window."}
              </div>
            ) : showTrendTable ? (
              <div className="overflow-x-auto" data-testid="cost-daily-trend-table">
                <table className="w-full border-collapse text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-[#DFE6F0] text-[#64748B]">
                      <th className="py-2 pr-4 font-semibold">Usage Date</th>
                      <th className="py-2 pr-4 font-semibold text-right">Gross Cost</th>
                      <th className="py-2 pr-4 font-semibold text-right">Credits</th>
                      <th className="py-2 font-semibold text-right">Net Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#DFE6F0]">
                    {report.dailyTrend.map((pt) => (
                      <tr key={pt.date}>
                        <td className="py-2 pr-4 font-mono text-[#17243A]">{pt.date}</td>
                        <td className="py-2 pr-4 text-right font-mono tabular-nums text-[#30415D]">
                          {formatCurrencyValue(pt.grossCost, pt.currency) ?? "—"}
                        </td>
                        <td className="py-2 pr-4 text-right font-mono tabular-nums text-[#18825D]">
                          {formatCurrencyValue(pt.creditsAmount, pt.currency) ?? "—"}
                        </td>
                        <td className="py-2 text-right font-mono font-semibold tabular-nums text-[#17243A]">
                          {formatCurrencyValue(pt.netCost, pt.currency) ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">
                {report.dailyTrend.slice(-14).map((pt) => (
                  <div
                    key={pt.date}
                    className="rounded-[8px] border border-[#DFE6F0] bg-[#F7F9FC] p-2.5 space-y-1"
                  >
                    <div className="font-mono text-[11px] text-[#64748B]">{pt.date}</div>
                    <div className="font-mono text-[13.5px] font-semibold tabular-nums text-[#17243A]">
                      {formatCurrencyValue(pt.netCost, pt.currency) ?? "—"}
                    </div>
                    <div className="font-mono text-[10.5px] tabular-nums text-[#18825D]">
                      Credits: {formatCurrencyValue(pt.creditsAmount, pt.currency) ?? "—"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* 12-Column Breakdown Grid: Top Services (7 cols) + GCP Projects & Invoice Months (5 cols) */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <Card
              className="p-5 sm:p-6 space-y-4 lg:col-span-7"
              data-testid="cost-service-breakdown-card"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
                  <h2 className="text-[16px] font-semibold text-[#17243A]">
                    Google Cloud Service &amp; SKU Breakdown
                  </h2>
                </div>
                <Badge tone="neutral">{report.serviceBreakdown.length} services</Badge>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-[12.5px]">
                  <thead>
                    <tr className="border-b border-[#DFE6F0] text-[#64748B]">
                      <th className="py-2 pr-3 font-semibold">Service</th>
                      <th className="py-2 pr-3 font-semibold text-right">Gross</th>
                      <th className="py-2 pr-3 font-semibold text-right">Credits</th>
                      <th className="py-2 pr-3 font-semibold text-right">Net Spend</th>
                      <th className="py-2 font-semibold text-right">Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#DFE6F0]">
                    {report.serviceBreakdown.map((svc) => (
                      <tr key={`${svc.serviceId}-${svc.currency}`}>
                        <td className="py-2.5 pr-3">
                          <div className="font-semibold text-[#17243A]">
                            {svc.serviceDescription}
                          </div>
                          <div className="font-mono text-[11px] text-[#64748B]">
                            ID: {svc.serviceId} • {svc.currency}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-[#30415D]">
                          {formatCurrencyValue(svc.grossCost, svc.currency)}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-[#18825D]">
                          {formatCurrencyValue(svc.creditsAmount, svc.currency)}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono font-semibold tabular-nums text-[#17243A]">
                          {formatCurrencyValue(svc.netCost, svc.currency)}
                        </td>
                        <td className="py-2.5 text-right font-mono tabular-nums text-[#64748B]">
                          {svc.sharePercentage > 0 ? `${svc.sharePercentage.toFixed(1)}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <div className="space-y-6 lg:col-span-5">
              {/* Linked GCP Projects */}
              <Card className="p-5 sm:p-6 space-y-3" data-testid="cost-gcp-projects-card">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-[#168E99]" aria-hidden="true" />
                  <h2 className="text-[16px] font-semibold text-[#17243A]">
                    Attributed Google Cloud Projects
                  </h2>
                </div>
                <div className="space-y-2.5">
                  {report.gcpProjectBreakdown.map((gp) => (
                    <div
                      key={`${gp.gcpProjectId}-${gp.currency}`}
                      className="rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC] p-3 text-[12.5px] space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-[#17243A]">
                          {gp.gcpProjectId}
                        </span>
                        <Badge
                          tone={gp.completenessState === "COMPLETE" ? "success" : "signal"}
                        >
                          {gp.completenessState}
                        </Badge>
                      </div>
                      <div className="text-[11.5px] text-[#64748B]">
                        Billing Account: <code>{gp.billingAccountId}</code> → Avenor Product:{" "}
                        <strong>{gp.mappedAvenorProjectName}</strong>
                      </div>
                      <div className="flex items-center justify-between pt-1 font-mono text-[13px]">
                        <span className="text-[#30415D]">
                          Gross: {formatCurrencyValue(gp.grossCost, gp.currency)}
                        </span>
                        <span className="font-semibold text-[#17243A]">
                          Net: {formatCurrencyValue(gp.netCost, gp.currency)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Invoice Month Finalization Ledger */}
              <Card className="p-5 sm:p-6 space-y-3" data-testid="cost-invoice-months-card">
                <h2 className="text-[16px] font-semibold text-[#17243A]">
                  Invoice Month Finalization Status
                </h2>
                <div className="space-y-2">
                  {report.invoiceMonths.map((inv) => (
                    <div
                      key={`${inv.invoiceMonth}-${inv.currency}`}
                      className="flex items-center justify-between rounded-[8px] border border-[#DFE6F0] bg-[#F7F9FC] px-3 py-2 text-[12.5px]"
                    >
                      <div>
                        <span className="font-mono font-semibold text-[#17243A]">
                          {inv.invoiceMonth.slice(0, 4)}-{inv.invoiceMonth.slice(4, 6)}
                        </span>{" "}
                        <Badge tone={inv.isFinalized ? "success" : "warning"}>
                          {inv.isFinalized ? "Closed Invoice" : "Open / Provisional"}
                        </Badge>
                      </div>
                      <span className="font-mono font-semibold tabular-nums text-[#17243A]">
                        {formatCurrencyValue(inv.netCost, inv.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        </>
      )}

      {/* Optional Thresholds & Cost Alerts Slot (THE-137) */}
      {thresholdsSlot ? <div>{thresholdsSlot}</div> : null}

      <MetricProvenanceDrawer
        onClose={() => setProvenanceContext(null)}
        context={provenanceContext}
      />
    </div>
  );
}
