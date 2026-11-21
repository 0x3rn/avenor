import "dotenv/config";
import { createLogicalProject, registerUserWithDefaultOwnership } from "@avenor/auth";
import { closeAllDatabasePools, resetTestDatabaseRecords, runMigrations } from "@avenor/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createUptimeMonitor,
  executeUptimeProbeAndRecord,
  listWorkspaceReliabilitySnapshot,
  toggleUptimeMonitor,
} from "@/lib/reliability/uptime";

describe("THE-152 PostgreSQL Integration: Uptime monitors, incident lifecycle, and cross-tenant isolation", () => {
  beforeAll(async () => {
    await runMigrations();
    await resetTestDatabaseRecords();
  });

  afterAll(async () => {
    await resetTestDatabaseRecords();
    await closeAllDatabasePools();
  });

  it("persists monitors, transitions through confirmed outage and recovery without duplicates, and enforces cross-tenant isolation", async () => {
    const ownerA = await registerUserWithDefaultOwnership({
      email: "uptime-owner-a@avenor.test",
      name: "Uptime Owner A",
      password: "ValidPassword!2026",
      organizationName: "Uptime Org A",
      workspaceName: "Uptime Workspace A",
    });
    const ownerB = await registerUserWithDefaultOwnership({
      email: "uptime-owner-b@avenor.test",
      name: "Uptime Owner B",
      password: "ValidPassword!2026",
      organizationName: "Uptime Org B",
      workspaceName: "Uptime Workspace B",
    });

    const projectA = await createLogicalProject(ownerA.context, ownerA.context.activeWorkspace.id, {
      name: "Avenor Public Site",
      primaryDomain: "avenor.corstack.dev",
      description: "Primary public web product",
    });

    // Reject SSRF target at creation time
    await expect(
      createUptimeMonitor(ownerA.context, {
        projectId: projectA.id,
        name: "Bad Metadata Monitor",
        targetUrl: "https://169.254.169.254/latest/meta-data",
      }),
    ).rejects.toThrow(/SSRF/i);

    const monitor = await createUptimeMonitor(ownerA.context, {
      projectId: projectA.id,
      name: "Avenor Health Endpoint",
      targetUrl: "https://avenor.corstack.dev/api/health",
      failureThreshold: 2,
      recoveryThreshold: 2,
    });
    expect(monitor.status).toBe("PENDING");

    const dnsStub = async () => [{ address: "93.184.216.34", family: 4 as const }];

    // 1st failure -> SUSPECTED_OUTAGE (no incident yet)
    const p1 = await executeUptimeProbeAndRecord(ownerA.context, monitor.id, {
      dnsLookupFn: dnsStub,
      transportFn: async () => ({ status: 503 }),
    });
    expect(p1.nextMonitorStatus).toBe("SUSPECTED_OUTAGE");
    expect(p1.incidentAction).toBe("NONE");

    // 2nd failure -> CONFIRMED_OUTAGE (1 incident opened)
    const p2 = await executeUptimeProbeAndRecord(ownerA.context, monitor.id, {
      dnsLookupFn: dnsStub,
      transportFn: async () => ({ status: 503 }),
    });
    expect(p2.nextMonitorStatus).toBe("CONFIRMED_OUTAGE");
    expect(p2.incidentAction).toBe("OPENED");

    // 1st success -> RECOVERING
    const p3 = await executeUptimeProbeAndRecord(ownerA.context, monitor.id, {
      dnsLookupFn: dnsStub,
      transportFn: async () => ({ status: 200 }),
    });
    expect(p3.nextMonitorStatus).toBe("RECOVERING");

    // 2nd success -> HEALTHY (incident RESOLVED)
    const p4 = await executeUptimeProbeAndRecord(ownerA.context, monitor.id, {
      dnsLookupFn: dnsStub,
      transportFn: async () => ({ status: 200 }),
    });
    expect(p4.nextMonitorStatus).toBe("HEALTHY");
    expect(p4.incidentAction).toBe("RESOLVED");

    const snapshotA = await listWorkspaceReliabilitySnapshot(ownerA.context, {
      projectId: projectA.id,
    });
    expect(snapshotA.monitors).toHaveLength(1);
    expect(snapshotA.incidents).toHaveLength(1);
    expect(snapshotA.incidents[0]?.status).toBe("RECOVERED");

    // Pause monitor
    const paused = await toggleUptimeMonitor(ownerA.context, monitor.id, false);
    expect(paused.status).toBe("PAUSED");

    // Cross-tenant access denied for ownerB
    await expect(
      listWorkspaceReliabilitySnapshot(ownerB.context, { projectId: projectA.id }),
    ).rejects.toThrow();
    await expect(toggleUptimeMonitor(ownerB.context, monitor.id, true)).rejects.toThrow();
  });
});
