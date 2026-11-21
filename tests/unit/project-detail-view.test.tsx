import "@testing-library/jest-dom/vitest";
import type { WorkspaceGovernanceDetails } from "@avenor/auth";
import type { LogicalProjectSummary } from "@avenor/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PortfolioOverviewClient } from "@/components/dashboard/portfolio-overview-client";
import { ProjectDetailView } from "@/components/projects/project-detail-view";
import type { AggregatedMetricResult } from "@/lib/metrics";
import type {
  PortfolioMetricComparison,
  ProjectControlCenterOverviewDto,
  WorkspacePortfolioOverviewDto,
} from "@/lib/reports/portfolio-service";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

const MOCK_PROJECT: LogicalProjectSummary = {
  id: "prj_m04_1",
  workspaceId: "wks_m04_1",
  name: "Control Center Product",
  slug: "control-center-product",
  description: "Product detail description",
  primaryDomain: "https://product.avenor.dev",
  status: "ACTIVE",
  mappedResourceCount: 2,
  createdAt: "2026-10-14T10:00:00.000Z",
  updatedAt: "2026-11-18T10:00:00.000Z",
  environments: [
    {
      id: "env_prod_1",
      projectId: "prj_m04_1",
      name: "Production",
      slug: "production",
      type: "PRODUCTION",
      primaryDomain: "https://product.avenor.dev",
      isDefault: true,
      mappedResourceCount: 2,
      createdAt: "2026-10-14T10:00:00.000Z",
    },
  ],
};

function makeAggMetric(
  canonicalMetricKey: string,
  displayName: string,
  value: number | null,
  unit = "count",
): AggregatedMetricResult {
  return {
    canonicalMetricKey,
    displayName,
    unit,
    valueType: "COUNT",
    aggregationRule: "SUM",
    value,
    numeratorSum: null,
    denominatorSum: null,
    uxState: "connected_healthy",
    completenessState: "COMPLETE",
    status: "ok",
    explanation: `Aggregated ${displayName}`,
    observationCount: 28,
    reportingTimezones: ["UTC"],
    resourcesIncluded: ["res_ga4_1"],
    latestCollectedAtIso: "2026-11-18T09:00:00.000Z",
  };
}

function makeComparison(currentValue: number, previousValue: number): PortfolioMetricComparison {
  return {
    currentValue,
    previousValue,
    absoluteDelta: currentValue - previousValue,
    percentDelta: 10.5,
    direction: "up",
    formattedDeltaLabel: "+10.5% vs prior period",
  };
}

