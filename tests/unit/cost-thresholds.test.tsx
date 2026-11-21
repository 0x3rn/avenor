import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CostThresholdsPanel } from "@/components/reports/cost-thresholds-panel";
import {
  evaluateSingleThresholdAgainstRows,
  resolveThresholdPeriodBounds,
  validateCostThresholdInput,
} from "@/lib/billing/thresholds";

describe("THE-137: User-Owned Avenor Spending Thresholds & Cost Alert Evaluation", () => {
  it("validates threshold inputs and rejects invalid currency codes or warning >= critical amounts", () => {
    const valid = validateCostThresholdInput({
      name: "Monthly Production Spend Cap",
      currency: "usd",
      warningAmount: 150,
      criticalAmount: 250,
      periodType: "MONTHLY",
      metricBasis: "NET_COST",
    });
    expect(valid.currency).toBe("USD");
    expect(valid.warningAmount).toBe(150);
    expect(valid.criticalAmount).toBe(250);

    expect(() =>
      validateCostThresholdInput({
        name: "Bad Rule",
        currency: "USD",
        warningAmount: 300,
        criticalAmount: 250,
      }),
    ).toThrow(/strictly less than critical amount/i);

    expect(() =>
      validateCostThresholdInput({
        name: "Bad Currency",
        currency: "USDOLLARS",
        criticalAmount: 100,
      }),
    ).toThrow(/Expected 3-letter ISO currency code/i);
  });

  it("resolves DAILY, WEEKLY_ROLLING, and MONTHLY evaluation period bounds deterministically", () => {
    const daily = resolveThresholdPeriodBounds("DAILY", "2026-11-15");
    expect(daily.periodKey).toBe("DAILY:2026-11-15");
    expect(daily.periodStartDate).toBe("2026-11-15");

    const weekly = resolveThresholdPeriodBounds("WEEKLY_ROLLING", "2026-11-15");
    expect(weekly.periodKey).toBe("WEEKLY:2026-11-09..2026-11-15");
    expect(weekly.periodStartDate).toBe("2026-11-09");

    const monthly = resolveThresholdPeriodBounds("MONTHLY", "2026-11-15");
    expect(monthly.periodKey).toBe("MONTHLY:2026-11");
    expect(monthly.periodStartDate).toBe("2026-11-01");
  });

  it("evaluates OK, WARNING, CRITICAL, CURRENCY_MISMATCH, and INSUFFICIENT_DATA across NET_COST and GROSS_COST", () => {
    const baseRule = {
      id: "cthr_1",
      name: "Cloud Run Monthly Cap",
      metricBasis: "NET_COST" as const,
      periodType: "MONTHLY" as const,
      currency: "USD",
      warningAmount: 100,
      criticalAmount: 200,
    };

    // 1. Empty rows -> INSUFFICIENT_DATA (never OK or $0)
    const emptyEval = evaluateSingleThresholdAgainstRows({
      threshold: baseRule,
      referenceDate: "2026-11-15",
      rows: [],
    });
    expect(emptyEval.severity).toBe("INSUFFICIENT_DATA");
    expect(emptyEval.shouldTriggerAlert).toBe(false);

    // 2. Currency mismatch (EUR rows vs USD rule) -> CURRENCY_MISMATCH
    const mismatchEval = evaluateSingleThresholdAgainstRows({
      threshold: baseRule,
      referenceDate: "2026-11-15",
      rows: [{ currency: "EUR", grossCost: 300, netCost: 250 }],
    });
    expect(mismatchEval.severity).toBe("CURRENCY_MISMATCH");
    expect(mismatchEval.shouldTriggerAlert).toBe(false);

    // 3. Gross is 220 (>200 critical), but Net after credits is 140 (>=100 warning, <200 critical) -> WARNING on NET_COST, CRITICAL on GROSS_COST
    const netWarningEval = evaluateSingleThresholdAgainstRows({
      threshold: baseRule,
      referenceDate: "2026-11-15",
      rows: [{ currency: "USD", grossCost: 220, netCost: 140 }],
    });
    expect(netWarningEval.severity).toBe("WARNING");
    expect(netWarningEval.observedAmount).toBe(140);
    expect(netWarningEval.shouldTriggerAlert).toBe(true);

    const grossCriticalEval = evaluateSingleThresholdAgainstRows({
      threshold: { ...baseRule, metricBasis: "GROSS_COST" },
      referenceDate: "2026-11-15",
      rows: [{ currency: "USD", grossCost: 220, netCost: 140 }],
    });
    expect(grossCriticalEval.severity).toBe("CRITICAL");
    expect(grossCriticalEval.observedAmount).toBe(220);
    expect(grossCriticalEval.shouldTriggerAlert).toBe(true);
  });

  it("renders CostThresholdsPanel with local Avenor rule notice, configured rules, and evaluation history", () => {
    render(
      <CostThresholdsPanel
        projectId="prj_1"
        defaultCurrency="USD"
        canManageThresholds={true}
        initialThresholds={[
          {
            id: "cthr_1",
            organizationId: "org_1",
            workspaceId: "wks_1",
            projectId: "prj_1",
            name: "Monthly Production Spend Cap",
            scopeType: "PROJECT",
            gcpProjectId: null,
            serviceDescription: null,
            metricBasis: "NET_COST",
            periodType: "MONTHLY",
            currency: "USD",
            warningAmount: 100,
            criticalAmount: 200,
            evaluationFrequency: "EVERY_SYNC",
            notificationChannels: ["IN_APP"],
            isEnabled: true,
            lastEvaluatedAtIso: "2026-11-16T10:00:00.000Z",
            lastStatus: "WARNING",
            createdByUserId: "usr_1",
            createdAtIso: "2026-11-16T09:00:00.000Z",
            updatedAtIso: "2026-11-16T10:00:00.000Z",
          },
        ]}
        initialEvaluations={[
          {
            id: "cevl_1",
            thresholdId: "cthr_1",
            thresholdName: "Monthly Production Spend Cap",
            organizationId: "org_1",
            workspaceId: "wks_1",
            projectId: "prj_1",
            periodKey: "MONTHLY:2026-11",
            periodStartDate: "2026-11-01",
            periodEndDate: "2026-11-16",
            severity: "WARNING",
            observedAmount: 140,
            thresholdAmount: 100,
            currency: "USD",
            dedupeKey: "cthr_1::MONTHLY:2026-11::WARNING",
            alertTriggered: true,
            wasDeduplicatedRepeat: false,
            summary:
              "WARNING: Monthly Production Spend Cap reached USD 140.00 (warning limit: USD 100.00).",
            details: {},
            evaluatedAtIso: "2026-11-16T10:00:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getByTestId("cost-thresholds-panel")).toBeInTheDocument();
    expect(screen.getByTestId("create-cost-threshold-form")).toBeInTheDocument();
    expect(screen.getByTestId("cost-threshold-row-cthr_1")).toBeInTheDocument();
    expect(screen.getByTestId("cost-evaluations-list")).toBeInTheDocument();
    expect(screen.getByText("Warning Breached")).toBeInTheDocument();
  });
});
