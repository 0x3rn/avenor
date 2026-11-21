"use client";

import type { LogicalProjectSummary } from "@avenor/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FormField,
  Select,
  TextInput,
  WarningBanner,
} from "@avenor/ui";
import { Download, FileSpreadsheet, Play, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import type { ExecutedReportBenchmark, SavedReportRecord } from "@/lib/reports/custom-reports";

const CANONICAL_PICKER_METRICS = [
  { key: "ga4.sessions", label: "GA4 Sessions (Audience)" },
  { key: "ga4.active_users", label: "GA4 Active Users (Non-Additive)" },
  { key: "gsc.clicks", label: "Search Console Clicks" },
  { key: "gsc.impressions", label: "Search Console Impressions" },
  { key: "gcp.billing.net_cost", label: "Google Cloud Net Cost" },
  { key: "neon.compute_unit_seconds", label: "Neon Compute-Unit Seconds" },
  { key: "cloudflare.http_requests_total", label: "Cloudflare HTTP Requests" },
  { key: "sentry.error_events_total", label: "Sentry Error Events" },
] as const;

export interface ReportBuilderViewProps {
  projects: readonly LogicalProjectSummary[];
  initialReports: readonly SavedReportRecord[];
}

export function ReportBuilderView({ projects, initialReports }: ReportBuilderViewProps) {
  const [reports, setReports] = React.useState<SavedReportRecord[]>([...initialReports]);
  const [name, setName] = React.useState("");
  const [selectedProjects, setSelectedProjects] = React.useState<string[]>(
    projects.slice(0, 2).map((p) => p.id),
  );
  const [selectedMetrics, setSelectedMetrics] = React.useState<string[]>([
    "ga4.sessions",
    "gsc.clicks",
  ]);
  const [datePreset, setDatePreset] = React.useState<"7d" | "28d" | "90d">("28d");
  const [executed, setExecuted] = React.useState<ExecutedReportBenchmark | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  function toggleItem(list: string[], value: string, setter: (next: string[]) => void) {
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          projectIds: selectedProjects,
          metricKeys: selectedMetrics,
          datePreset,
          visualizationType: "COMPARISON_TABLE",
        }),
      });
      const payload = (await res.json()) as {
        report?: SavedReportRecord;
        error?: { message?: string };
      };
      if (!res.ok || !payload.report) {
        setErrorMessage(payload.error?.message ?? "Failed to save report definition.");
        return;
      }
      setReports((prev) => [payload.report as SavedReportRecord, ...prev]);
      setName("");
    } finally {
      setSaving(false);
    }
  }

  async function handleRun(reportId: string) {
    setErrorMessage(null);
    const res = await fetch(`/api/reports?executeId=${encodeURIComponent(reportId)}`);
    if (res.ok) {
      setExecuted((await res.json()) as ExecutedReportBenchmark);
    }
  }

  async function handleDelete(reportId: string) {
    const res = await fetch(`/api/reports?reportId=${encodeURIComponent(reportId)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setReports((prev) => prev.filter((r) => r.id !== reportId));
      if (executed?.report.id === reportId) setExecuted(null);
    }
  }

  return (
    <div className="space-y-6" data-testid="report-builder-view">
      <WarningBanner
        tone="signal"
        title="Capability-Aware Cross-Project Benchmarking"
        description="Avenor preserves source definitions, currency boundaries, and non-additive metric rules. Missing observations render as Unavailable rather than fabricated zeros."
      />

      <Card className="p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
          <h2 className="text-[16px] font-semibold text-[#17243A]">
            Compose Saved Comparison Report
          </h2>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField id="report-name" label="Report Title">
              <TextInput
                id="report-name"
                placeholder="Monthly Multi-Product Executive Comparison"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </FormField>
            <FormField id="report-preset" label="Reporting Window">
              <Select
                id="report-preset"
                value={datePreset}
                onChange={(e) => setDatePreset(e.target.value as "7d" | "28d" | "90d")}
              >
                <option value="7d">Last 7 days</option>
                <option value="28d">Last 28 days</option>
                <option value="90d">Last 90 days</option>
              </Select>
            </FormField>
          </div>

          <div className="space-y-2">
            <p className="text-[12.5px] font-semibold text-[#17243A]">Authorized Products</p>
            <div className="flex flex-wrap gap-2">
              {projects.map((p) => {
                const active = selectedProjects.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleItem(selectedProjects, p.id, setSelectedProjects)}
                    className={`rounded-[8px] border px-3 py-1.5 text-[12.5px] font-medium ${
                      active
                        ? "border-[#5157D9] bg-[#EEF0FF] text-[#3730A3]"
                        : "border-[#DFE6F0] bg-[#FFFFFF] text-[#475569]"
                    }`}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-[12.5px] font-semibold text-[#17243A]">Canonical Metrics</p>
            <div className="flex flex-wrap gap-2">
              {CANONICAL_PICKER_METRICS.map((m) => {
                const active = selectedMetrics.includes(m.key);
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => toggleItem(selectedMetrics, m.key, setSelectedMetrics)}
                    className={`rounded-[8px] border px-3 py-1.5 text-[12.5px] font-medium ${
                      active
                        ? "border-[#5157D9] bg-[#EEF0FF] text-[#3730A3]"
                        : "border-[#DFE6F0] bg-[#FFFFFF] text-[#475569]"
                    }`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={saving || selectedProjects.length === 0 || selectedMetrics.length === 0}
            >
              {saving ? "Saving..." : "Save Report Configuration"}
            </Button>
            {errorMessage && (
              <span className="text-[13px] font-medium text-[#B91C1C]" role="alert">
                {errorMessage}
              </span>
            )}
          </div>
        </form>
      </Card>

      <Card className="p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
          <h2 className="text-[16px] font-semibold text-[#17243A]">
            Saved Reports ({reports.length})
          </h2>
        </div>

        {reports.length === 0 ? (
          <EmptyState
            icon={<FileSpreadsheet className="h-5 w-5" aria-hidden="true" />}
            title="No Saved Reports Yet"
            description="Create a saved cross-project comparison above to benchmark metrics and generate formula-safe CSV or printable HTML/PDF exports."
          />
        ) : (
          <div className="space-y-3">
            {reports.map((report) => (
              <div
                key={report.id}
                className="rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC] p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[#17243A]">{report.name}</span>
                    <Badge tone="indigo">{report.datePreset}</Badge>
                    <Badge tone="neutral">{report.projectIds.length} products</Badge>
                    <Badge tone="neutral">{report.metricKeys.length} metrics</Badge>
                  </div>
                  <p className="font-mono text-[12px] text-[#64748B]">
                    {report.metricKeys.join(" • ")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Button type="button" size="sm" onClick={() => handleRun(report.id)}>
                    <Play className="h-3.5 w-3.5 mr-1" /> Run
                  </Button>
                  <a
                    href={`/api/reports?executeId=${encodeURIComponent(report.id)}&format=csv`}
                    className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-[#C7D2E3] bg-[#FFFFFF] px-2.5 text-[12px] font-medium text-[#17243A] hover:bg-[#F0F4FA]"
                  >
                    <Download className="h-3.5 w-3.5" /> CSV
                  </a>
                  <a
                    href={`/api/reports?executeId=${encodeURIComponent(report.id)}&format=html`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-[#C7D2E3] bg-[#FFFFFF] px-2.5 text-[12px] font-medium text-[#17243A] hover:bg-[#F0F4FA]"
                  >
                    Printable PDF
                  </a>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => handleDelete(report.id)}
                    aria-label={`Delete ${report.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-[#B91C1C]" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {executed && (
        <Card className="p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-[15.5px] font-semibold text-[#17243A]">
                {executed.report.name} — Benchmark Result
              </h3>
              <p className="font-mono text-[12px] text-[#64748B]">
                {executed.dateStart} → {executed.dateEnd} • {executed.provenanceSummary}
              </p>
            </div>
            <Badge tone="read-only">Verified Provenance</Badge>
          </div>
          {executed.warnings.length > 0 && (
            <ul className="list-disc pl-5 text-[12.5px] text-[#92400E] space-y-1">
              {executed.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] border-collapse">
              <thead>
                <tr className="border-b border-[#DFE6F0] text-[#64748B]">
                  <th className="py-2 pr-4">Product</th>
                  <th className="py-2 pr-4">Metric</th>
                  <th className="py-2 pr-4">Provider</th>
                  <th className="py-2 pr-4">Value</th>
                  <th className="py-2">Freshness</th>
                </tr>
              </thead>
              <tbody>
                {executed.rows.map((r) => (
                  <tr key={`${r.projectId}-${r.metricKey}`} className="border-b border-[#F1F5F9]">
                    <td className="py-2 pr-4 font-medium text-[#17243A]">{r.projectName}</td>
                    <td className="py-2 pr-4 font-mono text-[12px]">{r.metricKey}</td>
                    <td className="py-2 pr-4">{r.providerKey ?? "unconnected"}</td>
                    <td className="py-2 pr-4 font-mono">
                      {r.value === null ? "Unavailable" : `${r.value} ${r.unit}`}
                    </td>
                    <td className="py-2 text-[#64748B]">{r.freshnessLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
