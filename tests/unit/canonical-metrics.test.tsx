import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  MetricDefinitionTrigger,
  MetricProvenanceDrawer,
} from "@/components/reports/metric-provenance-drawer";
import {
  aggregateMetricObservations,
  CANONICAL_METRIC_DEFINITIONS,
  computeDimensionIdentity,
  computeSourcePeriodUtcBounds,
  enforceDimensionCardinalityLimit,
  getCanonicalMetricDefinition,
  normalizeGa4ReportBundleToObservations,
  normalizeGscReportBundleToObservations,
  resolveCanonicalMetricByProviderName,
  type StoredMetricObservation,
  validateMetricDefinitionInput,
} from "@/lib/metrics";
import type { Ga4StandardReportBundle } from "@/lib/providers/google-analytics/types";
import type { GscSearchAnalyticsBundle } from "@/lib/providers/google-search-console/types";

function makeStoredObs(
  overrides: Partial<StoredMetricObservation> & {
    canonicalMetricKey: string;
    periodStartDate: string;
    periodEndDate: string;
  },
): StoredMetricObservation {
  const def = getCanonicalMetricDefinition(overrides.canonicalMetricKey);
  return {
    id: overrides.id ?? "mobs_1",
    organizationId: overrides.organizationId ?? "org_1",
    workspaceId: overrides.workspaceId ?? "wks_1",
    projectId: overrides.projectId ?? "prj_1",
    environmentId: overrides.environmentId ?? "env_1",
    providerConnectionId: overrides.providerConnectionId ?? "con_1",
    connectedResourceId: overrides.connectedResourceId ?? "res_1",
    providerKey: overrides.providerKey ?? String(def.providerKey),
    externalResourceId: overrides.externalResourceId ?? "properties/123456",
    canonicalMetricKey: def.canonicalKey,
    providerMetricName: def.providerMetricName,
    metricDefinitionVersion: 1,
    granularity: overrides.granularity ?? "DAILY",
    periodStartDate: overrides.periodStartDate,
    periodEndDate: overrides.periodEndDate,
    periodStartUtcIso: "2026-10-01T00:00:00.000Z",
    periodEndUtcIso: "2026-10-02T00:00:00.000Z",
    reportingTimezone: overrides.reportingTimezone ?? "UTC",
    dimensionKeyHash: overrides.dimensionKeyHash ?? "hash_empty",
    dimensionCanonicalKey: overrides.dimensionCanonicalKey ?? "0:",
    dimensions: overrides.dimensions ?? {},
    queryFingerprint: overrides.queryFingerprint ?? "qfp_1",
    unit: overrides.unit ?? def.unit,
    currency: overrides.currency ?? null,
    numericValue: overrides.numericValue !== undefined ? overrides.numericValue : 100,
    numeratorValue: overrides.numeratorValue ?? null,
    denominatorValue: overrides.denominatorValue ?? null,
    completenessState: overrides.completenessState ?? "COMPLETE",
    dataQualityFlags: overrides.dataQualityFlags ?? {},
    sourceUpdatedAtIso: null,
    collectedAtIso: overrides.collectedAtIso ?? "2026-10-02T06:00:00.000Z",
    ingestionRunId: null,
    revisionNumber: 1,
    previousNumericValue: null,
    revisionReason: null,
    createdAtIso: "2026-10-02T06:00:00.000Z",
    updatedAtIso: "2026-10-02T06:00:00.000Z",
  };
}

