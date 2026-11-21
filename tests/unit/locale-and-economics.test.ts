import { describe, expect, it } from "vitest";
import {
  estimateWorkspaceMonthlyUnitCost,
  resolveLocalDayBoundariesUtc,
  resolvePreviousCalendarDate,
  sumMoneyRecordsSafely,
} from "@/lib/ops/unit-economics";

describe("THE-166 Multi-Currency Precision, Timezone/DST/Leap-Year & Unit Economics", () => {
  it("sums monetary values in exact integer micro-units without IEEE-754 drift and refuses silent mixed-currency totals", () => {
    // Classic JS float trap: 0.1 + 0.2 = 0.30000000000000004
    const precise = sumMoneyRecordsSafely([
      { amount: "0.10", currency: "USD" },
      { amount: "0.20", currency: "USD" },
      { amount: "19.99", currency: "USD" },
    ]);
    expect(precise.decimalString).toBe("20.29");
    expect(precise.numericValue).toBe(20.29);
    expect(precise.converted).toBe(false);

    // Zero-decimal currency (JPY)
    const jpy = sumMoneyRecordsSafely([
      { amount: 1500, currency: "JPY" },
      { amount: 2500, currency: "JPY" },
    ]);
    expect(jpy.decimalString).toBe("4000");

    // Mixed currencies without explicit FX config must fail closed
    expect(() =>
      sumMoneyRecordsSafely([
        { amount: "10.00", currency: "USD" },
        { amount: "10.00", currency: "EUR" },
      ]),
    ).toThrow(/heterogeneous currencies/i);

    // Mixed currencies WITH explicit FX table produce explicit provenance metadata
    const converted = sumMoneyRecordsSafely(
      [
        { amount: "100.00", currency: "USD" },
        { amount: "50.00", currency: "EUR" },
      ],
      {
        targetCurrency: "USD",
        ratesToTarget: { EUR: 1.08 },
        fxSource: "ECB_REFERENCE_DAILY",
        fxAsOfIso: "2026-11-21T00:00:00.000Z",
      },
    );
    expect(converted.decimalString).toBe("154.00");
    expect(converted.converted).toBe(true);
    expect(converted.fxMetadata?.source).toBe("ECB_REFERENCE_DAILY");
    expect(converted.fxMetadata?.disclosure).toMatch(
      /Original provider billing currencies remain authoritative/i,
    );
  });

  it("handles 23-hour spring-forward DST, 25-hour fall-back DST, leap years, and month-end clamping", () => {
    // America/New_York spring forward: 2026-03-08 has 23 hours
    const springForward = resolveLocalDayBoundariesUtc("2026-03-08", "America/New_York");
    expect(springForward.durationHours).toBe(23);
    expect(springForward.isDstTransitionDay).toBe(true);

    // America/New_York fall back: 2026-11-01 has 25 hours
    const fallBack = resolveLocalDayBoundariesUtc("2026-11-01", "America/New_York");
    expect(fallBack.durationHours).toBe(25);
    expect(fallBack.isDstTransitionDay).toBe(true);

    // Africa/Lagos (no DST): always 24 hours
    const lagos = resolveLocalDayBoundariesUtc("2026-03-08", "Africa/Lagos");
    expect(lagos.durationHours).toBe(24);
    expect(lagos.isDstTransitionDay).toBe(false);

    // Invalid date or invalid IANA timezone must fail closed
    expect(() => resolveLocalDayBoundariesUtc("2026-02-29", "UTC")).toThrow(/does not exist/i);
    expect(() => resolveLocalDayBoundariesUtc("2026-03-08", "Mars/Olympus")).toThrow(
      /Invalid IANA timezone/i,
    );

    // Leap year & month-end rollover
    expect(resolvePreviousCalendarDate("2024-03-01", "day")).toBe("2024-02-29");
    expect(resolvePreviousCalendarDate("2026-03-01", "day")).toBe("2026-02-28");
    expect(resolvePreviousCalendarDate("2024-03-31", "month")).toBe("2024-02-29");
    expect(resolvePreviousCalendarDate("2026-03-31", "month")).toBe("2026-02-28");
    expect(resolvePreviousCalendarDate("2026-01-01", "day")).toBe("2025-12-31");
  });

  it("models sustainable Pro/Team SaaS unit economics and warns on oversized BigQuery scans", () => {
    const proHealthy = estimateWorkspaceMonthlyUnitCost({
      planCode: "PRO",
      monthlyPriceUsd: 19,
      connectedSources: 12,
      dailyIngestionRuns: 120,
      storedMetricRows: 250_000,
      monthlyBigQueryScanGiB: 15,
      monthlyEmailsSent: 60,
    });
    expect(proHealthy.withinTargetUnitEconomics).toBe(true);
    expect(proHealthy.estimatedGrossMarginRatio).toBeGreaterThan(0.9);
    expect(proHealthy.warnings).toHaveLength(0);

    const runaway = estimateWorkspaceMonthlyUnitCost({
      planCode: "PRO",
      monthlyPriceUsd: 19,
      connectedSources: 20,
      dailyIngestionRuns: 1000,
      storedMetricRows: 3_000_000,
      monthlyBigQueryScanGiB: 1200,
      monthlyEmailsSent: 100,
    });
    expect(runaway.withinTargetUnitEconomics).toBe(false);
    expect(runaway.warnings.length).toBeGreaterThanOrEqual(2);
  });
});
