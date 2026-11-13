import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchReportView } from "@/components/reports/search-report-view";
import { TrafficReportView } from "@/components/reports/traffic-report-view";
import type { Ga4StandardReportBundle } from "@/lib/providers/google-analytics/types";
import type {
  Ga4VsGscReconciliationSummary,
  GscSearchAnalyticsBundle,
} from "@/lib/providers/google-search-console/types";
import {
  formatComparisonDelta,
  formatIntegerCount,
  resolveReportDateWindow,
} from "@/lib/reports/date-window";
import type { ProjectGa4StandardResponseDto } from "@/lib/reports/ga4-service";
import type { ProjectSearchConsoleResponseDto } from "@/lib/reports/search-console-service";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const MOCK_PROJECTS = [
  {
    id: "prj_m03_1",
    workspaceId: "wks_m03_1",
    name: "Atlas Flagship Web",
    slug: "atlas-flagship-web",
    description: "Main SaaS web app",
    primaryDomain: "https://atlas.avenor.dev",
    status: "ACTIVE" as const,
    mappedResourceCount: 2,
    createdAt: "2026-10-14T10:00:00.000Z",
    updatedAt: "2026-11-12T10:00:00.000Z",
    environments: [
      {
        id: "env_prod_1",
        projectId: "prj_m03_1",
        name: "Production",
        slug: "production",
        type: "PRODUCTION" as const,
        primaryDomain: "https://atlas.avenor.dev",
        isDefault: true,
        mappedResourceCount: 2,
        createdAt: "2026-10-14T10:00:00.000Z",
      },
    ],
  },
];

const MOCK_GA4_REPORT: Ga4StandardReportBundle = {
  propertyName: "properties/987654321",
  numericPropertyId: "987654321",
  reportingTimeZone: "Europe/Dublin",
  currencyCode: "EUR",
  sourceMode: "sandbox_demo",
  cacheStatus: "miss",
  fetchedAtIso: "2026-11-12T12:00:00.000Z",
  startDate: "2026-10-15",
  endDate: "2026-11-11",
  compareStartDate: "2026-09-17",
  compareEndDate: "2026-10-14",
  totals: {
    activeUsers: 4200,
    totalUsers: 4510,
    newUsers: 1920,
    sessions: 5890,
    engagedSessions: 4100,
    engagementRate: 0.696,
    screenPageViews: 14200,
    eventCount: 28900,
    averageSessionDuration: 152,
    keyEvents: 310,
  },
  comparisonTotals: {
    activeUsers: 3900,
    totalUsers: 4100,
    newUsers: 1750,
    sessions: 5400,
    engagedSessions: 3600,
    engagementRate: 0.667,
    screenPageViews: 13100,
    eventCount: 25400,
    averageSessionDuration: 140,
    keyEvents: 270,
  },
  dailySeries: [
    {
      date: "2026-11-10",
      activeUsers: 180,
      totalUsers: 195,
      newUsers: 80,
      sessions: 245,
      engagedSessions: 172,
      engagementRate: 0.702,
      screenPageViews: 590,
      eventCount: 1120,
      averageSessionDuration: 148,
      keyEvents: 14,
    },
    {
      date: "2026-11-11",
      activeUsers: 210,
      totalUsers: 225,
      newUsers: 96,
      sessions: 290,
      engagedSessions: 210,
      engagementRate: 0.724,
      screenPageViews: 710,
      eventCount: 1390,
      averageSessionDuration: 162,
      keyEvents: 18,
    },
  ],
  comparisonSeries: [
    {
      date: "2026-10-13",
      activeUsers: 160,
      totalUsers: 175,
      newUsers: 72,
      sessions: 220,
      engagedSessions: 145,
      engagementRate: 0.659,
      screenPageViews: 520,
      eventCount: 980,
      averageSessionDuration: 136,
      keyEvents: 11,
    },
    {
      date: "2026-10-14",
      activeUsers: 170,
      totalUsers: 188,
      newUsers: 78,
      sessions: 235,
      engagedSessions: 159,
      engagementRate: 0.677,
      screenPageViews: 560,
      eventCount: 1030,
      averageSessionDuration: 144,
      keyEvents: 12,
    },
  ],
  channels: [
    {
      dimensionValue: "Organic Search",
      secondaryDimensionValue: "google / organic",
      activeUsers: 2100,
      sessions: 3100,
      engagedSessions: 2350,
      engagementRate: 0.758,
      screenPageViews: 8400,
      eventCount: 16200,
      keyEvents: 175,
    },
  ],
  sourceMediums: [],
  landingPages: [
    {
      dimensionValue: "/pricing",
      activeUsers: 910,
      sessions: 1120,
      engagedSessions: 880,
      engagementRate: 0.785,
      screenPageViews: 1940,
      eventCount: 4100,
      keyEvents: 92,
    },
  ],
  topPages: [
    {
      dimensionValue: "/docs/read-only-security",
      secondaryDimensionValue: "Read-Only Security Architecture",
      activeUsers: 640,
      sessions: 780,
      engagedSessions: 610,
      engagementRate: 0.782,
      screenPageViews: 1510,
      eventCount: 3200,
      keyEvents: 29,
    },
  ],
  devices: [
    {
      dimensionValue: "desktop",
      activeUsers: 2900,
      sessions: 3980,
      engagedSessions: 2920,
      engagementRate: 0.733,
      screenPageViews: 10200,
      eventCount: 21000,
      keyEvents: 235,
    },
  ],
  countries: [
    {
      dimensionValue: "Ireland",
      activeUsers: 1150,
      sessions: 1620,
      engagedSessions: 1200,
      engagementRate: 0.74,
      screenPageViews: 4100,
      eventCount: 8400,
      keyEvents: 88,
    },
  ],
  cities: [],
  topEvents: [
    {
      dimensionValue: "page_view",
      activeUsers: 4100,
      sessions: 5890,
      engagedSessions: 4100,
      engagementRate: 0.696,
      screenPageViews: 14200,
      eventCount: 14200,
      keyEvents: 0,
    },
  ],
  keyEventDefinitions: [
    {
      name: "properties/987654321/keyEvents/signup_completed",
      eventName: "signup_completed",
      countingMethod: "ONCE_PER_SESSION",
      defaultValue: null,
      currencyCode: "EUR",
    },
  ],
  dataQuality: {
    isSampled: true,
    samplingRatePct: 84,
    isThresholded: true,
    hasOtherRowTruncation: true,
    emptyReason: null,
    notices: [
      "Sampling active at 84% due to property volume.",
      "Thresholding hides rare demographic slices.",
    ],
  },
  quota: {
    tokensRemainingDay: 19400,
    tokensRemainingHour: 4820,
    tokensConsumed: 18,
  },
};

