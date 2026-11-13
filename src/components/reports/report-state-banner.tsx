"use client";

import type { AvenorUxState, LogicalProjectSummary } from "@avenor/types";
import { Badge, Button, Card, EmptyState, Select, WarningBanner } from "@avenor/ui";
import { AlertTriangle, ExternalLink, Lock, RefreshCw, ShieldAlert, Unplug } from "lucide-react";
import Link from "next/link";
import type * as React from "react";
import type { ResolvedReportDateWindow } from "@/lib/reports/date-window";

export interface ReportContextToolbarProps {
  testIdPrefix: string;
  projects?: LogicalProjectSummary[];
  selectedProjectId: string;
  onProjectChange?: (projectId: string) => void;
  environments?: Array<{ id: string; name: string; type: string; isDefault: boolean }>;
  selectedEnvironmentId: string;
  onEnvironmentChange: (environmentId: string) => void;
  windowState: ResolvedReportDateWindow;
  onPresetChange: (preset: "7d" | "28d" | "90d") => void;
  customStartDate: string;
  customEndDate: string;
  onCustomStartChange: (value: string) => void;
  onCustomEndChange: (value: string) => void;
  onApplyCustomDates: () => void;
  onToggleCompare: () => void;
  onRefresh: () => void;
  isLoading: boolean;
  extraControls?: React.ReactNode;
}