describe("THE-128: Canonical Metrics Registry, Timezones, Dimensions, Normalization & Aggregation", () => {
  it("registers canonical GA4 and GSC definitions and rejects invalid metric semantics", () => {
    expect(CANONICAL_METRIC_DEFINITIONS.length).toBeGreaterThanOrEqual(14);

    const activeUsersDef = getCanonicalMetricDefinition("ga4.active_users");
    expect(activeUsersDef.valueType).toBe("DISTINCT_COUNT");
    expect(activeUsersDef.aggregationRule).toBe("NON_ADDITIVE_DISTINCT");
    expect(activeUsersDef.isAdditiveAcrossDates).toBe(false);
    expect(activeUsersDef.isAdditiveAcrossResources).toBe(false);

    const gscCtrDef = resolveCanonicalMetricByProviderName("gsc", "ctr");
    expect(gscCtrDef.canonicalKey).toBe("gsc.ctr");
    expect(gscCtrDef.aggregationRule).toBe("WEIGHTED_RATIO");
    expect(gscCtrDef.numeratorMetricKey).toBe("gsc.clicks");
    expect(gscCtrDef.denominatorMetricKey).toBe("gsc.impressions");

    // Reject DISTINCT_COUNT marked additive
    expect(() =>
      validateMetricDefinitionInput({
        id: "mdef_bad_1",
        canonicalKey: "ga4.bad_users",
        providerKey: "ga4",
        providerMetricName: "badUsers",
        displayName: "Bad Users",
        description: "Invalid additive unique user metric",
        category: "audience",
        unit: "users",
        valueType: "DISTINCT_COUNT",
        aggregationRule: "SUM",
        isAdditiveAcrossDates: true,
        timezoneBehavior: "PROPERTY_LOCAL",
        freshnessWindowMinutes: 60,
        capabilityKey: "analytics_sessions",
      }),
    ).toThrow(/cannot be marked additive/i);

    // Reject WEIGHTED_RATIO missing numerator/denominator
    expect(() =>
      validateMetricDefinitionInput({
        id: "mdef_bad_2",
        canonicalKey: "gsc.bad_ratio",
        providerKey: "gsc",
        providerMetricName: "badRatio",
        displayName: "Bad Ratio",
        description: "Missing denominator",
        category: "search",
        unit: "ratio",
        valueType: "RATIO",
        aggregationRule: "WEIGHTED_RATIO",
        timezoneBehavior: "PACIFIC_TIME_FIXED",
        freshnessWindowMinutes: 60,
        capabilityKey: "search_queries",
      }),
    ).toThrow(/requires both numeratorMetricKey and denominatorMetricKey/i);
  });

  it("computes deterministic, collision-proof dimension hashes and redacts PII/tokens", () => {
    const dimA = computeDimensionIdentity({
      country: "US",
      device: "desktop",
    });
    const dimB = computeDimensionIdentity({
      device: "desktop",
      country: "US",
    });
    expect(dimA.canonicalKey).toBe(dimB.canonicalKey);
    expect(dimA.hash).toBe(dimB.hash);

    // Delimiter injection attempt must NOT collide
    const injection1 = computeDimensionIdentity({
      query: "a=1;6:device=mobile",
    });
    const injection2 = computeDimensionIdentity({
      query: "a=1",
      device: "mobile",
    });
    expect(injection1.canonicalKey).not.toBe(injection2.canonicalKey);
    expect(injection1.hash).not.toBe(injection2.hash);

    // Privacy redaction on page paths and queries
    const sanitized = computeDimensionIdentity({
      pagePath: "/reset?token=secret123&email=user@example.com&tab=overview",
      query: "contact founder@avenor.dev login",
    });
    expect(sanitized.dimensions.pagePath).not.toContain("secret123");
    expect(sanitized.dimensions.pagePath).not.toContain("user@example.com");
    expect(sanitized.dimensions.query).toContain("[redacted-email]");

    // Cardinality cap keeps highest-weight rows
    const rows = [
      { key: "r1", clicks: 5 },
      { key: "r2", clicks: 50 },
      { key: "r3", clicks: 20 },
    ];
    const limited = enforceDimensionCardinalityLimit(rows, (r) => r.clicks, 2);
    expect(limited.keptRows.map((r) => r.key)).toEqual(["r2", "r3"]);
    expect(limited.truncatedCount).toBe(1);
  });

  it("computes DST-aware half-open UTC boundaries for source timezones without assuming 24h days", () => {
    // US Spring-Forward DST in America/New_York: 2026-03-08 is 23 hours long
    const springForward = computeSourcePeriodUtcBounds({
      periodStartDate: "2026-03-08",
      periodEndDate: "2026-03-08",
      reportingTimezone: "America/New_York",
    });
    expect(springForward.dayCount).toBe(1);
    expect(springForward.elapsedHours).toBe(23);
    expect(springForward.hasDstTransition).toBe(true);
    expect(springForward.periodStartUtc.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(springForward.periodEndUtc.toISOString()).toBe("2026-03-09T04:00:00.000Z");

    // US Fall-Back DST in America/New_York: 2026-11-01 is 25 hours long
    const fallBack = computeSourcePeriodUtcBounds({
      periodStartDate: "2026-11-01",
      periodEndDate: "2026-11-01",
      reportingTimezone: "America/New_York",
    });
    expect(fallBack.dayCount).toBe(1);
    expect(fallBack.elapsedHours).toBe(25);
    expect(fallBack.hasDstTransition).toBe(true);
    expect(fallBack.periodStartUtc.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(fallBack.periodEndUtc.toISOString()).toBe("2026-11-02T05:00:00.000Z");

    // Invalid calendar date rejected
    expect(() =>
      computeSourcePeriodUtcBounds({
        periodStartDate: "2026-02-30",
        periodEndDate: "2026-02-30",
        reportingTimezone: "UTC",
      }),
    ).toThrow(/Non-existent calendar date/i);
  });

  it("enforces Scenario 9 (non-additive users), Scenario 10 (weighted CTR), Scenario 11 (zero vs null), and overlapping interval guards", () => {
    // Scenario 9: Daily activeUsers cannot be summed to fabricate a multi-day unique user total
    const dailyUsers = [
      makeStoredObs({
        canonicalMetricKey: "ga4.active_users",
        granularity: "DAILY",
        periodStartDate: "2026-10-01",
        periodEndDate: "2026-10-01",
        numericValue: 120,
      }),
      makeStoredObs({
        id: "mobs_2",
        canonicalMetricKey: "ga4.active_users",
        granularity: "DAILY",
        periodStartDate: "2026-10-02",
        periodEndDate: "2026-10-02",
        numericValue: 150,
      }),
    ];

    const rejectedUserSum = aggregateMetricObservations({
      canonicalMetricKey: "ga4.active_users",
      observations: dailyUsers,
      requestedStartDate: "2026-10-01",
      requestedEndDate: "2026-10-02",
    });
    expect(rejectedUserSum.value).toBeNull();
    expect(rejectedUserSum.status).toBe("non_additive_unavailable");

    // When a matching WINDOW_TOTAL (from GA4 RESERVED_TOTAL) is present, it is used accurately
    const withWindowTotal = [
      ...dailyUsers,
      makeStoredObs({
        id: "mobs_win",
        canonicalMetricKey: "ga4.active_users",
        granularity: "WINDOW_TOTAL",
        periodStartDate: "2026-10-01",
        periodEndDate: "2026-10-02",
        numericValue: 215,
      }),
    ];
    const validUserWindow = aggregateMetricObservations({
      canonicalMetricKey: "ga4.active_users",
      observations: withWindowTotal,
      requestedStartDate: "2026-10-01",
      requestedEndDate: "2026-10-02",
    });
    expect(validUserWindow.status).toBe("ok");
    expect(validUserWindow.value).toBe(215);

    // Scenario 10: Weighted CTR (Day 1: 10/100 = 10%, Day 2: 40/200 = 20% -> Combined = 50/300 = 16.6667%, NOT 15%)
    const ctrDays = [
      makeStoredObs({
        canonicalMetricKey: "gsc.ctr",
        granularity: "DAILY",
        periodStartDate: "2026-10-01",
        periodEndDate: "2026-10-01",
        numericValue: 0.1,
        numeratorValue: 10,
        denominatorValue: 100,
      }),
      makeStoredObs({
        id: "mobs_ctr_2",
        canonicalMetricKey: "gsc.ctr",
        granularity: "DAILY",
        periodStartDate: "2026-10-02",
        periodEndDate: "2026-10-02",
        numericValue: 0.2,
        numeratorValue: 40,
        denominatorValue: 200,
      }),
    ];
    const weightedCtr = aggregateMetricObservations({
      canonicalMetricKey: "gsc.ctr",
      observations: ctrDays,
    });
    expect(weightedCtr.status).toBe("ok");
    expect(weightedCtr.value).toBeCloseTo(50 / 300, 5);
    expect(weightedCtr.numeratorSum).toBe(50);
    expect(weightedCtr.denominatorSum).toBe(300);

    // Scenario 11: Genuine 0 vs unavailable null
    const zeroClicks = aggregateMetricObservations({
      canonicalMetricKey: "gsc.clicks",
      observations: [
        makeStoredObs({
          canonicalMetricKey: "gsc.clicks",
          periodStartDate: "2026-10-01",
          periodEndDate: "2026-10-01",
          numericValue: 0,
        }),
      ],
    });
    expect(zeroClicks.status).toBe("ok");
    expect(zeroClicks.value).toBe(0);

    const unavailableClicks = aggregateMetricObservations({
      canonicalMetricKey: "gsc.clicks",
      observations: [
        makeStoredObs({
          canonicalMetricKey: "gsc.clicks",
          periodStartDate: "2026-10-01",
          periodEndDate: "2026-10-01",
          numericValue: null,
          completenessState: "UNAVAILABLE",
        }),
      ],
    });
    expect(unavailableClicks.status).toBe("unavailable");
    expect(unavailableClicks.value).toBeNull();

    // Overlapping periods rejected on SUM
    const overlappingSessions = aggregateMetricObservations({
      canonicalMetricKey: "ga4.sessions",
      observations: [
        makeStoredObs({
          canonicalMetricKey: "ga4.sessions",
          granularity: "DAILY",
          periodStartDate: "2026-10-01",
          periodEndDate: "2026-10-03",
          numericValue: 300,
        }),
        makeStoredObs({
          id: "mobs_overlap",
          canonicalMetricKey: "ga4.sessions",
          granularity: "DAILY",
          periodStartDate: "2026-10-02",
          periodEndDate: "2026-10-04",
          numericValue: 350,
        }),
      ],
    });
    expect(overlappingSessions.status).toBe("overlapping_periods_rejected");
    expect(overlappingSessions.value).toBeNull();
  });

  it("normalizes GA4 and GSC report bundles with provenance and renders the MetricProvenanceDrawer", () => {
    const ga4Bundle: Ga4StandardReportBundle = {
      propertyName: "properties/402918401",
      numericPropertyId: "402918401",
      reportingTimeZone: "America/New_York",
      currencyCode: "USD",
      startDate: "2026-10-01",
      endDate: "2026-10-02",
      compareStartDate: null,
      compareEndDate: null,
      sourceMode: "sandbox_demo",
      cacheStatus: "miss",
      fetchedAtIso: "2026-10-10T12:00:00.000Z",
      totals: {
        activeUsers: 500,
        totalUsers: 540,
        newUsers: 210,
        sessions: 800,
        engagedSessions: 520,
        engagementRate: 0.65,
        screenPageViews: 1900,
        eventCount: 4500,
        averageSessionDuration: 140,
        keyEvents: 42,
      },
      comparisonTotals: null,
      dailySeries: [
        {
          date: "2026-10-01",
          activeUsers: 280,
          totalUsers: 300,
          newUsers: 110,
          sessions: 400,
          engagedSessions: 260,
          engagementRate: 0.65,
          screenPageViews: 950,
          eventCount: 2200,
          averageSessionDuration: 140,
          keyEvents: 20,
        },
      ],
      comparisonSeries: null,
      channels: [],
      sourceMediums: [],
      topPages: [],
      landingPages: [],
      devices: [],
      countries: [],
      cities: [],
      topEvents: [],
      keyEventDefinitions: [],
      dataQuality: {
        isSampled: false,
        samplingRatePct: null,
        isThresholded: false,
        hasOtherRowTruncation: false,
        emptyReason: null,
        notices: ["Verified GA4 property timezone America/New_York."],
      },
      quota: {
        tokensRemainingDay: 24000,
        tokensRemainingHour: 4990,
        tokensConsumed: 10,
      },
    };

    const gscBundle: GscSearchAnalyticsBundle = {
      siteUrl: "sc-domain:avenor.dev",
      encodedSiteUrl: "sc-domain%3Aavenor.dev",
      propertyKind: "DOMAIN",
      startDate: "2026-10-01",
      endDate: "2026-10-02",
      compareStartDate: null,
      compareEndDate: null,
      searchType: "WEB",
      dataState: "final",
      sourceMode: "sandbox_demo",
      cacheStatus: "miss",
      fetchedAtIso: "2026-10-10T12:00:00.000Z",
      totals: {
        clicks: 120,
        impressions: 2400,
        ctr: 0.05,
        position: 8.5,
      },
      comparisonTotals: null,
      dailySeries: [
        {
          keys: ["2026-10-01"],
          date: "2026-10-01",
          clicks: 120,
          impressions: 2400,
          ctr: 0.05,
          position: 8.5,
        },
      ],
      comparisonDailySeries: null,
      topQueries: [
        { keys: ["avenor analytics"], clicks: 50, impressions: 500, ctr: 0.1, position: 3.2 },
      ],
      topPages: [],
      byCountry: [],
      byDevice: [],
      bySearchAppearance: [],
      customRows: [],
      pagination: {
        startRow: 0,
        rowLimit: 250,
        rowsReturned: 1,
        hasMore: false,
        pagesFetched: 1,
      },
      coverage: {
        reportingTimeZone: "America/Los_Angeles",
        dataState: "final",
        finalDataCutoffDate: "2026-10-08",
        expectedLagHours: 48,
        hasPreliminaryDatesInWindow: false,
        isTopRowLimited: false,
        privacyAnonymizedPossible: true,
        queryClicksVsTotalClicksGap: {
          unsegmentedClicks: 120,
          returnedQueryClicks: 50,
          omittedClicksEstimate: 70,
        },
        notices: ["70 long-tail clicks anonymized by Google privacy thresholds."],
      },
    };

    const scope = {
      organizationId: "org_1",
      workspaceId: "wks_1",
      projectId: "prj_1",
      environmentId: "env_1",
      providerConnectionId: "con_1",
      connectedResourceId: "res_1",
      referenceNow: new Date("2026-10-10T12:00:00.000Z"),
    };

    const ga4Obs = normalizeGa4ReportBundleToObservations(ga4Bundle, scope);
    const gscObs = normalizeGscReportBundleToObservations(gscBundle, scope);

    expect(
      ga4Obs.some(
        (o) =>
          o.canonicalMetricKey === "ga4.active_users" &&
          o.granularity === "WINDOW_TOTAL" &&
          o.numericValue === 500,
      ),
    ).toBe(true);
    expect(
      gscObs.some(
        (o) =>
          o.canonicalMetricKey === "gsc.ctr" &&
          o.numeratorValue === 120 &&
          o.denominatorValue === 2400,
      ),
    ).toBe(true);

    const onInspect = vi.fn();
    const onClose = vi.fn();
    render(
      <div>
        <MetricDefinitionTrigger canonicalMetricKey="ga4.active_users" onInspect={onInspect} />
        <MetricProvenanceDrawer
          context={{
            canonicalMetricKey: "ga4.active_users",
            externalResourceId: "properties/402918401",
            reportingTimezone: "America/New_York",
            periodStartDate: "2026-10-01",
            periodEndDate: "2026-10-02",
            completenessState: "COMPLETE",
            lastCollectedAtIso: "2026-10-10T12:00:00.000Z",
            limitations: ["Verified GA4 property timezone America/New_York."],
          }}
          onClose={onClose}
        />
      </div>,
    );

    fireEvent.click(screen.getByTestId("inspect-metric-ga4-active_users"));
    expect(onInspect).toHaveBeenCalledWith("ga4.active_users");
    expect(screen.getByTestId("metric-provenance-drawer")).toBeInTheDocument();
    expect(screen.getByTestId("provenance-drawer-resource")).toHaveTextContent(
      "properties/402918401",
    );
    expect(screen.getByTestId("provenance-drawer-timezone")).toHaveTextContent("America/New_York");
    expect(screen.getByTestId("provenance-drawer-aggregation")).toHaveTextContent(
      "Non-Additive Distinct Users",
    );

    fireEvent.click(screen.getByTestId("close-metric-provenance-drawer"));
    expect(onClose).toHaveBeenCalled();
  });
});