const MOCK_CONTROL_CENTER: ProjectControlCenterOverviewDto = {
  organizationId: "org_m04_1",
  workspaceId: "wks_m04_1",
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
  mappedResources: [
    {
      connectedResourceId: "res_ga4_1",
      providerConnectionId: "con_ga4_1",
      providerKey: "ga4",
      externalResourceId: "properties/402918401",
      displayName: "Avenor Core GA4",
      environmentId: "env_prod_1",
      environmentType: "PRODUCTION",
      connectionStatus: "HEALTHY",
      syncState: "IDLE",
      reportingTimezone: "UTC",
      lastSyncedAtIso: "2026-11-18T09:00:00.000Z",
      sourceLagNotice: null,
    },
    {
      connectedResourceId: "res_gsc_1",
      providerConnectionId: "con_gsc_1",
      providerKey: "gsc",
      externalResourceId: "sc-domain:product.avenor.dev",
      displayName: "product.avenor.dev",
      environmentId: "env_prod_1",
      environmentType: "PRODUCTION",
      connectionStatus: "HEALTHY",
      syncState: "IDLE",
      reportingTimezone: "America/Los_Angeles",
      lastSyncedAtIso: "2026-11-18T09:05:00.000Z",
      sourceLagNotice: "Recent 48h subject to GSC finalization lag",
    },
  ],
  hasOverlappingGa4Properties: false,
  hasOverlappingGscProperties: false,
  overlapWarnings: [],
  uxState: "connected_healthy",
  audienceUxState: "connected_healthy",
  searchUxState: "connected_healthy",
  freshnessLabel: "Fresh · synced 10m ago",
  metrics: {
    sessions: makeAggMetric("ga4.sessions", "Sessions", 18420),
    activeUsers: makeAggMetric("ga4.active_users", "Active Users", 11250),
    engagedSessions: makeAggMetric("ga4.engaged_sessions", "Engaged Sessions", 12894),
    engagementRate: makeAggMetric("ga4.engagement_rate", "Engagement Rate", 0.7, "ratio"),
    pageViews: makeAggMetric("ga4.page_views", "Page Views", 42100),
    keyEvents: makeAggMetric("ga4.key_events", "Key Events", 642),
    eventCount: makeAggMetric("ga4.event_count", "Event Count", 95000),
    gscClicks: makeAggMetric("gsc.clicks", "Organic Clicks", 6400),
    gscImpressions: makeAggMetric("gsc.impressions", "Organic Impressions", 128000),
    gscCtr: makeAggMetric("gsc.ctr", "Organic CTR", 0.05, "ratio"),
    gscAveragePosition: makeAggMetric("gsc.average_position", "Average Position", 8.4, "position"),
  },
  comparisons: {
    sessions: makeComparison(18420, 16200),
    activeUsers: makeComparison(11250, 10500),
    engagementRate: makeComparison(0.7, 0.68),
    pageViews: makeComparison(42100, 39000),
    gscClicks: makeComparison(6400, 5800),
    gscImpressions: makeComparison(128000, 115000),
    gscCtr: makeComparison(0.05, 0.048),
    gscAveragePosition: makeComparison(8.4, 9.1),
  },
  dailyTrend: [
    {
      date: "2026-11-15",
      sessions: 620,
      engagedSessions: 440,
      gscClicks: 210,
      gscImpressions: 4200,
      gscCtr: 0.05,
    },
    {
      date: "2026-11-16",
      sessions: 680,
      engagedSessions: 490,
      gscClicks: 240,
      gscImpressions: 4800,
      gscCtr: 0.05,
    },
  ],
  breakdowns: {
    topChannels: [
      {
        dimensionValue: "Organic Search",
        primaryMetricValue: 9400,
        secondaryMetricValue: 6800,
        tertiaryMetricValue: 0.5103,
      },
      {
        dimensionValue: "Direct",
        primaryMetricValue: 5200,
        secondaryMetricValue: 3900,
        tertiaryMetricValue: 0.2823,
      },
    ],
    topPages: [
      {
        dimensionValue: "/dashboard",
        secondaryValue: "Control Center — Avenor",
        primaryMetricValue: 14200,
        secondaryMetricValue: 8100,
      },
    ],
    topQueries: [
      {
        dimensionValue: "avenor product observability",
        primaryMetricValue: 920,
        secondaryMetricValue: 9200,
        tertiaryMetricValue: 0.1,
        quaternaryMetricValue: 3.2,
      },
    ],
    topSearchPages: [
      {
        dimensionValue: "https://product.avenor.dev/docs",
        primaryMetricValue: 1850,
        secondaryMetricValue: 24000,
        tertiaryMetricValue: 0.077,
        quaternaryMetricValue: 4.5,
      },
    ],
  },
  syncStatus: {
    projectId: "prj_m04_1",
    workspaceId: "wks_m04_1",
    overallState: "COMPLETED",
    canTriggerSync: true,
    lastSyncedAtIso: "2026-11-18T09:05:00.000Z",
    nextScheduledAtIso: null,
    resources: [],
  },
};

const MOCK_PORTFOLIO_OVERVIEW: WorkspacePortfolioOverviewDto = {
  organizationId: "org_m04_1",
  workspaceId: "wks_m04_1",
  workspaceName: "Main Workspace",
  defaultTimezone: "UTC",
  defaultCurrency: "USD",
  dateWindow: MOCK_CONTROL_CENTER.dateWindow,
  summaryCounts: {
    activeProjectCount: 1,
    archivedProjectCount: 0,
    configuredEnvironmentCount: 1,
    mappedProjectCount: 1,
    healthyConnectionCount: 2,
    degradedConnectionCount: 0,
    distinctGa4PropertyCount: 1,
    distinctGscPropertyCount: 1,
  },
  portfolioMetrics: {
    sessions: MOCK_CONTROL_CENTER.metrics.sessions,
    activeUsers: MOCK_CONTROL_CENTER.metrics.activeUsers,
    engagedSessions: MOCK_CONTROL_CENTER.metrics.engagedSessions,
    engagementRate: MOCK_CONTROL_CENTER.metrics.engagementRate,
    keyEvents: MOCK_CONTROL_CENTER.metrics.keyEvents,
    gscClicks: MOCK_CONTROL_CENTER.metrics.gscClicks,
    gscImpressions: MOCK_CONTROL_CENTER.metrics.gscImpressions,
    gscCtr: MOCK_CONTROL_CENTER.metrics.gscCtr,
    gscAveragePosition: MOCK_CONTROL_CENTER.metrics.gscAveragePosition,
  },
  portfolioComparisons: {
    sessions: MOCK_CONTROL_CENTER.comparisons.sessions,
    engagedSessions: makeComparison(12894, 11340),
    gscClicks: MOCK_CONTROL_CENTER.comparisons.gscClicks,
    gscImpressions: MOCK_CONTROL_CENTER.comparisons.gscImpressions,
    gscCtr: MOCK_CONTROL_CENTER.comparisons.gscCtr,
    gscAveragePosition: MOCK_CONTROL_CENTER.comparisons.gscAveragePosition,
  },
  nonAdditiveNotices: [],
  dailyTrend: MOCK_CONTROL_CENTER.dailyTrend,
  products: [
    {
      project: MOCK_PROJECT,
      mappedResources: MOCK_CONTROL_CENTER.mappedResources,
      uxState: "connected_healthy",
      freshnessLabel: "Fresh · synced 10m ago",
      lastSyncedAtIso: "2026-11-18T09:05:00.000Z",
      hasMultiPropertyWarning: false,
      multiPropertyNotice: null,
      metrics: {
        sessions: MOCK_CONTROL_CENTER.metrics.sessions,
        activeUsers: MOCK_CONTROL_CENTER.metrics.activeUsers,
        engagementRate: MOCK_CONTROL_CENTER.metrics.engagementRate,
        keyEvents: MOCK_CONTROL_CENTER.metrics.keyEvents,
        gscClicks: MOCK_CONTROL_CENTER.metrics.gscClicks,
        gscImpressions: MOCK_CONTROL_CENTER.metrics.gscImpressions,
        gscCtr: MOCK_CONTROL_CENTER.metrics.gscCtr,
        gscAveragePosition: MOCK_CONTROL_CENTER.metrics.gscAveragePosition,
      },
      comparisons: {
        sessions: MOCK_CONTROL_CENTER.comparisons.sessions,
        gscClicks: MOCK_CONTROL_CENTER.comparisons.gscClicks,
        gscImpressions: MOCK_CONTROL_CENTER.comparisons.gscImpressions,
        gscCtr: MOCK_CONTROL_CENTER.comparisons.gscCtr,
      },
    },
  ],
  attentionItems: [],
  recentSyncRuns: [],
};

