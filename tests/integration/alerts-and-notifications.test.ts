import "dotenv/config";
import {
  completeOAuthCallback,
  createLogicalProject,
  initiateOAuthAuthorization,
  registerUserWithDefaultOwnership,
  resolveSessionByToken,
} from "@avenor/auth";
import { closeAllDatabasePools, dbQuery, runMigrations } from "@avenor/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createAlertRule,
  evaluateAndDispatchWorkspaceAlerts,
  listWorkspaceAlertsAndNotifications,
  markInAppNotificationRead,
  retryFailedEmailDeliveries,
  updateNotificationPreferences,
} from "@/lib/alerts/service";
import type { EmailTransportAdapter } from "@/lib/alerts/email-transport";

describe("THE-145: Baseline Alert Delivery, Deduplication, Retries & Preferences Integration", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await closeAllDatabasePools();
  });

  it("triggers connection failure & stale alerts, suppresses duplicate deliveries across 5 repeated evaluations, persists in-app alerts on email failure with bounded retry, honors opt-out/quiet-hours, and isolates tenants", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const registered = await registerUserWithDefaultOwnership({
      name: "Alerts Operator",
      email: `alerts.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Alerts Org ${suffix}`,
      workspaceName: `Alerts Workspace ${suffix}`,
    });
    const session = await resolveSessionByToken(registered.rawSessionToken);
    const workspaceId = registered.context.activeWorkspace.id;

    const otherReg = await registerUserWithDefaultOwnership({
      name: "Other Alerts Tenant",
      email: `other.alerts.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Other Alerts Org ${suffix}`,
      workspaceName: `Other Alerts Workspace ${suffix}`,
    });
    const otherSession = await resolveSessionByToken(otherReg.rawSessionToken);

    const project = await createLogicalProject(session, workspaceId, {
      name: "Avenor Monitored Product",
      slug: `avenor-alerts-${suffix}`,
      primaryDomain: "https://alerts.avenor.test",
      initialEnvironments: ["PRODUCTION"],
    });

    // Create a connection and simulate REVOKED state
    const redirectUri = "http://localhost:3000/api/connections/oauth/callback";
    const init = await initiateOAuthAuthorization({
      session,
      workspaceId,
      providerKey: "ga4",
      authorizeEndpointUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      requestedScopes: ["https://www.googleapis.com/auth/analytics.readonly"],
      redirectUri,
    });
    const conn = await completeOAuthCallback({
      session,
      workspaceId,
      providerKey: "ga4",
      displayName: "GA4 Primary Property",
      rawStateToken: init.rawStateToken,
      redirectUri,
      authorizationCode: "code_ga4_alerts_ok",
    });
    await dbQuery(`UPDATE provider_connections SET status = 'REVOKED' WHERE id = $1`, [
      conn.connectionId,
    ]);

    // Also add a KPI threshold rule on a missing metric — must NEVER fire on missing data!
    await createAlertRule(session, {
      workspaceId,
      projectId: project.id,
      name: "Zero Sessions Guard",
      category: "KPI_THRESHOLD",
      metricKey: "ga4.sessions",
      operator: "LT",
      thresholdValue: 100,
      severity: "WARNING",
    });

    // Simulate failing email transport on initial evaluation
    const failingTransport: EmailTransportAdapter = {
      sendAlertEmail: vi.fn(async () => ({
        status: "FAILED" as const,
        providerName: "resend" as const,
        providerMessageId: null,
        errorSummary: "Upstream 502 Bad Gateway",
      })),
    };

    // Run evaluation 5 times sequentially -> MUST produce exactly 1 incident, 1 in-app notification, and 1 email delivery attempt (ZERO spam!)
    const firstEval = await evaluateAndDispatchWorkspaceAlerts(session, {
      workspaceId,
      emailTransport: failingTransport,
    });
    expect(firstEval.incidentsTriggered).toBe(1);
    expect(firstEval.inAppNotificationsCreated).toBe(1);
    expect(firstEval.emailDeliveriesAttempted).toBe(1);
    expect(firstEval.emailDeliveriesFailed).toBe(1);

    for (let i = 0; i < 4; i += 1) {
      const repeatEval = await evaluateAndDispatchWorkspaceAlerts(session, {
        workspaceId,
        emailTransport: failingTransport,
      });
      expect(repeatEval.incidentsTriggered).toBe(0);
      expect(repeatEval.incidentsDeduplicated).toBe(1);
      expect(repeatEval.inAppNotificationsCreated).toBe(0);
      expect(repeatEval.emailDeliveriesAttempted).toBe(0);
    }

    expect(failingTransport.sendAlertEmail).toHaveBeenCalledTimes(1);

    // In-app notification persisted even though email failed, and can be marked read
    const listed = await listWorkspaceAlertsAndNotifications(session, workspaceId);
    expect(listed.incidents).toHaveLength(1);
    expect(listed.notifications).toHaveLength(1);
    expect(listed.notifications[0]?.isRead).toBe(false);
    expect(listed.deliveries[0]?.status).toBe("FAILED");

    const notifId = listed.notifications[0]?.id ?? "";
    await markInAppNotificationRead(session, notifId, workspaceId);

    // Bounded retry succeeds when email transport recovers
    const healthyTransport: EmailTransportAdapter = {
      sendAlertEmail: vi.fn(async () => ({
        status: "ACCEPTED" as const,
        providerName: "resend" as const,
        providerMessageId: "re_msg_999",
        errorSummary: null,
      })),
    };
    const retryRes = await retryFailedEmailDeliveries(session, {
      workspaceId,
      emailTransport: healthyTransport,
    });
    expect(retryRes.retried).toBe(1);
    expect(retryRes.succeeded).toBe(1);

    // Preferences update (opt-out email + quiet hours) persists
    const updatedPrefs = await updateNotificationPreferences(session, {
      workspaceId,
      emailEnabled: false,
      quietHoursEnabled: true,
      quietHoursPolicy: "DEFER",
    });
    expect(updatedPrefs.emailEnabled).toBe(false);
    expect(updatedPrefs.quietHoursEnabled).toBe(true);
    expect(updatedPrefs.quietHoursPolicy).toBe("DEFER");

    // Cross-tenant denial check
    await expect(listWorkspaceAlertsAndNotifications(otherSession, workspaceId)).rejects.toThrow();
  });
});
