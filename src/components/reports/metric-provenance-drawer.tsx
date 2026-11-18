"use client";

import { Badge, Button, Card } from "@avenor/ui";
import { BookOpen, Clock, Database, Info, Layers, ShieldCheck, X } from "lucide-react";
import * as React from "react";
import { findCanonicalMetricDefinition } from "@/lib/metrics/registry";
import type { MetricCompletenessState } from "@/lib/metrics/types";

export interface MetricProvenanceContext {
  canonicalMetricKey: string;
  externalResourceId: string;
  reportingTimezone: string;
  periodStartDate: string;
  periodEndDate: string;
  completenessState: MetricCompletenessState;
  lastCollectedAtIso?: string | null;
  currency?: string | null;
  limitations?: string[];
}

export function MetricDefinitionTrigger({
  canonicalMetricKey,
  onInspect,
}: {
  canonicalMetricKey: string;
  onInspect: (canonicalKey: string) => void;
}) {
  const safeId = canonicalMetricKey.replace(/\./g, "-");
  return (
    <button
      type="button"
      data-testid={`inspect-metric-${safeId}`}
      onClick={() => onInspect(canonicalMetricKey)}
      className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#5157D9] hover:text-[#4047BD] hover:underline cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5157D9] rounded-[4px]"
    >
      <Info className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>Provenance &amp; rules</span>
    </button>
  );
}

function formatAggregationRuleBadge(rule: string): {
  label: string;
  explanation: string;
} {
  switch (rule) {
    case "NON_ADDITIVE_DISTINCT":
      return {
        label: "Non-Additive Distinct Users",
        explanation:
          "Cannot be summed across dates or across distinct properties without double-counting returning users. Requires provider-deduplicated window totals (RESERVED_TOTAL).",
      };
    case "WEIGHTED_RATIO":
      return {
        label: "Denominator-Weighted Ratio",
        explanation:
          "Computed strictly from total numerator divided by total denominator across the reporting window. Never computed as an unweighted mean of daily ratios.",
      };
    case "WEIGHTED_AVERAGE":
      return {
        label: "Volume-Weighted Average",
        explanation:
          "Weighted by impression or session volume across intervals rather than averaging daily averages.",
      };
    case "SUM":
      return {
        label: "Additive Count (Disjoint Periods)",
        explanation:
          "May be summed across strictly disjoint reporting intervals within a consistent property scope.",
      };
    default:
      return {
        label: rule,
        explanation: "Governed by canonical Avenor metric aggregation semantics.",
      };
  }
}

