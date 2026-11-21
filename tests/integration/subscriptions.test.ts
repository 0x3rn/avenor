import "dotenv/config";
import crypto from "node:crypto";
import { registerUserWithDefaultOwnership } from "@avenor/auth";
import { closeAllDatabasePools, resetTestDatabaseRecords, runMigrations } from "@avenor/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activateCardFreeProTrial,
  getWorkspaceEffectiveEntitlements,
  listWorkspaceSubscriptionInvoices,
  processLemonSqueezyWebhookEvent,
} from "@/lib/billing/lemon-squeezy";

describe("THE-160 PostgreSQL Integration: Card-free Pro trial, Lemon Squeezy webhooks, deduplication, and invoices", () => {
  beforeAll(async () => {
    await runMigrations();
    await resetTestDatabaseRecords();
  });

  afterAll(async () => {
    await resetTestDatabaseRecords();
    await closeAllDatabasePools();
  });

  it("grants one-time card-free trial, reconciles signed Lemon Squeezy webhooks idempotently, and isolates invoices by tenant", async () => {
    const ownerA = await registerUserWithDefaultOwnership({
      email: "bill-owner-a@avenor.test",
      name: "Bill Owner A",
      password: "ValidPassword!2026",
      organizationName: "Bill Org A",
      workspaceName: "Bill WS A",
    });
    const ownerB = await registerUserWithDefaultOwnership({
      email: "bill-owner-b@avenor.test",
      name: "Bill Owner B",
      password: "ValidPassword!2026",
      organizationName: "Bill Org B",
      workspaceName: "Bill WS B",
    });

    // Starts on FREE
    const initial = await getWorkspaceEffectiveEntitlements(ownerA.context);
    expect(initial.effectivePlanCode).toBe("FREE");
    expect(initial.limits.maxProjects).toBe(1);

    // Activate 14-day card-free Pro trial
    const trial = await activateCardFreeProTrial(ownerA.context);
    expect(trial.effectivePlanCode).toBe("PRO");
    expect(trial.isCardFreeTrial).toBe(true);
    expect(trial.limits.maxProjects).toBe(5);

    // Repeat trial blocked
    await expect(activateCardFreeProTrial(ownerA.context)).rejects.toThrow(/already used/i);

    // Process signed Lemon Squeezy subscription_created + order_created webhooks
    const secret = "ls_whsec_integration_secret";
    const subBody = JSON.stringify({
      meta: {
        event_name: "subscription_created",
        test_mode: true,
        custom_data: {
          workspace_id: ownerA.context.activeWorkspace.id,
          plan_code: "TEAM",
          billing_interval: "ANNUAL",
        },
      },
      data: {
        id: "ls_sub_777",
        type: "subscriptions",
        attributes: {
          store_id: "store_1",
          customer_id: "cust_1",
          variant_id: "var_team_annual",
          status: "active",
          renews_at: "2027-11-21T00:00:00.000Z",
          updated_at: "2026-11-21T12:00:00.000Z",
        },
      },
    });
    const subSig = crypto.createHmac("sha256", secret).update(subBody).digest("hex");

    const wh1 = await processLemonSqueezyWebhookEvent({
      rawBody: subBody,
      signatureHeader: subSig,
      webhookSecret: secret,
    });
    expect(wh1.accepted).toBe(true);
    expect(wh1.deduplicated).toBe(false);

    // Replay must deduplicate
    const wh2 = await processLemonSqueezyWebhookEvent({
      rawBody: subBody,
      signatureHeader: subSig,
      webhookSecret: secret,
    });
    expect(wh2.deduplicated).toBe(true);

    // Order created -> invoice recorded
    const orderBody = JSON.stringify({
      meta: {
        event_name: "order_created",
        test_mode: true,
        custom_data: { workspace_id: ownerA.context.activeWorkspace.id },
      },
      data: {
        id: "ls_ord_888",
        type: "orders",
        attributes: {
          total: 58800,
          tax: 0,
          currency: "USD",
          created_at: "2026-11-21T12:00:00.000Z",
        },
      },
    });
    const orderSig = crypto.createHmac("sha256", secret).update(orderBody).digest("hex");
    await processLemonSqueezyWebhookEvent({
      rawBody: orderBody,
      signatureHeader: orderSig,
      webhookSecret: secret,
    });

    const upgraded = await getWorkspaceEffectiveEntitlements(ownerA.context);
    expect(upgraded.effectivePlanCode).toBe("TEAM");
    expect(upgraded.limits.maxProjects).toBe(20);

    const invoicesA = await listWorkspaceSubscriptionInvoices(ownerA.context);
    expect(invoicesA).toHaveLength(1);
    expect(invoicesA[0]?.amountMinor).toBe(58800);

    // Tenant B cannot view Tenant A's invoices
    await expect(
      listWorkspaceSubscriptionInvoices(ownerB.context, ownerA.context.activeWorkspace.id),
    ).rejects.toThrow();
  });
});
