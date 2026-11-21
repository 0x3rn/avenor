"use client";

import { Badge, Button, Card, EmptyState, PageHeader, Select, WarningBanner } from "@avenor/ui";
import { Bell, CheckCircle2, Mail, RefreshCw, SlidersHorizontal } from "lucide-react";
import * as React from "react";
import { ALERT_CATEGORIES, type AlertCategory } from "@/lib/alerts/constants";
import type {
  AlertIncidentRecord,
  AlertRuleRecord,
  InAppNotificationRecord,
  NotificationDeliveryRecord,
  NotificationPreferenceRecord,
  QuietHoursPolicy,
} from "@/lib/alerts/service";

export interface AlertsInboxViewProps {
  workspaceName: string;
  organizationName: string;
  initialRules: AlertRuleRecord[];
  initialIncidents: AlertIncidentRecord[];
  initialNotifications: InAppNotificationRecord[];
  initialDeliveries: NotificationDeliveryRecord[];
  initialPreferences: NotificationPreferenceRecord;
}

export function AlertsInboxView({
  workspaceName,
  organizationName,
  initialRules,
  initialIncidents,
  initialNotifications,
  initialDeliveries,
  initialPreferences,
}: AlertsInboxViewProps) {
  const [incidents, setIncidents] = React.useState(initialIncidents);
  const [notifications, setNotifications] = React.useState(initialNotifications);
  const [deliveries, setDeliveries] = React.useState(initialDeliveries);
  const [prefs, setPrefs] = React.useState(initialPreferences);
  const [evaluating, setEvaluating] = React.useState(false);
  const [savingPrefs, setSavingPrefs] = React.useState(false);
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  async function handleRunEvaluation() {
    setEvaluating(true);
    setFeedback(null);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "evaluate" }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Alert evaluation failed.");
      }
      setIncidents(data.incidents ?? []);
      setNotifications(data.notifications ?? []);
      setDeliveries(data.deliveries ?? []);
      setFeedback(
        `Evaluation complete: ${data.outcome?.incidentsTriggered ?? 0} new incident(s), ${data.outcome?.incidentsDeduplicated ?? 0} deduplicated.`,
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to run alert evaluation.");
    } finally {
      setEvaluating(false);
    }
  }

  async function handleMarkRead(notificationId: string) {
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId }),
      });
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((item) => (item.id === notificationId ? { ...item, isRead: true } : item)),
        );
      }
    } catch {
      // Non-fatal UI error
    }
  }

  async function handleSavePreferences(event: React.FormEvent) {
    event.preventDefault();
    setSavingPrefs(true);
    setFeedback(null);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailEnabled: prefs.emailEnabled,
          inAppEnabled: prefs.inAppEnabled,
          enabledCategories: [...prefs.enabledCategories],
          quietHoursEnabled: prefs.quietHoursEnabled,
          quietHoursStart: prefs.quietHoursStart,
          quietHoursEnd: prefs.quietHoursEnd,
          quietHoursTimezone: prefs.quietHoursTimezone,
          quietHoursPolicy: prefs.quietHoursPolicy,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Could not save notification preferences.");
      }
      setPrefs(data as NotificationPreferenceRecord);
      setFeedback("Notification preferences saved and active for subsequent evaluations.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to save preferences.");
    } finally {
      setSavingPrefs(false);
    }
  }

  function toggleCategory(category: AlertCategory) {
    setPrefs((prev) => {
      const exists = prev.enabledCategories.includes(category);
      return {
        ...prev,
        enabledCategories: exists
          ? prev.enabledCategories.filter((c) => c !== category)
          : [...prev.enabledCategories, category],
      };
    });
  }

  return (
    <div className="space-y-6" data-testid="alerts-inbox-view">
      <PageHeader
        breadcrumbs={[
          { label: organizationName },
          { label: workspaceName, href: "/dashboard" },
          { label: "Alerts & Notifications" },
        ]}
        title="Baseline Alerts & Notification Inbox"
        description="Evidence-based alerts for provider connection failures, stale data freshness, KPI thresholds, and Avenor cloud spending thresholds with deduplication and quiet-hour controls."
        badges={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={unreadCount > 0 ? "warning" : "success"}>{unreadCount} Unread</Badge>
            <Badge tone="neutral">{initialRules.length} Custom Rules</Badge>
          </div>
        }
        actions={
          <Button
            onClick={handleRunEvaluation}
            loading={evaluating}
            leftIcon={<RefreshCw className="h-4 w-4" />}
          >
            Evaluate Alerts Now
          </Button>
        }
      />

      {feedback ? (
        <WarningBanner tone="signal" title="Alert Engine Update" description={feedback} />
      ) : null}
      {errorMessage ? (
        <WarningBanner tone="warning" title="Alert Engine Notice" description={errorMessage} />
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* In-App Notification Inbox */}
        <Card
          className="p-5 sm:p-6 lg:col-span-2 space-y-4"
          data-testid="in-app-notifications-card"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
              <h2 className="text-[16px] font-semibold text-[#17243A]">
                In-App Notification Inbox
              </h2>
            </div>
            <Badge tone="neutral">{notifications.length} Total</Badge>
          </div>

          {notifications.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
              title="All Clear"
              description="No active alert notifications in your inbox. In-app alerts are always retained even if an external email transport fails."
            />
          ) : (
            <ul className="divide-y divide-[#DFE6F0]">
              {notifications.map((notif) => (
                <li
                  key={notif.id}
                  data-testid={`notification-item-${notif.id}`}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          notif.severity === "CRITICAL"
                            ? "critical"
                            : notif.severity === "WARNING"
                              ? "warning"
                              : "indigo"
                        }
                      >
                        {notif.severity}
                      </Badge>
                      <span className="font-semibold text-[13.5px] text-[#17243A]">
                        {notif.title}
                      </span>
                      {!notif.isRead ? <Badge tone="signal">Unread</Badge> : null}
                    </div>
                    <p className="text-[13px] text-[#30415D] m-0">{notif.body}</p>
                    <p className="font-mono text-[11.5px] text-[#64748B] m-0">
                      {notif.category} • {notif.createdAtIso.slice(0, 19).replace("T", " ")} UTC
                    </p>
                  </div>
                  {!notif.isRead ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleMarkRead(notif.id)}
                    >
                      Mark read
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Persistent Notification Preferences */}
        <Card className="p-5 sm:p-6 space-y-4" data-testid="notification-preferences-card">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
            <h2 className="text-[16px] font-semibold text-[#17243A]">Notification Preferences</h2>
          </div>

          <form onSubmit={handleSavePreferences} className="space-y-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[13px] text-[#17243A]">
                <input
                  type="checkbox"
                  checked={prefs.inAppEnabled}
                  onChange={(e) => setPrefs({ ...prefs, inAppEnabled: e.target.checked })}
                />
                <span>In-app inbox notifications</span>
              </label>
              <label className="flex items-center gap-2 text-[13px] text-[#17243A]">
                <input
                  type="checkbox"
                  checked={prefs.emailEnabled}
                  onChange={(e) => setPrefs({ ...prefs, emailEnabled: e.target.checked })}
                />
                <span>Email alert notifications</span>
              </label>
            </div>

            <div className="space-y-2 border-t border-[#DFE6F0] pt-3">
              <div className="text-[12px] font-semibold uppercase tracking-wide text-[#64748B]">
                Enabled Categories
              </div>
              {ALERT_CATEGORIES.map((category) => (
                <label
                  key={category}
                  className="flex items-center gap-2 text-[12.5px] text-[#30415D]"
                >
                  <input
                    type="checkbox"
                    checked={prefs.enabledCategories.includes(category)}
                    onChange={() => toggleCategory(category)}
                  />
                  <span>{category}</span>
                </label>
              ))}
            </div>

            <div className="space-y-2 border-t border-[#DFE6F0] pt-3">
              <label className="flex items-center gap-2 text-[13px] font-medium text-[#17243A]">
                <input
                  type="checkbox"
                  checked={prefs.quietHoursEnabled}
                  onChange={(e) => setPrefs({ ...prefs, quietHoursEnabled: e.target.checked })}
                />
                <span>Enable quiet hours ({prefs.quietHoursTimezone})</span>
              </label>
              {prefs.quietHoursEnabled ? (
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      aria-label="Quiet hours start"
                      type="text"
                      value={prefs.quietHoursStart}
                      onChange={(e) => setPrefs({ ...prefs, quietHoursStart: e.target.value })}
                      className="h-9 rounded-[8px] border border-[#C7D2E3] px-2.5 text-[13px]"
                    />
                    <input
                      aria-label="Quiet hours end"
                      type="text"
                      value={prefs.quietHoursEnd}
                      onChange={(e) => setPrefs({ ...prefs, quietHoursEnd: e.target.value })}
                      className="h-9 rounded-[8px] border border-[#C7D2E3] px-2.5 text-[13px]"
                    />
                  </div>
                  <Select
                    aria-label="Quiet hours policy"
                    value={prefs.quietHoursPolicy}
                    onChange={(e) =>
                      setPrefs({ ...prefs, quietHoursPolicy: e.target.value as QuietHoursPolicy })
                    }
                  >
                    <option value="IN_APP_ONLY">Record in-app only during quiet hours</option>
                    <option value="DEFER">Defer email until quiet hours end</option>
                    <option value="DISABLED">Deliver immediately</option>
                  </Select>
                </div>
              ) : null}
            </div>

            <Button type="submit" loading={savingPrefs} className="w-full">
              Save Preferences
            </Button>
          </form>
        </Card>
      </div>

      {/* Delivery History & Transport Transparency */}
      <Card className="p-5 sm:p-6 space-y-3" data-testid="delivery-history-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
            <h2 className="text-[16px] font-semibold text-[#17243A]">
              Notification Delivery Ledger ({incidents.length} Active/Recent Incidents)
            </h2>
          </div>
          <Badge tone="neutral">Transport Accepted ≠ Human Receipt</Badge>
        </div>

        {deliveries.length === 0 ? (
          <p className="text-[13px] text-[#64748B]">No outbound email deliveries recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="border-b border-[#DFE6F0] text-[#64748B]">
                <tr>
                  <th className="py-2 pr-3">Channel</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Attempts</th>
                  <th className="py-2 pr-3">Provider</th>
                  <th className="py-2">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DFE6F0]">
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td className="py-2 pr-3 font-mono">{d.channel}</td>
                    <td className="py-2 pr-3">
                      <Badge
                        tone={
                          d.status === "ACCEPTED" || d.status === "DELIVERED"
                            ? "success"
                            : d.status === "FAILED"
                              ? "critical"
                              : "neutral"
                        }
                      >
                        {d.status}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 font-mono">{d.attemptCount}</td>
                    <td className="py-2 pr-3">{d.providerName}</td>
                    <td className="py-2 text-[#64748B]">
                      {d.errorSummary ?? d.providerMessageId ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
