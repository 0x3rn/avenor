"use client";

import { Badge, type BadgeTone, Button, Card } from "@avenor/ui";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  History,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import * as React from "react";
import type {
  IngestionSyncState,
  ProjectSyncResourceStatusItem,
  ProjectSyncStatusSummaryDto,
} from "@/lib/ingestion/types";

function getSyncStateMeta(state: IngestionSyncState | "UNMAPPED"): {
  label: string;
  tone: BadgeTone;
} {
  switch (state) {
    case "COMPLETED":
      return { label: "Complete", tone: "success" };
    case "RUNNING":
      return { label: "Syncing", tone: "signal" };
    case "PENDING":
      return { label: "Queued", tone: "neutral" };
    case "PARTIALLY_COMPLETED":
      return { label: "Partial / Retrying", tone: "warning" };
    case "RATE_LIMITED":
      return { label: "Rate-Limited", tone: "warning" };
    case "FAILED":
      return { label: "Sync Failed", tone: "critical" };
    case "PAUSED":
      return { label: "Paused", tone: "neutral" };
    case "CONNECTION_REVOKED":
      return { label: "Access Revoked", tone: "critical" };
    default:
      return { label: "Unmapped", tone: "neutral" };
  }
}

function formatRelativeOrIsoTime(iso: string | null | undefined): string {
  if (!iso) return "Not yet recorded";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}

