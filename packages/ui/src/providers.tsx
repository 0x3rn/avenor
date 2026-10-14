import type {
  CapabilityStatus,
  ConnectionHealthStatus,
  EvaluatedProviderCapability,
  ProviderAvailabilityStatus,
  SemanticTone,
} from "@avenor/types";
import { AlertTriangle, CheckCircle2, Clock3, Lock, ShieldAlert, ShieldCheck } from "lucide-react";
import type * as React from "react";
import { Badge, type BadgeTone, Card, StatusIndicator } from "./primitives";
import { cn } from "./utils";

const CAPABILITY_STATUS_CONFIG: Record<
  CapabilityStatus,
  { label: string; tone: BadgeTone; icon: React.ReactNode }
> = {
  SUPPORTED: {
    label: "Supported",
    tone: "success",
    icon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />,
  },
  MISSING_PERMISSION: {
    label: "Missing read scope",
    tone: "warning",
    icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />,
  },
  UNSUPPORTED_BY_PROVIDER: {
    label: "Unsupported by provider",
    tone: "neutral",
    icon: <Lock className="h-3.5 w-3.5" aria-hidden="true" />,
  },
  PLAN_RESTRICTED: {
    label: "Provider plan tier limit",
    tone: "warning",
    icon: <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />,
  },
  PREVIEW_ONLY: {
    label: "Contract verified",
    tone: "signal",
    icon: <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />,
  },
};

export function CapabilityStatusBadge({
  status,
  className,
}: {
  status: CapabilityStatus;
  className?: string;
}) {
  const config = CAPABILITY_STATUS_CONFIG[status];
  return (
    <Badge
      tone={config.tone}
      icon={config.icon}
      data-testid={`capability-badge-${status.toLowerCase()}`}
      className={className}
    >
      {config.label}
    </Badge>
  );
}

const HEALTH_STATUS_CONFIG: Record<
  ConnectionHealthStatus,
  { label: string; tone: SemanticTone; pulse?: boolean }
> = {
  NOT_CONNECTED: { label: "Not connected", tone: "neutral" },
  CONNECTING: { label: "Connecting", tone: "signal", pulse: true },
  SYNCING: { label: "Syncing", tone: "signal", pulse: true },
  HEALTHY: { label: "Healthy", tone: "success" },
  DEGRADED: { label: "Degraded", tone: "warning" },
  STALE: { label: "Stale snapshot", tone: "warning" },
  WARNING: { label: "Warning", tone: "warning" },
  PERMISSION_MISSING: { label: "Permission missing", tone: "warning" },
  TOKEN_EXPIRED: { label: "Token expired", tone: "warning" },
  REVOKED: { label: "Access revoked", tone: "critical" },
  RATE_LIMITED: { label: "Rate limited", tone: "warning" },
  PROVIDER_UNAVAILABLE: { label: "Provider unavailable", tone: "critical" },
  FAILED: { label: "Failed", tone: "critical" },
  DISCONNECTED: { label: "Disconnected", tone: "neutral" },
};

export function ConnectionHealthBadge({
  status,
  className,
}: {
  status: ConnectionHealthStatus;
  className?: string;
}) {
  const config = HEALTH_STATUS_CONFIG[status] ?? {
    label: status,
    tone: "neutral" as SemanticTone,
  };
  return (
    <StatusIndicator
      tone={config.tone}
      label={config.label}
      pulse={config.pulse}
      data-testid={`connection-health-${status.toLowerCase()}`}
      className={className}
    />
  );
}

export function ProviderAvailabilityBadge({
  availabilityStatus,
  targetMilestone,
}: {
  availabilityStatus: ProviderAvailabilityStatus;
  targetMilestone: string;
}) {
  if (availabilityStatus === "active_sandbox") {
    return <Badge tone="read-only">Active in Sandbox ({targetMilestone})</Badge>;
  }
  if (availabilityStatus === "oauth_framework_ready") {
    return <Badge tone="indigo">OAuth & Mapping Ready • Sync in {targetMilestone}</Badge>;
  }
  return <Badge tone="planned">Planned • {targetMilestone}</Badge>;
}

