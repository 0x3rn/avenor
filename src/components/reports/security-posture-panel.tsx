"use client";

import { Badge, Card, WarningBanner } from "@avenor/ui";
import { FileText, ShieldCheck } from "lucide-react";
import type {
  PassiveSecurityPostureStatus,
  ProjectSecurityPostureReportDto,
} from "@/lib/reports/security-posture";

export interface SecurityPosturePanelProps {
  report: ProjectSecurityPostureReportDto;
}

function getPostureBadgeTone(
  status: PassiveSecurityPostureStatus,
): "success" | "warning" | "critical" | "neutral" | "indigo" {
  switch (status) {
    case "CONFIGURED":
      return "success";
    case "WARNING":
    case "NOT_CONFIGURED":
      return "warning";
    case "INSUFFICIENT_PERMISSION":
      return "critical";
    case "NOT_VERIFIED":
      return "indigo";
    default:
      return "neutral";
  }
}

export function SecurityPosturePanel({ report }: SecurityPosturePanelProps) {
  return (
    <section className="space-y-4" data-testid="passive-security-posture-panel">
      <Card className="p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#147D63]" aria-hidden="true" />
            <h2 className="text-[16px] font-semibold text-[#17243A]">
              Passive Security Posture Indicators
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="read-only">Read-Only Observation</Badge>
            <Badge tone="success">{report.countsByStatus.CONFIGURED} Configured</Badge>
            {report.countsByStatus.WARNING > 0 ? (
              <Badge tone="warning">{report.countsByStatus.WARNING} Warnings</Badge>
            ) : null}
            {report.countsByStatus.NOT_VERIFIED > 0 ? (
              <Badge tone="indigo">{report.countsByStatus.NOT_VERIFIED} Not Verified</Badge>
            ) : null}
          </div>
        </div>

        <WarningBanner
          tone="indigo"
          title="Non-Certification Disclosure"
          description={report.disclaimer}
        />

        {report.indicators.length === 0 ? (
          <p className="text-[13px] text-[#64748B]">
            No backend resources are mapped yet. Connect Neon, Supabase, or Firebase Cloud
            Monitoring to observe passive security posture metadata.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {report.indicators.map((ind) => (
              <div
                key={ind.id}
                data-testid={`posture-indicator-${ind.indicatorKey}`}
                className="rounded-[10px] border border-[#DFE6F0] bg-[#FFFFFF] p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[13.5px] font-semibold text-[#17243A]">{ind.title}</div>
                    <div className="text-[11.5px] text-[#64748B]">
                      {ind.providerKey} • {ind.resourceDisplayName}
                    </div>
                  </div>
                  <Badge tone={getPostureBadgeTone(ind.status)}>{ind.status}</Badge>
                </div>
                <p className="text-[12.5px] text-[#30415D] leading-relaxed">{ind.summary}</p>
                <p className="text-[11.5px] text-[#64748B] italic">{ind.qualificationNote}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5 sm:p-6 space-y-3" data-testid="sanitized-audit-summaries-panel">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
            <h3 className="text-[15px] font-semibold text-[#17243A]">
              Read-Only Sanitized Audit Summaries
            </h3>
          </div>
          <Badge tone="neutral">PII & Secrets Redacted</Badge>
        </div>

        {report.recentAuditSummaries.length === 0 ? (
          <p className="text-[13px] text-[#64748B]">No recent audit events recorded.</p>
        ) : (
          <ul className="divide-y divide-[#DFE6F0]">
            {report.recentAuditSummaries.map((entry) => (
              <li
                key={entry.id}
                className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[12.5px]"
              >
                <div className="space-y-0.5">
                  <span className="font-mono font-medium text-[#17243A]">{entry.action}</span>
                  <span className="ml-2 text-[#475569]">{entry.summary}</span>
                </div>
                <span className="font-mono text-[11.5px] text-[#64748B] shrink-0">
                  {entry.createdAtIso.slice(0, 19).replace("T", " ")} UTC
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
