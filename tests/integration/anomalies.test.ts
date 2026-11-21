import "dotenv/config";
import { createLogicalProject, registerUserWithDefaultOwnership } from "@avenor/auth";
import { closeAllDatabasePools, resetTestDatabaseRecords, runMigrations } from "@avenor/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  evaluateAndPersistProjectAnomaly,
  listWorkspaceAnomalies,
  updateAnomalyStatus,
} from "@/lib/intelligence/anomalies";

describe("THE-155 PostgreSQL Integration: Anomaly persistence, deduplication, acknowledgment, and tenant isolation", () => {
  beforeAll(async () => {
    await runMigrations();
    await resetTestDatabaseRecords();
  });

  afterAll(async () => {
    await resetTestDatabaseRecords();
    await closeAllDatabasePools();
  });

  it("persists detected anomaly, deduplicates repeated evaluations, allows acknowledgment, and blocks cross-tenant access", async () => {
    const ownerA = await registerUserWithDefaultOwnership({
      email: "anom-owner-a@avenor.test",
      name: "Anom Owner A",
      password: "ValidPassword!2026",
      organizationName: "Anom Org A",
      workspaceName: "Anom WS A",
    });
    const ownerB = await registerUserWithDefaultOwnership({
      email: "anom-owner-b@avenor.test",
      name: "Anom Owner B",
      password: "ValidPassword!2026",
      organizationName: "Anom Org B",
      workspaceName: "Anom WS B",
    });

    const projectA = await createLogicalProject(ownerA.context, ownerA.context.activeWorkspace.id, {
      name: "Traffic Product",
      primaryDomain: "traffic.avenor.dev",
    });

    const evalInput = {
      metricKey: "ga4.sessions",
      providerKey: "ga4",
      history: [
        { dateIso: "2026-11-13T00:00:00Z", value: 1000 },
        { dateIso: "2026-11-14T00:00:00Z", value: 1020 },
        { dateIso: "2026-11-15T00:00:00Z", value: 990 },
        { dateIso: "2026-11-16T00:00:00Z", value: 1010 },
        { dateIso: "2026-11-17T00:00:00Z", value: 980 },
        { dateIso: "2026-11-18T00:00:00Z", value: 1030 },
        { dateIso: "2026-11-19T00:00:00Z", value: 1005 },
      ],
      currentValue: 250,
      currentDateIso: "2026-11-20T00:00:00Z",
      completenessState: "COMPLETE" as const,
    };

    const run1 = await evaluateAndPersistProjectAnomaly(ownerA.context, projectA.id, evalInput);
    const run2 = await evaluateAndPersistProjectAnomaly(ownerA.context, projectA.id, evalInput);

    expect(run1.anomaly).not.toBeNull();
    expect(run2.anomaly?.id).toBe(run1.anomaly?.id); // Deduplicated!

    const listA = await listWorkspaceAnomalies(ownerA.context);
    expect(listA).toHaveLength(1);

    const acked = await updateAnomalyStatus(ownerA.context, run1.anomaly?.id ?? "", "ACKNOWLEDGED");
    expect(acked.status).toBe("ACKNOWLEDGED");

    // Cross-tenant denial
    await expect(
      updateAnomalyStatus(ownerB.context, run1.anomaly?.id ?? "", "RESOLVED"),
    ).rejects.toThrow();
  });
});
