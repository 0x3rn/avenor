export type SecuritySeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
export type SecurityFindingStatus = "REMEDIATED_AND_VERIFIED" | "OPEN" | "ACCEPTED_RISK";

export interface AsvsControlRecord {
  readonly asvsRef: string;
  readonly domain: string;
  readonly controlSummary: string;
  readonly enforcedInPaths: readonly string[];
  readonly verifiedByTests: readonly string[];
  readonly status: "VERIFIED";
}

export interface ProviderPrivilegeMatrixRow {
  readonly providerKey: string;
  readonly displayName: string;
  readonly authMechanism: string;
  readonly requestedScopes: readonly string[];
  readonly readOnlyEnforced: true;
  readonly blockedMutationSurface: string;
  readonly residualRiskNote: string;
}

export interface SecurityFindingRecord {
  readonly id: string;
  readonly title: string;
  readonly severity: SecuritySeverity;
  readonly status: SecurityFindingStatus;
  readonly affectedSurface: string;
  readonly rootCause: string;
  readonly remediation: string;
  readonly regressionTest: string;
}

export interface SecurityReleaseGateEvaluation {
  readonly internalAuditPassed: boolean;
  readonly openCriticalCount: number;
  readonly openHighCount: number;
  readonly externalIndependentPentestStatus: "PENDING_EXTERNAL_REVIEWER_SIGN_OFF";
  readonly truthfulCertificationStatement: string;
  readonly blockingReasons: readonly string[];
}

export const OWASP_ASVS_5_CONTROLS: readonly AsvsControlRecord[] = [
  {
    asvsRef: "V2 / V3 — Auth & Session Management",
    domain: "Authentication",
    controlSummary:
      "Better Auth database-backed sessions, HttpOnly/SameSite cookies, SHA-256 hashed single-use workspace invitation tokens with email-identity binding and FOR UPDATE locking.",
    enforcedInPaths: ["packages/auth/src/index.ts", "src/lib/team/memberships.ts"],
    verifiedByTests: ["tests/integration/team-invitations.test.ts"],
    status: "VERIFIED",
  },
  {
    asvsRef: "V4 — Access Control & Multi-Tenant Isolation",
    domain: "Authorization",
    controlSummary:
      "4-role workspace RBAC (OWNER, ADMIN, ANALYST, VIEWER), explicit per-project grants, last-owner demotion/removal protection, anti-orphaning personal deletion, and server-side workspace scoping on every query.",
    enforcedInPaths: [
      "packages/auth/src/rbac.ts",
      "src/lib/team/memberships.ts",
      "src/lib/privacy/compliance.ts",
    ],
    verifiedByTests: [
      "tests/unit/team-rbac.test.ts",
      "tests/integration/team-invitations.test.ts",
      "tests/integration/privacy.test.ts",
    ],
    status: "VERIFIED",
  },
  {
    asvsRef: "V6 — Cryptography & Secret Vault",
    domain: "Secrets",
    controlSummary:
      "AES-256-GCM authenticated envelope encryption for stored provider credentials, strict secret exclusion from personal data exports, and pre-storage secret scrubbing on support intake and Sentry ingestion.",
    enforcedInPaths: [
      "packages/crypto/src/index.ts",
      "src/lib/support/service.ts",
      "src/lib/providers/sentry/http.ts",
    ],
    verifiedByTests: [
      "tests/security/asvs-adversarial.test.ts",
      "tests/integration/support-and-pricing.test.ts",
    ],
    status: "VERIFIED",
  },
  {
    asvsRef: "V12 / V13 — SSRF, Webhooks & Outbound Network Safety",
    domain: "Network & Webhooks",
    controlSummary:
      "Public-only URL validator blocking RFC1918/loopback/link-local/cloud metadata/obfuscated IPs with DNS-rebinding IP pinning; constant-time HMAC-SHA256 raw-body verification on GitHub and Lemon Squeezy webhooks; timestamped signed outbound alert webhooks.",
    enforcedInPaths: [
      "src/lib/reliability/ssrf.ts",
      "src/lib/providers/github/http.ts",
      "src/lib/billing/lemon-squeezy.ts",
      "src/lib/alerts/digests.ts",
    ],
    verifiedByTests: [
      "tests/security/asvs-adversarial.test.ts",
      "tests/unit/lemon-squeezy.test.ts",
    ],
    status: "VERIFIED",
  },
  {
    asvsRef: "V5 — Injection, Output Encoding & AI Guardrails",
    domain: "Input/Output Safety",
    controlSummary:
      "Parameterized SQL queries throughout PostgreSQL persistence, CSV spreadsheet formula-injection neutralization, HTML entity escaping for printable reports, prompt-injection neutralization, and independent numeric-claim verification on optional AI summaries.",
    enforcedInPaths: [
      "src/lib/reports/custom-reports.ts",
      "src/lib/intelligence/insights.ts",
      "src/lib/exports/service.ts",
    ],
    verifiedByTests: [
      "tests/security/asvs-adversarial.test.ts",
      "tests/unit/custom-reports.test.ts",
      "tests/unit/insights.test.ts",
    ],
    status: "VERIFIED",
  },
];

