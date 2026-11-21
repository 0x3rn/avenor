import { describe, expect, it, vi } from "vitest";
import {
  computeDigestReportingWindow,
  deliverSignedOutboundWebhook,
  formatSafeTelegramMessage,
  signOutboundWebhookPayload,
  verifyOutboundWebhookSignature,
} from "@/lib/alerts/digests";

describe("THE-156: Digest window math, leap-year/timezone safety, signed webhooks, and SSRF protection", () => {
  it("computes completed DAILY, WEEKLY, and MONTHLY windows across leap years and IANA timezones", () => {
    // Leap year March 1, 2024 -> previous month is 2024-02-01..2024-02-29
    const leapMonthly = computeDigestReportingWindow(
      "MONTHLY",
      "UTC",
      new Date("2024-03-01T10:00:00.000Z"),
    );
    expect(leapMonthly.startDate).toBe("2024-02-01");
    expect(leapMonthly.endDate).toBe("2024-02-29");

    // Non-leap year March 1, 2026 -> 2026-02-01..2026-02-28
    const nonLeap = computeDigestReportingWindow(
      "MONTHLY",
      "America/New_York",
      new Date("2026-03-01T15:00:00.000Z"),
    );
    expect(nonLeap.startDate).toBe("2026-02-01");
    expect(nonLeap.endDate).toBe("2026-02-28");

    const daily = computeDigestReportingWindow(
      "DAILY",
      "Africa/Lagos",
      new Date("2026-11-21T08:00:00.000Z"),
    );
    expect(daily.startDate).toBe("2026-11-20");
    expect(daily.endDate).toBe("2026-11-20");
  });

  it("signs/verifies outbound webhooks with timestamped HMAC-SHA256, blocks SSRF targets, retries 5xx, and escapes Telegram HTML", async () => {
    const secret = "whsec_outbound_avenor_test";
    const body = JSON.stringify({ event: "digest.ready", workspaceId: "ws_1" });
    const ts = 1763700000;
    const sig = signOutboundWebhookPayload({
      rawBody: body,
      timestampSec: ts,
      deliveryId: "whdel_1",
      signingSecret: secret,
    });
    expect(
      verifyOutboundWebhookSignature({
        rawBody: body,
        deliveryId: "whdel_1",
        signatureHeader: sig,
        signingSecret: secret,
        nowSec: ts + 10,
      }),
    ).toBe(true);
    expect(
      verifyOutboundWebhookSignature({
        rawBody: `${body} `,
        deliveryId: "whdel_1",
        signatureHeader: sig,
        signingSecret: secret,
        nowSec: ts + 10,
      }),
    ).toBe(false);

    // SSRF blocked BEFORE fetch
    const blockedFetch = vi.fn();
    const blocked = await deliverSignedOutboundWebhook({
      targetUrl: "https://internal.local/hook",
      signingSecret: secret,
      payload: { ok: true },
      dnsLookupFn: async () => [{ address: "127.0.0.1", family: 4 }],
      fetchFn: blockedFetch,
    });
    expect(blocked.status).toBe("SSRF_BLOCKED");
    expect(blockedFetch).not.toHaveBeenCalled();

    // Retry once on 503 then succeed on 202
    let calls = 0;
    const retryFetch = vi.fn(async () => {
      calls++;
      return new Response("ok", { status: calls === 1 ? 503 : 202 });
    }) as unknown as typeof fetch;
    const delivered = await deliverSignedOutboundWebhook({
      targetUrl: "https://hooks.example.com/avenor",
      signingSecret: secret,
      payload: { event: "digest.generated" },
      dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      fetchFn: retryFetch,
    });
    expect(delivered.status).toBe("ACCEPTED_BY_PROVIDER");
    expect(delivered.attempts).toBe(2);

    const tg = formatSafeTelegramMessage({
      workspaceName: "Avenor <script>alert(1)</script>",
      windowLabel: "2026-11-20",
      bulletLines: ["Sessions: 1,240"],
    });
    expect(tg).not.toContain("<script>");
    expect(tg).toContain("&lt;script&gt;");
  });
});
