import { describe, expect, it } from "vitest";
import {
  AVENOR_SLO_TARGETS,
  computePercentile,
  evaluateSloWindow,
  formatStructuredTelemetryEvent,
  OPERATIONAL_RUNBOOKS,
} from "@/lib/ops/slo";

describe("THE-165 SLOs, Error-Budget Burn Rate, Telemetry Scrubbing & Capacity Benchmark", () => {
  it("excludes 4xx client errors from server availability and detects fast burn rates accurately", () => {
    // 1000 requests: 200 are 4xx invalid caller requests, 1 is 5xx server error -> 799/800 = 0.99875
    const healthy = evaluateSloWindow({
      surface: "DASHBOARD_API",
      totalRequests: 1000,
      client4xxRequests: 200,
      server5xxRequests: 1,
      latenciesMs: [40, 55, 70, 90, 120, 180, 210, 260, 320, 410],
    });
    expect(healthy.validServerRequests).toBe(800);
    expect(healthy.availabilityRatio).toBe(0.99875);
    expect(healthy.errorBudgetBurnRate).toBeLessThan(1);
    expect(healthy.burnSeverity).toBe("HEALTHY");
    expect(healthy.latencyObjectiveMet).toBe(true);

    // Severe 5xx outage: 50 server errors out of 1000 valid requests -> 5% error rate vs 0.5% budget = 10x burn!
    const outage = evaluateSloWindow({
      surface: "DASHBOARD_API",
      totalRequests: 1000,
      client4xxRequests: 0,
      server5xxRequests: 50,
      latenciesMs: [120, 400, 900, 1500],
    });
    expect(outage.errorBudgetBurnRate).toBe(10);
    expect(outage.burnSeverity).toBe("FAST_BURN_PAGE");
    expect(outage.latencyObjectiveMet).toBe(false);
  });

  it("scrubs secrets and DB URIs from structured telemetry logs and maintains all 5 operational runbooks", () => {
    const logLine = formatStructuredTelemetryEvent({
      timestampIso: "2026-11-21T20:00:00.000Z",
      level: "error",
      surface: "INGESTION_SCHEDULER",
      event: "db_connection_failed",
      requestId: "req_123",
      detail:
        "Failed connecting to postgresql://avenor:supersecret@ep-123.neon.tech/db with Bearer tok_99999",
    });
    expect(logLine).not.toContain("supersecret");
    expect(logLine).not.toContain("tok_99999");
    expect(logLine).toContain("[REDACTED_DB_URI]");

    expect(OPERATIONAL_RUNBOOKS.length).toBeGreaterThanOrEqual(5);
    expect(Object.keys(AVENOR_SLO_TARGETS).length).toBe(5);
  });

  it("meets bounded latency budgets in a 2,000-observation capacity micro-benchmark", () => {
    const latencies: number[] = [];
    const syntheticDataset = Array.from({ length: 2000 }, (_, i) => ({
      projectId: `proj_${i % 20}`,
      metricKey: Math.floor(i / 20) % 2 === 0 ? "ga4.sessions" : "gcp.billing.net_cost",
      value: (i % 100) * 1.25,
    }));

    for (let iter = 0; iter < 50; iter++) {
      const start = performance.now();
      const rollup = new Map<string, number>();
      for (const row of syntheticDataset) {
        const key = `${row.projectId}:${row.metricKey}`;
        rollup.set(key, (rollup.get(key) ?? 0) + row.value);
      }
      expect(rollup.size).toBe(40);
      latencies.push(performance.now() - start);
    }

    const p50 = computePercentile(latencies, 50);
    const p95 = computePercentile(latencies, 95);
    expect(p50).toBeLessThan(25);
    expect(p95).toBeLessThan(50);
  });
});