export const PROVIDER_PRIVILEGE_MATRIX: readonly ProviderPrivilegeMatrixRow[] = [
  {
    providerKey: "google_analytics_4",
    displayName: "Google Analytics 4",
    authMechanism: "Google OAuth 2.0",
    requestedScopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    readOnlyEnforced: true,
    blockedMutationSurface:
      "Admin API configuration writes, property deletion, custom dimension writes",
    residualRiskNote: "Read-only aggregate traffic & engagement metrics only; zero PII export.",
  },
  {
    providerKey: "google_search_console",
    displayName: "Google Search Console",
    authMechanism: "Google OAuth 2.0",
    requestedScopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
    readOnlyEnforced: true,
    blockedMutationSurface: "Sitemap submission/deletion, site verification mutation",
    residualRiskNote: "Aggregate search clicks, impressions, CTR, and position by date/query/page.",
  },
  {
    providerKey: "google_cloud_billing",
    displayName: "Google Cloud Billing (BigQuery Export)",
    authMechanism: "Google OAuth 2.0 / Scoped BigQuery Read",
    requestedScopes: ["https://www.googleapis.com/auth/bigquery.readonly"],
    readOnlyEnforced: true,
    blockedMutationSurface: "DML/DDL queries, budget modifications, project shutdown, IAM edits",
    residualRiskNote:
      "Read-only dry-run byte-capped SQL on user-selected billing export tables only.",
  },
  {
    providerKey: "firebase",
    displayName: "Firebase / Cloud Monitoring",
    authMechanism: "Google OAuth 2.0",
    requestedScopes: ["https://www.googleapis.com/auth/monitoring.read"],
    readOnlyEnforced: true,
    blockedMutationSurface:
      "Firestore document reads/writes, Auth user management, Hosting deploys",
    residualRiskNote:
      "Aggregate time-series metrics only; zero end-user database or auth record access.",
  },
  {
    providerKey: "neon",
    displayName: "Neon Control Plane",
    authMechanism: "Scoped Neon API Key",
    requestedScopes: ["control-plane:read-only"],
    readOnlyEnforced: true,
    blockedMutationSurface: "Branch creation/deletion, SQL query execution, role password resets",
    residualRiskNote:
      "Control-plane GET allowlist only; zero direct SQL access to customer databases.",
  },
  {
    providerKey: "supabase",
    displayName: "Supabase Management API",
    authMechanism: "Read-Only PAT / OAuth",
    requestedScopes: ["projects:read", "analytics:read"],
    readOnlyEnforced: true,
    blockedMutationSurface:
      "SQL endpoint, Edge Function deploys, Auth user mutations, Storage writes",
    residualRiskNote:
      "Management metadata & aggregate health stats only; service_role keys rejected.",
  },
  {
    providerKey: "cloudflare",
    displayName: "Cloudflare Zone Analytics",
    authMechanism: "Scoped API Token",
    requestedScopes: ["Zone.Analytics:Read", "Account.Account Analytics:Read"],
    readOnlyEnforced: true,
    blockedMutationSurface: "DNS record edits, Firewall/WAF rules, Worker deployments, cache purge",
    residualRiskNote: "Read-only GraphQL query allowlist blocking any GraphQL mutation operations.",
  },
  {
    providerKey: "vercel",
    displayName: "Vercel Projects & FOCUS Billing",
    authMechanism: "Read-Only Bearer Token",
    requestedScopes: ["projects:read", "deployments:read", "billing:read"],
    readOnlyEnforced: true,
    blockedMutationSurface: "Deployments trigger/rollback, env var reads/writes, domain mutations",
    residualRiskNote:
      "Strictly GET allowlist on metadata and FOCUS 1.3 billing streams; env secrets blocked.",
  },
  {
    providerKey: "github",
    displayName: "GitHub App (Actions & Deployments)",
    authMechanism: "GitHub App Installation + Signed Webhooks",
    requestedScopes: ["metadata:read", "actions:read", "deployments:read"],
    readOnlyEnforced: true,
    blockedMutationSurface:
      "Source code (/contents, /git/blobs), secrets, workflow dispatch/rerun, merges",
    residualRiskNote:
      "Path denylist blocks source files, logs, and secrets; webhooks require valid HMAC-SHA256.",
  },
  {
    providerKey: "sentry",
    displayName: "Sentry Issues & Releases",
    authMechanism: "Scoped Read-Only Auth Token",
    requestedScopes: ["org:read", "project:read", "event:read"],
    readOnlyEnforced: true,
    blockedMutationSurface:
      "Issue resolution/assignment, project DSN rotation, alert rule mutation",
    residualRiskNote:
      "Redacts emails, IPs, cookies, Authorization/Bearer tokens, and JWTs before storage.",
  },
];

