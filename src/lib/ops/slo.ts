import { redactSensitiveText } from "@avenor/types";

export type ServiceSurfaceKey =
  | "DASHBOARD_API"
  | "INGESTION_SCHEDULER"
  | "WEBHOOK_RECEIVERS"
  | "PUBLIC_READ_API"
  | "AUTH_AND_BILLING";

export interface SloTargetDefinition {
  readonly surface: ServiceSurfaceKey;
  readonly displayName: string;
  readonly availabilityObjective: number; // e.g. 0.995 = 99.5%
  readonly p95LatencyTargetMs: number;
  readonly rollingWindowDays: number;
  readonly notes: string;
}

export interface SloEvaluationInput {
  readonly surface: ServiceSurfaceKey;
  readonly totalRequests: number;
  readonly client4xxRequests: number;
  readonly server5xxRequests: number;
  readonly latenciesMs: readonly number[];
}

export interface SloEvaluationResult {
  readonly surface: ServiceSurfaceKey;
  readonly validServerRequests: number;
  readonly server5xxRequests: number;
  readonly availabilityRatio: number;
  readonly availabilityObjective: number;
  readonly errorBudgetRemainingRatio: number;
  readonly errorBudgetBurnRate: number;
  readonly burnSeverity: "HEALTHY" | "ELEVATED" | "FAST_BURN_PAGE";
  readonly p50LatencyMs: number;
  readonly p95LatencyMs: number;
  readonly p99LatencyMs: number;
  readonly latencyObjectiveMet: boolean;
}

export interface OperationalRunbook {
  readonly id: string;
  readonly title: string;
  readonly triggerSignals: readonly string[];
  readonly immediateContainmentSteps: readonly string[];
  readonly recoveryVerificationSteps: readonly string[];
  readonly rollbackOrFallbackPath: string;
}

export const AVENOR_SLO_TARGETS: Readonly<Record<ServiceSurfaceKey, SloTargetDefinition>> = {
  DASHBOARD_API: {
    surface: "DASHBOARD_API",
    displayName: "Authenticated Dashboard & Report APIs",
    availabilityObjective: 0.995,
    p95LatencyTargetMs: 650,
    rollingWindowDays: 30,
    notes:
      "Excludes 4xx caller validation/auth errors; measures server availability and cached/DB p95 latency.",
  },
  INGESTION_SCHEDULER: {
    surface: "INGESTION_SCHEDULER",
    displayName: "Read-Only Provider Ingestion Pipeline",
    availabilityObjective: 0.99,
    p95LatencyTargetMs: 4500,
    rollingWindowDays: 30,
    notes: "Tracks internal ingestion completion excluding third-party upstream 429/outage events.",
  },
  WEBHOOK_RECEIVERS: {
    surface: "WEBHOOK_RECEIVERS",
    displayName: "GitHub & Lemon Squeezy Webhook Receivers",
    availabilityObjective: 0.999,
    p95LatencyTargetMs: 400,
    rollingWindowDays: 30,
    notes: "High availability target to avoid dropped subscription or deployment notifications.",
  },
  PUBLIC_READ_API: {
    surface: "PUBLIC_READ_API",
    displayName: "Scoped Read-Only Public API (/api/v1/*)",
    availabilityObjective: 0.995,
    p95LatencyTargetMs: 500,
    rollingWindowDays: 30,
    notes: "Strictly bounded cursor-paginated read endpoints.",
  },
  AUTH_AND_BILLING: {
    surface: "AUTH_AND_BILLING",
    displayName: "Authentication, Invitations & Subscription Entitlements",
    availabilityObjective: 0.999,
    p95LatencyTargetMs: 450,
    rollingWindowDays: 30,
    notes: "Critical SaaS boundary; failures trigger immediate operator escalation.",
  },
};

export function computePercentile(sortedOrUnsorted: readonly number[], percentile: number): number {
  if (sortedOrUnsorted.length === 0) return 0;
  const sorted = [...sortedOrUnsorted].sort((a, b) => a - b);
  const clampedP = Math.max(0, Math.min(100, percentile));
  const rank = Math.ceil((clampedP / 100) * sorted.length) - 1;
  const idx = Math.max(0, Math.min(sorted.length - 1, rank));
  return Number((sorted[idx] ?? 0).toFixed(2));
}

