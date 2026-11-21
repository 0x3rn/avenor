import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BackendReportView } from "@/components/reports/backend-report-view";
import type { ProjectBackendIntelligenceReportDto } from "@/lib/reports/backend-service";

function buildFixtureReport(
  overrides?: Partial<ProjectBackendIntelligenceReportDto>,
): ProjectBackendIntelligenceReportDto {
  return {
    project: {
      id: "proj_backend_1",
      workspaceId: "ws_1",
      name: "Avenor Core Platform",
      slug: "avenor-core",
      description: null,
      primaryDomain: "https://core.avenor.test",
      status: "ACTIVE",
      mappedResourceCount: 3,
      environments: [
        {
          id: "env_prod",
          projectId: "proj_backend_1",
          name: "Production",
          slug: "production",
          type: "PRODUCTION",
          isDefault: true,
          primaryDomain: "https://core.avenor.test",
          mappedResourceCount: 3,
          createdAt: "2026-10-01T00:00:00.000Z",
        },
      ],
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-11-21T00:00:00.000Z",
    },
    dateWindow: {
      preset: "28d",
      timeZone: "UTC",
      startDate: "2026-10-25",
      endDate: "2026-11-21",
      compareEnabled: true,
      compareStartDate: "2026-09-27",
      compareEndDate: "2026-10-24",
      dayCount: 28,
    },
    environmentId: null,
    uxState: "connected_healthy",
    freshnessLabel: "Fresh • synced 5m ago",
    sources: [],
    neon: {
      connected: true,
      uxState: "connected_healthy",
      instantaneousStorageBytes: 2_147_483_648,
      storageConsumptionBytesMonth: 1_500_000_000,
      computeUnitSeconds: 172_800,
      activeTimeSeconds: 115_200,
      networkTransferBytes: 206_569_472,
      branchCount: 3,
      comparisons: {
        computeUnitSeconds: {
          currentValue: 172_800,
          previousValue: 150_000,
          absoluteDelta: 22_800,
          percentDelta: 15.2,
          direction: "up",
          formattedDeltaLabel: "+15.2% vs prior period",
        },
        storageConsumptionBytesMonth: {
          currentValue: 1_500_000_000,
          previousValue: 1_400_000_000,
          absoluteDelta: 100_000_000,
          percentDelta: 7.14,
          direction: "up",
          formattedDeltaLabel: "+7.1% vs prior period",
        },
      },
      unitDisclaimer:
        "CU-seconds reflect allocated serverless compute capacity over time (not CPU %); bytes-month consumption is separate from instantaneous branch storage bytes.",
    },
    supabase: {
      connected: true,
      uxState: "connected_healthy",
      dbSizeBytes: 872_415_232,
      storageSizeBytes: 3_288_334_336,
      activeConnections: 22,
      apiRequests: 301_720,
      authRequests: 40_760,
      registeredAuthUsers: 4_865,
      comparisons: {
        apiRequests: {
          currentValue: 301_720,
          previousValue: 280_000,
          absoluteDelta: 21_720,
          percentDelta: 7.76,
          direction: "up",
          formattedDeltaLabel: "+7.8% vs prior period",
        },
        authRequests: {
          currentValue: 40_760,
          previousValue: 38_000,
          absoluteDelta: 2_760,
          percentDelta: 7.26,
          direction: "up",
          formattedDeltaLabel: "+7.3% vs prior period",
        },
      },
    },
    firebase: {
      connected: true,
      uxState: "connected_healthy",
      firestoreReads: 597_400,
      firestoreWrites: 136_000,
      firestoreDeletes: 6_550,
      firestoreActiveListeners: 168,
      functionInvocations: 197_000,
      functionErrors: 80,
      functionErrorRatePercent: 0.04,
      functionMeanExecutionTimeMs: 139.2,
      storageBytes: 5_512_495_104,
      comparisons: {
        firestoreReads: {
          currentValue: 597_400,
          previousValue: 520_000,
          absoluteDelta: 77_400,
          percentDelta: 14.88,
          direction: "up",
          formattedDeltaLabel: "+14.9% vs prior period",
        },
        functionInvocations: {
          currentValue: 197_000,
          previousValue: 180_000,
          absoluteDelta: 17_000,
          percentDelta: 9.44,
          direction: "up",
          formattedDeltaLabel: "+9.4% vs prior period",
        },
      },
    },
    storageGrowth: [
      {
        providerKey: "neon",
        metricKey: "neon.instantaneous_storage_bytes",
        label: "Neon Instantaneous Branch Storage",
        unit: "bytes",
        latestBytes: 2_147_483_648,
        earliestBytes: 1_900_000_000,
        growthBytes: 247_483_648,
        growthPercent: 13.03,
        sampleDays: 14,
        uxState: "connected_healthy",
        note: "Point-in-time branch logical_size in bytes.",
      },
    ],
    authSemanticsPanel: [
      {
        key: "supabase_registered_auth_users",
        label: "Supabase Registered Auth Accounts",
        providerKey: "supabase",
        value: 4_865,
        status: "SUPPORTED",
        unit: "accounts",
        semanticClarification:
          "Aggregate account count from allowlisted Supabase usage counter (zero raw auth.users PII).",
      },
      {
        key: "supabase_auth_requests",
        label: "Supabase GoTrue Auth HTTP Requests",
        providerKey: "supabase",
        value: 40_760,
        status: "SUPPORTED",
        unit: "requests",
        semanticClarification:
          "Authentication gateway HTTP traffic — NOT registered user headcount.",
      },
      {
        key: "ga4_active_visitors",
        label: "GA4 Active Visitors (Web/App Analytics)",
        providerKey: "ga4",
        value: 12_400,
        status: "SUPPORTED",
        unit: "visitors",
        semanticClarification: "Client-side web/app analytics visitors.",
      },
      {
        key: "neon_registered_users",
        label: "Neon Registered Application Users",
        providerKey: "neon",
        value: null,
        status: "UNAVAILABLE",
        unit: "accounts",
        semanticClarification: "Neon has no control-plane user directory; zero SQL executed.",
      },
      {
        key: "firebase_registered_users",
        label: "Firebase Auth Registered Users",
        providerKey: "firebase-monitoring",
        value: null,
        status: "UNAVAILABLE",
        unit: "accounts",
        semanticClarification: "Admin SDK auth.listUsers() is prohibited.",
      },
    ],
    dailyTrend: [],
    limitations: [
      "Strictly read-only control-plane and monitoring telemetry: zero arbitrary SQL execution.",
    ],
    cacheMetadata: {
      cacheKeyHash: "hash_backend_1",
      cacheStatus: "MISS",
      policyTier: "recent_standard",
      computedAtIso: "2026-11-21T16:00:00.000Z",
      expiresAtIso: "2026-11-21T16:05:00.000Z",
      staleUntilIso: "2026-11-21T16:30:00.000Z",
      ageSeconds: 0,
    },
    ...overrides,
  };
}

