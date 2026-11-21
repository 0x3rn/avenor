export type AvenorPlanCode = "FREE" | "PRO" | "TEAM";
export type AvenorBillingInterval = "MONTHLY" | "ANNUAL";

export interface PlanEntitlementLimits {
  readonly maxProjects: number;
  readonly maxMappedSources: number;
  readonly maxMembers: number;
  readonly retentionDays: number;
  readonly syncTargetLabel: string;
  readonly maxUptimeMonitors: number;
  readonly uptimePollingMinutes: number;
  readonly maxSavedReports: number | null; // null = unlimited* subject to fair use
  readonly csvExportsPerMonth: number;
  readonly pdfExportsPerMonth: number;
  readonly maxActiveAlertRules: number;
  readonly maxDigestSchedules: number;
  readonly aiInsightsPerMonth: number;
  readonly publicApiRequestsPerMonth: number;
  readonly maxOutgoingWebhooks: number;
  readonly supportTier: string;
}

export interface AvenorPlanDefinition {
  readonly planCode: AvenorPlanCode;
  readonly displayName: string;
  readonly audienceLabel: string;
  readonly currency: "USD";
  readonly monthlyPriceUsd: number;
  readonly annualTotalUsd: number;
  readonly annualMonthlyEquivalentUsd: number;
  readonly annualSavingsUsd: number;
  readonly limits: PlanEntitlementLimits;
}

export const AVENOR_BILLING_CATALOG_VERSION = "1.0" as const;

/**
 * Single versioned commercial catalog aligned with Avenor's canonical
 * Billing Plan & Structure specification (Lemon Squeezy merchant of record).
 */
export const AVENOR_PLAN_CATALOG: Readonly<Record<AvenorPlanCode, AvenorPlanDefinition>> = {
  FREE: {
    planCode: "FREE",
    displayName: "Free",
    audienceLabel: "First-time independent builder evaluating Avenor",
    currency: "USD",
    monthlyPriceUsd: 0,
    annualTotalUsd: 0,
    annualMonthlyEquivalentUsd: 0,
    annualSavingsUsd: 0,
    limits: {
      maxProjects: 1,
      maxMappedSources: 4,
      maxMembers: 1,
      retentionDays: 30,
      syncTargetLabel: "Daily",
      maxUptimeMonitors: 1,
      uptimePollingMinutes: 30,
      maxSavedReports: 1,
      csvExportsPerMonth: 2,
      pdfExportsPerMonth: 0,
      maxActiveAlertRules: 2,
      maxDigestSchedules: 0,
      aiInsightsPerMonth: 0,
      publicApiRequestsPerMonth: 0,
      maxOutgoingWebhooks: 0,
      supportTier: "Help center",
    },
  },
  PRO: {
    planCode: "PRO",
    displayName: "Pro",
    audienceLabel: "Solo developers and founders managing several products",
    currency: "USD",
    monthlyPriceUsd: 19,
    annualTotalUsd: 180,
    annualMonthlyEquivalentUsd: 15,
    annualSavingsUsd: 48,
    limits: {
      maxProjects: 5,
      maxMappedSources: 20,
      maxMembers: 2,
      retentionDays: 365,
      syncTargetLabel: "Up to every 6 hours",
      maxUptimeMonitors: 5,
      uptimePollingMinutes: 15,
      maxSavedReports: null,
      csvExportsPerMonth: 50,
      pdfExportsPerMonth: 20,
      maxActiveAlertRules: 15,
      maxDigestSchedules: 3,
      aiInsightsPerMonth: 20,
      publicApiRequestsPerMonth: 2000,
      maxOutgoingWebhooks: 2,
      supportTier: "Email support",
    },
  },
  TEAM: {
    planCode: "TEAM",
    displayName: "Team",
    audienceLabel: "Growing startups, small technical teams, and agencies",
    currency: "USD",
    monthlyPriceUsd: 59,
    annualTotalUsd: 588,
    annualMonthlyEquivalentUsd: 49,
    annualSavingsUsd: 120,
    limits: {
      maxProjects: 20,
      maxMappedSources: 60,
      maxMembers: 10,
      retentionDays: 730,
      syncTargetLabel: "Up to hourly",
      maxUptimeMonitors: 20,
      uptimePollingMinutes: 10,
      maxSavedReports: null,
      csvExportsPerMonth: 250,
      pdfExportsPerMonth: 100,
      maxActiveAlertRules: 75,
      maxDigestSchedules: 20,
      aiInsightsPerMonth: 150,
      publicApiRequestsPerMonth: 25000,
      maxOutgoingWebhooks: 10,
      supportTier: "Priority email support",
    },
  },
} as const;

export function resolveLemonSqueezyVariantId(
  planCode: Exclude<AvenorPlanCode, "FREE">,
  interval: AvenorBillingInterval,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (planCode === "PRO" && interval === "MONTHLY") {
    return env.LEMON_SQUEEZY_VARIANT_PRO_MONTHLY?.trim() || null;
  }
  if (planCode === "PRO" && interval === "ANNUAL") {
    return env.LEMON_SQUEEZY_VARIANT_PRO_ANNUAL?.trim() || null;
  }
  if (planCode === "TEAM" && interval === "MONTHLY") {
    return env.LEMON_SQUEEZY_VARIANT_TEAM_MONTHLY?.trim() || null;
  }
  return env.LEMON_SQUEEZY_VARIANT_TEAM_ANNUAL?.trim() || null;
}

export function resolvePlanFromLemonSqueezyVariant(
  variantId: string,
  env: Record<string, string | undefined> = process.env,
): { planCode: Exclude<AvenorPlanCode, "FREE">; interval: AvenorBillingInterval } | null {
  const clean = variantId.trim();
  if (!clean) return null;
  if (clean === env.LEMON_SQUEEZY_VARIANT_PRO_MONTHLY?.trim()) {
    return { planCode: "PRO", interval: "MONTHLY" };
  }
  if (clean === env.LEMON_SQUEEZY_VARIANT_PRO_ANNUAL?.trim()) {
    return { planCode: "PRO", interval: "ANNUAL" };
  }
  if (clean === env.LEMON_SQUEEZY_VARIANT_TEAM_MONTHLY?.trim()) {
    return { planCode: "TEAM", interval: "MONTHLY" };
  }
  if (clean === env.LEMON_SQUEEZY_VARIANT_TEAM_ANNUAL?.trim()) {
    return { planCode: "TEAM", interval: "ANNUAL" };
  }
  return null;
}
