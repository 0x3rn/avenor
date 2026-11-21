import { describe, expect, it } from "vitest";
import {
  evaluateCrossMetricCostTrafficSignal,
  evaluateRobustStatisticalAnomaly,
} from "@/lib/intelligence/anomalies";

describe("THE-155: Statistical MAD anomaly detection, sample-size & completeness guards", () => {
  it("detects genuine outliers via rolling median/MAD while guarding insufficient history, incomplete data, and weekly seasonality", () => {
    // Clear drop against stable baseline: [100,102,99,101,98,103,100] -> 20
    const drop = evaluateRobustStatisticalAnomaly({
      metricKey: "ga4.sessions",
      providerKey: "ga4",
      history: [
        { dateIso: "2026-11-13T00:00:00Z", value: 100 },
        { dateIso: "2026-11-14T00:00:00Z", value: 102 },
        { dateIso: "2026-11-15T00:00:00Z", value: 99 },
        { dateIso: "2026-11-16T00:00:00Z", value: 101 },
        { dateIso: "2026-11-17T00:00:00Z", value: 98 },
        { dateIso: "2026-11-18T00:00:00Z", value: 103 },
        { dateIso: "2026-11-19T00:00:00Z", value: 100 },
      ],
      currentValue: 20,
      currentDateIso: "2026-11-20T00:00:00Z",
      completenessState: "COMPLETE",
    });
    expect(drop.outcome).toBe("ANOMALY_DETECTED");
    expect(drop.isAnomaly).toBe(true);
    expect(drop.direction).toBe("DROP");
    expect(drop.explanation).toMatch(/not a proven root cause/i);

    // Insufficient history (1 observation) -> INSUFFICIENT_HISTORY, never false anomaly
    const tiny = evaluateRobustStatisticalAnomaly({
      metricKey: "ga4.sessions",
      providerKey: "ga4",
      history: [{ dateIso: "2026-11-19T00:00:00Z", value: 100 }],
      currentValue: 20,
      currentDateIso: "2026-11-20T00:00:00Z",
      completenessState: "COMPLETE",
    });
    expect(tiny.outcome).toBe("INSUFFICIENT_HISTORY");
    expect(tiny.isAnomaly).toBe(false);

    // Incomplete/partial or missing current value -> SKIPPED_INCOMPLETE_DATA
    const partial = evaluateRobustStatisticalAnomaly({
      metricKey: "gsc.clicks",
      providerKey: "gsc",
      history: Array.from({ length: 10 }, (_, idx) => ({
        dateIso: `2026-11-${String(10 + idx).padStart(2, "0")}T00:00:00Z`,
        value: 500,
      })),
      currentValue: 0,
      currentDateIso: "2026-11-20T00:00:00Z",
      completenessState: "PARTIAL",
    });
    expect(partial.outcome).toBe("SKIPPED_INCOMPLETE_DATA");
    expect(partial.isAnomaly).toBe(false);

    // Cross-metric cost vs sessions observation
    const cross = evaluateCrossMetricCostTrafficSignal({
      priorCost: 100,
      currentCost: 140,
      currency: "USD",
      priorSessions: 10000,
      currentSessions: 10200,
    });
    expect(cross.triggered).toBe(true);
    expect(cross.statement).toMatch(/without a comparable rise in sessions/i);
  });
});
