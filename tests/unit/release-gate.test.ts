import { assertNonProductionDestructiveAction } from "@avenor/config";
import { validateDatabaseSchemaFiles } from "@avenor/database";
import { assertReadOnlyAdapterContract } from "@avenor/types";
import { describe, expect, it } from "vitest";
import {
  buildRecoveryAndRollbackRunbook,
  evaluatePrivateMvpReleaseReadiness,
} from "@/lib/ops/release-readiness";
import { listRegisteredProviderAdapters } from "@/lib/providers";

describe("THE-147: Private MVP Security, Schema & Release Readiness Gate", () => {
  it("passes release readiness with valid production configuration and never leaks secret values in output", () => {
    const fakeMasterKey = "a".repeat(64);
    const fakeAuthSecret = "super-secret-production-auth-key-32chars-minimum";
    const report = evaluatePrivateMvpReleaseReadiness({
      APP_ENV: "production",
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:secret@ep-prod.neon.tech/neondb?sslmode=require",
      BETTER_AUTH_SECRET: fakeAuthSecret,
      AVENOR_ENCRYPTION_MASTER_KEY: fakeMasterKey,
      AVENOR_JOB_SIGNING_SECRET: "job-signing-secret-24-chars-min",
      AVENOR_PRIVATE_ACCESS_MODE: "allowlist",
      AVENOR_ALLOWED_SIGNUP_EMAILS: "owner@avenor.corstack.dev",
      NEXT_PUBLIC_APP_URL: "https://avenor.corstack.dev",
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
      RESEND_API_KEY: "re_live_123456",
    });

    expect(report.readyForPrivateMvpProduction).toBe(true);
    expect(report.counts.fail).toBe(0);

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(fakeMasterKey);
    expect(serialized).not.toContain(fakeAuthSecret);
    expect(serialized).not.toContain("re_live_123456");
    expect(serialized).not.toContain("google-client-secret");
  });

  it("blocks production readiness when private access is open, master key is invalid, or URL points to localhost", () => {
    const badReport = evaluatePrivateMvpReleaseReadiness({
      APP_ENV: "production",
      NODE_ENV: "production",
      DATABASE_URL: "",
      BETTER_AUTH_SECRET: "short",
      AVENOR_ENCRYPTION_MASTER_KEY: "not-hex",
      AVENOR_PRIVATE_ACCESS_MODE: "open",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    });

    expect(badReport.readyForPrivateMvpProduction).toBe(false);
    expect(badReport.counts.fail).toBeGreaterThanOrEqual(5);
  });

  it("verifies database schema synchronization (32 core tables), read-only contract across all adapters, production destructive-action block, and recovery runbook", () => {
    const schemaReport = validateDatabaseSchemaFiles();
    expect(schemaReport.valid).toBe(true);
    expect(schemaReport.verifiedTables.length).toBeGreaterThanOrEqual(32);

    const adapters = listRegisteredProviderAdapters();
    expect(adapters.length).toBeGreaterThanOrEqual(11);
    for (const adapter of adapters) {
      expect(() => assertReadOnlyAdapterContract(adapter)).not.toThrow();
    }

    expect(() =>
      assertNonProductionDestructiveAction({ NODE_ENV: "production" }, "testReset"),
    ).toThrow();

    const runbook = buildRecoveryAndRollbackRunbook();
    expect(runbook.length).toBeGreaterThanOrEqual(2);
    expect(runbook[0]?.steps.length).toBeGreaterThanOrEqual(4);
  });
});