describe("THE-142: Backend health, DB growth and user-count dashboards", () => {
  it("renders Neon, Supabase, and Firebase telemetry with strict unit labels and honest auth/visitor semantic separation", () => {
    render(
      <BackendReportView
        initialReport={buildFixtureReport()}
        workspaceName="Core Workspace"
        organizationName="Corstack"
      />,
    );

    expect(screen.getByTestId("project-backend-report-view")).toBeInTheDocument();
    expect(screen.getByTestId("neon-backend-section")).toHaveTextContent("Not CPU %");
    expect(screen.getByTestId("supabase-backend-section")).toHaveTextContent(
      "service_role Rejected",
    );
    expect(screen.getByTestId("firebase-backend-section")).toHaveTextContent(
      "Admin SDK Prohibited",
    );
    expect(screen.getByTestId("storage-growth-panel")).toHaveTextContent("+13.03%");

    expect(screen.getByTestId("auth-semantics-supabase_registered_auth_users")).toHaveTextContent(
      "4,865",
    );
    expect(screen.getByTestId("auth-semantics-supabase_auth_requests")).toHaveTextContent("40,760");
    expect(screen.getByTestId("auth-semantics-ga4_active_visitors")).toHaveTextContent("12,400");
    expect(screen.getByTestId("auth-semantics-neon_registered_users")).toHaveTextContent(
      "UNAVAILABLE",
    );
    expect(screen.getByTestId("auth-semantics-firebase_registered_users")).toHaveTextContent(
      "UNAVAILABLE",
    );
  });

  it("renders honest disconnected empty state when no backend sources are mapped", () => {
    render(
      <BackendReportView
        initialReport={buildFixtureReport({
          uxState: "unconnected",
          neon: { ...buildFixtureReport().neon, connected: false },
          supabase: { ...buildFixtureReport().supabase, connected: false },
          firebase: { ...buildFixtureReport().firebase, connected: false },
          storageGrowth: [],
        })}
        workspaceName="Core Workspace"
        organizationName="Corstack"
      />,
    );

    expect(screen.getByText(/No Backend or Database Sources Mapped/i)).toBeInTheDocument();
    expect(screen.queryByTestId("neon-backend-section")).not.toBeInTheDocument();
  });
});
