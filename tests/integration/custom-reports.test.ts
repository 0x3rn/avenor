import "dotenv/config";
import { createLogicalProject, registerUserWithDefaultOwnership } from "@avenor/auth";
import { closeAllDatabasePools, resetTestDatabaseRecords, runMigrations } from "@avenor/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createSavedReport,
  executeSavedReportBenchmark,
  listSavedReports,
} from "@/lib/reports/custom-reports";

describe("THE-154 PostgreSQL Integration: Saved reports, cross-project benchmarking, and tenant isolation", () => {
  beforeAll(async () => {
    await runMigrations();
    await resetTestDatabaseRecords();
  });

  afterAll(async () => {
    await resetTestDatabaseRecords();
    await closeAllDatabasePools();
  });

  it("saves multi-project reports, executes with UNAVAILABLE honesty, and blocks cross-tenant smuggling or reads", async () => {
    const ownerA = await registerUserWithDefaultOwnership({
      email: "rep-owner-a@avenor.test",
      name: "Report Owner A",
      password: "ValidPassword!2026",
      organizationName: "Rep Org A",
      workspaceName: "Rep WS A",
    });
    const ownerB = await registerUserWithDefaultOwnership({
      email: "rep-owner-b@avenor.test",
      name: "Report Owner B",
      password: "ValidPassword!2026",
      organizationName: "Rep Org B",
      workspaceName: "Rep WS B",
    });

    const p1 = await createLogicalProject(ownerA.context, ownerA.context.activeWorkspace.id, {
      name: "Product Alpha",
      primaryDomain: "alpha.avenor.dev",
    });
    const p2 = await createLogicalProject(ownerA.context, ownerA.context.activeWorkspace.id, {
      name: "Product Beta",
      primaryDomain: "beta.avenor.dev",
    });
    const pOther = await createLogicalProject(ownerB.context, ownerB.context.activeWorkspace.id, {
      name: "Tenant B Secret Product",
      primaryDomain: "secret.tenantb.dev",
    });

    // Reject cross-tenant project ID smuggling at save time
    await expect(
      createSavedReport(ownerA.context, {
        name: "Smuggled Report",
        projectIds: [p1.id, pOther.id],
        metricKeys: ["ga4.sessions"],
      }),
    ).rejects.toThrow(/do not belong to the authorized workspace/i);

    const report = await createSavedReport(ownerA.context, {
      name: "Alpha vs Beta Growth",
      projectIds: [p1.id, p2.id],
      metricKeys: ["ga4.sessions", "ga4.active_users"],
      datePreset: "28d",
    });

    const listA = await listSavedReports(ownerA.context);
    expect(listA).toHaveLength(1);

    const executed = await executeSavedReportBenchmark(ownerA.context, report.id);
    expect(executed.rows).toHaveLength(4);
    expect(executed.rows.every((r) => r.value === null)).toBe(true);
    expect(executed.warnings.some((w) => /Non-additive/i.test(w))).toBe(true);

    // Tenant B cannot execute Tenant A's saved report
    await expect(executeSavedReportBenchmark(ownerB.context, report.id)).rejects.toThrow();
  });
});