const MOCK_GSC_REPORT: GscSearchAnalyticsBundle = {
  siteUrl: "sc-domain:atlas.avenor.dev",
  encodedSiteUrl: "sc-domain%3Aatlas.avenor.dev",
  propertyKind: "DOMAIN",
  sourceMode: "sandbox_demo",
  cacheStatus: "miss",
  fetchedAtIso: "2026-11-12T12:00:00.000Z",
  searchType: "WEB",
  dataState: "final",
  startDate: "2026-10-13",
  endDate: "2026-11-09",
  compareStartDate: "2026-09-15",
  compareEndDate: "2026-10-12",
  totals: {
    clicks: 3420,
    impressions: 91500,
    ctr: 3420 / 91500,
    position: 7.4,
  },
  comparisonTotals: {
    clicks: 2980,
    impressions: 84000,
    ctr: 2980 / 84000,
    position: 8.1,
  },
  dailySeries: [
    {
      keys: ["2026-11-08"],
      date: "2026-11-08",
      clicks: 120,
      impressions: 3200,
      ctr: 120 / 3200,
      position: 7.5,
    },
    {
      keys: ["2026-11-09"],
      date: "2026-11-09",
      clicks: 145,
      impressions: 3600,
      ctr: 145 / 3600,
      position: 7.1,
    },
  ],
  comparisonDailySeries: [
    {
      keys: ["2026-10-11"],
      date: "2026-10-11",
      clicks: 102,
      impressions: 2950,
      ctr: 102 / 2950,
      position: 8.3,
    },
    {
      keys: ["2026-10-12"],
      date: "2026-10-12",
      clicks: 115,
      impressions: 3100,
      ctr: 115 / 3100,
      position: 8.0,
    },
  ],
  topQueries: [
    {
      keys: ["avenor read only analytics"],
      query: "avenor read only analytics",
      clicks: 680,
      impressions: 12400,
      ctr: 680 / 12400,
      position: 3.2,
    },
  ],
  topPages: [
    {
      keys: ["https://atlas.avenor.dev/pricing"],
      page: "https://atlas.avenor.dev/pricing",
      clicks: 820,
      impressions: 19200,
      ctr: 820 / 19200,
      position: 4.9,
    },
  ],
  byCountry: [
    {
      keys: ["irl"],
      country: "irl",
      clicks: 950,
      impressions: 22100,
      ctr: 950 / 22100,
      position: 5.8,
    },
  ],
  byDevice: [
    {
      keys: ["DESKTOP"],
      device: "DESKTOP",
      clicks: 2450,
      impressions: 62000,
      ctr: 2450 / 62000,
      position: 6.9,
    },
  ],
  bySearchAppearance: [],
  customRows: [],
  pagination: {
    rowLimit: 250,
    startRow: 0,
    rowsReturned: 1,
    hasMore: false,
    pagesFetched: 1,
  },
  coverage: {
    reportingTimeZone: "America/Los_Angeles",
    dataState: "final",
    finalDataCutoffDate: "2026-11-09",
    expectedLagHours: 48,
    hasPreliminaryDatesInWindow: true,
    isTopRowLimited: false,
    privacyAnonymizedPossible: true,
    queryClicksVsTotalClicksGap: {
      unsegmentedClicks: 3420,
      returnedQueryClicks: 2890,
      omittedClicksEstimate: 530,
    },
    notices: [
      "Trailing 48–72 hours may contain preliminary Search Console counts.",
      "530 rare-query clicks were omitted by Google privacy filtering.",
    ],
  },
};

