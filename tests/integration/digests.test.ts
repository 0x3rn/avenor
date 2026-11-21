import "dotenv/config";
import { registerUserWithDefaultOwnership } from "@avenor/auth";
import { closeAllDatabasePools, resetTestDatabaseRecords, runMigrations } from "@avenor/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDigestSchedule,
  registerOutboundChannel,
  runDigestScheduleIdempotently,
} from "@/lib/alerts/digests";

describe("THE-156 PostgreSQL Integration: Idempotent digest runs, recipient re-verification, and encrypted channels", () => {
  beforeAll(async () => {
    await runMigrations();
    await resetTestDatabaseRecords();
  });

  afterAll(async () => {
    await resetTestDatabaseRecords();
    await closeAllDatabasePools();
  });

  it("prevents duplicate digest generation for the same window, excludes non-member recipients, and rejects SSRF channel URLs", async () => {
    const owner = await registerUserWithDefaultOwnership({
      email: "digest-owner@avenor.test",
      name: "Digest Owner",
      password: "ValidPassword!2026",
      organizationName: "Digest Org",
      workspaceName: "Digest WS",
    });

    const schedule = await createDigestSchedule(owner.context, {
      name: "Weekly Executive Summary",
      cadence: "WEEKLY",
      timezone: "UTC",
      channels: ["IN_APP", "EMAIL"],
      recipientUserIds: [owner.context.user.id, "removed_user_xyz"],
    });

    const now = new Date("2026-11-21T09:00:00.000Z");
    const run1 = await runDigestScheduleIdempotently(owner.context, schedule.id, { now });
    expect(run1.deduplicated).toBe(false);
    expect(run1.authorizedRecipientCount).toBe(1);
    expect(run1.excludedRecipientCount).toBe(1);

    // Re-running in the same window must deduplicate!
    const run2 = await runDigestScheduleIdempotently(owner.context, schedule.id, { now });
    expect(run2.deduplicated).toBe(true);

    // Reject internal SSRF channel registration
    await expect(
      registerOutboundChannel(owner.context, {
        channelType: "SIGNED_WEBHOOK",
        name: "Bad Hook",
        targetUrl: "https://169.254.169.254/latest/meta-data",
      }),
    ).rejects.toThrow(/SSRF/i);

    const ch = await registerOutboundChannel(owner.context, {
      channelType: "SIGNED_WEBHOOK",
      name: "Ops Webhook",
      targetUrl: "https://hooks.avenor.dev/digest",
      signingSecret: "whsec_secret_value",
    });
    expect(ch.id).toMatch(/^owhc_/);
  });
});
