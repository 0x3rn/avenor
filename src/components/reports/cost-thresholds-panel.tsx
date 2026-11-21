"use client";

import type { BadgeTone } from "@avenor/ui";
import { Badge, Button, Card, WarningBanner } from "@avenor/ui";
import { BellRing, Plus, RefreshCw, ShieldAlert } from "lucide-react";
import * as React from "react";
import type {
  CostSpendingThresholdDto,
  CostThresholdEvaluationDto,
  CostThresholdMetricBasis,
  CostThresholdPeriodType,
  CostThresholdSeverity,
} from "@/lib/billing/thresholds";

export interface CostThresholdsPanelProps {
  projectId: string;
  defaultCurrency?: string;
  canManageThresholds: boolean;
  initialThresholds?: CostSpendingThresholdDto[];
  initialEvaluations?: CostThresholdEvaluationDto[];
}

function getSeverityBadge(severity: CostThresholdSeverity): {
  tone: BadgeTone;
  label: string;
} {
  switch (severity) {
    case "OK":
      return { tone: "success", label: "Under Limit (OK)" };
    case "WARNING":
      return { tone: "warning", label: "Warning Breached" };
    case "CRITICAL":
      return { tone: "critical", label: "Critical Breached" };
    case "CURRENCY_MISMATCH":
      return { tone: "indigo", label: "Currency Mismatch" };
    case "INSUFFICIENT_DATA":
      return { tone: "neutral", label: "Awaiting Export Data" };
  }
}

