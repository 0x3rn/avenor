import "dotenv/config";
import { createLogicalProject, registerUserWithDefaultOwnership } from "@avenor/auth";
import { closeAllDatabasePools, resetTestDatabaseRecords, runMigrations } from "@avenor/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createHistoricalDataExportJob,
  downloadExportArtifactWithToken,
  executeWorkspaceRetentionCleanup,
  updateWorkspaceRetentionPolicy,
} from "@/lib/exports/service";

describe("THE-158 PostgreSQL Integration: Audit-friendly historical exports, signed downloads, retention, and tenant isolation", () => {
  beforeAll(async () => {
    await runMigrations();
    await resetTestDatabaseRecords();
  });

  afterAll(async () => {
    await resetTestDatabaseRecords();
    await closeAllDatabasePools();
  });

  it("creates signed exports with checksums and provenance, blocks cross-tenant downloads, and updates retention policy", async () => {
    const ownerA = await registerUserWithDefaultOwnership({
      email: "exp-owner-a@avenor.test",
      name: "Export Owner A",
      password: "ValidPassword!2026",
      organizationName: "Exp Org A",
      workspaceName: "Exp WS A",
    });
    const ownerB = await registerUserWithDefaultOwnership({
      email: "exp-owner-b@avenor.test",
      name: "Export Owner B",
      password: "ValidPassword!2026",
      organizationName: "Exp Org B",
      workspaceName: "Exp WS B",
    });

    const projectA = await createLogicalProject(ownerA.context, ownerA.context.activeWorkspace.id, {
      name: "Exportable Product",
      primaryDomain: "export.avenor.dev",
    });

    const policy = await updateWorkspaceRetentionPolicy(ownerA.context, {
      metricRetentionDays: 180,
      eventRetentionDays: 90,
      exportExpiryHours: 12,
    });
    expect(policy.metricRetentionDays).toBe(180);

    const { job, downloadToken } = await createHistoricalDataExportJob(ownerA.context, {
      exportType: "HISTORICAL_METRICS_CSV",
      projectIds: [projectA.id],
      dateStart: "2026-11-01",
      dateEnd: "2026-11-21",
    });
    expect(job.status).toBe("READY");
    expect(job.checksumSha256).toMatch(/^[0-9a-f]{64}$/);

    const artifact = await downloadExportArtifactWithToken(ownerA.context, job.id, downloadToken);
    expect(artifact.content).toContain("Avenor Historical Export");
    expect(artifact.checksumSha256).toBe(job.checksumSha256);

    // Cross-tenant download denied even if token is leaked
    await expect(
      downloadExportArtifactWithToken(ownerB.context, job.id, downloadToken),
    ).rejects.toThrow();

    const cleanup = await executeWorkspaceRetentionCleanup(ownerA.context);
    expect(cleanup.backupLimitationNote).toMatch(/point-in-time recovery/i);
  });
});