const MOCK_RECONCILIATION: Ga4VsGscReconciliationSummary = {
  ga4PropertyName: "properties/987654321",
  ga4ReportingTimeZone: "Europe/Dublin",
  gscSiteUrl: "sc-domain:atlas.avenor.dev",
  gscPropertyKind: "DOMAIN",
  gscReportingTimeZone: "America/Los_Angeles",
  timezoneOffsetMismatch: true,
  ga4TotalSessions: 5890,
  ga4OrganicSessions: 3100,
  ga4ActiveUsers: 4200,
  gscClicks: 3420,
  gscImpressions: 91500,
  gscCtr: 3420 / 91500,
  gscPosition: 7.4,
  clickToOrganicSessionRatio: 1.1,
  scopeAlignmentStatus: "PARTIAL_SUBSET",
  notes: [
    {
      topic: "clicks_vs_sessions",
      title: "GSC Clicks and GA4 Sessions measure different funnel events",
      summary: "Clicks are pre-click SERP taps while GA4 Sessions require JS analytics load.",
      severity: "info",
    },
    {
      topic: "timezone_alignment",
      title:
        "Timezone difference detected: GA4 uses Europe/Dublin while GSC uses America/Los_Angeles",
      summary: "Daily cutoff shifts end-of-day counts across adjacent calendar days.",
      severity: "warning",
    },
  ],
};

