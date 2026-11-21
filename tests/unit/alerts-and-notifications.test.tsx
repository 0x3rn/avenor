import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AlertsInboxView } from "@/components/alerts/alerts-inbox-view";
import {
  buildAlertEmailContent,
  escapeHtml,
  resolveSafeAppBaseUrl,
} from "@/lib/alerts/email-transport";
import { isWithinQuietHours } from "@/lib/alerts/service";

describe("THE-145: Baseline alert delivery, email template safety, quiet hours, and notification inbox", () => {
  it("evaluates timezone-aware quiet hours accurately including midnight wrap-around windows", () => {
    // 23:30 UTC inside 22:00 - 07:00 UTC
    expect(isWithinQuietHours(new Date("2026-11-21T23:30:00.000Z"), "22:00", "07:00", "UTC")).toBe(
      true,
    );
    // 06:15 UTC inside 22:00 - 07:00 UTC
    expect(isWithinQuietHours(new Date("2026-11-21T06:15:00.000Z"), "22:00", "07:00", "UTC")).toBe(
      true,
    );
    // 14:00 UTC outside 22:00 - 07:00 UTC
    expect(isWithinQuietHours(new Date("2026-11-21T14:00:00.000Z"), "22:00", "07:00", "UTC")).toBe(
      false,
    );
    // Same UTC time (03:00Z = 22:00 EST / UTC-5) inside America/New_York 22:00-07:00 quiet hours
    expect(
      isWithinQuietHours(
        new Date("2026-11-21T03:30:00.000Z"),
        "22:00",
        "07:00",
        "America/New_York",
      ),
    ).toBe(true);
  });

  it("escapes HTML safely in alert email templates, redacts secrets, and prevents localhost links in production", () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;",
    );

    const prodBaseUrl = resolveSafeAppBaseUrl({
      NODE_ENV: "production",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    });
    expect(prodBaseUrl).toBe("https://avenor.corstack.dev");

    const email = buildAlertEmailContent(
      {
        toEmail: "founder@avenor.test",
        projectName: "Core <App>",
        categoryLabel: "PROVIDER_CONNECTION_FAILURE",
        severity: "CRITICAL",
        title: "Connection needs attention",
        summary: "Token ya29_secretGoogleAccessToken999 failed during sync.",
        observedSummary: "REVOKED",
        freshnessNote: "Checked 1m ago",
        actionPath: "/connections",
        preferencesPath: "/alerts",
      },
      { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "http://localhost:3000" },
    );

    expect(email.html).not.toContain("<App>");
    expect(email.html).toContain("Core &lt;App&gt;");
    expect(email.html).not.toContain("ya29_secretGoogleAccessToken999");
    expect(email.html).not.toContain("localhost");
    expect(email.html).toContain("https://avenor.corstack.dev/connections");
  });

  it("renders in-app inbox, persistent preferences, and honest transport delivery ledger", () => {
    render(
      <AlertsInboxView
        workspaceName="Core Workspace"
        organizationName="Corstack"
        initialRules={[]}
        initialIncidents={[
          {
            id: "ainc_1",
            workspaceId: "ws_1",
            projectId: "proj_1",
            connectedResourceId: null,
            alertRuleId: null,
            category: "PROVIDER_CONNECTION_FAILURE",
            severity: "CRITICAL",
            status: "OPEN",
            dedupeKey: "conn_fail:c1:REVOKED",
            title: "Connection needs attention: GA4 Prod",
            summary: "Authorization revoked upstream.",
            observedValue: null,
            thresholdValue: null,
            unit: null,
            currency: null,
            firstTriggeredAtIso: "2026-11-21T16:00:00.000Z",
            lastEvaluatedAtIso: "2026-11-21T16:05:00.000Z",
            resolvedAtIso: null,
          },
        ]}
        initialNotifications={[
          {
            id: "ntf_1",
            workspaceId: "ws_1",
            userId: "usr_1",
            incidentId: "ainc_1",
            category: "PROVIDER_CONNECTION_FAILURE",
            severity: "CRITICAL",
            title: "Connection needs attention: GA4 Prod",
            body: "Authorization revoked upstream.",
            actionUrl: "/connections",
            isRead: false,
            readAtIso: null,
            createdAtIso: "2026-11-21T16:00:00.000Z",
          },
        ]}
        initialDeliveries={[
          {
            id: "ndel_1",
            incidentId: "ainc_1",
            userId: "usr_1",
            channel: "EMAIL",
            recipientAddress: "founder@avenor.test",
            status: "ACCEPTED",
            attemptCount: 1,
            providerName: "sandbox_email",
            providerMessageId: "sbx_mail_1",
            errorSummary: null,
            nextRetryAtIso: null,
            updatedAtIso: "2026-11-21T16:00:00.000Z",
          },
        ]}
        initialPreferences={{
          id: "npref_1",
          workspaceId: "ws_1",
          userId: "usr_1",
          emailEnabled: true,
          inAppEnabled: true,
          enabledCategories: ["PROVIDER_CONNECTION_FAILURE", "STALE_DATA"],
          quietHoursEnabled: true,
          quietHoursStart: "22:00",
          quietHoursEnd: "07:00",
          quietHoursTimezone: "UTC",
          quietHoursPolicy: "IN_APP_ONLY",
          updatedAtIso: "2026-11-21T16:00:00.000Z",
        }}
      />,
    );

    expect(screen.getByTestId("in-app-notifications-card")).toHaveTextContent(
      "Connection needs attention: GA4 Prod",
    );
    expect(screen.getByTestId("notification-preferences-card")).toHaveTextContent(
      /Enable quiet hours/i,
    );
    expect(screen.getByTestId("delivery-history-card")).toHaveTextContent(
      "Transport Accepted ≠ Human Receipt",
    );
    expect(screen.getByTestId("delivery-history-card")).toHaveTextContent("ACCEPTED");
  });
});
