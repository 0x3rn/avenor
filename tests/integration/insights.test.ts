import "dotenv/config";
import { registerUserWithDefaultOwnership } from "@avenor/auth";
import { closeAllDatabasePools, resetTestDatabaseRecords, runMigrations } from "@avenor/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  generateAndPersistInsightSummary,
  listWorkspaceInsights,
} from "@/lib/intelligence/insights";

describe("THE-157 PostgreSQL Integration: Guarded AI fallback and tenant-scoped insight persistence", () => {
  beforeAll(async () => {
    await runMigrations();
    await resetTestDatabaseRecords();
  });

  afterAll(async () => {
    await resetTestDatabaseRecords();
    await closeAllDatabasePools();
  });

  it("falls back to deterministic verified summary when AI hallucinates a number and persists safely", async () => {
    const owner = await registerUserWithDefaultOwnership({
      email: "insight-owner@avenor.test",
      name: "Insight Owner",
      password: "ValidPassword!2026",
      organizationName: "Insight Org",
      workspaceName: "Insight WS",
    });

    const insight = await generateAndPersistInsightSummary(owner.context, {
      evidence: [
        {
          evidenceId: "ev_1",
          providerKey: "ga4",
          metricKey: "ga4.sessions",
          label: "GA4 Sessions",
          currentValue: 820,
          priorValue: 1000,
          unit: "sessions",
          periodLabel: "2026-11-14 to 2026-11-20",
        },
      ],
      preferAi: true,
      aiGenerator: async () => ({
        model: "mock-hallucinator",
        candidate: {
          headline: "Traffic fell by 95% with 45000 lost users",
          summary: "Hallucinated 45000 users lost.",
          evidenceIds: ["ev_1"],
        },
      }),
    });

    expect(insight.mode).toBe("DETERMINISTIC");
    expect(insight.fallbackReason).toMatch(/hallucinated\/unverified numeric/i);
    expect(insight.verifiedNumericClaims).toBe(true);

    const list = await listWorkspaceInsights(owner.context);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(insight.id);
  });
});
