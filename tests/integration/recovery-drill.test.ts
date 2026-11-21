import "dotenv/config";
import crypto from "node:crypto";
import { closeAllDatabasePools, getDatabasePool } from "@avenor/database";
import { afterAll, describe, expect, it } from "vitest";

describe("THE-147: Controlled Disposable-Schema Backup & Restore Recovery Drill", () => {
  afterAll(async () => {
    await closeAllDatabasePools();
  });

  it("executes a safe backup, simulated data loss, full restore, and SHA-256 integrity verification inside an isolated disposable schema without touching production tables", async () => {
    const pool = getDatabasePool();
    const schemaName = `avenor_recovery_drill_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    try {
      // 1. Provision isolated disposable schema with representative Avenor domain tables
      await pool.query(`CREATE SCHEMA "${schemaName}"`);
      await pool.query(`
        CREATE TABLE "${schemaName}".drill_projects (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE
        );
        CREATE TABLE "${schemaName}".drill_observations (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES "${schemaName}".drill_projects(id) ON DELETE CASCADE,
          canonical_metric_key TEXT NOT NULL,
          period_date TEXT NOT NULL,
          numeric_value NUMERIC(20, 4) NOT NULL
        );
      `);

      // 2. Seed known baseline records
      await pool.query(
        `INSERT INTO "${schemaName}".drill_projects (id, workspace_id, name, slug) VALUES
           ('prj_drill_1', 'ws_drill_1', 'Avenor Alpha', 'avenor-alpha'),
           ('prj_drill_2', 'ws_drill_1', 'Avenor Beta', 'avenor-beta')`,
      );
      await pool.query(
        `INSERT INTO "${schemaName}".drill_observations (id, project_id, canonical_metric_key, period_date, numeric_value) VALUES
           ('obs_1', 'prj_drill_1', 'ga4.sessions', '2026-11-20', 4200.0000),
           ('obs_2', 'prj_drill_2', 'gcp_billing.net_cost', '2026-11-20', 115.0000)`,
      );

      // 3. Export logical checkpoint snapshot and compute SHA-256 integrity digest
      const preProjects = (
        await pool.query(`SELECT * FROM "${schemaName}".drill_projects ORDER BY id ASC`)
      ).rows;
      const preObs = (
        await pool.query(`SELECT * FROM "${schemaName}".drill_observations ORDER BY id ASC`)
      ).rows;

      const checkpointPayload = JSON.stringify({ projects: preProjects, observations: preObs });
      const preRestoreSha256 = crypto.createHash("sha256").update(checkpointPayload).digest("hex");

      // 4. Simulate accidental destructive loss strictly inside the disposable schema
      await pool.query(
        `TRUNCATE TABLE "${schemaName}".drill_observations, "${schemaName}".drill_projects CASCADE`,
      );
      const afterLossCount = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM "${schemaName}".drill_projects`,
      );
      expect(Number(afterLossCount.rows[0]?.count)).toBe(0);

      // 5. Restore from verified checkpoint snapshot inside a transaction
      const parsedCheckpoint = JSON.parse(checkpointPayload) as {
        projects: Array<{ id: string; workspace_id: string; name: string; slug: string }>;
        observations: Array<{
          id: string;
          project_id: string;
          canonical_metric_key: string;
          period_date: string;
          numeric_value: string;
        }>;
      };

      await pool.query("BEGIN");
      try {
        for (const p of parsedCheckpoint.projects) {
          await pool.query(
            `INSERT INTO "${schemaName}".drill_projects (id, workspace_id, name, slug) VALUES ($1, $2, $3, $4)`,
            [p.id, p.workspace_id, p.name, p.slug],
          );
        }
        for (const o of parsedCheckpoint.observations) {
          await pool.query(
            `INSERT INTO "${schemaName}".drill_observations (id, project_id, canonical_metric_key, period_date, numeric_value) VALUES ($1, $2, $3, $4, $5)`,
            [o.id, o.project_id, o.canonical_metric_key, o.period_date, o.numeric_value],
          );
        }
        await pool.query("COMMIT");
      } catch (err) {
        await pool.query("ROLLBACK");
        throw err;
      }

      // 6. Verify bit-for-bit SHA-256 equality after recovery
      const postProjects = (
        await pool.query(`SELECT * FROM "${schemaName}".drill_projects ORDER BY id ASC`)
      ).rows;
      const postObs = (
        await pool.query(`SELECT * FROM "${schemaName}".drill_observations ORDER BY id ASC`)
      ).rows;
      const postRestoreSha256 = crypto
        .createHash("sha256")
        .update(JSON.stringify({ projects: postProjects, observations: postObs }))
        .digest("hex");

      expect(postRestoreSha256).toBe(preRestoreSha256);
      expect(postProjects).toHaveLength(2);
      expect(postObs).toHaveLength(2);
    } finally {
      // 7. Always tear down disposable drill schema cleanly
      await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    }
  });
});
