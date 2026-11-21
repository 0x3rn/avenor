import { redactSensitiveText } from "@avenor/types";

export interface AlertEmailPayload {
  toEmail: string;
  projectName: string;
  categoryLabel: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  summary: string;
  observedSummary: string | null;
  freshnessNote: string;
  actionPath: string;
  preferencesPath: string;
}

export interface EmailSendResult {
  status: "ACCEPTED" | "FAILED";
  providerName: "resend" | "sandbox_email";
  providerMessageId: string | null;
  errorSummary: string | null;
}

export interface EmailTransportAdapter {
  sendAlertEmail(payload: AlertEmailPayload): Promise<EmailSendResult>;
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function resolveSafeAppBaseUrl(
  rawEnv: Record<string, string | undefined> = process.env,
): string {
  const candidate = (rawEnv.NEXT_PUBLIC_APP_URL ?? rawEnv.BETTER_AUTH_URL ?? "").trim();
  const isProd = rawEnv.NODE_ENV === "production";
  if (candidate) {
    try {
      const parsed = new URL(candidate);
      if (isProd && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")) {
        return "https://avenor.corstack.dev";
      }
      return parsed.origin;
    } catch {
      // Fall through to safe default
    }
  }
  return isProd ? "https://avenor.corstack.dev" : "http://localhost:3000";
}

export function buildAlertEmailContent(
  payload: AlertEmailPayload,
  rawEnv: Record<string, string | undefined> = process.env,
): { subject: string; html: string; text: string } {
  const baseUrl = resolveSafeAppBaseUrl(rawEnv);
  const safePath = payload.actionPath.startsWith("/")
    ? payload.actionPath
    : `/${payload.actionPath}`;
  const safePrefsPath = payload.preferencesPath.startsWith("/")
    ? payload.preferencesPath
    : `/${payload.preferencesPath}`;

  const actionUrl = `${baseUrl}${safePath}`;
  const preferencesUrl = `${baseUrl}${safePrefsPath}`;

  const cleanTitle = redactSensitiveText(payload.title);
  const cleanSummary = redactSensitiveText(payload.summary);
  const cleanProject = redactSensitiveText(payload.projectName);
  const cleanCategory = redactSensitiveText(payload.categoryLabel);
  const cleanObserved = payload.observedSummary
    ? redactSensitiveText(payload.observedSummary)
    : null;
  const cleanFreshness = redactSensitiveText(payload.freshnessNote);

  const subject = `[Avenor • ${payload.severity}] ${cleanProject}: ${cleanTitle}`;

  const textLines = [
    `Avenor Digital Product Intelligence — ${cleanCategory}`,
    `Project: ${cleanProject}`,
    `Severity: ${payload.severity}`,
    `Alert: ${cleanTitle}`,
    "",
    cleanSummary,
    ...(cleanObserved ? [`Evidence: ${cleanObserved}`] : []),
    `Source freshness: ${cleanFreshness}`,
    "",
    `Inspect in Avenor: ${actionUrl}`,
    `Manage notification preferences: ${preferencesUrl}`,
  ];

  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #F7F9FC; color: #17243A; padding: 24px;">
    <div style="max-width: 600px; margin: 0 auto; background: #FFFFFF; border: 1px solid #DFE6F0; border-radius: 12px; padding: 24px;">
      <p style="font-size: 12px; font-weight: 600; color: #5157D9; letter-spacing: 0.06em; text-transform: uppercase; margin: 0 0 8px;">
        AVENOR • ${escapeHtml(cleanCategory)}
      </p>
      <h1 style="font-size: 18px; margin: 0 0 12px; color: #17243A;">${escapeHtml(cleanTitle)}</h1>
      <p style="font-size: 14px; line-height: 1.6; color: #30415D; margin: 0 0 16px;">${escapeHtml(cleanSummary)}</p>
      <div style="background: #F7F9FC; border: 1px solid #DFE6F0; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; font-size: 13px;">
        <div><strong>Project:</strong> ${escapeHtml(cleanProject)}</div>
        <div><strong>Severity:</strong> ${escapeHtml(payload.severity)}</div>
        ${cleanObserved ? `<div><strong>Observed:</strong> ${escapeHtml(cleanObserved)}</div>` : ""}
        <div><strong>Freshness:</strong> ${escapeHtml(cleanFreshness)}</div>
      </div>
      <p style="margin: 0 0 16px;">
        <a href="${escapeHtml(actionUrl)}" style="display: inline-block; background: #5157D9; color: #FFFFFF; text-decoration: none; padding: 10px 16px; border-radius: 8px; font-size: 13px; font-weight: 600;">
          Open in Avenor
        </a>
      </p>
      <p style="font-size: 12px; color: #64748B; margin: 0;">
        Read-only alert notification. <a href="${escapeHtml(preferencesUrl)}" style="color: #5157D9;">Manage notification preferences</a>.
      </p>
    </div>
  </body>
</html>`;

  return {
    subject,
    html,
    text: textLines.join("\n"),
  };
}

/**
 * Default transactional email transport using Resend when `RESEND_API_KEY` is configured,
 * or deterministic sandbox acceptance when running without live email credentials.
 * Transport acceptance is explicitly recorded as `ACCEPTED`, never falsely claiming human receipt.
 */
export function createDefaultEmailTransport(options?: {
  rawEnv?: Record<string, string | undefined>;
  fetchFn?: typeof fetch;
}): EmailTransportAdapter {
  const rawEnv = options?.rawEnv ?? process.env;
  const fetchFn = options?.fetchFn ?? globalThis.fetch;

  return {
    async sendAlertEmail(payload: AlertEmailPayload): Promise<EmailSendResult> {
      const { subject, html, text } = buildAlertEmailContent(payload, rawEnv);
      const apiKey = (rawEnv.RESEND_API_KEY ?? "").trim();
      const fromAddress = (rawEnv.AVENOR_EMAIL_FROM ?? "alerts@avenor.corstack.dev").trim();

      if (!apiKey) {
        return {
          status: "ACCEPTED",
          providerName: "sandbox_email",
          providerMessageId: `sbx_mail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          errorSummary: null,
        };
      }

      try {
        const res = await fetchFn("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromAddress,
            to: [payload.toEmail],
            subject,
            html,
            text,
          }),
        });

        const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
        if (!res.ok) {
          return {
            status: "FAILED",
            providerName: "resend",
            providerMessageId: null,
            errorSummary: redactSensitiveText(
              body.message ?? `Email transport rejected request with HTTP ${res.status}.`,
            ),
          };
        }

        return {
          status: "ACCEPTED",
          providerName: "resend",
          providerMessageId: body.id ?? null,
          errorSummary: null,
        };
      } catch (err) {
        return {
          status: "FAILED",
          providerName: "resend",
          providerMessageId: null,
          errorSummary: redactSensitiveText(
            err instanceof Error ? err.message : "Email transport network failure.",
          ),
        };
      }
    },
  };
}
