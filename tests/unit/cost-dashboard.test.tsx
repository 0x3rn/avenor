import "@testing-library/jest-dom/vitest";
import type { LogicalProjectSummary } from "@avenor/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CostReportView } from "@/components/reports/cost-report-view";
import type { ProjectCostIntelligenceReportDto } from "@/lib/reports/cost-service";

const MOCK_PROJECT: LogicalProjectSummary = {
  id: "prj_cost_1",
  workspaceId: "wks_cost_1",
  name: "Atlas Cloud Platform",
  slug: "atlas-cloud-platform",
  description: "Production platform",
  primaryDomain: "https://atlas.avenor.dev",
  status: "ACTIVE",
  mappedResourceCount: 2,
  createdAt: "2026-10-14T10:00:00.000Z",
  updatedAt: "2026-11-18T10:00:00.000Z",
  environments: [
    {
      id: "env_prod_1",
      projectId: "prj_cost_1",
      name: "Production",
      slug: "production",
      type: "PRODUCTION",
      primaryDomain: "https://atlas.avenor.dev",
      isDefault: true,
      mappedResourceCount: 2,
      createdAt: "2026-10-14T10:00:00.000Z",
    },
  ],
};

const MOCK_COST_REPORT: ProjectCostIntelligenceReportDto = {
  organizationId: "org_cost_1",
  workspaceId: "wks_cost_1",
  project: MOCK_PROJECT,
  selectedEnvironmentId: "env_prod_1",
  selectedEnvironmentType: "PRODUCTION",
  dateWindow: {
    preset: "28d",
    timeZone: "UTC",
    startDate: "2026-10-20",
    endDate: "2026-11-16",
    compareEnabled: true,
    compareStartDate: "2026-09-22",
    compareEndDate: "2026-10-19",
    dayCount: 28,
  },
  uxState: "connected_healthy",
  completenessState: "PROVISIONAL",
  sourceStatus: {
    hasBillingConnection: true,
    hasBigQueryExportDataset: true,
    connectedResourceId: "res_bq_1",
    externalResourceId:
      "bq-export:avenor-finops-prod.cloud_billing_export.gcp_billing_export_v1_01A2B3_45C6D7_89E0F1",
    billingAccountId: "01A2B3-45C6D7-89E0F1",
    datasetLocation: "US",
    exportType: "STANDARD_USAGE_COST",
    availabilityState: "EXPORT_ACTIVE_POPULATED",
    lastExportTimeIso: "2026-11-16T23:55:00.000Z",
    totalQueryBytesProcessed: 2_097_152,
  },
  isMixedCurrency: false,
  currencies: ["USD"],
  primaryCurrency: "USD",
  mixedCurrencyWarning: null,
  totals: {
    grossCost: 420.0,
    creditsAmount: -70.0,
    netCost: 350.0,
    regularCost: 340.0,
    taxAndAdjustmentsCost: 10.0,
  },
  comparisons: {
    grossCost: {
      currentValue: 420.0,
      previousValue: 400.0,
      absoluteDelta: 20.0,
      percentDelta: 5.0,
      direction: "down",
      formattedDeltaLabel: "+5.0% vs prior period",
    },
    netCost: {
      currentValue: 350.0,
      previousValue: 360.0,
      absoluteDelta: -10.0,
      percentDelta: -2.78,
      direction: "up",
      formattedDeltaLabel: "-2.8% vs prior period",
    },
  },
  efficiency: {
    available: true,
    costPer1kSessions: 17.5,
    currency: "USD",
    numeratorNetCost: 350.0,
    denominatorSessions: 20_000,
    provenanceExplanation:
      "Derived from BigQuery Net Cloud Cost (USD 350.00) divided by stored GA4 Sessions (20,000 sessions).",
  },
  currencyBuckets: [
    {
      currency: "USD",
      grossCost: 420.0,
      creditsAmount: -70.0,
      netCost: 350.0,
      rowCount: 14,
    },
  ],
  dailyTrend: [
    {
      date: "2026-11-15",
      grossCost: 210.0,
      creditsAmount: -35.0,
      netCost: 175.0,
      currency: "USD",
    },
    {
      date: "2026-11-16",
      grossCost: 210.0,
      creditsAmount: -35.0,
      netCost: 175.0,
      currency: "USD",
    },
  ],
  serviceBreakdown: [
    {
      serviceId: "6F81-5844-456A",
      serviceDescription: "Cloud Run",
      currency: "USD",
      grossCost: 250.0,
      creditsAmount: -50.0,
      netCost: 200.0,
      sharePercentage: 57.14,
    },
    {
      serviceId: "9662-B51E-5089",
      serviceDescription: "Cloud SQL",
      currency: "USD",
      grossCost: 170.0,
      creditsAmount: -20.0,
      netCost: 150.0,
      sharePercentage: 42.86,
    },
  ],
  skuBreakdown: [],
  gcpProjectBreakdown: [
    {
      gcpProjectId: "avenor-cloud-prod",
      billingAccountId: "01A2B3-45C6D7-89E0F1",
      mappedAvenorProjectId: "prj_cost_1",
      mappedAvenorProjectName: "Atlas Cloud Platform",
      currency: "USD",
      grossCost: 420.0,
      creditsAmount: -70.0,
      netCost: 350.0,
      completenessState: "PROVISIONAL",
    },
  ],
  invoiceMonths: [
    {
      invoiceMonth: "202611",
      currency: "USD",
      grossCost: 220.0,
      creditsAmount: -40.0,
      netCost: 180.0,
      completenessState: "PROVISIONAL",
      isFinalized: false,
    },
    {
      invoiceMonth: "202610",
      currency: "USD",
      grossCost: 200.0,
      creditsAmount: -30.0,
      netCost: 170.0,
      completenessState: "COMPLETE",
      isFinalized: true,
    },
  ],
  warnings: [],
};

