export type ReleaseCheckStatus = "PASS" | "WARN" | "FAIL";

export interface ReleaseReadinessCheckItem {
  readonly key: string;
  readonly category: "SECURITY" | "DATABASE" | "OAUTH" | "DELIVERY" | "RECOVERY";
  readonly title: string;
  readonly status: ReleaseCheckStatus;
  readonly detail: string;
}

export interface ReleaseReadinessReport {
  readonly environment: string;
  readonly evaluatedAtIso: string;
  readonly readyForPrivateMvpProduction: boolean;
  readonly counts: {
    readonly pass: number;
    readonly warn: number;
    readonly fail: number;
  };
  readonly checks: readonly ReleaseReadinessCheckItem[];
}

export interface RecoveryRunbookSection {
  readonly id: string;
  readonly title: string;
  readonly steps: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Evaluates private MVP deployment readiness without ever echoing secret values.
 */
export function evaluatePrivateMvpReleaseReadiness(
  rawEnv: Record<string, string | undefined> = process.env,
): ReleaseReadinessReport {
  const envName = (rawEnv.APP_ENV ?? rawEnv.NODE_ENV ?? "development").trim().toLowerCase();
  const isProd = envName === "production";
  const checks: ReleaseReadinessCheckItem[] = [];

  // 1. Database URL presence & TLS
  const dbUrl = (rawEnv.DATABASE_URL ?? "").trim();
  checks.push({
    key: "database.url_tls",
    category: "DATABASE",
    title: "Primary PostgreSQL URL & TLS Mode",
    status: !dbUrl ? "FAIL" : isProd && !dbUrl.includes("sslmode=require") ? "WARN" : "PASS",
    detail: !dbUrl
      ? "DATABASE_URL is not configured."
      : dbUrl.includes("sslmode=require")
        ? "DATABASE_URL is configured with TLS (`sslmode=require`)."
        : "DATABASE_URL is configured; ensure TLS (`sslmode=require`) is enabled in production.",
  });

  // 2. Auth session signing secret entropy
  const authSecret = (rawEnv.BETTER_AUTH_SECRET ?? "").trim();
  checks.push({
    key: "security.auth_secret",
    category: "SECURITY",
    title: "Authentication Session Secret Entropy",
    status: authSecret.length >= 32 ? "PASS" : "FAIL",
    detail:
      authSecret.length >= 32
        ? "BETTER_AUTH_SECRET meets minimum 32-character entropy requirement."
        : "BETTER_AUTH_SECRET is missing or shorter than 32 characters.",
  });

  // 3. Vault AES-256-GCM Master Key (64 hex chars = 32 bytes)
  const masterKey = (rawEnv.AVENOR_ENCRYPTION_MASTER_KEY ?? "").trim();
  const masterKeyValid = /^[0-9a-fA-F]{64}$/.test(masterKey);
  checks.push({
    key: "security.vault_master_key",
    category: "SECURITY",
    title: "Credential Vault AES-256-GCM Master Key",
    status: masterKeyValid ? "PASS" : "FAIL",
    detail: masterKeyValid
      ? "AVENOR_ENCRYPTION_MASTER_KEY is a valid 256-bit (64-hex) key."
      : "AVENOR_ENCRYPTION_MASTER_KEY must be a 64-character hex string (32 random bytes).",
  });

  // 4. Job signing secret
  const jobSecret = (rawEnv.AVENOR_JOB_SIGNING_SECRET ?? "").trim();
  checks.push({
    key: "security.job_signing_secret",
    category: "SECURITY",
    title: "Background Job HMAC Signing Secret",
    status: jobSecret.length >= 24 ? "PASS" : isProd ? "FAIL" : "WARN",
    detail:
      jobSecret.length >= 24
        ? "AVENOR_JOB_SIGNING_SECRET is configured for signed worker execution."
        : "AVENOR_JOB_SIGNING_SECRET is missing or short; required for production background ingestion.",
  });

  // 5. Private MVP Access Mode
  const accessMode = (rawEnv.AVENOR_PRIVATE_ACCESS_MODE ?? "open").trim().toLowerCase();
  const allowedEmails = (rawEnv.AVENOR_ALLOWED_SIGNUP_EMAILS ?? "").trim();
  const privateAccessSecure = accessMode === "allowlist" || accessMode === "invite_only";
  checks.push({
    key: "security.private_access_gate",
    category: "SECURITY",
    title: "Server-Side Private MVP Access Gate",
    status: privateAccessSecure ? "PASS" : isProd ? "FAIL" : "WARN",
    detail: privateAccessSecure
      ? `Private access mode "${accessMode}" active${allowedEmails ? " with allowlist configured" : " (invite approval table active)"}.`
      : `AVENOR_PRIVATE_ACCESS_MODE is "${accessMode}"; set to "allowlist" or "invite_only" before private MVP production deployment.`,
  });

  // 6. Public App URL (HTTPS, no localhost in production)
  const appUrl = (rawEnv.NEXT_PUBLIC_APP_URL ?? rawEnv.BETTER_AUTH_URL ?? "").trim();
  let appUrlStatus: ReleaseCheckStatus = "PASS";
  let appUrlDetail = "Public app origin configured.";
  if (!appUrl) {
    appUrlStatus = isProd ? "FAIL" : "WARN";
    appUrlDetail = "NEXT_PUBLIC_APP_URL is not set.";
  } else {
    try {
      const parsed = new URL(appUrl);
      if (isProd && (parsed.protocol !== "https:" || parsed.hostname === "localhost")) {
        appUrlStatus = "FAIL";
        appUrlDetail =
          "Production NEXT_PUBLIC_APP_URL must use HTTPS and never point to localhost.";
      } else {
        appUrlDetail = `App origin verified (${parsed.origin}).`;
      }
    } catch {
      appUrlStatus = "FAIL";
      appUrlDetail = "NEXT_PUBLIC_APP_URL is not a valid URL.";
    }
  }
  checks.push({
    key: "delivery.public_app_url",
    category: "DELIVERY",
    title: "Deployed Origin & Notification Deep-Link URL",
    status: appUrlStatus,
    detail: appUrlDetail,
  });

  // 7. Google OAuth credentials (live provider verification)
  const hasGoogleOAuth = Boolean(
    (rawEnv.GOOGLE_CLIENT_ID ?? "").trim() && (rawEnv.GOOGLE_CLIENT_SECRET ?? "").trim(),
  );
  checks.push({
    key: "oauth.google_credentials",
    category: "OAUTH",
    title: "Google OAuth 2.0 Read-Only Client Configuration",
    status: hasGoogleOAuth ? "PASS" : "WARN",
    detail: hasGoogleOAuth
      ? "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are configured for GA4, GSC, Cloud Billing, and Cloud Monitoring."
      : "Google OAuth client variables are not configured; live Google connectors operate in deterministic sandbox mode until supplied.",
  });

  // 8. Transactional Email Provider (Resend)
  const hasResend = Boolean((rawEnv.RESEND_API_KEY ?? "").trim());
  checks.push({
    key: "delivery.transactional_email",
    category: "DELIVERY",
    title: "Transactional Alert Email Transport",
    status: hasResend ? "PASS" : "WARN",
    detail: hasResend
      ? "RESEND_API_KEY is configured for outbound alert emails."
      : "RESEND_API_KEY is not configured; email notifications use deterministic sandbox transport until supplied.",
  });

  const pass = checks.filter((c) => c.status === "PASS").length;
  const warn = checks.filter((c) => c.status === "WARN").length;
  const fail = checks.filter((c) => c.status === "FAIL").length;

  return {
    environment: envName,
    evaluatedAtIso: new Date().toISOString(),
    readyForPrivateMvpProduction: fail === 0,
    counts: { pass, warn, fail },
    checks,
  };
}

export function buildRecoveryAndRollbackRunbook(): readonly RecoveryRunbookSection[] {
  return [
    {
      id: "neon-pitr-restore",
      title: "Neon PostgreSQL Point-in-Time Branch Restore",
      steps: [
        "Identify the target UTC timestamp prior to accidental deletion or schema corruption.",
        "Create an isolated Neon restore branch (`neon branches create --parent main --timestamp <ISO_UTC> --name restore-verify-<date>`).",
        "Validate row integrity across users, workspaces, logical_projects, provider_connections, resource_mappings, and metric_observations on the restore branch.",
        "Verify `pnpm db:status` reports zero pending or missing tables and verify encrypted credentials decrypt cleanly using the preserved `AVENOR_ENCRYPTION_MASTER_KEY`.",
        "Switch production `DATABASE_URL` to the verified branch only after smoke tests pass, and resume scheduled ingestion workers.",
      ],
      warnings: [
        "Never run destructive reset or truncate commands against the production branch.",
        "Database backups alone cannot decrypt `provider_credentials` without matching `AVENOR_ENCRYPTION_MASTER_KEY` key versions.",
      ],
    },
    {
      id: "migration-and-app-rollback",
      title: "Application & Migration Rollback Protocol",
      steps: [
        "For application-only regressions, immediately promote the previous known-good deployment artifact.",
        "For schema changes, follow expand/migrate/contract so older builds remain compatible during rollout.",
        "If an ingestion worker or provider triggers HTTP 429 quota storms, pause the scheduler trigger without deleting historical `metric_observations`.",
      ],
      warnings: [
        "Never assume an automatic down-migration is lossless; prefer forward-fix or verified branch restore.",
      ],
    },
  ];
}
