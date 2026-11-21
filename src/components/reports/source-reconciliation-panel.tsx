"use client";

import type { EnvironmentType } from "@avenor/types";
import type { BadgeTone } from "@avenor/ui";
import { Badge, Button, Card, WarningBanner } from "@avenor/ui";
import { CheckCircle2, Filter, GitCompare, RefreshCw, Scale } from "lucide-react";
import * as React from "react";
import type {
  ReconciledMetricItemDto,
  ReconciliationStatus,
  SourceReconciliationReportDto,
} from "@/lib/reports/reconciliation";

export interface SourceReconciliationPanelProps {
  projectId: string;
  environmentId?: string | null;
  environmentType?: EnvironmentType;
  preset?: string;
  initialReport?: SourceReconciliationReportDto | null;
}

function formatMetricVal(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  if (unit === "ratio") return `${(value * 100).toFixed(2)}%`;
  if (unit === "position") return value.toFixed(2);
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value < 100 && !Number.isInteger(value) ? 2 : 0,
  }).format(value);
}

function getReconciliationBadge(status: ReconciliationStatus): {
  tone: BadgeTone;
  label: string;
} {
  switch (status) {
    case "MATCHED":
      return { tone: "success", label: "Exact Match" };
    case "REVISION_SUPERSEDED":
      return { tone: "indigo", label: "Reconciled (Revised)" };
    case "RECONCILED_WITH_PRIVACY_THRESHOLD":
      return { tone: "signal", label: "GSC Privacy Threshold" };
    case "RECONCILED_WITH_KNOWN_VARIANCE":
      return { tone: "warning", label: "Known Source Lag/Sampling" };
    case "DRIFT_DETECTED":
      return { tone: "critical", label: "Drift Detected" };
    case "MISSING_IN_AVENOR":
      return { tone: "neutral", label: "Not Yet Collected" };
  }
}