describe("THE-136: Cloud Cost Intelligence Dashboard & Comparative Views", () => {
  it("renders single-currency KPIs, cost per 1k GA4 sessions, service breakdown, GCP project mapping, and invoice finalization", () => {
    render(
      <CostReportView
        initialReport={MOCK_COST_REPORT}
        workspaceName="Main Workspace"
        organizationName="Acme Corp"
        canManageConnections={true}
      />,
    );

    expect(screen.getByTestId("cost-report-view")).toBeInTheDocument();
    expect(screen.getByTestId("cost-kpi-grid")).toBeInTheDocument();
    expect(screen.getAllByText("$350.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$420.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("-$70.00").length).toBeGreaterThan(0);
    expect(screen.getByText("$17.50")).toBeInTheDocument();

    expect(screen.getByText("Cloud Run")).toBeInTheDocument();
    expect(screen.getByText("Cloud SQL")).toBeInTheDocument();
    expect(screen.getByText("avenor-cloud-prod")).toBeInTheDocument();
    expect(screen.getByText("Closed Invoice")).toBeInTheDocument();
    expect(screen.getByText("Open / Provisional")).toBeInTheDocument();

    // Toggle accessible trend table
    fireEvent.click(screen.getByTestId("cost-trend-table-toggle"));
    expect(screen.getByTestId("cost-daily-trend-table")).toBeInTheDocument();

    // Open metric provenance drawer for net cost
    fireEvent.click(screen.getByTestId("inspect-metric-gcp_billing-net_cost"));
    expect(screen.getByTestId("metric-provenance-drawer")).toBeInTheDocument();
  });

  it("displays multi-currency guardrail banner and segmented currency buckets when multiple currencies exist", () => {
    const mixedReport: ProjectCostIntelligenceReportDto = {
      ...MOCK_COST_REPORT,
      isMixedCurrency: true,
      currencies: ["USD", "EUR"],
      primaryCurrency: null,
      mixedCurrencyWarning:
        "Multiple billing currencies detected (USD, EUR). Avenor refuses to sum distinct currencies without an explicit conversion ledger.",
      totals: {
        grossCost: null,
        creditsAmount: null,
        netCost: null,
        regularCost: null,
        taxAndAdjustmentsCost: null,
      },
      currencyBuckets: [
        {
          currency: "USD",
          grossCost: 420.0,
          creditsAmount: -70.0,
          netCost: 350.0,
          rowCount: 10,
        },
        {
          currency: "EUR",
          grossCost: 150.0,
          creditsAmount: -15.0,
          netCost: 135.0,
          rowCount: 4,
        },
      ],
      dailyTrend: [],
    };

    render(
      <CostReportView
        initialReport={mixedReport}
        workspaceName="Main Workspace"
        organizationName="Acme Corp"
        canManageConnections={true}
      />,
    );

    expect(screen.getByTestId("cost-mixed-currency-banner")).toBeInTheDocument();
    expect(screen.getByTestId("cost-currency-buckets-card")).toBeInTheDocument();
    expect(screen.getByText("$350.00 net")).toBeInTheDocument();
    expect(screen.getByText("€135.00 net")).toBeInTheDocument();
  });
});