export interface ReadOnlyGuaranteeCalloutProps {
  providerName: string;
  guaranteeText: string;
  requiredScopes: readonly string[];
  prohibitedOperations: readonly string[];
  className?: string;
}

export function ReadOnlyGuaranteeCallout({
  providerName,
  guaranteeText,
  requiredScopes,
  prohibitedOperations,
  className,
}: ReadOnlyGuaranteeCalloutProps) {
  return (
    <Card
      data-testid="read-only-guarantee-callout"
      className={cn("p-5 bg-[#F7F9FC] border-[#B8E5E8] space-y-4", className)}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-[10px] bg-[#E7F6F7] border border-[#B8E5E8] text-[#168E99] flex items-center justify-center shrink-0">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h4 className="text-[14.5px] font-semibold text-[#17243A] m-0">
              {providerName} Read-Only Security Contract
            </h4>
            <p className="text-[12.5px] text-[#30415D] m-0">
              Avenor enforces a strict read-only boundary and never mutates connected services.
            </p>
          </div>
        </div>
        <Badge tone="read-only">Read-only verified</Badge>
      </div>

      <p className="text-[13.5px] leading-[20px] text-[#30415D] m-0">{guaranteeText}</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
        <div className="rounded-[12px] bg-white border border-[#DFE6F0] p-3.5 space-y-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#147D63] block">
            Requested Read-Only Scopes
          </span>
          <div className="flex flex-wrap gap-1.5">
            {requiredScopes.map((scope) => (
              <code
                key={scope}
                className="text-[12px] font-mono px-2 py-0.5 rounded-[6px] bg-[#F0F4FA] text-[#17243A] border border-[#DFE6F0] break-all"
              >
                {scope}
              </code>
            ))}
          </div>
        </div>

        <div className="rounded-[12px] bg-white border border-[#DFE6F0] p-3.5 space-y-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#64748B] block">
            Explicitly Prohibited by Contract
          </span>
          <ul className="space-y-1 m-0 pl-4 text-[12.5px] leading-[18px] text-[#30415D]">
            {prohibitedOperations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

export interface CapabilityMatrixListProps {
  capabilities: readonly EvaluatedProviderCapability[];
  className?: string;
}

export function CapabilityMatrixList({ capabilities, className }: CapabilityMatrixListProps) {
  return (
    <div data-testid="capability-matrix-list" className={cn("space-y-3", className)}>
      {capabilities.map((cap) => (
        <div
          key={cap.capabilityKey}
          data-testid={`capability-row-${cap.capabilityKey}`}
          className="rounded-[14px] bg-white border border-[#DFE6F0] p-4 flex flex-col gap-2.5"
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-0.5">
              <span className="text-[14px] font-semibold text-[#17243A] block">{cap.label}</span>
              <p className="text-[13px] leading-[19px] text-[#64748B] m-0">{cap.description}</p>
            </div>
            <CapabilityStatusBadge status={cap.status} />
          </div>

          <p className="text-[12.5px] leading-[18px] text-[#30415D] m-0 bg-[#F7F9FC] border border-[#DFE6F0] rounded-[10px] px-3 py-2">
            {cap.statusExplanation}
          </p>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[12px] text-[#64748B]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span>Scopes:</span>
              {cap.requiredScopes.map((scope) => (
                <code
                  key={scope}
                  className="font-mono text-[11.5px] px-1.5 py-0.5 rounded bg-[#F0F4FA] text-[#30415D]"
                >
                  {scope}
                </code>
              ))}
            </div>
            <div className="flex items-center gap-3 tabular-nums">
              {cap.freshnessWindowMinutes > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                  Freshness window: {cap.freshnessWindowMinutes}m
                </span>
              ) : (
                <span>No live polling</span>
              )}
              <span>Quota: {cap.rateLimitPolicy.requestsPerMinute} req/min</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
