import { Badge, Card, WarningBanner } from "@avenor/ui";
import { GitCommitHorizontal, Link2 } from "lucide-react";
import type {
  OperationalCorrelationRecord,
  OperationalEventRecord,
} from "@/lib/reliability/correlation";

export interface CorrelationTimelinePanelProps {
  events: readonly OperationalEventRecord[];
  correlations: readonly OperationalCorrelationRecord[];
  causationDisclaimer: string;
}

export function CorrelationTimelinePanel({
  events,
  correlations,
  causationDisclaimer,
}: CorrelationTimelinePanelProps) {
  return (
    <div className="space-y-4" data-testid="correlation-timeline-panel">
      <WarningBanner
        tone="indigo"
        title="Evidence-Based Operational Correlation (Not Proven Causation)"
        description={causationDisclaimer}
      />

      <Card className="p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
          <h2 className="text-[16px] font-semibold text-[#17243A]">
            Cross-Provider Signal Associations ({correlations.length})
          </h2>
        </div>

        {correlations.length === 0 ? (
          <p className="text-[13.5px] text-[#64748B]">
            No cross-provider correlations observed in the selected environment window.
          </p>
        ) : (
          <div className="space-y-2.5">
            {correlations.map((corr) => (
              <div
                key={corr.correlationId}
                className="rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC] p-3.5 space-y-1.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    tone={
                      corr.evidenceLevel === "DIRECTLY_LINKED"
                        ? "indigo"
                        : corr.evidenceLevel === "TEMPORALLY_ASSOCIATED"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {corr.evidenceLevel === "DIRECTLY_LINKED"
                      ? "Directly Linked"
                      : corr.evidenceLevel === "TEMPORALLY_ASSOCIATED"
                        ? "Observed Near"
                        : "Insufficient Granularity"}
                  </Badge>
                  <Badge tone="neutral">{corr.environmentName}</Badge>
                  {corr.sharedIdentifier && (
                    <span className="font-mono text-[12px] text-[#5157D9]">
                      ID: {corr.sharedIdentifier}
                    </span>
                  )}
                </div>
                <p className="text-[13.5px] text-[#17243A]">{corr.cautiousStatement}</p>
                <p className="font-mono text-[11.5px] text-[#64748B]">{corr.granularityNote}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <GitCommitHorizontal className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
          <h2 className="text-[16px] font-semibold text-[#17243A]">
            Unified Operational Event Tracks ({events.length})
          </h2>
        </div>

        {events.length === 0 ? (
          <p className="text-[13.5px] text-[#64748B]">
            No deployment, CI, error, or backend pressure events recorded for this product yet.
          </p>
        ) : (
          <div className="space-y-2">
            {events.map((ev) => (
              <div
                key={ev.id}
                className="rounded-[8px] border border-[#DFE6F0] bg-[#FFFFFF] px-4 py-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="indigo">{ev.providerKey}</Badge>
                    <Badge tone="neutral">{ev.eventType}</Badge>
                    <Badge tone="neutral">{ev.environmentName}</Badge>
                    <span className="font-medium text-[13.5px] text-[#17243A]">{ev.summary}</span>
                  </div>
                  <p className="font-mono text-[12px] text-[#64748B]">
                    {ev.occurredAtIso} ({ev.sourceTimezone} • {ev.sourceGranularity})
                    {ev.commitSha ? ` • sha:${ev.commitSha.slice(0, 10)}` : ""}
                  </p>
                </div>
                <Badge tone="neutral">{ev.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
