import { describe, expect, it } from "vitest";
import robots, { PRIVATE_DISALLOWED_PATHS } from "@/app/robots";
import sitemap, { PUBLIC_SITEMAP_PATHS } from "@/app/sitemap";
import {
  evaluateProductionGaReadiness,
  PUBLIC_PRODUCT_CLAIM_VERIFICATION_MATRIX,
} from "@/lib/ops/ga-checklist";
import { assertKillSwitchEnabled, evaluateKillSwitchState } from "@/lib/ops/kill-switches";

describe("THE-169 Production GA Readiness, Feature Kill Switches & Technical SEO", () => {
  it("enforces operational kill switches with emergency env override taking highest precedence", () => {
    const defaultOn = evaluateKillSwitchState("ai.narratives", null, {});
    expect(defaultOn.enabled).toBe(true);
    expect(() => assertKillSwitchEnabled(defaultOn)).not.toThrow();

    const dbPaused = evaluateKillSwitchState(
      "billing.checkout",
      { enabled: false, reason: "Lemon Squeezy webhook maintenance" },
      {},
    );
    expect(dbPaused.enabled).toBe(false);
    expect(dbPaused.source).toBe("DATABASE_OVERRIDE");
    expect(() => assertKillSwitchEnabled(dbPaused)).toThrow(/temporarily paused/i);

    // Emergency env override pauses even when DB record says enabled=true
    const envOverride = evaluateKillSwitchState(
      "ingestion.global",
      { enabled: true },
      { AVENOR_KILL_SWITCH_INGESTION_GLOBAL: "false" },
    );
    expect(envOverride.enabled).toBe(false);
    expect(envOverride.source).toBe("ENV_EMERGENCY_OVERRIDE");
    expect(() => assertKillSwitchEnabled(envOverride)).toThrow(/emergency environment variable/i);
  });

  it("evaluates engineering GA gates as passing while truthfully separating pending owner/live-credential gates", () => {
    const report = evaluateProductionGaReadiness();
    expect(report.engineeringGatesPassed).toBe(true);
    expect(report.verifiedCoreTableCount).toBeGreaterThanOrEqual(56);
    expect(report.registeredReadOnlyAdapterCount).toBeGreaterThanOrEqual(11);
    expect(report.pendingOwnerGateCount).toBe(3);
    expect(PUBLIC_PRODUCT_CLAIM_VERIFICATION_MATRIX.every((c) => c.truthful)).toBe(true);
  });

  it("publishes only public routes in sitemap.xml and disallows all private/API routes in robots.txt", () => {
    const entries = sitemap();
    expect(entries.length).toBe(PUBLIC_SITEMAP_PATHS.length);
    for (const entry of entries) {
      for (const privatePrefix of PRIVATE_DISALLOWED_PATHS) {
        expect(entry.url.includes(privatePrefix)).toBe(false);
      }
    }

    const robotsConfig = robots();
    const firstRule = Array.isArray(robotsConfig.rules)
      ? robotsConfig.rules[0]
      : robotsConfig.rules;
    expect(firstRule?.disallow).toContain("/api/");
    expect(firstRule?.disallow).toContain("/dashboard");
    expect(firstRule?.disallow).toContain("/billing");
    expect(robotsConfig.sitemap).toMatch(/\/sitemap\.xml$/);
  });
});