export function CostThresholdsPanel({
  projectId,
  defaultCurrency = "USD",
  canManageThresholds,
  initialThresholds = [],
  initialEvaluations = [],
}: CostThresholdsPanelProps) {
  const [thresholds, setThresholds] =
    React.useState<CostSpendingThresholdDto[]>(initialThresholds);
  const [evaluations, setEvaluations] =
    React.useState<CostThresholdEvaluationDto[]>(initialEvaluations);
  const [loading, setLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const [name, setName] = React.useState("Monthly Production Cloud Spend Cap");
  const [metricBasis, setMetricBasis] = React.useState<CostThresholdMetricBasis>("NET_COST");
  const [periodType, setPeriodType] = React.useState<CostThresholdPeriodType>("MONTHLY");
  const [currency, setCurrency] = React.useState(defaultCurrency);
  const [warningAmount, setWarningAmount] = React.useState("100");
  const [criticalAmount, setCriticalAmount] = React.useState("200");

  async function handleCreateRule(e: React.FormEvent) {
    e.preventDefault();
    if (!canManageThresholds) return;
    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/cost/thresholds`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "create",
            name,
            metricBasis,
            periodType,
            currency,
            warningAmount: warningAmount.trim() ? Number(warningAmount) : null,
            criticalAmount: Number(criticalAmount),
          }),
        },
      );
      const payload = await res.json();
      if (!res.ok) {
        setErrorMessage(
          payload?.error?.message ?? "Failed to save spending threshold rule.",
        );
        return;
      }
      if (Array.isArray(payload?.thresholds)) {
        setThresholds(payload.thresholds);
      }
      if (Array.isArray(payload?.evaluations)) {
        setEvaluations(payload.evaluations);
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Network error saving threshold rule.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleRunEvaluation() {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/cost/thresholds`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "evaluate" }),
        },
      );
      const payload = await res.json();
      if (res.ok) {
        if (Array.isArray(payload?.thresholds)) {
          setThresholds(payload.thresholds);
        }
        if (Array.isArray(payload?.evaluations)) {
          setEvaluations(payload.evaluations);
        }
      }
    } catch {
      // Safe no-op in isolated tests
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-5 sm:p-6 space-y-5" data-testid="cost-thresholds-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <BellRing className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
            <h2 className="text-[16px] font-semibold text-[#17243A]">
              Avenor-Owned Spending Thresholds &amp; Cost Alert Rules
            </h2>
            <Badge tone="indigo">Local Avenor Rules Only</Badge>
          </div>
          <p className="text-[12.5px] text-[#64748B]">
            Thresholds are stored and evaluated locally inside Avenor against normalized BigQuery
            export observations. Avenor never creates or modifies native Google Cloud Budgets.
          </p>
        </div>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={loading}
          data-testid="evaluate-cost-thresholds-btn"
          onClick={() => void handleRunEvaluation()}
        >
          <RefreshCw
            className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          <span>Evaluate Rules Now</span>
        </Button>
      </div>

      {errorMessage ? (
        <div data-testid="cost-threshold-error-banner">
          <WarningBanner
            tone="warning"
            title="Spending Threshold Validation Error"
            description={errorMessage}
          />
        </div>
      ) : null}

      {/* Create Rule Form */}
      {canManageThresholds ? (
        <form
          onSubmit={handleCreateRule}
          className="rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC] p-4 space-y-3"
          data-testid="create-cost-threshold-form"
        >
          <div className="text-[13px] font-semibold text-[#17243A] flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5 text-[#5157D9]" aria-hidden="true" />
            <span>Configure New Spending Threshold Rule</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="sm:col-span-2">
              <label
                htmlFor="thr-name"
                className="block text-[11.5px] font-medium text-[#30415D] mb-1"
              >
                Rule Name
              </label>
              <input
                id="thr-name"
                data-testid="thr-input-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9 w-full rounded-[8px] border border-[#C7D2E3] bg-[#FFFFFF] px-2.5 text-[12.5px] text-[#17243A]"
              />
            </div>

            <div>
              <label
                htmlFor="thr-basis"
                className="block text-[11.5px] font-medium text-[#30415D] mb-1"
              >
                Cost Basis
              </label>
              <select
                id="thr-basis"
                data-testid="thr-select-basis"
                value={metricBasis}
                onChange={(e) =>
                  setMetricBasis(
                    e.target.value === "GROSS_COST" ? "GROSS_COST" : "NET_COST",
                  )
                }
                className="h-9 w-full rounded-[8px] border border-[#C7D2E3] bg-[#FFFFFF] px-2.5 text-[12.5px] text-[#17243A]"
              >
                <option value="NET_COST">Net Cost (After Credits)</option>
                <option value="GROSS_COST">Gross Cost (Before Credits)</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="thr-period"
                className="block text-[11.5px] font-medium text-[#30415D] mb-1"
              >
                Evaluation Window
              </label>
              <select
                id="thr-period"
                data-testid="thr-select-period"
                value={periodType}
                onChange={(e) =>
                  setPeriodType(e.target.value as CostThresholdPeriodType)
                }
                className="h-9 w-full rounded-[8px] border border-[#C7D2E3] bg-[#FFFFFF] px-2.5 text-[12.5px] text-[#17243A]"
              >
                <option value="MONTHLY">Monthly (MTD)</option>
                <option value="WEEKLY_ROLLING">Rolling 7 Days</option>
                <option value="DAILY">Daily Spend</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="thr-warning"
                className="block text-[11.5px] font-medium text-[#30415D] mb-1"
              >
                Warning ({currency})
              </label>
              <input
                id="thr-warning"
                type="number"
                step="0.01"
                data-testid="thr-input-warning"
                value={warningAmount}
                onChange={(e) => setWarningAmount(e.target.value)}
                className="h-9 w-full rounded-[8px] border border-[#C7D2E3] bg-[#FFFFFF] px-2.5 text-[12.5px] text-[#17243A]"
              />
            </div>

            <div>
              <label
                htmlFor="thr-critical"
                className="block text-[11.5px] font-medium text-[#30415D] mb-1"
              >
                Critical ({currency})
              </label>
              <input
                id="thr-critical"
                type="number"
                step="0.01"
                data-testid="thr-input-critical"
                value={criticalAmount}
                onChange={(e) => setCriticalAmount(e.target.value)}
                className="h-9 w-full rounded-[8px] border border-[#C7D2E3] bg-[#FFFFFF] px-2.5 text-[12.5px] text-[#17243A]"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-2 text-[11.5px] text-[#64748B]">
              <span>Currency:</span>
              <input
                aria-label="Rule ISO currency"
                data-testid="thr-input-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                className="h-7 w-16 rounded-[6px] border border-[#C7D2E3] bg-[#FFFFFF] px-2 font-mono text-[12px] text-[#17243A]"
              />
              <span>• Deduplicated per period &amp; severity</span>
            </div>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={loading}
              data-testid="thr-submit-btn"
            >
              Save Spending Rule
            </Button>
          </div>
        </form>
      ) : null}

      {/* Configured Threshold Rules List */}
      <div className="space-y-2.5" data-testid="cost-thresholds-list">
        {thresholds.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-[#C7D2E3] bg-[#F7F9FC] p-4 text-[12.5px] text-[#64748B]">
            No Avenor spending threshold rules configured for this product yet.
          </div>
        ) : (
          thresholds.map((t) => {
            const badge = getSeverityBadge(t.lastStatus);
            return (
              <div
                key={t.id}
                data-testid={`cost-threshold-row-${t.id}`}
                className="rounded-[10px] border border-[#DFE6F0] bg-[#FFFFFF] p-3.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold text-[#17243A]">{t.name}</span>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                    <Badge tone="neutral">
                      {t.periodType} • {t.metricBasis}
                    </Badge>
                  </div>
                  <div className="font-mono text-[12px] text-[#64748B]">
                    Currency: {t.currency} •{" "}
                    {t.warningAmount !== null
                      ? `Warning: ${t.currency} ${t.warningAmount.toFixed(2)} • `
                      : ""}
                    Critical: {t.currency} {t.criticalAmount.toFixed(2)}
                  </div>
                </div>
                <div className="text-[11.5px] text-[#64748B] tabular-nums">
                  {t.lastEvaluatedAtIso
                    ? `Evaluated ${t.lastEvaluatedAtIso.slice(0, 16).replace("T", " ")} UTC`
                    : "Not evaluated yet"}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Recent Evaluation & Alert Deduplication Ledger */}
      {evaluations.length > 0 ? (
        <div className="space-y-2 border-t border-[#DFE6F0] pt-4" data-testid="cost-evaluations-list">
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#17243A]">
            <ShieldAlert className="h-3.5 w-3.5 text-[#5157D9]" aria-hidden="true" />
            <span>Threshold Evaluation &amp; Deduplication History</span>
          </div>
          <div className="space-y-2">
            {evaluations.slice(0, 8).map((ev) => {
              const badge = getSeverityBadge(ev.severity);
              return (
                <div
                  key={ev.id}
                  className="rounded-[8px] border border-[#DFE6F0] bg-[#F7F9FC] px-3 py-2 text-[12px] flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={badge.tone}>{ev.severity}</Badge>
                      <span className="font-medium text-[#17243A]">{ev.summary}</span>
                    </div>
                    <div className="font-mono text-[10.5px] text-[#64748B]">
                      Dedupe Key: {ev.dedupeKey} •{" "}
                      {ev.alertTriggered
                        ? "Alert Triggered"
                        : ev.wasDeduplicatedRepeat
                          ? "Deduplicated Repeat (Suppressed)"
                          : "No Alert"}
                    </div>
                  </div>
                  <span className="font-mono text-[11px] text-[#64748B] tabular-nums">
                    {ev.periodStartDate} → {ev.periodEndDate}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