export function ReportContextToolbar({
  testIdPrefix,
  projects,
  selectedProjectId,
  onProjectChange,
  environments,
  selectedEnvironmentId,
  onEnvironmentChange,
  windowState,
  onPresetChange,
  customStartDate,
  customEndDate,
  onCustomStartChange,
  onCustomEndChange,
  onApplyCustomDates,
  onToggleCompare,
  onRefresh,
  isLoading,
  extraControls,
}: ReportContextToolbarProps) {
  return (
    <Card className="p-4 sm:p-5 space-y-4 min-w-0" data-testid={`${testIdPrefix}-toolbar`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
          {projects && projects.length > 0 && onProjectChange ? (
            <div className="min-w-[200px]">
              <label
                htmlFor={`${testIdPrefix}-project-select`}
                className="block text-[11.5px] font-semibold uppercase tracking-wider text-[#64748B] mb-1"
              >
                Logical Product
              </label>
              <Select
                id={`${testIdPrefix}-project-select`}
                data-testid={`${testIdPrefix}-project-select`}
                value={selectedProjectId}
                onChange={(e) => onProjectChange(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          {environments && environments.length > 0 ? (
            <div className="min-w-[180px]">
              <label
                htmlFor={`${testIdPrefix}-environment-select`}
                className="block text-[11.5px] font-semibold uppercase tracking-wider text-[#64748B] mb-1"
              >
                Environment Tier
              </label>
              <Select
                id={`${testIdPrefix}-environment-select`}
                data-testid={`${testIdPrefix}-environment-select`}
                value={selectedEnvironmentId}
                onChange={(e) => onEnvironmentChange(e.target.value)}
              >
                <option value="">Default / Project Mapping</option>
                {environments.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.name} ({env.type})
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          {extraControls}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <fieldset className="inline-flex items-center rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC] p-1 m-0">
            <legend className="sr-only">Date range presets</legend>
            {(["7d", "28d", "90d"] as const).map((presetKey) => {
              const active = windowState.preset === presetKey;
              return (
                <button
                  key={presetKey}
                  type="button"
                  data-testid={`${testIdPrefix}-preset-${presetKey}`}
                  onClick={() => onPresetChange(presetKey)}
                  aria-pressed={active}
                  className={`rounded-[7px] px-2.5 py-1 text-[12.5px] font-medium cursor-pointer transition-colors ${
                    active
                      ? "bg-white text-[#17243A] border border-[#DFE6F0] shadow-xs"
                      : "text-[#64748B] hover:text-[#17243A]"
                  }`}
                >
                  {presetKey}
                </button>
              );
            })}
          </fieldset>

          <Button
            type="button"
            size="sm"
            variant={windowState.compareEnabled ? "primary" : "secondary"}
            data-testid={`${testIdPrefix}-compare-toggle`}
            aria-pressed={windowState.compareEnabled}
            onClick={onToggleCompare}
          >
            Compare Prior
          </Button>

          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={isLoading}
            data-testid={`${testIdPrefix}-refresh-button`}
            leftIcon={
              <RefreshCw
                className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
            }
            onClick={onRefresh}
          >
            {isLoading ? "Updating..." : "Refresh"}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-end sm:justify-between border-t border-[#DFE6F0] pt-3">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label
              htmlFor={`${testIdPrefix}-start-date`}
              className="block text-[11px] font-medium text-[#64748B] mb-1"
            >
              Start ({windowState.timeZone})
            </label>
            <input
              id={`${testIdPrefix}-start-date`}
              data-testid={`${testIdPrefix}-start-date`}
              type="date"
              value={customStartDate}
              onChange={(e) => onCustomStartChange(e.target.value)}
              className="h-9 rounded-[9px] border border-[#DFE6F0] bg-white px-2.5 text-[13px] text-[#17243A]"
            />
          </div>
          <div>
            <label
              htmlFor={`${testIdPrefix}-end-date`}
              className="block text-[11px] font-medium text-[#64748B] mb-1"
            >
              End ({windowState.timeZone})
            </label>
            <input
              id={`${testIdPrefix}-end-date`}
              data-testid={`${testIdPrefix}-end-date`}
              type="date"
              value={customEndDate}
              onChange={(e) => onCustomEndChange(e.target.value)}
              className="h-9 rounded-[9px] border border-[#DFE6F0] bg-white px-2.5 text-[13px] text-[#17243A]"
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid={`${testIdPrefix}-apply-dates-button`}
            disabled={!customStartDate || !customEndDate || customStartDate > customEndDate}
            onClick={onApplyCustomDates}
          >
            Apply Dates
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#64748B]">
          <span>
            Active window:{" "}
            <strong className="font-mono text-[#17243A]">
              {windowState.startDate} → {windowState.endDate}
            </strong>
          </span>
          {windowState.compareEnabled &&
          windowState.compareStartDate &&
          windowState.compareEndDate ? (
            <Badge tone="neutral">
              Prior: {windowState.compareStartDate} → {windowState.compareEndDate}
            </Badge>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

export function ReportBlockedStateCard({
  testId,
  providerLabel,
  uxState,
  message,
  actionLabel,
  actionHref,
  workspaceUnmappedCount,
}: {
  testId: string;
  providerLabel: string;
  uxState: AvenorUxState;
  message: string | null;
  actionLabel: string | null;
  actionHref: string | null;
  workspaceUnmappedCount?: number;
}) {
  const isPerm = uxState === "permission_insufficient";
  const isRateLimited = uxState === "rate_limited";
  const isError = uxState === "provider_error";

  const title = isPerm
    ? `${providerLabel} read-only permission required`
    : isRateLimited
      ? `${providerLabel} API quota temporarily rate-limited`
      : isError
        ? `${providerLabel} temporarily unavailable`
        : workspaceUnmappedCount && workspaceUnmappedCount > 0
          ? `${providerLabel} connected in workspace — map property to this product`
          : `${providerLabel} not connected to this product yet`;

  const Icon = isPerm ? Lock : isRateLimited ? AlertTriangle : isError ? ShieldAlert : Unplug;

  return (
    <div data-testid={testId}>
      <EmptyState
        title={title}
        description={
          message ??
          `No read-only ${providerLabel} property is mapped to this logical product or environment yet.`
        }
        reason="Avenor never fabricates numeric 0 fallbacks when provider data is unmapped, denied, or rate-limited."
        icon={<Icon className="h-5 w-5" aria-hidden="true" />}
        primaryAction={
          actionHref ? (
            <Link href={actionHref} data-testid={`${testId}-action`}>
              <Button
                type="button"
                variant="primary"
                rightIcon={<ExternalLink className="h-4 w-4" aria-hidden="true" />}
              >
                {actionLabel ?? `Open ${providerLabel} Connections`}
              </Button>
            </Link>
          ) : undefined
        }
      />
    </div>
  );
}

export function ReportDegradedBanner({
  testId,
  uxState,
  message,
  actionLabel,
  actionHref,
}: {
  testId: string;
  uxState: AvenorUxState;
  message: string | null;
  actionLabel?: string | null;
  actionHref?: string | null;
}) {
  if (!message && uxState === "connected_healthy") {
    return null;
  }

  const tone =
    uxState === "rate_limited" || uxState === "stale_cached" || uxState === "partial_coverage"
      ? "warning"
      : "signal";

  return (
    <div data-testid={testId}>
      <WarningBanner
        tone={tone}
        title={
          uxState === "rate_limited"
            ? "Rate limit active — showing stale cached snapshot"
            : uxState === "stale_cached"
              ? "Showing cached snapshot outside fresh SLA window"
              : uxState === "empty_filtered"
                ? "Zero rows matched your active filter criteria"
                : "Provider coverage & quality notices"
        }
        description={message ?? "Inspect provider coverage flags before drawing trend conclusions."}
        action={
          actionHref ? (
            <Link href={actionHref}>
              <Button type="button" size="sm" variant="secondary">
                {actionLabel ?? "Inspect connection"}
              </Button>
            </Link>
          ) : undefined
        }
      />
    </div>
  );
}
