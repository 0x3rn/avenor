import "dotenv/config";
import { createLogicalProject, registerUserWithDefaultOwnership } from "@avenor/auth";
import { closeAllDatabasePools, resetTestDatabaseRecords, runMigrations } from "@avenor/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertHardWorkspaceCapacity,
  commitQuotaReservation,
  getWorkspaceUsageAndQuotaReport,
  releaseQuotaReservation,
  reserveMonthlyQuotaAtomically,
} from "@/lib/billing/quotas";

describe("THE-161 PostgreSQL Integration: Atomic concurrent quotas, idempotency, release, and hard capacity enforcement", () => {
  beforeAll(async () => {
    await runMigrations();
    await resetTestDatabaseRecords();
  });

  afterAll(async () => {
    await resetTestDatabaseRecords();
    await closeAllDatabasePools();
  });

  it("enforces Free hard capacity and prevents concurrent race oversubscription via PostgreSQL advisory locks", async () => {
    const ownerA = await registerUserWithDefaultOwnership({
      email: "quota-a@avenor.test",
      name: "Quota Owner A",
      password: "ValidPassword!2026",
      organizationName: "Quota Org A",
      workspaceName: "Quota WS A",
    });
    const ownerB = await registerUserWithDefaultOwnership({
      email: "quota-b@avenor.test",
      name: "Quota Owner B",
      password: "ValidPassword!2026",
      organizationName: "Quota Org B",
      workspaceName: "Quota WS B",
    });

    const wsA = ownerA.context.activeWorkspace.id;

    // Hard capacity: Free plan allows 1 project
    await createLogicalProject(ownerA.context, wsA, {
      name: "Only Free Project",
      primaryDomain: "free1.avenor.dev",
    });
    await expect(assertHardWorkspaceCapacity(ownerA.context, wsA, "projects")).rejects.toThrow(
      /FREE plan limit reached for projects \(1\/1\)/i,
    );

    // Concurrency race: Free plan allows 2 CSV exports/month; fire 5 concurrent reservations!
    const raceResults = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        reserveMonthlyQuotaAtomically(ownerA.context, {
          workspaceId: wsA,
          resourceKey: "csv_exports",
          operationId: `export_op_${i}`,
        }),
      ),
    );
    const succeeded = raceResults.filter((r) => r.status === "fulfilled");
    const rejected = raceResults.filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(2);
    expect(rejected).toHaveLength(3);

    // Idempotent retry on same operationId does NOT double-charge
    const first = succeeded[0];
    if (first?.status === "fulfilled") {
      const retry = await reserveMonthlyQuotaAtomically(ownerA.context, {
        workspaceId: wsA,
        resourceKey: "csv_exports",
        operationId: "export_op_0",
      });
      expect(retry.idempotentHit).toBe(true);
      await commitQuotaReservation(first.value.reservationId);
    }

    // Releasing the second reservation frees 1 slot cleanly
    const second = succeeded[1];
    if (second?.status === "fulfilled") {
      await releaseQuotaReservation(second.value.reservationId);
    }

    const reportA = await getWorkspaceUsageAndQuotaReport(ownerA.context, wsA);
    const csvRow = reportA.quotas.find((q) => q.resourceKey === "csv_exports");
    expect(csvRow?.used).toBe(1);
    expect(csvRow?.limit).toBe(2);

    // Tenant B's allowance is completely unaffected by Tenant A's consumption
    const resB = await reserveMonthlyQuotaAtomically(ownerB.context, {
      workspaceId: ownerB.context.activeWorkspace.id,
      resourceKey: "csv_exports",
      operationId: "tenant_b_op_1",
    });
    expect(resB.usedAfterReservation).toBe(1);
  });
});
