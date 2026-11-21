import { describe, expect, it } from "vitest";
import {
  correlateOperationalEvents,
  type OperationalEventRecord,
} from "@/lib/reliability/correlation";

function makeEvent(overrides: Partial<OperationalEventRecord>): OperationalEventRecord {
  return {
    id: overrides.id ?? "ev_1",
    workspaceId: "ws_1",
    projectId: "prj_1",
    environmentId: "env_prod",
    providerKey: "vercel",
    eventType: "DEPLOYMENT",
    externalEventId: "ext_1",
    environmentName: "PRODUCTION",
    commitSha: null,
    releaseTag: null,
    status: "READY",
    summary: "Production deployment",
    sourceGranularity: "EVENT",
    sourceTimezone: "UTC",
    sourceUrl: null,
    occurredAtIso: "2026-11-20T14:00:00.000Z",
    metadata: {},
    ...overrides,
  };
}

describe("THE-153: Cross-provider operational event correlation engine", () => {
  it("directly links matching commit SHAs across GitHub CI and Vercel deploys while separating environments and preventing fabricated causal claims", () => {
    const ghRun = makeEvent({
      id: "ev_gh",
      providerKey: "github",
      eventType: "CI_WORKFLOW",
      commitSha: "a1b2c3d4e5f6",
      occurredAtIso: "2026-11-20T13:56:00.000Z",
    });
    const vercelProd = makeEvent({
      id: "ev_vcl",
      providerKey: "vercel",
      eventType: "DEPLOYMENT",
      commitSha: "a1b2c3d4e5f6",
      occurredAtIso: "2026-11-20T14:00:00.000Z",
    });
    const sentryAfter = makeEvent({
      id: "ev_sen",
      providerKey: "sentry",
      eventType: "ERROR_SPIKE",
      commitSha: null,
      occurredAtIso: "2026-11-20T14:08:00.000Z",
      summary: "Sentry error event rate increased",
    });
    const stagingFail = makeEvent({
      id: "ev_stg",
      providerKey: "vercel",
      eventType: "DEPLOYMENT",
      environmentName: "STAGING",
      commitSha: "a1b2c3d4e5f6",
      status: "ERROR",
      occurredAtIso: "2026-11-20T14:01:00.000Z",
    });

    const correlations = correlateOperationalEvents([ghRun, vercelProd, sentryAfter, stagingFail]);

    // GitHub + Vercel same SHA -> DIRECTLY_LINKED
    const direct = correlations.find(
      (c) => c.primaryEventId === "ev_gh" && c.relatedEventId === "ev_vcl",
    );
    expect(direct?.evidenceLevel).toBe("DIRECTLY_LINKED");
    expect(direct?.sharedIdentifier).toBe("a1b2c3d4e5f6");

    // Vercel + Sentry within 8 mins -> TEMPORALLY_ASSOCIATED (never claims causation)
    const temporal = correlations.find(
      (c) => c.primaryEventId === "ev_vcl" && c.relatedEventId === "ev_sen",
    );
    expect(temporal?.evidenceLevel).toBe("TEMPORALLY_ASSOCIATED");
    expect(temporal?.cautiousStatement).toMatch(/does not prove causation/i);

    // Staging failure NEVER correlates with Production events
    expect(
      correlations.some((c) => c.primaryEventId === "ev_stg" || c.relatedEventId === "ev_stg"),
    ).toBe(false);
  });

  it("refuses minute-level correlation with DAILY GA4 summaries and preserves chronological order when errors precede a deployment", () => {
    const errorBefore = makeEvent({
      id: "ev_err_before",
      providerKey: "sentry",
      eventType: "ERROR_SPIKE",
      occurredAtIso: "2026-11-20T13:50:00.000Z",
    });
    const deployAfter = makeEvent({
      id: "ev_dpl_after",
      providerKey: "vercel",
      eventType: "DEPLOYMENT",
      occurredAtIso: "2026-11-20T14:00:00.000Z",
    });
    const dailyGa4 = makeEvent({
      id: "ev_ga4_daily",
      providerKey: "ga4",
      eventType: "TRAFFIC_DAILY_SUMMARY",
      sourceGranularity: "DAILY",
      occurredAtIso: "2026-11-20T00:00:00.000Z",
    });

    const correlations = correlateOperationalEvents([deployAfter, errorBefore, dailyGa4]);

    // Error preceded deploy -> primary is ev_err_before, related is ev_dpl_after
    const pair = correlations.find(
      (c) => c.primaryEventId === "ev_err_before" && c.relatedEventId === "ev_dpl_after",
    );
    expect(pair?.evidenceLevel).toBe("TEMPORALLY_ASSOCIATED");
    expect(pair?.cautiousStatement).toMatch(
      /vercel \(DEPLOYMENT\) was observed ~10m after sentry/i,
    );

    // Daily GA4 -> INSUFFICIENT_EVIDENCE
    const ga4Pair = correlations.find(
      (c) => c.primaryEventId === "ev_ga4_daily" && c.relatedEventId === "ev_dpl_after",
    );
    expect(ga4Pair?.evidenceLevel).toBe("INSUFFICIENT_EVIDENCE");
  });
});
