import "dotenv/config";
import {
  closeAllDatabasePools,
  dbQuery,
  generateId,
  getDatabasePool,
  resetTestDatabaseRecords,
  runMigrations,
} from "@avenor/database";
import { PROVIDER_ERROR_CODES, ProviderAdapterError } from "@avenor/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeResourceIngestionSync, setResourceIngestionPausedState } from "@/lib/ingestion";
import { queryMetricObservations } from "@/lib/metrics";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe("THE-129: Idempotent Scheduled Collection, Backfill Resumption, Concurrency Locks & Quota Control", () => {
  let orgAId = "";
  let wksAId = "";
  let prjAId = "";
  let envAId = "";
  let conGa4Id = "";
  let resGa4Id = "";
  let conRevokedId = "";
  let resRevokedId = "";

  let orgBId = "";
  let wksBId = "";

  beforeAll(async () => {
    await runMigrations({ connectionString: TEST_DB_URL });
    await resetTestDatabaseRecords({ connectionString: TEST_DB_URL });

    const pool = getDatabasePool(TEST_DB_URL);
    orgAId = generateId("org");
    wksAId = generateId("wks");
    prjAId = generateId("prj");
    envAId = generateId("env");
    conGa4Id = generateId("con");
    resGa4Id = generateId("res");
    conRevokedId = generateId("con");
    resRevokedId = generateId("res");

    orgBId = generateId("org");
    wksBId = generateId("wks");

    await dbQuery(
      `INSERT INTO organizations (id, name, slug) VALUES ($1, 'Ingest Org A', 'ingest-org-a'), ($2, 'Ingest Org B', 'ingest-org-b')`,
      [orgAId, orgBId],
      pool,
    );
    await dbQuery(
      `INSERT INTO workspaces (id, organization_id, name, slug, default_timezone)
       VALUES ($1, $2, 'Ingest Wks A', 'ingest-wks-a', 'America/New_York'),
              ($3, $4, 'Ingest Wks B', 'ingest-wks-b', 'UTC')`,
      [wksAId, orgAId, wksBId, orgBId],
      pool,
    );
    await dbQuery(
      `INSERT INTO logical_projects (id, workspace_id, name, slug)
       VALUES ($1, $2, 'Ingest Atlas App', 'ingest-atlas-app')`,
      [prjAId, wksAId],
      pool,
    );
    await dbQuery(
      `INSERT INTO project_environments (id, project_id, name, slug, environment_type, is_default)
       VALUES ($1, $2, 'Production', 'production', 'PRODUCTION', true)`,
      [envAId, prjAId],
      pool,
    );
    await dbQuery(
      `INSERT INTO provider_connections (id, workspace_id, provider_key, display_name, status)
       VALUES ($1, $2, 'ga4', 'GA4 Healthy', 'HEALTHY'),
              ($3, $4, 'gsc', 'GSC Revoked', 'REVOKED')`,
      [conGa4Id, wksAId, conRevokedId, wksAId],
      pool,
    );
    await dbQuery(
      `INSERT INTO connected_resources (id, provider_connection_id, workspace_id, external_resource_id, resource_type, display_name, metadata)
       VALUES ($1, $2, $3, 'properties/402918401', 'ga4_property', 'Atlas GA4', '{"timeZone":"America/New_York"}'::jsonb),
              ($4, $5, $6, 'sc-domain:revoked.dev', 'gsc_site', 'Revoked Site', '{}'::jsonb)`,
      [resGa4Id, conGa4Id, wksAId, resRevokedId, conRevokedId, wksAId],
      pool,
    );
    await dbQuery(
      `INSERT INTO resource_mappings (id, workspace_id, project_id, environment_id, connected_resource_id, mapping_role)
       VALUES ($1, $2, $3, $4, $5, 'PRIMARY')`,
      [generateId("map"), wksAId, prjAId, envAId, resGa4Id],
      pool,
    );
  });

  afterAll(async () => {
    await resetTestDatabaseRecords({ connectionString: TEST_DB_URL });
    await closeAllDatabasePools();
  });

  it("verifies Scenario 1 (idempotent repeated sync), Scenario 3 (concurrent worker lease protection), and Scenario 4 (DB failure rollback)", async () => {
    const makeBatchObs = (sessionsVal: number) => [
      {
        organizationId: orgAId,
        workspaceId: wksAId,
        projectId: prjAId,
        environmentId: envAId,
        providerConnectionId: conGa4Id,
        connectedResourceId: resGa4Id,
        providerKey: "ga4",
        externalResourceId: "properties/402918401",
        canonicalMetricKey: "ga4.sessions",
        granularity: "DAILY" as const,
        periodStartDate: "2026-10-10",
        periodEndDate: "2026-10-10",
        reportingTimezone: "America/New_York",
        numericValue: sessionsVal,
        completenessState: "PROVISIONAL" as const,
      },
    ];

    // First sync inserts observation and advances watermark
    const firstSync = await executeResourceIngestionSync(
      {
        organizationId: orgAId,
        workspaceId: wksAId,
        projectId: prjAId,
        environmentId: envAId,
        providerConnectionId: conGa4Id,
        connectedResourceId: resGa4Id,
        runType: "SCHEDULED_SYNC",
        requestedStartDate: "2026-10-10",
        requestedEndDate: "2026-10-10",
        idempotencyToken: "sync_1",
        customFetcher: async () => ({
          observations: makeBatchObs(250),
          quotaSnapshot: { tokensRemainingHour: 4800 },
        }),
      },
      { connectionString: TEST_DB_URL },
    );

    expect(firstSync.outcome).toBe("completed");
    expect(firstSync.recordsInserted).toBe(1);
    expect(firstSync.watermark.lastCommittedEndDate).toBe("2026-10-10");
    expect(firstSync.watermark.syncState).toBe("COMPLETED");

    // Repeated identical sync is idempotent (0 inserted, 1 unchanged)
    const secondSync = await executeResourceIngestionSync(
      {
        organizationId: orgAId,
        workspaceId: wksAId,
        projectId: prjAId,
        environmentId: envAId,
        providerConnectionId: conGa4Id,
        connectedResourceId: resGa4Id,
        runType: "SCHEDULED_SYNC",
        requestedStartDate: "2026-10-10",
        requestedEndDate: "2026-10-10",
        idempotencyToken: "sync_2",
        customFetcher: async () => ({
          observations: makeBatchObs(250),
        }),
      },
      { connectionString: TEST_DB_URL },
    );

    expect(secondSync.outcome).toBe("completed");
    expect(secondSync.recordsInserted).toBe(0);
    expect(secondSync.recordsUnchanged).toBe(1);

    // Scenario 4: Simulated DB failure during batch commit must NOT advance watermark to 2026-10-12
    const failedDbSync = await executeResourceIngestionSync(
      {
        organizationId: orgAId,
        workspaceId: wksAId,
        projectId: prjAId,
        environmentId: envAId,
        providerConnectionId: conGa4Id,
        connectedResourceId: resGa4Id,
        runType: "SCHEDULED_SYNC",
        requestedStartDate: "2026-10-12",
        requestedEndDate: "2026-10-12",
        idempotencyToken: "sync_db_fail",
        simulateDbFailureOnBatchIndex: 0,
        customFetcher: async () => ({
          observations: [
            {
              ...makeBatchObs(500)[0],
              periodStartDate: "2026-10-12",
              periodEndDate: "2026-10-12",
            },
          ],
        }),
      },
      { connectionString: TEST_DB_URL },
    );

    expect(failedDbSync.outcome).toBe("failed");
    expect(failedDbSync.watermark.lastCommittedEndDate).toBe("2026-10-10");
    const rolledBackRows = await queryMetricObservations(
      {
        organizationId: orgAId,
        workspaceId: wksAId,
        periodStartDate: "2026-10-12",
        periodEndDate: "2026-10-12",
      },
      { connectionString: TEST_DB_URL },
    );
    expect(rolledBackRows).toHaveLength(0);

    // Scenario 3: Two concurrent workers starting simultaneously — one claims lease, the other skips safely
    const [worker1, worker2] = await Promise.all([
      executeResourceIngestionSync(
        {
          organizationId: orgAId,
          workspaceId: wksAId,
          projectId: prjAId,
          environmentId: envAId,
          providerConnectionId: conGa4Id,
          connectedResourceId: resGa4Id,
          runType: "SCHEDULED_SYNC",
          requestedStartDate: "2026-10-11",
          requestedEndDate: "2026-10-11",
          idempotencyToken: "concurrent_w1",
          customFetcher: async () => {
            await new Promise((resolve) => setTimeout(resolve, 120));
            return {
              observations: [
                {
                  ...makeBatchObs(310)[0],
                  periodStartDate: "2026-10-11",
                  periodEndDate: "2026-10-11",
                },
              ],
            };
          },
        },
        { connectionString: TEST_DB_URL },
      ),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return executeResourceIngestionSync(
          {
            organizationId: orgAId,
            workspaceId: wksAId,
            projectId: prjAId,
            environmentId: envAId,
            providerConnectionId: conGa4Id,
            connectedResourceId: resGa4Id,
            runType: "SCHEDULED_SYNC",
            requestedStartDate: "2026-10-11",
            requestedEndDate: "2026-10-11",
            idempotencyToken: "concurrent_w2",
            customFetcher: async () => ({
              observations: [
                {
                  ...makeBatchObs(310)[0],
                  periodStartDate: "2026-10-11",
                  periodEndDate: "2026-10-11",
                },
              ],
            }),
          },
          { connectionString: TEST_DB_URL },
        );
      })(),
    ]);

    const outcomes = [worker1.outcome, worker2.outcome].sort();
    expect(outcomes).toEqual(["completed", "skipped_active_lease"]);
  });

  it("verifies Scenario 15 (interrupted multi-batch backfill resumption), Scenario 6 (429 rate-limit cooldown), Scenario 8 (revoked connection), and cross-tenant isolation", async () => {
    const backfillScopeKey = "backfill_resumable_test";

    // 30-day backfill (2026-09-01..2026-09-30 -> 3 batches: Sept 1..14, Sept 15..28, Sept 29..30)
    // Interrupt on batchIndex === 1 (Batch 2)
    const interruptedBackfill = await executeResourceIngestionSync(
      {
        organizationId: orgAId,
        workspaceId: wksAId,
        projectId: prjAId,
        environmentId: envAId,
        providerConnectionId: conGa4Id,
        connectedResourceId: resGa4Id,
        runType: "INITIAL_BACKFILL",
        requestedStartDate: "2026-09-01",
        requestedEndDate: "2026-09-30",
        queryScopeKey: backfillScopeKey,
        idempotencyToken: "bf_part_1",
        customFetcher: async ({ batch }) => {
          if (batch.batchIndex === 1) {
            throw new Error("Simulated transient network timeout on batch 2");
          }
          return {
            observations: [
              {
                organizationId: orgAId,
                workspaceId: wksAId,
                projectId: prjAId,
                environmentId: envAId,
                providerConnectionId: conGa4Id,
                connectedResourceId: resGa4Id,
                providerKey: "ga4",
                externalResourceId: "properties/402918401",
                canonicalMetricKey: "ga4.sessions",
                granularity: "DAILY",
                periodStartDate: batch.startDate,
                periodEndDate: batch.startDate,
                reportingTimezone: "America/New_York",
                numericValue: 100 + batch.batchIndex,
              },
            ],
          };
        },
      },
      { connectionString: TEST_DB_URL },
    );

    expect(interruptedBackfill.outcome).toBe("partially_completed");
    expect(interruptedBackfill.batchesCompleted).toBe(1);
    expect(interruptedBackfill.watermark.lastCommittedEndDate).toBe("2026-09-14");
    expect(interruptedBackfill.watermark.backfillCompleted).toBe(false);

    // Resume the interrupted backfill: should start at 2026-09-15 (skipping Batch 1!) and complete remaining 2 batches
    const resumedFetchedStarts: string[] = [];
    const resumedBackfill = await executeResourceIngestionSync(
      {
        organizationId: orgAId,
        workspaceId: wksAId,
        projectId: prjAId,
        environmentId: envAId,
        providerConnectionId: conGa4Id,
        connectedResourceId: resGa4Id,
        runType: "INITIAL_BACKFILL",
        requestedStartDate: "2026-09-01",
        requestedEndDate: "2026-09-30",
        queryScopeKey: backfillScopeKey,
        idempotencyToken: "bf_part_2",
        customFetcher: async ({ batch }) => {
          resumedFetchedStarts.push(batch.startDate);
          return {
            observations: [
              {
                organizationId: orgAId,
                workspaceId: wksAId,
                projectId: prjAId,
                environmentId: envAId,
                providerConnectionId: conGa4Id,
                connectedResourceId: resGa4Id,
                providerKey: "ga4",
                externalResourceId: "properties/402918401",
                canonicalMetricKey: "ga4.sessions",
                granularity: "DAILY",
                periodStartDate: batch.startDate,
                periodEndDate: batch.startDate,
                reportingTimezone: "America/New_York",
                numericValue: 200 + batch.batchIndex,
              },
            ],
          };
        },
      },
      { connectionString: TEST_DB_URL },
    );

    expect(resumedBackfill.outcome).toBe("completed");
    expect(resumedFetchedStarts).toEqual(["2026-09-15", "2026-09-29"]);
    expect(resumedBackfill.watermark.lastCommittedEndDate).toBe("2026-09-30");
    expect(resumedBackfill.watermark.backfillCompleted).toBe(true);

    // Scenario 6: Provider 429 rate-limit sets cooldown and prevents retry storms
    const rateLimitScope = "rate_limit_scope";
    const rateLimitedRun = await executeResourceIngestionSync(
      {
        organizationId: orgAId,
        workspaceId: wksAId,
        projectId: prjAId,
        environmentId: envAId,
        providerConnectionId: conGa4Id,
        connectedResourceId: resGa4Id,
        runType: "SCHEDULED_SYNC",
        queryScopeKey: rateLimitScope,
        idempotencyToken: "rl_1",
        customFetcher: async () => {
          throw new ProviderAdapterError({
            providerKey: "ga4",
            code: PROVIDER_ERROR_CODES.RATE_LIMITED,
            message: "429 Too Many Requests",
            retryAfterSeconds: 60,
          });
        },
      },
      { connectionString: TEST_DB_URL },
    );
    expect(rateLimitedRun.outcome).toBe("skipped_rate_limited");
    expect(rateLimitedRun.watermark.syncState).toBe("RATE_LIMITED");
    expect(rateLimitedRun.watermark.rateLimitResetAtIso).not.toBeNull();

    // Immediate retry while cooldown is active skips without calling provider
    let providerCalledDuringCooldown = false;
    const blockedRetry = await executeResourceIngestionSync(
      {
        organizationId: orgAId,
        workspaceId: wksAId,
        projectId: prjAId,
        environmentId: envAId,
        providerConnectionId: conGa4Id,
        connectedResourceId: resGa4Id,
        runType: "SCHEDULED_SYNC",
        queryScopeKey: rateLimitScope,
        idempotencyToken: "rl_2",
        customFetcher: async () => {
          providerCalledDuringCooldown = true;
          return { observations: [] };
        },
      },
      { connectionString: TEST_DB_URL },
    );
    expect(blockedRetry.outcome).toBe("skipped_rate_limited");
    expect(providerCalledDuringCooldown).toBe(false);

    // Pause and resume watermark state
    const pausedWm = await setResourceIngestionPausedState(
      {
        organizationId: orgAId,
        workspaceId: wksAId,
        connectedResourceId: resGa4Id,
        paused: true,
      },
      { connectionString: TEST_DB_URL },
    );
    expect(pausedWm?.syncState).toBe("PAUSED");

    const skippedWhilePaused = await executeResourceIngestionSync(
      {
        organizationId: orgAId,
        workspaceId: wksAId,
        projectId: prjAId,
        environmentId: envAId,
        providerConnectionId: conGa4Id,
        connectedResourceId: resGa4Id,
        runType: "SCHEDULED_SYNC",
        idempotencyToken: "paused_test",
      },
      { connectionString: TEST_DB_URL },
    );
    expect(skippedWhilePaused.outcome).toBe("skipped_paused");

    // Scenario 8: Revoked connection stops ingestion immediately
    let revokedCalled = false;
    const revokedSync = await executeResourceIngestionSync(
      {
        organizationId: orgAId,
        workspaceId: wksAId,
        providerConnectionId: conRevokedId,
        connectedResourceId: resRevokedId,
        runType: "SCHEDULED_SYNC",
        customFetcher: async () => {
          revokedCalled = true;
          return { observations: [] };
        },
      },
      { connectionString: TEST_DB_URL },
    );
    expect(revokedSync.outcome).toBe("connection_revoked");
    expect(revokedSync.watermark.syncState).toBe("CONNECTION_REVOKED");
    expect(revokedCalled).toBe(false);

    // Cross-tenant ingestion attempt (Org B targeting Org A's resource) rejected with FORBIDDEN
    await expect(
      executeResourceIngestionSync(
        {
          organizationId: orgBId,
          workspaceId: wksBId,
          providerConnectionId: conGa4Id,
          connectedResourceId: resGa4Id,
          runType: "SCHEDULED_SYNC",
        },
        { connectionString: TEST_DB_URL },
      ),
    ).rejects.toThrow(/Unauthorized ingestion target/i);
  });
});
