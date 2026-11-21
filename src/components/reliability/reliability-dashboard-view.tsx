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
import { Activity, Pause, Play, Plus, ShieldAlert, Trash2 } from "lucide-react";
import * as React from "react";
import type { UptimeIncidentRecord, UptimeMonitorRecord } from "@/lib/reliability/uptime";

export interface ReliabilityDashboardViewProps {
  projects: readonly LogicalProjectSummary[];
  initialMonitors: readonly UptimeMonitorRecord[];
  initialIncidents: readonly UptimeIncidentRecord[];
  singleRegionCaveat: string;
  fixedProjectId?: string;
}

function statusBadgeTone(status: UptimeMonitorRecord["status"]) {
  switch (status) {
    case "HEALTHY":
      return "success" as const;
    case "CONFIRMED_OUTAGE":
      return "critical" as const;
    case "SUSPECTED_OUTAGE":
    case "DEGRADED":
    case "RECOVERING":
      return "warning" as const;
    default:
      return "neutral" as const;
  }
}

export function ReliabilityDashboardView({
  projects,
  initialMonitors,
  initialIncidents,
  singleRegionCaveat,
  fixedProjectId,
}: ReliabilityDashboardViewProps) {
  const [monitors, setMonitors] = React.useState<UptimeMonitorRecord[]>([...initialMonitors]);
  const [incidents, setIncidents] = React.useState<UptimeIncidentRecord[]>([...initialIncidents]);
  const [projectId, setProjectId] = React.useState(fixedProjectId ?? projects[0]?.id ?? "");
  const [name, setName] = React.useState("");
  const [targetUrl, setTargetUrl] = React.useState("https://");
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [feedback, setFeedback] = React.useState<string | null>(null);

  async function refresh() {
    const query = fixedProjectId ? `?projectId=${encodeURIComponent(fixedProjectId)}` : "";
    const res = await fetch(`/api/reliability${query}`);
    if (res.ok) {
      const data = (await res.json()) as {
        monitors: UptimeMonitorRecord[];
        incidents: UptimeIncidentRecord[];
      };
      setMonitors(data.monitors);
      setIncidents(data.incidents);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);
    setFeedback(null);
    try {
      const res = await fetch("/api/reliability", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: fixedProjectId ?? projectId,
          name,
          targetUrl,
          httpMethod: "HEAD",
          intervalSeconds: 600,
          failureThreshold: 3,
          recoveryThreshold: 2,
        }),
      });
      const payload = (await res.json()) as {
        monitor?: UptimeMonitorRecord;
        error?: { message?: string };
      };
      if (!res.ok) {
        setErrorMessage(payload.error?.message ?? "Unable to create uptime monitor.");
        return;
      }
      setName("");
      setTargetUrl("https://");
      setFeedback("Authorized public HTTPS uptime monitor created.");
      await refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(monitor: UptimeMonitorRecord) {
    setErrorMessage(null);
    const res = await fetch("/api/reliability", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ monitorId: monitor.id, isEnabled: !monitor.isEnabled }),
    });
    if (res.ok) {
      await refresh();
    }
  }

  async function handleDelete(monitorId: string) {
    setErrorMessage(null);
    const res = await fetch(`/api/reliability?monitorId=${encodeURIComponent(monitorId)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      await refresh();
    }
  }

  return (
    <div className="space-y-6" data-testid="reliability-dashboard-view">
      <WarningBanner
        tone="signal"
        title="Passive Public Availability Monitoring (SSRF-Protected)"
        description={singleRegionCaveat}
      />

      <Card className="p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
            <h2 className="text-[16px] font-semibold text-[#17243A]">
              Add Authorized Public HTTPS Monitor
            </h2>
          </div>
          <Badge tone="read-only">HEAD/GET Only • SSRF Blocked</Badge>
        </div>

        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {!fixedProjectId && (
            <FormField id="uptime-project" label="Logical Project">
              <Select
                id="uptime-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                required
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </FormField>
          )}
          <FormField id="uptime-name" label="Monitor Name">
            <TextInput
              id="uptime-name"
              placeholder="Production Marketing Health"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </FormField>
          <FormField id="uptime-url" label="Authorized Public HTTPS URL">
            <TextInput
              id="uptime-url"
              type="url"
              placeholder="https://status.example.com/health"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              required
            />
          </FormField>
          <div className="md:col-span-3 flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={submitting || !projectId}>
              {submitting ? "Validating..." : "Create Monitor"}
            </Button>
            {errorMessage && (
              <span className="text-[13px] font-medium text-[#B91C1C]" role="alert">
                {errorMessage}
              </span>
            )}
            {feedback && <span className="text-[13px] font-medium text-[#15803D]">{feedback}</span>}
          </div>
        </form>
      </Card>

      <Card className="p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
          <h2 className="text-[16px] font-semibold text-[#17243A]">
            Configured Uptime Monitors ({monitors.length})
          </h2>
        </div>

        {monitors.length === 0 ? (
          <EmptyState
            icon={<Activity className="h-5 w-5" aria-hidden="true" />}
            title="No Uptime Monitors Configured"
            description="Add an authorized public HTTPS endpoint above to observe availability and incident timelines without granting Avenor infrastructure write access."
          />
        ) : (
          <div className="space-y-3">
            {monitors.map((monitor) => (
              <div
                key={monitor.id}
                className="rounded-[10px] border border-[#DFE6F0] bg-[#F7F9FC] p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[#17243A]">{monitor.name}</span>
                    <Badge tone={statusBadgeTone(monitor.status)}>{monitor.status}</Badge>
                    <Badge tone="neutral">{monitor.probeRegion}</Badge>
                  </div>
                  <div className="font-mono text-[12px] text-[#64748B] break-all">
                    {monitor.httpMethod} {monitor.targetUrl} • Expected {monitor.expectedStatusMin}–
                    {monitor.expectedStatusMax} • Confirm after {monitor.failureThreshold}{" "}
                    consecutive failures
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => handleToggle(monitor)}
                  >
                    {monitor.isEnabled ? (
                      <>
                        <Pause className="h-3.5 w-3.5 mr-1" /> Pause
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5 mr-1" /> Resume
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => handleDelete(monitor.id)}
                    aria-label={`Delete ${monitor.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-[#B91C1C]" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
          <h2 className="text-[16px] font-semibold text-[#17243A]">
            Observed Availability Incidents ({incidents.length})
          </h2>
        </div>
        {incidents.length === 0 ? (
          <p className="text-[13.5px] text-[#64748B]">
            No confirmed availability incidents recorded in this workspace.
          </p>
        ) : (
          <div className="space-y-2">
            {incidents.map((inc) => (
              <div
                key={inc.id}
                className="rounded-[8px] border border-[#DFE6F0] bg-[#FFFFFF] px-4 py-3 flex flex-wrap items-center justify-between gap-2"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Badge tone={inc.status === "RECOVERED" ? "success" : "critical"}>
                      {inc.status}
                    </Badge>
                    <span className="text-[13.5px] font-medium text-[#17243A]">
                      {inc.failureCategory}
                    </span>
                  </div>
                  <p className="font-mono text-[12px] text-[#64748B]">
                    Confirmed {inc.confirmedAtIso} • Region {inc.probeRegion} •{" "}
                    {inc.recoveredAtIso
                      ? `Recovered ${inc.recoveredAtIso} (${inc.durationSeconds ?? 0}s observed)`
                      : "Ongoing"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