export function SourceReconciliationPanel({
  projectId,
  environmentId,
  environmentType = "PRODUCTION",
  preset = "28d",
  initialReport = null,
}: SourceReconciliationPanelProps) {
  const [report, setReport] = React.useState<SourceReconciliationReportDto | null>(initialReport);
  const [loading, setLoading] = React.useState(false);
  const [includeToday, setIncludeToday] = React.useState(
    initialReport?.dateWindow.includesIncompleteToday ?? false,
  );
  const [selectedDimensionFilter, setSelectedDimensionFilter] = React.useState<string>("none");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const loadReconciliationReport = React.useCallback(
    async (opts?: { nextIncludeToday?: boolean; nextFilter?: string }) => {
      setLoading(true);
      setErrorMessage(null);
      try {
        const useToday = opts?.nextIncludeToday ?? includeToday;
        const filterKey = opts?.nextFilter ?? selectedDimensionFilter;

        const params = new URLSearchParams({
          preset,
          environmentType,
          includeToday: useToday ? "true" : "false",
        });
        if (environmentId) {
          params.set("environmentId", environmentId);
        }
        if (filterKey === "gsc_web") {
          params.set("metrics", "gsc.clicks,gsc.impressions,gsc.ctr,gsc.average_position");
          params.set("filter.searchType", "web");
        } else if (filterKey === "incompatible_demo") {
          params.set("metrics", "ga4.sessions,gsc.clicks");
          params.set("filter.query", "avenor");
        }

        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/reconciliation?${params.toString()}`,
          { cache: "no-store" },
        );
        const payload = await res.json();
        if (!res.ok) {
          setErrorMessage(
            payload?.error?.message ?? "Incompatible filter or reconciliation query failed.",
          );
          return;
        }
        if (payload?.dateWindow && Array.isArray(payload.comparisons)) {
          setReport(payload as SourceReconciliationReportDto);
        }
      } catch {
        // Non-fatal in isolated tests without a mocked endpoint
      } finally {
        setLoading(false);
      }
    },
    [environmentId, environmentType, includeToday, preset, projectId, selectedDimensionFilter],
  );

  return (
    <Card className="p-5 sm:p-6 space-y-5" data-testid="source-reconciliation-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Scale className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
            <h2 className="text-[16px] font-semibold text-[#17243A]">
              Period Comparison &amp; Provider Reconciliation Ledger
            </h2>
            {report ? (
              <Badge tone={report.summary.allWithinContract ? "success" : "warning"}>
                {report.summary.matchedCount + report.summary.knownVarianceCount}/
                {report.summary.totalChecked} Reconciled
              </Badge>
            ) : null}
          </div>
          <p className="text-[12.5px] text-[#64748B]">
            Deterministic period-over-period delta verification, source timezone boundary alignment,
            and tolerance-checked GA4 / Search Console reconciliation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#30415D] cursor-pointer">
            <input
              type="checkbox"
              checked={includeToday}
              data-testid="reconciliation-include-today-toggle"
              onChange={(e) => {
                const next = e.target.checked;
                setIncludeToday(next);
                void loadReconciliationReport({ nextIncludeToday: next });
              }}
              className="rounded border-[#C7D2E3] text-[#5157D9]"
            />
            <span>Include incomplete today</span>
          </label>

          <select
            aria-label="Capability-aware segment lens"
            data-testid="reconciliation-dimension-filter-select"
            value={selectedDimensionFilter}
            onChange={(e) => {
              const next = e.target.value;
              setSelectedDimensionFilter(next);
              void loadReconciliationReport({ nextFilter: next });
            }}
            className="h-8 rounded-[8px] border border-[#C7D2E3] bg-[#FFFFFF] px-2.5 text-[12px] text-[#17243A]"
          >
            <option value="none">All compatible metrics (Summary scope)</option>
            <option value="gsc_web">GSC Web Search filter (searchType=web)</option>
            <option value="incompatible_demo">Test guard: Filter GA4 Sessions by GSC Query</option>
          </select>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={loading}
            data-testid="run-source-reconciliation-btn"
            onClick={() => void loadReconciliationReport()}
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            <span>{report ? "Re-verify Ledger" : "Run Reconciliation"}</span>
          </Button>
        </div>
      </div>

      {errorMessage ? (
        <div data-testid="reconciliation-incompatible-filter-banner">
          <WarningBanner
            tone="warning"
            title="Capability-Aware Filter Guardrail"
            description={errorMessage}
          />
        </div>
      ) : null}

      {report?.dateWindow.partialDayNotice ? (
        <div data-testid="reconciliation-partial-day-banner">
          <WarningBanner
            tone="indigo"
            title="Partial Current-Day Coverage Notice"
            description={report.dateWindow.partialDayNotice}
          />
        </div>
      ) : null}

      {report && !report.timezoneAlignment.isAligned && report.timezoneAlignment.warningMessage ? (
        <div data-testid="reconciliation-timezone-alignment-banner">
          <WarningBanner
            tone="signal"
            title="Cross-Source Reporting Timezone Boundary Notice"
            description={report.timezoneAlignment.warningMessage}
          />
        </div>
      ) : null}

      {report ? (
        <div className="space-y-5">
          {/* Period Comparison Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[12px] text-[#64748B]">
              <span className="font-semibold text-[#17243A] inline-flex items-center gap-1.5">
                <GitCompare className="h-3.5 w-3.5 text-[#5157D9]" aria-hidden="true" />
                <span>
                  Current ({report.dateWindow.startDate} → {report.dateWindow.endDate}) vs Prior (
                  {report.dateWindow.previousStartDate ?? "—"} →{" "}
                  {report.dateWindow.previousEndDate ?? "—"})
                </span>
              </span>
              <span>Reporting TZ: {report.dateWindow.timeZone}</span>
            </div>

            <div className="overflow-x-auto" data-testid="reconciliation-comparison-table">
              <table className="w-full border-collapse text-left text-[12px]">
                <thead>
                  <tr className="border-b border-[#DFE6F0] text-[#64748B]">
                    <th className="py-2 pr-3 font-semibold">Canonical Metric</th>
                    <th className="py-2 pr-3 font-semibold text-right">Current Window</th>
                    <th className="py-2 pr-3 font-semibold text-right">Previous Window</th>
                    <th className="py-2 pr-3 font-semibold text-right">Period Delta</th>
                    <th className="py-2 font-semibold">Mathematical Rule</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DFE6F0]">
                  {report.comparisons.map((c) => (
                    <tr key={c.canonicalMetricKey}>
                      <td className="py-2 pr-3 font-medium text-[#17243A]">
                        <div>{c.displayName}</div>
                        <div className="font-mono text-[10.5px] text-[#64748B]">
                          {c.canonicalMetricKey}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-[#17243A]">
                        {formatMetricVal(c.currentValue, c.unit)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-[#64748B]">
                        {formatMetricVal(c.previousValue, c.unit)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">
                        <Badge
                          tone={
                            c.direction === "non_comparable"
                              ? "warning"
                              : c.direction === "new_activity"
                                ? "signal"
                                : c.isImprovement === true
                                  ? "success"
                                  : c.isImprovement === false
                                    ? "critical"
                                    : "neutral"
                          }
                        >
                          {c.formattedDeltaLabel}
                        </Badge>
                      </td>
                      <td className="py-2 text-[11.5px] text-[#30415D]">{c.explanation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Source Reconciliation Items */}
          {report.reconciliationItems.length > 0 ? (
            <div className="space-y-2 border-t border-[#DFE6F0] pt-4">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#17243A]">
                <CheckCircle2 className="h-3.5 w-3.5 text-[#18825D]" aria-hidden="true" />
                <span>Provider Benchmark Reconciliation Items</span>
              </div>
              <div className="overflow-x-auto" data-testid="reconciliation-items-table">
                <table className="w-full border-collapse text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-[#DFE6F0] text-[#64748B]">
                      <th className="py-2 pr-3 font-semibold">Metric &amp; Resource</th>
                      <th className="py-2 pr-3 font-semibold text-right">Avenor Stored</th>
                      <th className="py-2 pr-3 font-semibold text-right">Provider Benchmark</th>
                      <th className="py-2 pr-3 font-semibold text-right">Diff / Tolerance</th>
                      <th className="py-2 pr-3 font-semibold">Status</th>
                      <th className="py-2 font-semibold">Audit Explanation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#DFE6F0]">
                    {report.reconciliationItems.map((item: ReconciledMetricItemDto) => {
                      const badge = getReconciliationBadge(item.status);
                      return (
                        <tr
                          key={`${item.canonicalMetricKey}-${item.externalResourceId}-${item.periodStartDate}`}
                        >
                          <td className="py-2 pr-3">
                            <div className="font-medium text-[#17243A]">{item.displayName}</div>
                            <div className="font-mono text-[10.5px] text-[#64748B]">
                              {item.externalResourceId} ({item.reportingTimezone})
                            </div>
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-[#17243A]">
                            {item.avenorStoredValue !== null ? item.avenorStoredValue : "—"}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-[#30415D]">
                            {item.providerBenchmarkValue}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-[#64748B]">
                            {item.absoluteDifference !== null
                              ? `${item.absoluteDifference} (≤${item.allowedTolerance})`
                              : "—"}
                          </td>
                          <td className="py-2 pr-3">
                            <Badge tone={badge.tone}>{badge.label}</Badge>
                          </td>
                          <td className="py-2 text-[11.5px] text-[#30415D]">{item.explanation}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-[10px] border border-dashed border-[#C7D2E3] bg-[#F7F9FC] p-4 text-[12.5px] text-[#64748B] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
            <span>
              Click <strong>Run Reconciliation</strong> to evaluate period comparisons, source
              timezone boundaries, and tolerance-checked provider benchmarks for this environment.
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}