/**
 * Computes SLI availability, percentile latencies, and error-budget burn rate.
 * Explicitly excludes 4xx caller errors from denominator/failures so invalid client requests
 * never corrupt server SLO budgets.
 */
export function evaluateSloWindow(input: SloEvaluationInput): SloEvaluationResult {
  const target = AVENOR_SLO_TARGETS[input.surface];
  const validServerRequests = Math.max(0, input.totalRequests - input.client4xxRequests);
  const server5xxRequests = Math.max(0, Math.min(validServerRequests, input.server5xxRequests));

  const availabilityRatio =
    validServerRequests === 0
      ? 1
      : Number(((validServerRequests - server5xxRequests) / validServerRequests).toFixed(6));

  const allowedErrorRatio = 1 - target.availabilityObjective;
  const observedErrorRatio = 1 - availabilityRatio;
  const errorBudgetBurnRate =
    allowedErrorRatio <= 0 ? 0 : Number((observedErrorRatio / allowedErrorRatio).toFixed(4));
  const errorBudgetRemainingRatio = Number(Math.max(0, 1 - errorBudgetBurnRate).toFixed(4));

  const burnSeverity: SloEvaluationResult["burnSeverity"] =
    errorBudgetBurnRate >= 6 ? "FAST_BURN_PAGE" : errorBudgetBurnRate >= 2 ? "ELEVATED" : "HEALTHY";

  const p50LatencyMs = computePercentile(input.latenciesMs, 50);
  const p95LatencyMs = computePercentile(input.latenciesMs, 95);
  const p99LatencyMs = computePercentile(input.latenciesMs, 99);

  return {
    surface: input.surface,
    validServerRequests,
    server5xxRequests,
    availabilityRatio,
    availabilityObjective: target.availabilityObjective,
    errorBudgetRemainingRatio,
    errorBudgetBurnRate,
    burnSeverity,
    p50LatencyMs,
    p95LatencyMs,
    p99LatencyMs,
    latencyObjectiveMet: p95LatencyMs <= target.p95LatencyTargetMs,
  };
}

export interface StructuredTelemetryEvent {
  readonly timestampIso: string;
  readonly level: "info" | "warn" | "error";
  readonly surface: ServiceSurfaceKey;
  readonly event: string;
  readonly requestId?: string;
  readonly workspaceId?: string;
  readonly durationMs?: number;
  readonly statusCode?: number;
  readonly detail?: string;
}

/**
 * Formats a secret-scrubbed single-line JSON structured telemetry log entry.
 */