const MOCK_GOVERNANCE: WorkspaceGovernanceDetails = {
  organization: {
    id: "org_m04_1",
    name: "Acme Corp",
    slug: "acme-corp",
  },
  workspace: {
    id: "wks_m04_1",
    organizationId: "org_m04_1",
    organizationName: "Acme Corp",
    name: "Main Workspace",
    slug: "main-workspace",
    defaultTimezone: "UTC",
    defaultCurrency: "USD",
    role: "OWNER",
    projectCount: 1,
    memberCount: 1,
  },
  members: [
    {
      userId: "usr_1",
      name: "Acme Founder",
      email: "founder@acme.test",
      role: "OWNER",
      joinedAt: "2026-10-14T10:00:00.000Z",
    },
  ],
  auditLogs: [],
};

describe("THE-130: Project Detail View Control Center & Portfolio Overview", () => {
  it("renders product metadata, environments, canonical KPIs, trend series, and breakdowns", () => {
    render(
      <ProjectDetailView
        workspaceName="Main Workspace"
        organizationName="Acme Corp"
        canUpdateProject={true}
        canArchiveProject={true}
        canManageEnvironments={true}
        project={MOCK_PROJECT}
        initialControlCenter={MOCK_CONTROL_CENTER}
      />,
    );

    expect(screen.getByRole("heading", { name: "Control Center Product" })).toBeInTheDocument();
    expect(screen.getByText("control-center-product")).toBeInTheDocument();
    const urls = screen.getAllByText("https://product.avenor.dev");
    expect(urls.length).toBeGreaterThan(0);
    expect(screen.getByTestId("environment-row-PRODUCTION")).toBeInTheDocument();

    // Canonical KPIs
    expect(screen.getByTestId("project-control-center-kpi-grid")).toBeInTheDocument();
    expect(screen.getByText("18,420")).toBeInTheDocument();
    expect(screen.getByText(/11,250 active users/i)).toBeInTheDocument();
    expect(screen.getByText("6,400")).toBeInTheDocument();

    // Channel and query breakdowns
    expect(screen.getByText("Organic Search")).toBeInTheDocument();
    expect(screen.getByText("avenor product observability")).toBeInTheDocument();

    // Switch trend chart to accessible data table
    fireEvent.click(screen.getByTestId("project-trend-table-toggle"));
    expect(screen.getByTestId("project-trend-table")).toBeInTheDocument();
  });

  it("renders PortfolioOverviewClient executive KPIs, product comparison cards, and provenance drawer", () => {
    render(
      <PortfolioOverviewClient
        initialOverview={MOCK_PORTFOLIO_OVERVIEW}
        governance={MOCK_GOVERNANCE}
        onboardingCompletedAt="2026-10-14T10:05:00.000Z"
      />,
    );

    expect(screen.getByTestId("portfolio-kpi-grid")).toBeInTheDocument();
    expect(screen.getByTestId("portfolio-product-card-control-center-product")).toBeInTheDocument();
    expect(screen.getByTestId("portfolio-attention-required-card")).toBeInTheDocument();

    // Open metric provenance drawer from Sessions KPI card
    fireEvent.click(screen.getByTestId("inspect-metric-ga4-sessions"));
    expect(screen.getByTestId("metric-provenance-drawer")).toBeInTheDocument();
  });
});
