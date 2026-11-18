import "dotenv/config";
import {
  closeAllDatabasePools,
  dbQuery,
  generateId,
  getDatabasePool,
  resetTestDatabaseRecords,
  runMigrations,
} from "@avenor/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  aggregateMetricObservations,
  getMetricObservationRevisions,
  listMetricDefinitionsFromDb,
  queryMetricObservations,
  registerMetricDefinitionInDb,
  upsertMetricObservation,
  upsertMetricObservationBatch,
} from "@/lib/metrics";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe("THE-128: PostgreSQL Canonical Metrics Storage, Revisions, Idempotency & Tenant Isolation", () => {
  let orgAId = "";
  let wksAId = "";
  let prjAId = "";
  let envAId = "";
  let conAId = "";
  let resAId = "";

  let orgBId = "";
  let wksBId = "";
  let conBId = "";
  let resBId = "";

  beforeAll(async () => {
    await runMigrations({ connectionString: TEST_DB_URL });
    await resetTestDatabaseRecords({ connectionString: TEST_DB_URL });

    orgAId = generateId("org");
    wksAId = generateId("wks");
    prjAId = generateId("prj");
    envAId = generateId("env");
    conAId = generateId("con");
    resAId = generateId("res");

    orgBId = generateId("org");
    wksBId = generateId("wks");
    conBId = generateId("con");
    resBId = generateId("res");

    const pool = getDatabasePool(TEST_DB_URL);

    await dbQuery(
      `INSERT INTO organizations (id, name, slug) VALUES ($1, 'Org A', 'org-a'), ($2, 'Org B', 'org-b')`,
      [orgAId, orgBId],
      pool,
    );
    await dbQuery(
      `INSERT INTO workspaces (id, organization_id, name, slug, default_timezone)
       VALUES ($1, $2, 'Workspace A', 'wks-a', 'America/New_York'),
              ($3, $4, 'Workspace B', 'wks-b', 'Europe/London')`,
      [wksAId, orgAId, wksBId, orgBId],
      pool,
    );
    await dbQuery(
      `INSERT INTO logical_projects (id, workspace_id, name, slug)
       VALUES ($1, $2, 'Atlas Flagship', 'atlas-flagship')`,
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
       VALUES ($1, $2, 'ga4', 'GA4 Org A', 'HEALTHY'),
              ($3, $4, 'gsc', 'GSC Org B', 'HEALTHY')`,
      [conAId, wksAId, conBId, wksBId],
      pool,
    );
    await dbQuery(
      `INSERT INTO connected_resources (id, provider_connection_id, workspace_id, external_resource_id, resource_type, display_name)
       VALUES ($1, $2, $3, 'properties/402918401', 'ga4_property', 'Atlas GA4 Property'),
              ($4, $5, $6, 'sc-domain:orgb.example.com', 'gsc_site', 'Org B GSC Site')`,
      [resAId, conAId, wksAId, resBId, conBId, wksBId],
      pool,
    );
  });

  afterAll(async () => {
    await resetTestDatabaseRecords({ connectionString: TEST_DB_URL });
    await closeAllDatabasePools();
  });

  it("loads seeded canonical metric definitions and registers extensible provider definitions idempotently", async () => {
    const defs = await listMetricDefinitionsFromDb({ connectionString: TEST_DB_URL });
    expect(defs.length).toBeGreaterThanOrEqual(14);
    expect(defs.some((d) => d.canonicalKey === "ga4.active_users")).toBe(true);
    expect(defs.some((d) => d.canonicalKey === "gsc.clicks")).toBe(true);

    const customDef = await registerMetricDefinitionInDb(
      {
        id: "mdef_gcp_cost_v1",
        canonicalKey: "gcp_billing.net_cost",
        providerKey: "gcp_billing",
        providerMetricName: "net_cost",
        displayName: "Net Cloud Cost",
        description: "Reported cloud spend after applicable credits.",
        category: "cost",
        unit: "currency",
        valueType: "CURRENCY",
        aggregationRule: "SUM",
        isAdditiveAcrossDates: true,
        isAdditiveAcrossResources: true,
        supportedDimensions: ["date", "service", "project"],
        supportedGranularities: ["DAILY", "MONTHLY", "WINDOW_TOTAL"],
        timezoneBehavior: "BILLING_ACCOUNT_LOCAL",
        freshnessWindowMinutes: 360,
        capabilityKey: "billing_export_cost",
        schemaVersion: 1,
      },
      { connectionString: TEST_DB_URL },
    );
    expect(customDef.canonicalKey).toBe("gcp_billing.net_cost");
  });

  it("enforces Scenario 1 (duplicate daily observation idempotency) and Scenario 2 (historical revision without double-counting)", async () => {
    // First sync: 100 sessions (PROVISIONAL)
    const first = await upsertMetricObservation(
      {
        organizationId: orgAId,
        workspaceId: wksAId,
        projectId: prjAId,
        environmentId: envAId,
        providerConnectionId: conAId,
        connectedResourceId: resAId,
        providerKey: "ga4",
        externalResourceId: "properties/402918401",
        canonicalMetricKey: "ga4.sessions",
        granularity: "DAILY",
        periodStartDate: "2026-10-15",
        periodEndDate: "2026-10-15",
        reportingTimezone: "America/New_York",
        numericValue: 100,
        completenessState: "PROVISIONAL",
      },
      { connectionString: TEST_DB_URL },
    );
    expect(first.action).toBe("inserted");
    expect(first.observation.numericValue).toBe(100);
    expect(first.observation.revisionNumber).toBe(1);

    // Scenario 1: Identical re-run -> unchanged, no revision inflation, no duplicate row
    const second = await upsertMetricObservation(
      {
        organizationId: orgAId,
        workspaceId: wksAId,
        projectId: prjAId,
        environmentId: envAId,
        providerConnectionId: conAId,
        connectedResourceId: resAId,
        providerKey: "ga4",
        externalResourceId: "properties/402918401",
        canonicalMetricKey: "ga4.sessions",
        granularity: "DAILY",
        periodStartDate: "2026-10-15",
        periodEndDate: "2026-10-15",
        reportingTimezone: "America/New_York",
        numericValue: 100,
        completenessState: "PROVISIONAL",
      },
      { connectionString: TEST_DB_URL },
    );
    expect(second.action).toBe("unchanged");
    expect(second.observation.id).toBe(first.observation.id);
    expect(second.observation.revisionNumber).toBe(1);

    // Scenario 2: Later corrected provider value: 108 sessions (COMPLETE) -> replaces 100 with 108 (NOT 208!)
    const revised = await upsertMetricObservation(
      {
        organizationId: orgAId,
        workspaceId: wksAId,
        projectId: prjAId,
        environmentId: envAId,
        providerConnectionId: conAId,
        connectedResourceId: resAId,
        providerKey: "ga4",
        externalResourceId: "properties/402918401",
        canonicalMetricKey: "ga4.sessions",
        granularity: "DAILY",
        periodStartDate: "2026-10-15",
        periodEndDate: "2026-10-15",
        reportingTimezone: "America/New_York",
        numericValue: 108,
        completenessState: "COMPLETE",
        revisionReason: "GA4 finalized late-arriving session events",
      },
      { connectionString: TEST_DB_URL },
    );
    expect(revised.action).toBe("updated");
    expect(revised.revisionRecorded).toBe(true);
    expect(revised.observation.numericValue).toBe(108);
    expect(revised.observation.previousNumericValue).toBe(100);
    expect(revised.observation.revisionNumber).toBe(2);

    const storedRows = await queryMetricObservations(
      {
        organizationId: orgAId,
        workspaceId: wksAId,
        canonicalMetricKeys: ["ga4.sessions"],
        periodStartDate: "2026-10-15",
        periodEndDate: "2026-10-15",
      },
      { connectionString: TEST_DB_URL },
    );
    expect(storedRows).toHaveLength(1);
    expect(storedRows[0]?.numericValue).toBe(108);

    const revisions = await getMetricObservationRevisions(
      {
        organizationId: orgAId,
        workspaceId: wksAId,
        observationId: first.observation.id,
      },
      { connectionString: TEST_DB_URL },
    );
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.previousValue).toBe(100);
    expect(revisions[0]?.newValue).toBe(108);
    expect(revisions[0]?.previousCompleteness).toBe("PROVISIONAL");
    expect(revisions[0]?.newCompleteness).toBe("COMPLETE");
  });

  it("handles concurrent writes safely, preserves 0 vs null & decimal precision, and enforces strict tenant isolation", async () => {
    // Concurrent writes for the same period & metric
    await Promise.all([
      upsertMetricObservation(
        {
          organizationId: orgAId,
          workspaceId: wksAId,
          projectId: prjAId,
          environmentId: envAId,
          providerConnectionId: conAId,
          connectedResourceId: resAId,
          providerKey: "ga4",
          externalResourceId: "properties/402918401",
          canonicalMetricKey: "ga4.key_events",
          granularity: "DAILY",
          periodStartDate: "2026-10-16",
          periodEndDate: "2026-10-16",
          reportingTimezone: "America/New_York",
          numericValue: 0,
          completenessState: "COMPLETE",
        },
        { connectionString: TEST_DB_URL },
      ),
      upsertMetricObservation(
        {
          organizationId: orgAId,
          workspaceId: wksAId,
          projectId: prjAId,
          environmentId: envAId,
          providerConnectionId: conAId,
          connectedResourceId: resAId,
          providerKey: "ga4",
          externalResourceId: "properties/402918401",
          canonicalMetricKey: "ga4.key_events",
          granularity: "DAILY",
          periodStartDate: "2026-10-16",
          periodEndDate: "2026-10-16",
          reportingTimezone: "America/New_York",
          numericValue: 0,
          completenessState: "COMPLETE",
        },
        { connectionString: TEST_DB_URL },
      ),
    ]);

    // Batch upsert with decimal precision & null unavailable value
    const batch = await upsertMetricObservationBatch(
      [
        {
          organizationId: orgAId,
          workspaceId: wksAId,
          projectId: prjAId,
          environmentId: envAId,
          providerConnectionId: conAId,
          connectedResourceId: resAId,
          providerKey: "ga4",
          externalResourceId: "properties/402918401",
          canonicalMetricKey: "ga4.engagement_rate",
          granularity: "DAILY",
          periodStartDate: "2026-10-16",
          periodEndDate: "2026-10-16",
          reportingTimezone: "America/New_York",
          numericValue: 0.642857,
          numeratorValue: 90,
          denominatorValue: 140,
          completenessState: "COMPLETE",
        },
        {
          organizationId: orgAId,
          workspaceId: wksAId,
          projectId: prjAId,
          environmentId: envAId,
          providerConnectionId: conAId,
          connectedResourceId: resAId,
          providerKey: "ga4",
          externalResourceId: "properties/402918401",
          canonicalMetricKey: "ga4.total_users",
          granularity: "DAILY",
          periodStartDate: "2026-10-16",
          periodEndDate: "2026-10-16",
          reportingTimezone: "America/New_York",
          numericValue: null,
          completenessState: "UNAVAILABLE",
        },
      ],
      { connectionString: TEST_DB_URL },
    );
    expect(batch.insertedCount).toBe(2);

    const day16Rows = await queryMetricObservations(
      {
        organizationId: orgAId,
        workspaceId: wksAId,
        periodStartDate: "2026-10-16",
        periodEndDate: "2026-10-16",
      },
      { connectionString: TEST_DB_URL },
    );

    const keyEventsRow = day16Rows.find((r) => r.canonicalMetricKey === "ga4.key_events");
    const engRateRow = day16Rows.find((r) => r.canonicalMetricKey === "ga4.engagement_rate");
    const unavailableUsersRow = day16Rows.find((r) => r.canonicalMetricKey === "ga4.total_users");

    expect(keyEventsRow?.numericValue).toBe(0);
    expect(engRateRow?.numericValue).toBeCloseTo(0.642857, 6);
    expect(unavailableUsersRow?.numericValue).toBeNull();

    // Aggregate engagement rate from stored DB observations
    const aggEngRate = aggregateMetricObservations({
      canonicalMetricKey: "ga4.engagement_rate",
      observations: day16Rows,
    });
    expect(aggEngRate.value).toBeCloseTo(90 / 140, 5);

    // Wrong-tenant write attempt (Org B trying to write to Org A's resource) must fail with FORBIDDEN
    await expect(
      upsertMetricObservation(
        {
          organizationId: orgBId,
          workspaceId: wksBId,
          projectId: null,
          environmentId: null,
          providerConnectionId: conAId,
          connectedResourceId: resAId,
          providerKey: "ga4",
          externalResourceId: "properties/402918401",
          canonicalMetricKey: "ga4.sessions",
          granularity: "DAILY",
          periodStartDate: "2026-10-16",
          periodEndDate: "2026-10-16",
          reportingTimezone: "America/New_York",
          numericValue: 999,
        },
        { connectionString: TEST_DB_URL },
      ),
    ).rejects.toThrow(/does not belong to the authorized/i);

    // Org B querying observations sees 0 rows from Org A
    const orgBRows = await queryMetricObservations(
      {
        organizationId: orgBId,
        workspaceId: wksBId,
      },
      { connectionString: TEST_DB_URL },
    );
    expect(orgBRows).toHaveLength(0);
  });
});
