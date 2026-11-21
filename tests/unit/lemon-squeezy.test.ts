import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { resolveEffectivePlanCode, verifyLemonSqueezySignature } from "@/lib/billing/lemon-squeezy";
import { AVENOR_PLAN_CATALOG } from "@/lib/billing/plan-catalog";

describe("THE-160: Lemon Squeezy catalog, X-Signature verification, trial expiry, and paid-through cancellation grace", () => {
  it("matches canonical Billing Plan & Structure pricing and limits", () => {
    expect(AVENOR_PLAN_CATALOG.FREE.monthlyPriceUsd).toBe(0);
    expect(AVENOR_PLAN_CATALOG.PRO.monthlyPriceUsd).toBe(19);
    expect(AVENOR_PLAN_CATALOG.PRO.annualTotalUsd).toBe(180);
    expect(AVENOR_PLAN_CATALOG.PRO.annualMonthlyEquivalentUsd).toBe(15);
    expect(AVENOR_PLAN_CATALOG.TEAM.monthlyPriceUsd).toBe(59);
    expect(AVENOR_PLAN_CATALOG.TEAM.annualTotalUsd).toBe(588);
    expect(AVENOR_PLAN_CATALOG.TEAM.annualMonthlyEquivalentUsd).toBe(49);
    expect(AVENOR_PLAN_CATALOG.FREE.limits.maxProjects).toBe(1);
    expect(AVENOR_PLAN_CATALOG.PRO.limits.maxProjects).toBe(5);
    expect(AVENOR_PLAN_CATALOG.TEAM.limits.maxProjects).toBe(20);
  });

  it("verifies raw-body X-Signature HMAC-SHA256 in constant time and handles trial expiry + cancelled grace", () => {
    const secret = "ls_whsec_test_12345";
    const body = JSON.stringify({
      meta: { event_name: "subscription_created" },
      data: { id: "sub_1" },
    });
    const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");

    expect(
      verifyLemonSqueezySignature({ rawBody: body, signatureHeader: sig, webhookSecret: secret }),
    ).toBe(true);
    expect(
      verifyLemonSqueezySignature({
        rawBody: `${body}!`,
        signatureHeader: sig,
        webhookSecret: secret,
      }),
    ).toBe(false);

    // Local 14-day trial active -> PRO; after expiry -> FREE
    const nowMs = Date.parse("2026-11-21T12:00:00.000Z");
    expect(
      resolveEffectivePlanCode({
        configuredPlanCode: "PRO",
        providerName: "LOCAL_TRIAL",
        status: "on_trial",
        trialEndsAtIso: "2026-11-25T12:00:00.000Z",
        endsAtIso: null,
        nowMs,
      }).effectivePlanCode,
    ).toBe("PRO");

    expect(
      resolveEffectivePlanCode({
        configuredPlanCode: "PRO",
        providerName: "LOCAL_TRIAL",
        status: "on_trial",
        trialEndsAtIso: "2026-11-20T12:00:00.000Z",
        endsAtIso: null,
        nowMs,
      }).effectivePlanCode,
    ).toBe("FREE");

    // Lemon Squeezy `cancelled` retains paid tier through `ends_at`, then reverts to FREE
    const cancelledGrace = resolveEffectivePlanCode({
      configuredPlanCode: "TEAM",
      providerName: "LEMON_SQUEEZY",
      status: "cancelled",
      trialEndsAtIso: null,
      endsAtIso: "2026-12-01T00:00:00.000Z",
      nowMs,
    });
    expect(cancelledGrace.effectivePlanCode).toBe("TEAM");
    expect(cancelledGrace.isWithinPaidGracePeriod).toBe(true);

    const expired = resolveEffectivePlanCode({
      configuredPlanCode: "TEAM",
      providerName: "LEMON_SQUEEZY",
      status: "expired",
      trialEndsAtIso: null,
      endsAtIso: "2026-11-01T00:00:00.000Z",
      nowMs,
    });
    expect(expired.effectivePlanCode).toBe("FREE");
  });
});
