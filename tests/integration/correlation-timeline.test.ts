import "dotenv/config";
import { createLogicalProject, registerUserWithDefaultOwnership } from "@avenor/auth";
import { closeAllDatabasePools, resetTestDatabaseRecords, runMigrations } from "@avenor/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getProjectOperationalTimeline,
  recordOperationalEvent,
} from "@/lib/reliability/correlation";

describe("THE-153 PostgreSQL Integration: Operational event deduplication, correlation, and tenant isolation", () => {
  beforeAll(async () => {
    await runMigrations();
    await resetTestDatabaseRecords();
  });

  afterAll(async () => {
    await resetTestDatabaseRecords();
    await closeAllDatabasePools();
  });

  it("deduplicates webhook + polling observations for the same external event, computes correlations, and isolates tenant caches", async () => {
    const ownerA = await registerUserWithDefaultOwnership({
      email: "corr-owner-a@avenor.test",
      name: "Corr Owner A",
      password: "ValidPassword!2026",
      organizationName: "Corr Org A",
      workspaceName: "Corr WS A",
    });
    const ownerB = await registerUserWithDefaultOwnership({
      email: "corr-owner-b@avenor.test",
      name: "Corr Owner B",
      password: "ValidPassword!2026",
      organizationName: "Corr Org B",
      workspaceName: "Corr WS B",
    });

    const projectA = await createLogicalProject(ownerA.context, ownerA.context.activeWorkspace.id, {
      name: "Avenor Core",
      primaryDomain: "core.avenor.dev",
    });

    // Same deployment observed twice (BUILDING -> READY): must upsert to 1 row
    await recordOperationalEvent(ownerA.context, {
      projectId: projectA.id,
      providerKey: "vercel",
      eventType: "DEPLOYMENT",
      externalEventId: "dpl_999",
      environmentName: "PRODUCTION",
      commitSha: "f00ba7123456",
      status: "BUILDING",
      summary: "Vercel deploy dpl_999 building",
      occurredAtIso: "2026-11-20T14:00:00.000Z",
    });
    await recordOperationalEvent(ownerA.context, {
      projectId: projectA.id,
      providerKey: "vercel",
      eventType: "DEPLOYMENT",
      externalEventId: "dpl_999",
      environmentName: "PRODUCTION",
      commitSha: "f00ba7123456",
      status: "READY",
      summary: "Vercel deploy dpl_999 ready",
      occurredAtIso: "2026-11-20T14:01:00.000Z",
    });

    await recordOperationalEvent(ownerA.context, {
      projectId: projectA.id,
      providerKey: "github",
      eventType: "CI_WORKFLOW",
      externalEventId: "gh_run_999",
      environmentName: "PRODUCTION",
      commitSha: "f00ba7123456",
      status: "passed",
      summary: "GitHub CI workflow passed",
      occurredAtIso: "2026-11-20T13:58:00.000Z",
    });

    const timeline = await getProjectOperationalTimeline(ownerA.context, projectA.id);
    expect(timeline.events).toHaveLength(2);
    const dpl = timeline.events.find((e) => e.externalEventId === "dpl_999");
    expect(dpl?.status).toBe("READY");
    expect(timeline.correlations).toHaveLength(1);
    expect(timeline.correlations[0]?.evidenceLevel).toBe("DIRECTLY_LINKED");

    // Tenant B denied access even after Tenant A populated cache
    await expect(getProjectOperationalTimeline(ownerB.context, projectA.id)).rejects.toThrow();
  });
});
