import { type AvenorUxState, canRenderNumericValue, UX_STATE_DESCRIPTORS } from "@avenor/types";
import { AlertCircle, AlertTriangle, Compass, Info, ShieldCheck } from "lucide-react";
import type * as React from "react";
import { Badge, Card, Skeleton, StatusIndicator } from "./primitives";
import { cn, formatTabularNumber } from "./utils";

export interface MetricCardProps {
  title: string;
  definition: string;
  state: AvenorUxState;
  value?: number | null;
  formattedValue?: string;
  unit?: string;
  sourceLabel?: string;
  freshnessLabel?: string;
  comparisonDeltaText?: string;
  actionSlot?: React.ReactNode;
  className?: string;
}

/**
 * Signal Atlas MetricCard (Master Product Design Brief Sections 07 & 13)
 * Enforces metric integrity:
 * - Never renders fake 0 when `state` is `unconnected`, `empty_first_use`, etc.
 * - Uses `tabular-nums` for all numeric measurements.
 * - Pairs every value or non-numeric state with definition, source provenance, and freshness context.
 */
export function MetricCard({
  title,
  definition,
  state,
  value,
  formattedValue,
  unit,
  sourceLabel,
  freshnessLabel,
  comparisonDeltaText,
  actionSlot,
  className,
}: MetricCardProps) {
  const descriptor = UX_STATE_DESCRIPTORS[state];
  const isNumericAllowed = canRenderNumericValue(state, value ?? null);

  return (
    <Card className={cn("p-5 sm:p-6 flex flex-col justify-between gap-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <span className="text-[14px] font-semibold text-[#17243A] block">{title}</span>
          <p className="text-[12.5px] leading-[18px] text-[#64748B] m-0">{definition}</p>
        </div>
        {sourceLabel ? <Badge tone="signal">{sourceLabel}</Badge> : null}
      </div>

      {state === "loading_initial" ? (
        <div
          role="status"
          className="space-y-2 py-1"
          aria-busy="true"
          aria-label={`Loading ${title}`}
        >
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-4 w-44" />
        </div>
      ) : isNumericAllowed ? (
        <div className="space-y-1.5">
          <div className="flex items-baseline gap-2">
            <span
              data-testid="metric-card-numeric-value"
              className="text-[30px] sm:text-[34px] leading-[1.15] font-semibold tracking-[-0.02em] text-[#17243A] tabular-nums"
            >
              {formattedValue ?? formatTabularNumber(value as number)}
            </span>
            {unit ? (
              <span className="text-[13px] font-medium text-[#64748B] tabular-nums">{unit}</span>
            ) : null}
          </div>
          {comparisonDeltaText ? (
            <p className="text-[12.5px] text-[#30415D] tabular-nums m-0">{comparisonDeltaText}</p>
          ) : null}
        </div>
      ) : (
        <div
          data-testid="metric-card-non-numeric-state"
          className="rounded-[12px] bg-[#F7F9FC] border border-[#DFE6F0] p-3.5 space-y-1.5"
        >
          <StatusIndicator
            tone={descriptor.tone}
            label={descriptor.label}
            pulse={state === "connected_syncing"}
          />
          <p className="text-[12.5px] leading-[18px] text-[#64748B] m-0">
            {descriptor.explanation}
          </p>
          {actionSlot ? <div className="pt-1">{actionSlot}</div> : null}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#DFE6F0] text-[12px] text-[#64748B]">
        <StatusIndicator tone={descriptor.tone} label={descriptor.label} />
        {freshnessLabel ? <span className="tabular-nums">{freshnessLabel}</span> : null}
      </div>
    </Card>
  );
}

export interface EmptyStateProps {
  title: string;
  description: string;
  reason?: string;
  icon?: React.ReactNode;
  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  reason,
  icon,
  primaryAction,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <Card
      className={cn(
        "p-6 sm:p-8 flex flex-col items-start gap-4 bg-white border border-[#DFE6F0]",
        className,
      )}
    >
      <div className="h-10 w-10 rounded-[12px] bg-[#ECEEFF] border border-[#CED3FF] text-[#5157D9] flex items-center justify-center">
        {icon ?? <Compass className="h-5 w-5" aria-hidden="true" />}
      </div>
      <div className="space-y-1.5 max-w-2xl">
        <h3 className="text-[18px] leading-[26px] font-semibold text-[#17243A] m-0">{title}</h3>
        <p className="text-[14.5px] leading-[22px] text-[#30415D] m-0">{description}</p>
        {reason ? (
          <p className="text-[12.5px] leading-[18px] text-[#64748B] m-0">{reason}</p>
        ) : null}
      </div>
      {primaryAction || secondaryAction ? (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {primaryAction}
          {secondaryAction}
        </div>
      ) : null}
    </Card>
  );
}

export interface ErrorStateProps {
  title: string;
  message: string;
  code?: string;
  retryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
}

export function ErrorState({
  title,
  message,
  code,
  retryAction,
  secondaryAction,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-[16px] bg-[#FDECEF] border border-[#F6C3CB] p-5 sm:p-6 flex flex-col gap-3",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 text-[#BF4256]">
          <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <h3 className="text-[16px] font-semibold text-[#17243A] m-0">{title}</h3>
        </div>
        {code ? <Badge tone="critical">{code}</Badge> : null}
      </div>
      <p className="text-[14px] leading-[21px] text-[#30415D] m-0">{message}</p>
      {retryAction || secondaryAction ? (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {retryAction}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}

export interface WarningBannerProps {
  title: string;
  description: string;
  tone?: "warning" | "signal" | "indigo";
  action?: React.ReactNode;
  className?: string;
}

export function WarningBanner({
  title,
  description,
  tone = "warning",
  action,
  className,
}: WarningBannerProps) {
  const toneStyles = {
    warning: "bg-[#FFF5E5] border-[#F5D9A6] text-[#A66A16]",
    signal: "bg-[#E7F6F7] border-[#B8E5E8] text-[#168E99]",
    indigo: "bg-[#ECEEFF] border-[#CED3FF] text-[#4047BD]",
  }[tone];

  const IconComponent = tone === "warning" ? AlertTriangle : tone === "signal" ? ShieldCheck : Info;

  return (
    <div
      role="status"
      className={cn(
        "rounded-[14px] border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3",
        toneStyles,
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <IconComponent className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="space-y-0.5">
          <p className="text-[14px] font-semibold text-[#17243A] m-0">{title}</p>
          <p className="text-[13px] leading-[19px] text-[#30415D] m-0">{description}</p>
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
