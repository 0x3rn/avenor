export type ExpansionDecision = "IMPLEMENTED_IN_M11" | "DEFERRED_POST_GA";

export interface ProviderExpansionEvaluation {
  readonly providerKey: string;
  readonly displayName: string;
  readonly category: "analytics" | "cloud_billing" | "hosting_edge" | "revenue_metadata";
  readonly authMode: "api_token" | "oauth2" | "iam_role";
  readonly readOnlyScopeAvailable: boolean;
  readonly piiRiskLevel:
    | "LOW_AGGREGATE_ONLY"
    | "MODERATE_REQUIRES_SCRUBBING"
    | "HIGH_SENSITIVE_FINANCIAL";
  readonly rateLimitAndCostRisk: string;
  readonly decision: ExpansionDecision;
  readonly rationale: string;
}

export const PROVIDER_EXPANSION_FEASIBILITY_MATRIX: readonly ProviderExpansionEvaluation[] = [
  {
    providerKey: "posthog",
    displayName: "PostHog Product Analytics (Aggregate Insights)",
    category: "analytics",
    authMode: "api_token",
    readOnlyScopeAvailable: true,
    piiRiskLevel: "LOW_AGGREGATE_ONLY",
    rateLimitAndCostRisk:
      "Standard Personal API key read limits; aggregate insights queries are lightweight.",
    decision: "IMPLEMENTED_IN_M11",
    rationale:
      "Strong product-analytics complement to GA4; easily locked to GET-only /projects and /insights aggregate endpoints while blocking /persons, /events, and /feature_flags.",
  },
  {
    providerKey: "stripe-revenue-metadata",
    displayName: "Stripe Restricted Read-Only Revenue Aggregates",
    category: "revenue_metadata",
    authMode: "api_token",
    readOnlyScopeAvailable: true,
    piiRiskLevel: "HIGH_SENSITIVE_FINANCIAL",
    rateLimitAndCostRisk:
      "Requires strict separation from Avenor's Lemon Squeezy SaaS billing and zero raw customer PII storage.",
    decision: "DEFERRED_POST_GA",
    rationale:
      "Valuable post-GA customer revenue telemetry, but deferred until post-GA financial data isolation review so it is never confused with Avenor's own Lemon Squeezy subscription billing.",
  },
  {
    providerKey: "aws-cost-explorer",
    displayName: "AWS Cost Explorer (Read-Only STS Role)",
    category: "cloud_billing",
    authMode: "iam_role",
    readOnlyScopeAvailable: true,
    piiRiskLevel: "LOW_AGGREGATE_ONLY",
    rateLimitAndCostRisk:
      "AWS charges $0.01 per Cost Explorer API request; requires strict per-workspace daily polling caps.",
    decision: "DEFERRED_POST_GA",
    rationale:
      "Requires external-ID cross-account STS assume-role onboarding UX and strict Cost Explorer per-request spend metering.",
  },
  {
    providerKey: "render",
    displayName: "Render Services & Deploy Telemetry",
    category: "hosting_edge",
    authMode: "api_token",
    readOnlyScopeAvailable: false,
    piiRiskLevel: "MODERATE_REQUIRES_SCRUBBING",
    rateLimitAndCostRisk: "Standard REST limits; API keys historically carry broad account scope.",
    decision: "DEFERRED_POST_GA",
    rationale:
      "Deferred until Render offers fine-grained read-only scoped tokens without deploy/env-var write capability.",
  },
  {
    providerKey: "railway",
    displayName: "Railway GraphQL Usage & Deploy Metadata",
    category: "hosting_edge",
    authMode: "api_token",
    readOnlyScopeAvailable: false,
    piiRiskLevel: "MODERATE_REQUIRES_SCRUBBING",
    rateLimitAndCostRisk:
      "GraphQL complexity quotas; requires strict mutation-AST blocking similar to Cloudflare.",
    decision: "DEFERRED_POST_GA",
    rationale:
      "Deferred pending read-only scoped project token guarantees to preserve Avenor's least-privilege standard.",
  },
];
