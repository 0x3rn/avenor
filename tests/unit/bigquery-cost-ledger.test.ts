import { describe, expect, it } from "vitest";
import {
  assertReadOnlyBigQuerySelectStatement,
  buildAllowlistedBigQueryCostSelectRequest,
  parseBigQueryCostQueryResponse,
} from "@/lib/providers";

describe("THE-135: BigQuery Cost Query Adapter & Normalized Billing Ledger", () => {
  it("blocks DDL, DML, EXPORT DATA, stored procedures, and multi-statement SQL while allowing parameterized SELECT", () => {
    expect(() =>
      assertReadOnlyBigQuerySelectStatement("SELECT * FROM `proj.ds.tbl` WHERE 1=1"),
    ).not.toThrow();

    for (const forbidden of [
      "DROP TABLE `proj.ds.tbl`",
      "DELETE FROM `proj.ds.tbl` WHERE 1=1",
      "UPDATE `proj.ds.tbl` SET cost = 0",
      "INSERT INTO `proj.ds.tbl` VALUES (1)",
      "SELECT 1; DROP TABLE `proj.ds.tbl`",
      "EXPORT DATA OPTIONS(uri='gs://bucket/*') AS SELECT * FROM `proj.ds.tbl`",
      "SELECT * FROM `proj.ds.tbl` WHERE 1=1 UNION ALL EXECUTE IMMEDIATE 'DROP TABLE x'",
    ]) {
      expect(() => assertReadOnlyBigQuerySelectStatement(forbidden)).toThrow();
    }
  });

  it("constructs named-parameterized BigQuery SELECT requests bounded by date partitions and maximumBytesBilled", () => {
    const req = buildAllowlistedBigQueryCostSelectRequest({
      billingAccountId: "01A2B3-45C6D7-89E0F1",
      datasetProjectId: "avenor-finops-prod",
      datasetId: "cloud_billing_export",
      tableId: "gcp_billing_export_v1_01A2B3_45C6D7_89E0F1",
      datasetLocation: "EU",
      startDate: "2026-11-01",
      endDate: "2026-11-15",
      gcpProjectFilter: "avenor-cloud-prod",
      maximumBytesBilled: 250_000_000,
    });

    expect(req.url).toBe(
      "https://bigquery.googleapis.com/bigquery/v2/projects/avenor-finops-prod/queries",
    );
    expect(req.body.useLegacySql).toBe(false);
    expect(req.body.parameterMode).toBe("NAMED");
    expect(req.body.location).toBe("EU");
    expect(req.body.maximumBytesBilled).toBe("250000000");
    expect(req.body.queryParameters).toHaveLength(4);
    expect(req.body.query).toContain("WHERE billing_account_id = @billingAccountId");
    expect(req.body.query).toContain("AND project.id = @gcpProjectFilter");
  });

  it("parses BigQuery tabular responses, normalizes credits and net cost, preserves currency and invoice month, and distinguishes provisional vs finalized months", () => {
    const fixedNow = new Date("2026-11-18T12:00:00.000Z");

    const parsed = parseBigQueryCostQueryResponse(
      {
        jobComplete: true,
        totalBytesProcessed: "4194304",
        schema: {
          fields: [
            { name: "usage_date", type: "STRING" },
            { name: "invoice_month", type: "STRING" },
            { name: "gcp_project_id", type: "STRING" },
            { name: "service_id", type: "STRING" },
            { name: "service_description", type: "STRING" },
            { name: "sku_id", type: "STRING" },
            { name: "sku_description", type: "STRING" },
            { name: "region", type: "STRING" },
            { name: "cost_type", type: "STRING" },
            { name: "currency", type: "STRING" },
            { name: "currency_conversion_rate", type: "FLOAT" },
            { name: "gross_cost", type: "FLOAT" },
            { name: "credits_amount", type: "FLOAT" },
            { name: "net_cost", type: "FLOAT" },
            { name: "usage_amount", type: "FLOAT" },
            { name: "usage_unit", type: "STRING" },
            { name: "latest_export_time", type: "TIMESTAMP" },
          ],
        },
        rows: [
          {
            // Closed prior invoice month (202610) -> COMPLETE
            f: [
              { v: "2026-10-25" },
              { v: "202610" },
              { v: "avenor-cloud-prod" },
              { v: "6F81-5844-456A" },
              { v: "Cloud Run" },
              { v: "D97E-32A1-8102" },
              { v: "CPU Allocation Time" },
              { v: "us-central1" },
              { v: "regular" },
              { v: "USD" },
              { v: "1.0" },
              { v: "120.50" },
              { v: "-20.50" },
              { v: "100.00" },
              { v: "360000" },
              { v: "vCPU-seconds" },
              { v: "2026-10-26T04:00:00.000Z" },
            ],
          },
          {
            // Current open invoice month (202611) -> PROVISIONAL
            f: [
              { v: "2026-11-16" },
              { v: "202611" },
              { v: "avenor-eu-api" },
              { v: "9662-B51E-5089" },
              { v: "Cloud SQL" },
              { v: "A104-99B2-44C1" },
              { v: "Postgres Enterprise vCPU" },
              { v: "europe-west1" },
              { v: "tax" },
              { v: "EUR" },
              { v: "0.92" },
              { v: "45.25" },
              { v: "0" },
              { v: "45.25" },
              { v: null },
              { v: null },
              { v: "2026-11-17T02:00:00.000Z" },
            ],
          },
        ],
      },
      {
        billingAccountId: "01A2B3-45C6D7-89E0F1",
        now: fixedNow,
      },
    );

    expect(parsed.totalBytesProcessed).toBe(4194304);
    expect(parsed.rows).toHaveLength(2);

    const octRow = parsed.rows[0];
    expect(octRow?.grossCost).toBe(120.5);
    expect(octRow?.creditsAmount).toBe(-20.5);
    expect(octRow?.netCost).toBe(100);
    expect(octRow?.currency).toBe("USD");
    expect(octRow?.completenessState).toBe("COMPLETE");

    const novRow = parsed.rows[1];
    expect(novRow?.costType).toBe("tax");
    expect(novRow?.currency).toBe("EUR");
    expect(novRow?.completenessState).toBe("PROVISIONAL");
  });
});
