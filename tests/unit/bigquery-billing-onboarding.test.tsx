import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BigQueryExportOnboardingCard } from "@/components/connections/bigquery-export-onboarding-card";
import {
  BIGQUERY_BILLING_EXPORT_ONBOARDING_STEPS,
  GCP_BIGQUERY_READONLY_SCOPE,
  GCP_BILLING_METADATA_SCOPE,
  parseAndValidateExportTableIdentifier,
  REQUIRED_DETAILED_EXPORT_COLUMNS,
  REQUIRED_STANDARD_EXPORT_COLUMNS,
  validateBigQueryBillingExportConfig,
} from "@/lib/providers";

describe("THE-134: Guided BigQuery Cloud Billing Export Onboarding & Schema/Location Validation", () => {
  it("exposes all 8 customer-controlled onboarding steps without claiming Avenor modifies Google Cloud settings", () => {
    expect(BIGQUERY_BILLING_EXPORT_ONBOARDING_STEPS).toHaveLength(8);
    expect(
      BIGQUERY_BILLING_EXPORT_ONBOARDING_STEPS.every(
        (s) => s.officialDocUrl.startsWith("https://cloud.google.com/"),
      ),
    ).toBe(true);
  });

  it("enforces strict table allowlist and billing account suffix matching, rejecting arbitrary tables or SQL injection", () => {
    const validStd = parseAndValidateExportTableIdentifier({
      billingAccountId: "01A2B3-45C6D7-89E0F1",
      datasetProjectId: "avenor-finops-prod",
      datasetId: "cloud_billing_export",
      tableId: "gcp_billing_export_v1_01A2B3_45C6D7_89E0F1",
    });
    expect(validStd.exportType).toBe("STANDARD_USAGE_COST");

    const validDetailed = parseAndValidateExportTableIdentifier({
      billingAccountId: "01A2B3-45C6D7-89E0F1",
      datasetProjectId: "avenor-finops-prod",
      datasetId: "cloud_billing_export",
      tableId: "gcp_billing_export_resource_v1_01A2B3_45C6D7_89E0F1",
    });
    expect(validDetailed.exportType).toBe("DETAILED_USAGE_COST");

    // Reject arbitrary non-billing table
    expect(() =>
      parseAndValidateExportTableIdentifier({
        billingAccountId: "01A2B3-45C6D7-89E0F1",
        datasetProjectId: "avenor-finops-prod",
        datasetId: "users_prod",
        tableId: "customers_pii_table",
      }),
    ).toThrow(/Only official Cloud Billing export tables/i);

    // Reject mismatched billing account suffix
    expect(() =>
      parseAndValidateExportTableIdentifier({
        billingAccountId: "01A2B3-45C6D7-89E0F1",
        datasetProjectId: "avenor-finops-prod",
        datasetId: "cloud_billing_export",
        tableId: "gcp_billing_export_v1_99Z9Z9_88Y8Y8_77X7X7",
      }),
    ).toThrow(/does not match selected billing account/i);
  });

  it("validates dataset location, retroactive backfill behavior, schema columns, empty/missing/stale states, and dry-run query access", async () => {
    const fixedNow = new Date("2026-11-18T12:00:00.000Z");

    // 1. Missing bigquery.readonly scope -> rejected
    await expect(
      validateBigQueryBillingExportConfig(
        {
          organizationId: "org_1",
          workspaceId: "wks_1",
          accessToken: "ya29.meta_only",
          grantedScopes: [GCP_BILLING_METADATA_SCOPE],
        },
        {
          billingAccountId: "01A2B3-45C6D7-89E0F1",
          datasetProjectId: "avenor-finops-prod",
          datasetId: "cloud_billing_export",
          tableId: "gcp_billing_export_v1_01A2B3_45C6D7_89E0F1",
        },
      ),
    ).rejects.toThrow(/bigquery\.readonly/i);

    // 2. Single-region dataset (europe-west1) with valid detailed schema and dryRun query check
    const singleRegionFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === "string" ? input : input.toString();
      if (urlStr.endsWith("/datasets/cloud_billing_export")) {
        return new Response(JSON.stringify({ location: "europe-west1" }), { status: 200 });
      }
      if (urlStr.includes("/tables/gcp_billing_export_resource_v1_01A2B3_45C6D7_89E0F1")) {
        return new Response(
          JSON.stringify({
            location: "europe-west1",
            numRows: "8420",
            lastModifiedTime: String(fixedNow.getTime() - 2 * 3_600_000),
            schema: {
              fields: REQUIRED_DETAILED_EXPORT_COLUMNS.map((name) => ({ name, type: "STRING" })),
            },
          }),
          { status: 200 },
        );
      }
      if (urlStr.endsWith("/queries") && init?.method === "POST") {
        const body = JSON.parse(String(init.body ?? "{}"));
        expect(body.dryRun).toBe(true);
        expect(body.location).toBe("europe-west1");
        return new Response(
          JSON.stringify({ jobComplete: true, totalBytesProcessed: "1048576" }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    const singleRegionRes = await validateBigQueryBillingExportConfig(
      {
        organizationId: "org_1",
        workspaceId: "wks_1",
        accessToken: "ya29.valid_bq",
        grantedScopes: [GCP_BILLING_METADATA_SCOPE, GCP_BIGQUERY_READONLY_SCOPE],
      },
      {
        billingAccountId: "01A2B3-45C6D7-89E0F1",
        datasetProjectId: "avenor-finops-prod",
        datasetId: "cloud_billing_export",
        tableId: "gcp_billing_export_resource_v1_01A2B3_45C6D7_89E0F1",
      },
      { fetchFn: singleRegionFetch, now: fixedNow },
    );

    expect(singleRegionRes.valid).toBe(true);
    expect(singleRegionRes.datasetLocation).toBe("europe-west1");
    expect(singleRegionRes.supportsRetroactiveBackfill).toBe(false);
    expect(singleRegionRes.availabilityState).toBe("EXPORT_ACTIVE_POPULATED");
    expect(singleRegionRes.dryRunJobPermitted).toBe(true);
    expect(singleRegionRes.dryRunEstimatedBytes).toBe(1048576);

    // 3. Empty export table (numRows = 0) -> EXPORT_ENABLED_EMPTY (never $0 spend)
    const emptyTableFetch = (async (input: RequestInfo | URL) => {
      const urlStr = typeof input === "string" ? input : input.toString();
      if (urlStr.endsWith("/datasets/cloud_billing_export")) {
        return new Response(JSON.stringify({ location: "US" }), { status: 200 });
      }
      if (urlStr.includes("/tables/")) {
        return new Response(
          JSON.stringify({
            location: "US",
            numRows: "0",
            lastModifiedTime: String(fixedNow.getTime()),
            schema: {
              fields: REQUIRED_STANDARD_EXPORT_COLUMNS.map((name) => ({ name, type: "STRING" })),
            },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ jobComplete: true, totalBytesProcessed: "0" }), {
        status: 200,
      });
    }) as typeof fetch;

    const emptyRes = await validateBigQueryBillingExportConfig(
      {
        organizationId: "org_1",
        workspaceId: "wks_1",
        accessToken: "ya29.valid_bq",
        grantedScopes: [GCP_BIGQUERY_READONLY_SCOPE],
      },
      {
        billingAccountId: "01A2B3-45C6D7-89E0F1",
        datasetProjectId: "avenor-finops-prod",
        datasetId: "cloud_billing_export",
        tableId: "gcp_billing_export_v1_01A2B3_45C6D7_89E0F1",
      },
      { fetchFn: emptyTableFetch, now: fixedNow },
    );
    expect(emptyRes.availabilityState).toBe("EXPORT_ENABLED_EMPTY");
    expect(emptyRes.availabilityExplanation).toContain("not $0 spend");
  });

  it("renders BigQueryExportOnboardingCard with 8 interactive steps and export table selector", () => {
    render(
      <BigQueryExportOnboardingCard
        workspaceId="wks_1"
        connectionId="con_1"
        defaultBillingAccountId="01A2B3-45C6D7-89E0F1"
        defaultDatasetProjectId="avenor-finops-prod"
      />,
    );

    expect(screen.getByTestId("bigquery-export-onboarding-card")).toBeInTheDocument();
    expect(screen.getByTestId("bq-onboarding-step-panel-1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("bq-onboarding-step-btn-4"));
    expect(screen.getByTestId("bq-onboarding-step-panel-4")).toBeInTheDocument();

    // Switching export kind updates the allowlisted table identifier automatically
    fireEvent.change(screen.getByTestId("bq-select-export-kind"), {
      target: { value: "detailed" },
    });
    expect(screen.getByTestId("bq-input-table-id")).toHaveValue(
      "gcp_billing_export_resource_v1_01A2B3_45C6D7_89E0F1",
    );
  });
});