export function formatStructuredTelemetryEvent(event: StructuredTelemetryEvent): string {
  const scrubbedDetail = event.detail
    ? redactSensitiveText(
        event.detail.replace(
          /(?:postgres(?:ql)?|mysql|mongodb):\/\/[^\s"']+/gi,
          "[REDACTED_DB_URI]",
        ),
      )
    : undefined;
  return JSON.stringify({
    ts: event.timestampIso,
    level: event.level,
    surface: event.surface,
    event: event.event,
    requestId: event.requestId,
    workspaceId: event.workspaceId,
    durationMs: event.durationMs,
    statusCode: event.statusCode,
    detail: scrubbedDetail,
  });
}

export const OPERATIONAL_RUNBOOKS: readonly OperationalRunbook[] = [
  {
    id: "RB-001",
    title: "Primary PostgreSQL / Neon Outage or Connection Saturation",
    triggerSignals: [
      "DASHBOARD_API or AUTH_AND_BILLING 5xx burn rate >= 6x",
      "pg pool connection timeout or ECONNREFUSED errors in structured logs",
    ],
    immediateContainmentSteps: [
      "Verify Neon project status and active compute/pooler connections.",
      "Pause non-essential ingestion and export workers via feature kill switches (ingestion.global, exports.global).",
      "Confirm read-only cached responses degrade cleanly without fabricating zero metrics.",
    ],
    recoveryVerificationSteps: [
      "Run `pnpm db:status` against primary database and confirm healthy=true.",
      "Verify `/api/health` returns 200 OK and p95 latency returns below 650ms.",
      "Re-enable paused kill switches incrementally and observe error budget stabilization.",
    ],
    rollbackOrFallbackPath:
      "Restore from Neon point-in-time branch snapshot (tested in recovery-drill) and switch pooled DATABASE_URL.",
  },
  {
    id: "RB-002",
    title: "Lemon Squeezy Webhook Backlog or Signature Failure",
    triggerSignals: [
      "WEBHOOK_RECEIVERS HTTP 401/500 spike on `/api/webhooks/lemon-squeezy`",
      "Paid customers reporting missing entitlement upgrades after checkout",
    ],
    immediateContainmentSteps: [
      "Check `LEMON_SQUEEZY_WEBHOOK_SECRET` rotation state and raw-body forwarding on Cloudflare/edge proxy.",
      "Inspect `subscription_webhook_events` for failed or missing delivery fingerprints.",
      "Pause checkout CTA via kill switch `billing.checkout` only if webhooks are unrecoverable.",
    ],
    recoveryVerificationSteps: [
      "Replay failed deliveries from Lemon Squeezy webhook dashboard (idempotent fingerprint dedupe prevents double-processing).",
      "Confirm workspace entitlement updates cleanly in `workspace_subscriptions` and `subscription_invoices`.",
    ],
    rollbackOrFallbackPath:
      "Manually reconcile affected workspace subscription state from verified Lemon Squeezy API response.",
  },
  {
    id: "RB-003",
    title: "External Provider OAuth Revocation or Upstream API Rate Limit Storm",
    triggerSignals: [
      "Spikes in PROVIDER_UNAUTHORIZED or PROVIDER_RATE_LIMITED across GA4, GSC, Cloudflare, Vercel, GitHub, or Sentry",
    ],
    immediateContainmentSteps: [
      "Disable the single affected provider adapter via its scoped kill switch (e.g. `provider.cloudflare`) while keeping all other providers active.",
      "Verify ingestion watermarks respect Retry-After backoff without hammering upstream endpoints.",
    ],
    recoveryVerificationSteps: [
      "Verify connection health indicator accurately displays degraded/re-auth-required state rather than zeros.",
      "Re-enable adapter kill switch once upstream status recovers and confirm watermark catch-up.",
    ],
    rollbackOrFallbackPath:
      "Serve last verified observations with explicit staleness banners until upstream recovers.",
  },
  {
    id: "RB-004",
    title: "BigQuery Billing Query Byte Surge",
    triggerSignals: [
      "BigQuery dry-run byte guard rejecting customer queries or approaching monthly scan cap",
    ],
    immediateContainmentSteps: [
      "Confirm `MAX_BIGQUERY_BYTES_BILLED` ceiling is enforced and dry-run estimation runs before execution.",
      "Verify partition date-range filter is present on every BigQuery billing ledger query.",
    ],
    recoveryVerificationSteps: [
      "Re-run cost reconciliation unit/integration tests and confirm dry-run rejections produce actionable guidance without executing unpartitioned scans.",
    ],
    rollbackOrFallbackPath:
      "Disable `provider.google_cloud_billing` kill switch until oversized table partition scope is narrowed.",
  },
  {
    id: "RB-005",
    title: "Production Release Rollback Procedure",
    triggerSignals: [
      "Post-deploy FAST_BURN_PAGE alert or broken authentication/billing flow within 15 minutes of release",
    ],
    immediateContainmentSteps: [
      "Promote previous verified deployment artifact in Cloudflare Workers / Vercel.",
      "Do NOT run destructive down-migrations; all Avenor migrations are additive and backward-compatible.",
    ],
    recoveryVerificationSteps: [
      "Confirm `/api/health`, `/pricing`, `/security`, and authenticated dashboard load cleanly with p95 latency within SLO.",
    ],
    rollbackOrFallbackPath:
      "Immediate deployment promotion rollback plus selective feature kill switch disablement.",
  },
];
