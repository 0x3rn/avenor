"use client";

import { Badge, Card } from "@avenor/ui";
import { AlertTriangle, Info, Scale } from "lucide-react";
import type { Ga4VsGscReconciliationSummary } from "@/lib/providers/google-search-console/types";
import {
  formatIntegerCount,
  formatPositionRank,
  formatRatioPercent,
} from "@/lib/reports/date-window";

export function Ga4VsGscReconciliationPanel({
  reconciliation,
}: {
  reconciliation: Ga4VsGscReconciliationSummary;
}) {
  const scopeTone =
    reconciliation.scopeAlignmentStatus === "ALIGNED"
      ? "success"
      : reconciliation.scopeAlignmentStatus === "PARTIAL_SUBSET"
        ? "indigo"
        : reconciliation.scopeAlignmentStatus === "MISMATCHED_CANONICAL"
          ? "warning"
          : "neutral";

  return (
    <Card className="p-5 sm:p-6 space-y-5 min-w-0" data-testid="ga4-gsc-reconciliation-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Scale className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
            <h2 className="text-[18px] font-semibold text-[#17243A] m-0">
              GA4 vs Search Console Interpretation Guide
            </h2>
            <Badge tone={scopeTone}>{reconciliation.scopeAlignmentStatus}</Badge>
          </div>
          <p className="text-[13px] text-[#64748B] m-0">
            Side-by-side funnel comparison keeping pre-click Google Search observations strictly
            separate from post-load GA4 analytics sessions. Clicks are never summed with Sessions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Badge tone={reconciliation.timezoneOffsetMismatch ? "warning" : "neutral"}>
            GSC: {reconciliation.gscReportingTimeZone}
          </Badge>
          {reconciliation.ga4ReportingTimeZone ? (
            <Badge tone={reconciliation.timezoneOffsetMismatch ? "warning" : "neutral"}>
              GA4: {reconciliation.ga4ReportingTimeZone}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-[12px] border border-[#DFE6F0] bg-[#F7F9FC] p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-[#168E99]">
              Search Console (Pre-Click SERP Funnel)
            </span>
            {reconciliation.gscPropertyKind ? (
              <Badge tone="neutral">{reconciliation.gscPropertyKind}</Badge>
            ) : null}
          </div>
          <p className="font-mono text-[12px] text-[#64748B] truncate m-0">
            {reconciliation.gscSiteUrl ?? "No Search Console property mapped"}
          </p>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <p className="text-[11.5px] text-[#64748B] m-0">Search Clicks</p>
              <p className="text-[20px] font-semibold text-[#17243A] tabular-nums m-0">
                {formatIntegerCount(reconciliation.gscClicks)}
              </p>
            </div>
            <div>
              <p className="text-[11.5px] text-[#64748B] m-0">Impressions / Avg Pos</p>
              <p className="text-[15px] font-semibold text-[#17243A] tabular-nums m-0">
                {formatIntegerCount(reconciliation.gscImpressions)} •{" "}
                {formatPositionRank(reconciliation.gscPosition)}
              </p>
              <p className="text-[11px] text-[#64748B] tabular-nums m-0">
                Weighted CTR: {formatRatioPercent(reconciliation.gscCtr)}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-[12px] border border-[#DFE6F0] bg-[#F7F9FC] p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-[#5157D9]">
              GA4 (Post-Load Analytics Funnel)
            </span>
            {reconciliation.clickToOrganicSessionRatio !== null ? (
              <Badge tone="indigo">
                Click / Organic Session ratio: {reconciliation.clickToOrganicSessionRatio}
              </Badge>
            ) : null}
          </div>
          <p className="font-mono text-[12px] text-[#64748B] truncate m-0">
            {reconciliation.ga4PropertyName ?? "Map a GA4 property to unlock session alignment"}
          </p>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <p className="text-[11.5px] text-[#64748B] m-0">Organic Search Sessions</p>
              <p className="text-[20px] font-semibold text-[#17243A] tabular-nums m-0">
                {formatIntegerCount(reconciliation.ga4OrganicSessions)}
              </p>
            </div>
            <div>
              <p className="text-[11.5px] text-[#64748B] m-0">Total Sessions / Active Users</p>
              <p className="text-[15px] font-semibold text-[#17243A] tabular-nums m-0">
                {formatIntegerCount(reconciliation.ga4TotalSessions)} /{" "}
                {formatIntegerCount(reconciliation.ga4ActiveUsers)}
              </p>
              <p className="text-[11px] text-[#64748B] m-0">Consent & JS tag required</p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {reconciliation.notes.map((note) => {
          const isWarn = note.severity === "warning";
          return (
            <div
              key={`${note.topic}-${note.title}`}
              className={`flex items-start gap-2.5 rounded-[10px] border px-3.5 py-2.5 text-[12.5px] ${
                isWarn
                  ? "border-[#F5D9A6] bg-[#FFF5E5] text-[#8B5712]"
                  : "border-[#DFE6F0] bg-[#FFFFFF] text-[#30415D]"
              }`}
            >
              {isWarn ? (
                <AlertTriangle
                  className="h-4 w-4 shrink-0 mt-0.5 text-[#A66A16]"
                  aria-hidden="true"
                />
              ) : (
                <Info className="h-4 w-4 shrink-0 mt-0.5 text-[#5157D9]" aria-hidden="true" />
              )}
              <div className="space-y-0.5 min-w-0">
                <p className="font-semibold text-[#17243A] m-0">{note.title}</p>
                <p className="text-[12px] leading-[18px] m-0 opacity-90">{note.summary}</p>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