describe("THE-127: Traffic & SEO Report Experiences and Date Helpers", () => {
  it("computes Pacific Time lag windows and avoids fake zero comparison deltas", () => {
    const win = resolveReportDateWindow({
      preset: "28d",
      compare: true,
      timeZone: "America/Los_Angeles",
      endLagDays: 2,
      now: new Date("2026-11-12T18:00:00.000Z"),
    });
    expect(win.dayCount).toBe(28);
    expect(win.endDate).toBe("2026-11-10");
    expect(win.startDate).toBe("2026-10-14");
    expect(win.compareEndDate).toBe("2026-10-13");
    expect(win.compareStartDate).toBe("2026-09-16");

    expect(formatIntegerCount(null)).toBe("—");
    expect(formatComparisonDelta(120, 0)).toBeUndefined();
    expect(formatComparisonDelta(null, 100)).toBeUndefined();
    expect(formatComparisonDelta(110, 100)).toBe("+10.0% vs prior");
  });

  it("renders blocked unconnected and permission_insufficient states honestly with zero fabricated 0s", () => {
    const blockedDto: ProjectGa4StandardResponseDto = {
      projectId: "prj_m03_1",
      projectName: "Atlas Flagship Web",
      primaryDomain: "https://atlas.avenor.dev",
      status: "blocked",
      uxState: "unconnected",
      message: "No GA4 property is mapped to this environment yet.",
      actionLabel: "Map Google Analytics",
      actionHref: "/connections?provider=ga4",
      selectedBinding: null,
      availableBindings: [],
      workspaceUnmappedCount: 1,
      window: {
        preset: "28d",
        timeZone: "UTC",
        startDate: "2026-10-15",
        endDate: "2026-11-11",
        compareEnabled: true,
        compareStartDate: "2026-09-17",
        compareEndDate: "2026-10-14",
        dayCount: 28,
      },
      report: null,
      realtime: null,
    };

    const { rerender } = render(
      <TrafficReportView projects={MOCK_PROJECTS} initialTelemetry={blockedDto} />,
    );
    expect(screen.getByTestId("ga4-blocked-state")).toBeInTheDocument();
    expect(screen.queryByTestId("ga4-kpi-grid")).not.toBeInTheDocument();
    expect(screen.getByTestId("ga4-blocked-state-action")).toHaveAttribute(
      "href",
      "/connections?provider=ga4",
    );

    rerender(
      <TrafficReportView
        projects={MOCK_PROJECTS}
        initialTelemetry={{
          ...blockedDto,
          uxState: "permission_insufficient",
          message: "Missing analytics.readonly viewer scope.",
        }}
      />,
    );
    expect(screen.getByText(/read-only permission required/i)).toBeInTheDocument();
    expect(screen.queryByTestId("ga4-kpi-grid")).not.toBeInTheDocument();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders GA4 standard report with quality badges, 30m realtime panel, tabs, and accessible chart/table toggle", async () => {
    const readyRealtime = {
      propertyName: "properties/987654321",
      sourceMode: "sandbox_demo" as const,
      windowMinutes: 30 as const,
      windowLabel: "Active users in the last 30 minutes (estimate)",
      observedAtIso: "2026-11-12T12:00:00.000Z",
      freshnessSeconds: 8,
      activeUsersLast30m: 34,
      screenPageViewsLast30m: 112,
      eventCountLast30m: 268,
      minuteTrend: [{ minutesAgo: 0, activeUsers: 5 }],
      byCountry: [],
      byDevice: [
        {
          dimensionValues: { deviceCategory: "desktop", platform: "web" },
          activeUsers: 24,
          screenPageViews: 80,
          eventCount: 190,
        },
      ],
      byScreenOrPage: [
        {
          dimensionValues: { unifiedScreenName: "Pricing | Atlas" },
          activeUsers: 18,
          screenPageViews: 44,
          eventCount: 110,
        },
      ],
      stale: false,
      rateLimited: false,
      retryAfterSeconds: null,
      isEstimateNotice: "Estimated active users across the rolling 30-minute window.",
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "ready",
        realtime: readyRealtime,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const readyGa4Dto: ProjectGa4StandardResponseDto = {
      projectId: "prj_m03_1",
      projectName: "Atlas Flagship Web",
      primaryDomain: "https://atlas.avenor.dev",
      status: "ready",
      uxState: "partial_coverage",
      message: "Sampling active at 84% due to property volume.",
      actionLabel: null,
      actionHref: null,
      selectedBinding: null,
      availableBindings: [],
      workspaceUnmappedCount: 0,
      window: {
        preset: "28d",
        timeZone: "Europe/Dublin",
        startDate: "2026-10-15",
        endDate: "2026-11-11",
        compareEnabled: true,
        compareStartDate: "2026-09-17",
        compareEndDate: "2026-10-14",
        dayCount: 28,
      },
      report: MOCK_GA4_REPORT,
      realtime: readyRealtime,
    };

    const { container } = render(
      <TrafficReportView projects={MOCK_PROJECTS} initialTelemetry={readyGa4Dto} />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    expect(screen.getByText(/Sampled \(84%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Thresholding Applied/i)).toBeInTheDocument();
    expect(screen.getByText(/\(other\) Row Truncation/i)).toBeInTheDocument();
    expect(screen.getByTestId("ga4-realtime-active-users")).toHaveTextContent("34");

    // Toggle accessible chart -> data table
    expect(screen.getByTestId("trend-svg-panel-ga4-trend")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toggle-chart-table-ga4-trend"));
    expect(screen.getByTestId("trend-table-panel-ga4-trend")).toBeInTheDocument();
    expect(screen.getByText("2026-11-11")).toBeInTheDocument();

    // Switch breakdown tab to Landing Pages
    fireEvent.click(screen.getByRole("tab", { name: /Landing Pages/i }));
    expect(screen.getAllByText("/pricing").length).toBeGreaterThanOrEqual(1);

    // Ensure zero secrets leak
    expect(container.textContent).not.toContain("refresh_token");
    expect(container.textContent).not.toContain("client_secret");
  });

  it("renders Search Console report, privacy gap, reconciliation panel, and disables query filter on DISCOVER", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        projectId: "prj_m03_1",
        projectName: "Atlas Flagship Web",
        primaryDomain: "https://atlas.avenor.dev",
        status: "ready",
        uxState: "partial_coverage",
        message: null,
        actionLabel: null,
        actionHref: null,
        selectedBinding: null,
        availableBindings: [],
        workspaceUnmappedCount: 0,
        window: {
          preset: "28d",
          timeZone: "America/Los_Angeles",
          startDate: "2026-10-13",
          endDate: "2026-11-09",
          compareEnabled: true,
          compareStartDate: "2026-09-15",
          compareEndDate: "2026-10-12",
          dayCount: 28,
        },
        filters: {
          searchType: "DISCOVER",
          dataState: "final",
          queryText: null,
          pageText: null,
          country: null,
          device: null,
          rowLimit: 250,
          startRow: 0,
        },
        report: {
          ...MOCK_GSC_REPORT,
          searchType: "DISCOVER",
          topQueries: [],
        },
        reconciliation: MOCK_RECONCILIATION,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const readyGscDto: ProjectSearchConsoleResponseDto = {
      projectId: "prj_m03_1",
      projectName: "Atlas Flagship Web",
      primaryDomain: "https://atlas.avenor.dev",
      status: "ready",
      uxState: "partial_coverage",
      message: "Trailing 48–72 hours may contain preliminary Search Console counts.",
      actionLabel: null,
      actionHref: null,
      selectedBinding: null,
      availableBindings: [],
      workspaceUnmappedCount: 0,
      window: {
        preset: "28d",
        timeZone: "America/Los_Angeles",
        startDate: "2026-10-13",
        endDate: "2026-11-09",
        compareEnabled: true,
        compareStartDate: "2026-09-15",
        compareEndDate: "2026-10-12",
        dayCount: 28,
      },
      filters: {
        searchType: "WEB",
        dataState: "final",
        queryText: null,
        pageText: null,
        country: null,
        device: null,
        rowLimit: 250,
        startRow: 0,
      },
      report: MOCK_GSC_REPORT,
      reconciliation: MOCK_RECONCILIATION,
    };

    render(<SearchReportView projects={MOCK_PROJECTS} initialTelemetry={readyGscDto} />);

    expect(screen.getByTestId("gsc-canonical-site")).toHaveTextContent(
      "sc-domain:atlas.avenor.dev",
    );
    expect(screen.getByTestId("gsc-privacy-gap-notice")).toHaveTextContent(
      "530 clicks withheld by Google Search Console privacy thresholds",
    );
    expect(screen.getByTestId("ga4-gsc-reconciliation-panel")).toHaveTextContent(
      "GSC Clicks and GA4 Sessions measure different funnel events",
    );

    // Toggle accessible Search Trend table
    fireEvent.click(screen.getByTestId("toggle-chart-table-gsc-trend"));
    expect(screen.getByTestId("trend-table-panel-gsc-trend")).toBeInTheDocument();

    // Switching to DISCOVER disables query filter and omits Queries tab
    const searchTypeSelect = screen.getByTestId("gsc-search-type-select");
    fireEvent.change(searchTypeSelect, { target: { value: "DISCOVER" } });

    await waitFor(() => {
      expect(screen.getByTestId("gsc-query-filter-input")).toBeDisabled();
    });

    vi.unstubAllGlobals();
  });
});
