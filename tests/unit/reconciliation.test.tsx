import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SourceReconciliationPanel } from "@/components/reports/source-reconciliation-panel";
import {
  computeDimensionIdentity,
  getCanonicalMetricDefinition,
  type StoredMetricObservation,
} from "@/lib/metrics";
import {
  assessSourceTimezoneAlignment,
  evaluateCanonicalMetricPeriodComparison,
  evaluateProviderBenchmarkReconciliation,
  getDeterministicMetricTolerance,
  resolveComparisonDateWindow,
  type SourceReconciliationReportDto,
  validateMetricCapabilityFilters,
} from "@/lib/reports/reconciliation";

function makeObs(
  overrides: Partial<StoredMetricObservation> & {
    canonicalMetricKey: string;
    periodStartDate: string;
    periodEndDate: string;
  },
): StoredMetricObservation {
  const def = getCanonicalMetricDefinition(overrides.canonicalMetricKey);
  return {
    id: overrides.id ?? "mobs_rec_1",
    organizationId: overrides.organizationId ?? "org_1",
    workspaceId: overrides.workspaceId ?? "wks_1",
    projectId: overrides.projectId ?? "prj_1",
    environmentId: overrides.environmentId ?? "env_1",
    providerConnectionId: overrides.providerConnectionId ?? "con_1",
    connectedResourceId: overrides.connectedResourceId ?? "res_1",
    providerKey: overrides.providerKey ?? def.providerKey,
    externalResourceId: overrides.externalResourceId ?? "properties/1001",
    canonicalMetricKey: def.canonicalKey,
    providerMetricName: def.providerMetricName,
    metricDefinitionVersion: 1,
    granularity: overrides.granularity ?? "DAILY",
    periodStartDate: overrides.periodStartDate,
    periodEndDate: overrides.periodEndDate,
    periodStartUtcIso: "2026-11-01T00:00:00.000Z",
    periodEndUtcIso: "2026-11-02T00:00:00.000Z",
    reportingTimezone: overrides.reportingTimezone ?? "UTC",
    dimensionKeyHash:
      overrides.dimensionKeyHash ?? computeDimensionIdentity(overrides.dimensions ?? {}).hash,
    dimensionCanonicalKey:
      overrides.dimensionCanonicalKey ??
      computeDimensionIdentity(overrides.dimensions ?? {}).canonicalKey,
    dimensions: overrides.dimensions ?? {},
    queryFingerprint: overrides.queryFingerprint ?? "qfp_rec_1",
    unit: overrides.unit ?? def.unit,
    currency: overrides.currency ?? null,
    numericValue: overrides.numericValue !== undefined ? overrides.numericValue : 100,
    numeratorValue: overrides.numeratorValue ?? null,
    denominatorValue: overrides.denominatorValue ?? null,
    completenessState: overrides.completenessState ?? "COMPLETE",
    dataQualityFlags: overrides.dataQualityFlags ?? {},
    sourceUpdatedAtIso: null,
    collectedAtIso: overrides.collectedAtIso ?? "2026-11-16T08:00:00.000Z",
    ingestionRunId: null,
    revisionNumber: overrides.revisionNumber ?? 1,
    previousNumericValue: null,
    revisionReason: null,
    createdAtIso: "2026-11-16T08:00:00.000Z",
    updatedAtIso: "2026-11-16T08:00:00.000Z",
  };
}