export function MetricProvenanceDrawer({
  context,
  onClose,
}: {
  context: MetricProvenanceContext | null;
  onClose: () => void;
}) {
  React.useEffect(() => {
    if (!context) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [context, onClose]);

  if (!context) {
    return null;
  }

  const def = findCanonicalMetricDefinition(context.canonicalMetricKey);
  if (!def) {
    return null;
  }

  const aggDetails = formatAggregationRuleBadge(def.aggregationRule);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#10192B]/40 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="metric-provenance-drawer-title"
      data-testid="metric-provenance-drawer"
    >
      <div className="relative h-full w-full max-w-[480px] overflow-y-auto bg-white border-l border-[#DFE6F0] shadow-xl p-5 sm:p-6 space-y-5">
        <div className="flex items-start justify-between gap-3 border-b border-[#DFE6F0] pb-4">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="indigo">{def.canonicalKey}</Badge>
              <Badge tone="neutral">Schema v{def.schemaVersion}</Badge>
              <Badge tone="read-only">{def.providerKey.toUpperCase()}</Badge>
            </div>
            <h2
              id="metric-provenance-drawer-title"
              className="text-[19px] font-semibold text-[#17243A] m-0"
            >
              {def.displayName}
            </h2>
          </div>

          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="close-metric-provenance-drawer"
            onClick={onClose}
            leftIcon={<X className="h-3.5 w-3.5" aria-hidden="true" />}
          >
            Close
          </Button>
        </div>

        <Card className="p-4 bg-[#F7F9FC] border-[#DFE6F0] space-y-2">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-[#30415D]">
            <BookOpen className="h-3.5 w-3.5 text-[#5157D9]" aria-hidden="true" />
            <span>Canonical Metric Definition</span>
          </div>
          <p className="text-[13.5px] leading-relaxed text-[#17243A] m-0">{def.description}</p>
        </Card>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-[12px] border border-[#DFE6F0] p-3.5 space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B] block">
              Source Resource
            </span>
            <span
              className="text-[13px] font-mono font-semibold text-[#17243A] break-all block"
              data-testid="provenance-drawer-resource"
            >
              {context.externalResourceId}
            </span>
            <span className="text-[11.5px] text-[#64748B] block">
              Provider field: <code>{def.providerMetricName}</code>
            </span>
          </div>

          <div className="rounded-[12px] border border-[#DFE6F0] p-3.5 space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B] block">
              Reporting Timezone
            </span>
            <span
              className="text-[13px] font-mono font-semibold text-[#17243A] block"
              data-testid="provenance-drawer-timezone"
            >
              {context.reportingTimezone}
            </span>
            <span className="text-[11.5px] text-[#64748B] block">
              Policy: {def.timezoneBehavior}
            </span>
          </div>

          <div className="rounded-[12px] border border-[#DFE6F0] p-3.5 space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B] block">
              Measurement Window
            </span>
            <span className="text-[13px] font-mono font-semibold text-[#17243A] block">
              {context.periodStartDate} → {context.periodEndDate}
            </span>
            <span className="text-[11.5px] text-[#64748B] block">
              Half-open local period [start, end)
            </span>
          </div>

          <div className="rounded-[12px] border border-[#DFE6F0] p-3.5 space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B] block">
              Value Type &amp; Unit
            </span>
            <span className="text-[13px] font-semibold text-[#17243A] block">
              {def.valueType} ({def.unit})
            </span>
            <span className="text-[11.5px] text-[#64748B] block">
              Completeness: <strong>{context.completenessState}</strong>
            </span>
          </div>
        </div>

        <Card
          className="p-4 border-[#DFE6F0] space-y-2.5"
          data-testid="provenance-drawer-aggregation"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-[#30415D]">
              <Layers className="h-3.5 w-3.5 text-[#168E99]" aria-hidden="true" />
              <span>Aggregation Semantics</span>
            </div>
            <Badge tone={def.isAdditiveAcrossDates ? "success" : "warning"}>
              {aggDetails.label}
            </Badge>
          </div>
          <p className="text-[13px] text-[#30415D] leading-relaxed m-0">{aggDetails.explanation}</p>
          <div className="flex flex-wrap gap-2 pt-1 text-[12px] text-[#64748B]">
            <span>
              Additive across dates: <strong>{def.isAdditiveAcrossDates ? "Yes" : "No"}</strong>
            </span>
            <span>•</span>
            <span>
              Additive across properties:{" "}
              <strong>{def.isAdditiveAcrossResources ? "Yes" : "No"}</strong>
            </span>
          </div>
          {def.numeratorMetricKey && def.denominatorMetricKey ? (
            <p className="text-[12px] font-mono text-[#4047BD] bg-[#ECEEFF] rounded-[8px] px-2.5 py-1.5 m-0">
              Formula: {def.numeratorMetricKey} / {def.denominatorMetricKey}
            </p>
          ) : null}
        </Card>

        <div className="rounded-[12px] border border-[#DFE6F0] p-4 space-y-2.5">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-[#30415D]">
            <Clock className="h-3.5 w-3.5 text-[#5157D9]" aria-hidden="true" />
            <span>Freshness &amp; Collection Provenance</span>
          </div>
          <div className="text-[12.5px] text-[#30415D] space-y-1">
            <p className="m-0">
              Expected source cadence: within{" "}
              <strong>{Math.round(def.freshnessWindowMinutes / 60)}h</strong> ({def.capabilityKey})
            </p>
            {context.lastCollectedAtIso ? (
              <p className="m-0">
                Observed / collected at:{" "}
                <span className="font-mono">{context.lastCollectedAtIso}</span>
              </p>
            ) : null}
          </div>
        </div>

        <div className="rounded-[12px] border border-[#DFE6F0] p-4 space-y-2">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-[#30415D]">
            <Database className="h-3.5 w-3.5 text-[#168E99]" aria-hidden="true" />
            <span>Supported Breakdown Dimensions ({def.supportedDimensions.length})</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {def.supportedDimensions.map((dim) => (
              <Badge key={dim} tone="neutral">
                {dim}
              </Badge>
            ))}
          </div>
        </div>

        {context.limitations && context.limitations.length > 0 ? (
          <div className="rounded-[12px] border border-[#F5D9A6] bg-[#FFF5E5] p-4 space-y-1.5">
            <span className="text-[12px] font-semibold text-[#A66A16] block">
              Active Data Quality &amp; Scope Notes
            </span>
            <ul className="list-disc pl-4 space-y-1 text-[12.5px] text-[#30415D] m-0">
              {context.limitations.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex items-center gap-2 rounded-[10px] bg-[#E7F6F7] border border-[#B8E5E8] px-3.5 py-2.5 text-[12px] text-[#168E99]">
          <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Read-only external boundary: Avenor stores normalized aggregate observations and never
            mutates {def.providerKey.toUpperCase()} properties.
          </span>
        </div>
      </div>
    </div>
  );
}