export const SECURITY_FINDINGS_REGISTER: readonly SecurityFindingRecord[] = [
  {
    id: "SEC-001",
    title: "Sentry Bearer token redaction ordering truncated marker label",
    severity: "MEDIUM",
    status: "REMEDIATED_AND_VERIFIED",
    affectedSurface: "src/lib/providers/sentry/http.ts",
    rootCause:
      "Header redaction regex matched 'Authorization: Bearer' before the Bearer token matcher ran.",
    remediation:
      "Reordered Bearer redaction ahead of generic header matching and extended Authorization matcher to consume full token payload.",
    regressionTest: "tests/security/asvs-adversarial.test.ts",
  },
  {
    id: "SEC-002",
    title: "Support intake DB URI redaction masked by generic secret scrubber",
    severity: "LOW",
    status: "REMEDIATED_AND_VERIFIED",
    affectedSurface: "src/lib/support/service.ts",
    rootCause:
      "Generic redactSensitiveText ran prior to explicit PostgreSQL/MySQL/MongoDB URI scrubbing.",
    remediation:
      "Applied explicit DB URI replacement ([REDACTED_DB_URI]) before redactSensitiveText across both subject and description.",
    regressionTest: "tests/integration/support-and-pricing.test.ts",
  },
  {
    id: "SEC-003",
    title: "GitHub webhook error classification aligned with unauthenticated boundary",
    severity: "LOW",
    status: "REMEDIATED_AND_VERIFIED",
    affectedSurface: "src/app/api/webhooks/github/route.ts",
    rootCause: "Canonical error constant used UNAUTHENTICATED rather than UNAUTHORIZED.",
    remediation:
      "Enforced HTTP 401 UNAUTHENTICATED response on invalid or missing X-Hub-Signature-256 signatures before JSON parsing.",
    regressionTest: "tests/security/asvs-adversarial.test.ts",
  },
];

/**
 * Evaluates internal security release gates truthfully without fabricating external
 * penetration-test sign-off or third-party compliance certifications.
 */
export function evaluateSecurityReleaseGate(
  findings: readonly SecurityFindingRecord[] = SECURITY_FINDINGS_REGISTER,
): SecurityReleaseGateEvaluation {
  const openCriticalCount = findings.filter(
    (f) => f.severity === "CRITICAL" && f.status === "OPEN",
  ).length;
  const openHighCount = findings.filter((f) => f.severity === "HIGH" && f.status === "OPEN").length;

  const blockingReasons: string[] = [];
  if (openCriticalCount > 0) {
    blockingReasons.push(`${openCriticalCount} open CRITICAL security finding(s) remain.`);
  }
  if (openHighCount > 0) {
    blockingReasons.push(`${openHighCount} open HIGH security finding(s) remain.`);
  }

  return {
    internalAuditPassed: blockingReasons.length === 0,
    openCriticalCount,
    openHighCount,
    externalIndependentPentestStatus: "PENDING_EXTERNAL_REVIEWER_SIGN_OFF",
    truthfulCertificationStatement:
      "Avenor follows OWASP ASVS 5.0 engineering controls and read-only least-privilege provider boundaries. Avenor does not currently claim SOC 2 Type II or ISO 27001 certification; independent external penetration-test sign-off is tracked as a pre-GA owner gate.",
    blockingReasons,
  };
}