describe("THE-131: Date-Range Comparison, Capability Filtering & Source Reconciliation", () => {
  it("resolves timezone-aware comparison windows and flags incomplete current-day coverage", () => {
    const fixedNow = new Date("2026-11-16T14:30:00.000Z");

    const completed7d = resolveComparisonDateWindow({
      preset: "7d",
      includeToday: false,
      timeZone: "UTC",
      now: fixedNow,
    });
    expect(completed7d.startDate).toBe("2026-11-09");
    expect(completed7d.endDate).toBe("2026-11-15");
    expect(completed7d.dayCount).toBe(7);
    expect(completed7d.includesIncompleteToday).toBe(false);
    expect(completed7d.partialDayNotice).toBeNull();
    expect(completed7d.previousStartDate).toBe("2026-11-02");
    expect(completed7d.previousEndDate).toBe("2026-11-08");
    expect(completed7d.previousDayCount).toBe(7);

    const includingToday = resolveComparisonDateWindow({
      preset: "7d",
      includeToday: true,
      timeZone: "UTC",
      now: fixedNow,
    });
    expect(includingToday.endDate).toBe("2026-11-16");
    expect(includingToday.includesIncompleteToday).toBe(true);
    expect(includingToday.partialDayNotice).toContain("still in progress");
  });

  it("detects cross-source reporting timezone boundary differences between GA4 and Search Console", () => {
    const aligned = assessSourceTimezoneAlignment([
      {
        providerKey: "ga4",
        displayName: "GA4 Pacific",
        reportingTimezone: "America/Los_Angeles",
      },
      {
        providerKey: "gsc",
        displayName: "GSC Pacific",
        reportingTimezone: "America/Los_Angeles",
      },
    ]);
    expect(aligned.isAligned).toBe(true);
    expect(aligned.warningMessage).toBeNull();

    const divergent = assessSourceTimezoneAlignment([
      {
        providerKey: "ga4",
        displayName: "GA4 Berlin",
        reportingTimezone: "Europe/Berlin",
      },
      {
        providerKey: "gsc",
        displayName: "GSC Pacific",
        reportingTimezone: "America/Los_Angeles",
      },
    ]);
    expect(divergent.isAligned).toBe(false);
    expect(divergent.warningMessage).toContain("Europe/Berlin vs America/Los_Angeles");
  });

  it("validates capability-aware dimension filters and rejects unsupported metric/dimension combinations", () => {
    const validGscFilter = validateMetricCapabilityFilters({
      canonicalMetricKeys: ["gsc.clicks", "gsc.impressions", "gsc.ctr"],
      dimensionFilters: { query: "avenor observability", device: "DESKTOP" },
    });
    expect(validGscFilter.valid).toBe(true);

    const invalidCrossFilter = validateMetricCapabilityFilters({
      canonicalMetricKeys: ["ga4.sessions", "gsc.clicks"],
      dimensionFilters: { query: "avenor observability" },
    });
    expect(invalidCrossFilter.valid).toBe(false);
    expect(invalidCrossFilter.unsupportedByMetric[0]?.canonicalMetricKey).toBe("ga4.sessions");
    expect(invalidCrossFilter.errorMessage).toContain("ga4.sessions does not support dimension(s): query");
  });

  it("computes mathematically safe period comparisons for zero prior, inverted ranking position, and non-additive daily unique users", () => {
    // Zero prior -> new_activity (never Infinity or NaN)
    const zeroPriorComp = evaluateCanonicalMetricPeriodComparison({
      canonicalMetricKey: "ga4.sessions",
      currentObservations: [
        makeObs({
          canonicalMetricKey: "ga4.sessions",
          periodStartDate: "2026-11-10",
          periodEndDate: "2026-11-10",
          numericValue: 25,
        }),
      ],
      previousObservations: [
        makeObs({
          canonicalMetricKey: "ga4.sessions",
          periodStartDate: "2026-11-03",
          periodEndDate: "2026-11-03",
          numericValue: 0,
        }),
      ],
      currentWindow: { startDate: "2026-11-09", endDate: "2026-11-15" },
      previousWindow: { startDate: "2026-11-02", endDate: "2026-11-08" },
    });
    expect(zeroPriorComp.direction).toBe("new_activity");
    expect(zeroPriorComp.percentDelta).toBeNull();
    expect(zeroPriorComp.formattedDeltaLabel).toBe("New activity vs 0 prior");

    // Position metric: lower rank number (6.0 vs 8.0) is an improvement
    const posComp = evaluateCanonicalMetricPeriodComparison({
      canonicalMetricKey: "gsc.average_position",
      currentObservations: [
        makeObs({
          canonicalMetricKey: "gsc.average_position",
          periodStartDate: "2026-11-10",
          periodEndDate: "2026-11-10",
          numericValue: 6.0,
          numeratorValue: 600,
          denominatorValue: 100,
        }),
      ],
      previousObservations: [
        makeObs({
          canonicalMetricKey: "gsc.average_position",
          periodStartDate: "2026-11-03",
          periodEndDate: "2026-11-03",
          numericValue: 8.0,
          numeratorValue: 800,
          denominatorValue: 100,
        }),
      ],
      currentWindow: { startDate: "2026-11-09", endDate: "2026-11-15" },
      previousWindow: { startDate: "2026-11-02", endDate: "2026-11-08" },
    });
    expect(posComp.isImprovement).toBe(true);
    expect(posComp.percentDelta).toBe(-25);

    // Non-additive active_users with multiple daily rows -> non_comparable
    const nonAdditiveComp = evaluateCanonicalMetricPeriodComparison({
      canonicalMetricKey: "ga4.active_users",
      currentObservations: [
        makeObs({
          canonicalMetricKey: "ga4.active_users",
          periodStartDate: "2026-11-10",
          periodEndDate: "2026-11-10",
          numericValue: 100,
        }),
        makeObs({
          canonicalMetricKey: "ga4.active_users",
          periodStartDate: "2026-11-11",
          periodEndDate: "2026-11-11",
          numericValue: 120,
        }),
      ],
      previousObservations: [],
      currentWindow: { startDate: "2026-11-09", endDate: "2026-11-15" },
      previousWindow: { startDate: "2026-11-02", endDate: "2026-11-08" },
    });
    expect(nonAdditiveComp.direction).toBe("non_comparable");
  });

  it("reconciles stored observations against provider benchmarks with deterministic tolerances, GSC privacy thresholds, and revision tracking", () => {
    expect(getDeterministicMetricTolerance("ga4.sessions")).toBe(0);
    expect(getDeterministicMetricTolerance("gsc.ctr")).toBe(0.0001);

    const items = evaluateProviderBenchmarkReconciliation({
      observations: [
        makeObs({
          canonicalMetricKey: "ga4.sessions",
          externalResourceId: "properties/1001",
          periodStartDate: "2026-11-10",
          periodEndDate: "2026-11-10",
          numericValue: 500,
          revisionNumber: 2,
        }),
        makeObs({
          canonicalMetricKey: "gsc.clicks",
          externalResourceId: "sc-domain:avenor.dev",
          periodStartDate: "2026-11-10",
          periodEndDate: "2026-11-10",
          numericValue: 320,
        }),
      ],
      benchmarks: [
        {
          canonicalMetricKey: "ga4.sessions",
          externalResourceId: "properties/1001",
          periodStartDate: "2026-11-10",
          periodEndDate: "2026-11-10",
          reportingTimezone: "UTC",
          expectedValue: 500,
        },
        {
          canonicalMetricKey: "gsc.clicks",
          externalResourceId: "sc-domain:avenor.dev",
          periodStartDate: "2026-11-10",
          periodEndDate: "2026-11-10",
          reportingTimezone: "America/Los_Angeles",
          expectedValue: 320,
          queryTableSummedClicks: 295,
        },
      ],
    });

    expect(items[0]?.status).toBe("REVISION_SUPERSEDED");
    expect(items[1]?.status).toBe("RECONCILED_WITH_PRIVACY_THRESHOLD");
    expect(items[1]?.anonymizedClicksGap).toBe(25);
  });

  it("renders SourceReconciliationPanel with comparison ledger, timezone warning, and benchmark items", () => {
    const mockReport: SourceReconciliationReportDto = {
      organizationId: "org_1",
      workspaceId: "wks_1",
      projectId: "prj_1",
      environmentId: "env_1",
      generatedAtIso: "2026-11-16T10:00:00.000Z",
      dateWindow: {
        preset: "7d",
        timeZone: "Europe/Berlin",
        startDate: "2026-11-09",
        endDate: "2026-11-15",
        dayCount: 7,
        includesIncompleteToday: false,
        partialDayNotice: null,
        compareMode: "previous_period",
        previousStartDate: "2026-11-02",
        previousEndDate: "2026-11-08",
        previousDayCount: 7,
      },
      timezoneAlignment: {
        isAligned: false,
        timezones: ["Europe/Berlin", "America/Los_Angeles"],
        hasGscPacificFixed: true,
        hasCustomGa4Timezone: true,
        warningMessage:
          "Mapped sources report on different calendar timezone boundaries (Europe/Berlin vs America/Los_Angeles).",
      },
      filterValidation: {
        valid: true,
        normalizedFilters: {},
        unsupportedByMetric: [],
        errorMessage: null,
      },
      comparisons: [
        {
          canonicalMetricKey: "ga4.sessions",
          displayName: "Sessions",
          unit: "sessions",
          currentValue: 1400,
          previousValue: 1200,
          absoluteDelta: 200,
          percentDelta: 16.67,
          basisPointsDelta: null,
          direction: "up",
          isImprovement: true,
          formattedDeltaLabel: "+16.7% vs prior period",
          explanation: "Compared 2026-11-09..2026-11-15 against 2026-11-02..2026-11-08.",
        },
      ],
      reconciliationItems: [
        {
          canonicalMetricKey: "ga4.sessions",
          displayName: "Sessions",
          providerKey: "ga4",
          externalResourceId: "properties/1001",
          reportingTimezone: "Europe/Berlin",
          periodStartDate: "2026-11-09",
          periodEndDate: "2026-11-15",
          avenorStoredValue: 1400,
          providerBenchmarkValue: 1400,
          absoluteDifference: 0,
          allowedTolerance: 0,
          status: "MATCHED",
          completenessState: "COMPLETE",
          revisionCount: 1,
          anonymizedClicksGap: null,
          explanation: "Stored value (1400) reconciles with provider benchmark (1400).",
        },
      ],
      summary: {
        totalChecked: 1,
        matchedCount: 1,
        knownVarianceCount: 0,
        driftDetectedCount: 0,
        missingCount: 0,
        allWithinContract: true,
      },
    };

    render(<SourceReconciliationPanel projectId="prj_1" initialReport={mockReport} />);

    expect(screen.getByTestId("source-reconciliation-panel")).toBeInTheDocument();
    expect(screen.getByTestId("reconciliation-timezone-alignment-banner")).toBeInTheDocument();
    expect(screen.getByTestId("reconciliation-comparison-table")).toBeInTheDocument();
    expect(screen.getByTestId("reconciliation-items-table")).toBeInTheDocument();
    expect(screen.getByText("Exact Match")).toBeInTheDocument();
  });
});