export function SourceSyncStatusPanel({
  projectId,
  providerFilter,
  onSyncCompleted,
}: {
  projectId: string;
  providerFilter?: "ga4" | "gsc";
  onSyncCompleted?: () => void;
}) {
  const [summary, setSummary] = React.useState<ProjectSyncStatusSummaryDto | null>(null);
  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  const [activeActionResourceId, setActiveActionResourceId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const loadSyncStatus = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/sync`, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) return;
      const payload = (await res.json()) as ProjectSyncStatusSummaryDto;
      if (payload && Array.isArray(payload.resources)) {
        setSummary(payload);
      }
    } catch {
      // Non-fatal in unit tests or offline renders
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  React.useEffect(() => {
    void loadSyncStatus();
  }, [loadSyncStatus]);

  const handleAction = async (
    action: "sync" | "backfill" | "pause" | "resume",
    connectedResourceId: string,
  ) => {
    if (activeActionResourceId) return;
    setActiveActionResourceId(connectedResourceId);
    setActionError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action,
          connectedResourceId,
          backfillDays: action === "backfill" ? 28 : undefined,
        }),
      });
      const payload = (await res.json()) as {
        summary?: ProjectSyncStatusSummaryDto;
        error?: { message?: string };
      };
      if (!res.ok) {
        setActionError(payload.error?.message ?? "Unable to trigger source synchronization.");
        return;
      }
      if (payload.summary) {
        setSummary(payload.summary);
      } else {
        await loadSyncStatus();
      }
      onSyncCompleted?.();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Network error while triggering source sync.",
      );
    } finally {
      setActiveActionResourceId(null);
    }
  };

  const filteredResources: ProjectSyncResourceStatusItem[] = React.useMemo(() => {
    if (!summary || !Array.isArray(summary.resources)) return [];
    if (!providerFilter) return summary.resources;
    return summary.resources.filter((r) => r.providerKey === providerFilter);
  }, [summary, providerFilter]);

  if (isLoading || filteredResources.length === 0) {
    return null;
  }

  return (
    <Card className="p-4 sm:p-5 space-y-3 min-w-0" data-testid="source-sync-status-panel">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <History className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
          <h3 className="text-[14.5px] font-semibold text-[#17243A] m-0">
            Historical Ingestion &amp; Watermark Status
          </h3>
          <Badge tone="neutral">Idempotent Pipeline</Badge>
        </div>
        {summary?.lastSyncedAtIso ? (
          <span className="text-[12px] text-[#64748B]">
            Last durable commit: {formatRelativeOrIsoTime(summary.lastSyncedAtIso)}
          </span>
        ) : null}
      </div>

      {actionError ? (
        <div className="rounded-[10px] border border-[#F6C3CB] bg-[#FDECEF] px-3 py-2 text-[12.5px] text-[#BF4256]">
          {actionError}
        </div>
      ) : null}

      <div className="space-y-2.5">
        {filteredResources.map((item) => {
          const wm = item.watermark;
          const syncState: IngestionSyncState = wm?.syncState ?? "PENDING";
          const meta = getSyncStateMeta(syncState);
          const isBusy =
            activeActionResourceId === item.connectedResourceId || syncState === "RUNNING";
          const isRateLimited = syncState === "RATE_LIMITED";
          const isRevoked = syncState === "CONNECTION_REVOKED";

          return (
            <div
              key={item.connectedResourceId}
              data-testid={`sync-resource-row-${item.providerKey}`}
              className="flex flex-col gap-3 rounded-[12px] border border-[#DFE6F0] bg-[#F7F9FC] p-3.5 lg:flex-row lg:items-center lg:justify-between"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-[#17243A]">
                    {item.resourceDisplayName}
                  </span>
                  <span className="font-mono text-[11.5px] text-[#64748B]">
                    ({item.externalResourceId})
                  </span>
                  <Badge tone={meta.tone} data-testid={`sync-state-badge-${item.providerKey}`}>
                    {meta.label}
                  </Badge>
                  {wm?.sourceCompleteness ? (
                    <Badge tone="neutral">Coverage: {wm.sourceCompleteness}</Badge>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[#64748B]">
                  {wm?.lastCommittedStartDate && wm?.lastCommittedEndDate ? (
                    <span>
                      Committed window:{" "}
                      <strong className="font-mono text-[#30415D]">
                        {wm.lastCommittedStartDate} → {wm.lastCommittedEndDate}
                      </strong>
                    </span>
                  ) : (
                    <span>No historical observations committed yet</span>
                  )}

                  {wm?.nextScheduledAtIso ? (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      Next scheduled: {formatRelativeOrIsoTime(wm.nextScheduledAtIso)}
                    </span>
                  ) : null}

                  {/* Show batch progress ONLY when known from actual batch metadata (never invented percentages) */}
                  {item.knownBatchProgress ? (
                    <span
                      className="font-mono text-[#4047BD]"
                      data-testid={`sync-batch-progress-${item.providerKey}`}
                    >
                      Batches: {item.knownBatchProgress.completedBatches}/
                      {item.knownBatchProgress.totalBatches}
                    </span>
                  ) : null}
                </div>

                {wm?.lastErrorSummary && syncState !== "COMPLETED" ? (
                  <p className="text-[12px] text-[#A66A16] m-0 flex items-center gap-1.5">
                    {isRevoked ? (
                      <ShieldAlert className="h-3.5 w-3.5 text-[#BF4256] shrink-0" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-[#A66A16] shrink-0" />
                    )}
                    <span>{wm.lastErrorSummary}</span>
                  </p>
                ) : null}
              </div>

              {summary?.canTriggerSync ? (
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    data-testid={`trigger-sync-${item.providerKey}`}
                    disabled={isBusy || isRateLimited || isRevoked}
                    leftIcon={
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${isBusy ? "animate-spin" : ""}`}
                        aria-hidden="true"
                      />
                    }
                    onClick={() => void handleAction("sync", item.connectedResourceId)}
                  >
                    {isBusy ? "Syncing..." : "Sync Now"}
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid={`trigger-backfill-${item.providerKey}`}
                    disabled={isBusy || isRateLimited || isRevoked}
                    leftIcon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() => void handleAction("backfill", item.connectedResourceId)}
                  >
                    Backfill 28d
                  </Button>

                  {syncState === "PAUSED" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="subtle"
                      data-testid={`resume-sync-${item.providerKey}`}
                      disabled={isBusy}
                      leftIcon={<PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                      onClick={() => void handleAction("resume", item.connectedResourceId)}
                    >
                      Resume
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="subtle"
                      data-testid={`pause-sync-${item.providerKey}`}
                      disabled={isBusy || isRevoked}
                      leftIcon={<PauseCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                      onClick={() => void handleAction("pause", item.connectedResourceId)}
                    >
                      Pause
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
