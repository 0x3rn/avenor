import path from "node:path";
import { expect, test } from "@playwright/test";

const ARTIFACT_DIR = "C:/Users/User/.gemini/antigravity/brain/8794b1c7-b8ca-424c-8f1a-1cd01113be75";

test.describe("Milestone 02 — Read-Only Provider Framework & Security E2E Journey (THE-120 / THE-121)", () => {
  test("completes full provider catalog, 7-step PKCE connection wizard, resource-to-project/environment mapping, health diagnostics, token refresh, multi-viewport checks, and disconnect", async ({
    page,
  }) => {
    test.setTimeout(240_000);

    const uniqueSuffix = Date.now().toString(36);
    const userEmail = `security.${uniqueSuffix}@avenor-e2e.dev`;
    const userPassword = "AvenorStrongPassword!2026";
    const orgName = `Avenor Security Org ${uniqueSuffix}`;
    const workspaceName = `Signal Atlas ${uniqueSuffix}`;

    // 1. Sign up and create first logical project during onboarding
    await page.goto("/signup");
    await page.locator("#signup-name").fill("Marcus Sterling");
    await page.locator("#signup-email").fill(userEmail);
    await page.locator("#signup-password").fill(userPassword);
    await page.locator("#signup-organization").fill(orgName);
    await page.locator("#signup-workspace").fill(workspaceName);
    await page
      .getByRole("button", { name: /Create workspace & start 14-day Pro preview/i })
      .click();

    await expect(page).toHaveURL(/\/onboarding$/);
    await page.getByTestId("onboarding-project-name-input").fill("Avenor Cloud Console");
    await page.getByTestId("onboarding-project-domain-input").fill("https://console.avenor.dev");
    await page.getByTestId("onboarding-create-project-submit").click();
    await expect(page.getByTestId("onboarding-project-list")).toContainText("Avenor Cloud Console");

    await page.getByTestId("complete-onboarding-button").click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // 2. Navigate to /connections and verify Provider Catalog & truthful availability badges
    await page.goto("/connections");
    await expect(page.getByTestId("connections-readiness-page")).toBeVisible();
    await expect(page.getByTestId("provider-catalog-section")).toBeVisible();

    // Planned providers are non-clickable badges, not fake buttons
    await expect(page.getByTestId("planned-provider-badge-neon")).toContainText("Planned • M07");
    await expect(page.getByTestId("planned-provider-badge-gcp-billing")).toContainText(
      "Planned • M06",
    );

    // Filter catalog by category and search
    await page.getByTestId("catalog-filter-analytics").click();
    await expect(page.getByTestId("catalog-card-ga4")).toBeVisible();
    await page.getByTestId("catalog-filter-all").click();

    // 3. Launch 7-Step Connection Wizard for avenor-sandbox
    await page.getByTestId("connect-provider-avenor-sandbox").click();
    await expect(page.getByTestId("connection-wizard-panel")).toBeVisible();

    // Step 1: Select Provider & customize label
    await expect(page.getByTestId("wizard-step-1")).toBeVisible();
    await page.getByTestId("wizard-display-name-input").fill("Avenor Sandbox Production Stream");
    await page.getByTestId("wizard-next-to-step-2").click();

    // Step 2: Permissions & Data — verify Read-Only Guarantee Callout & live Capability Matrix evaluation
    await expect(page.getByTestId("wizard-step-2")).toBeVisible();
    await expect(page.getByTestId("read-only-guarantee-callout")).toBeVisible();
    await expect(page.getByTestId("capability-matrix-list")).toBeVisible();

    // Toggle secondary scope off to verify MISSING_PERMISSION badge, then re-enable
    const metricsScopeCheckbox = page.getByTestId("wizard-scope-checkbox-sandbox.metrics.readonly");
    await metricsScopeCheckbox.uncheck();
    await expect(
      page
        .getByTestId("capability-row-analytics_sessions")
        .getByTestId("capability-badge-missing_permission"),
    ).toBeVisible();
    await metricsScopeCheckbox.check();

    // Proceed to Step 3 (initiates PKCE S256 + CSRF state)
    await page.getByTestId("wizard-initiate-oauth-button").click();
    await expect(page.getByTestId("wizard-step-3")).toBeVisible();

    // First simulate consent denial -> verify error banner, then re-initiate & authorize
    await page.getByTestId("wizard-simulate-consent-denied").click();
    await expect(page.getByTestId("wizard-error-banner")).toContainText("declined");

    // Re-initiate from Step 2 and authorize
    await page.getByTestId("close-wizard-button").click();
    await page.getByTestId("connect-provider-avenor-sandbox").click();
    await page.getByTestId("wizard-display-name-input").fill("Avenor Sandbox Production Stream");
    await page.getByTestId("wizard-next-to-step-2").click();
    await page.getByTestId("wizard-initiate-oauth-button").click();
    await expect(page.getByTestId("wizard-step-3")).toBeVisible();
    await page.getByTestId("wizard-complete-oauth-consent").click();

    // Step 4: Discover Resources
    await expect(page.getByTestId("wizard-step-4")).toBeVisible();
    await expect(page.getByTestId("wizard-discovered-resources-list")).toContainText(
      "sbx_stream_prod_web",
    );
    await page.getByTestId("wizard-next-to-step-5").click();

    // Step 5: Map to Logical Project & Environment
    await expect(page.getByTestId("wizard-step-5")).toBeVisible();
    await page.getByTestId("wizard-create-mapping-button").click();
    await expect(page.getByTestId("wizard-created-mappings-list")).toContainText(
      "Avenor Cloud Console",
    );
    await page.getByTestId("wizard-next-to-step-6").click();

    // Step 6: Validate Connection Health
    await expect(page.getByTestId("wizard-step-6")).toBeVisible();
    await page.getByTestId("wizard-run-validation-button").click();
    await expect(page.getByTestId("wizard-validation-result")).toContainText("Healthy");
    await page.getByTestId("wizard-next-to-step-7").click();

    // Step 7: Complete & open Connection Inspector Drawer
    await expect(page.getByTestId("wizard-step-7")).toBeVisible();
    await page.getByTestId("wizard-finish-button").click();

    // 4. Verify Connection Detail & Health Drawer
    const drawer = page.getByTestId("connection-detail-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("Vault Status: ACTIVE (Key v1)");

    // Ensure no raw secrets appear anywhere in the DOM
    const pageContent = await page.content();
    expect(pageContent).not.toContain("avn_ro_access_");
    expect(pageContent).not.toContain("avn_ro_refresh_");

    // Simulate Rate Limited (429) health check and then restore Healthy
    await page.getByTestId("drawer-diagnostic-scenario-select").selectOption("rate_limited");
    await page.getByTestId("drawer-validate-health-button").click();
    await expect(page.getByTestId("drawer-feedback-banner")).toContainText("RATE_LIMITED");

    await page.getByTestId("drawer-diagnostic-scenario-select").selectOption("healthy");
    await page.getByTestId("drawer-validate-health-button").click();
    await expect(page.getByTestId("drawer-feedback-banner")).toContainText("HEALTHY");

    // Refresh OAuth token in vault
    await page.getByTestId("drawer-refresh-token-button").click();
    await expect(page.getByTestId("drawer-feedback-banner")).toContainText(
      "OAuth access token rotated and re-encrypted in vault.",
    );

    // Verify Connection Audit Trail
    const auditTrail = page.getByTestId("connection-audit-trail");
    await expect(auditTrail).toContainText("connection.oauth_completed");
    await expect(auditTrail).toContainText("connection.resources_discovered");
    await expect(auditTrail).toContainText("connection.resource_mapped");
    await expect(auditTrail).toContainText("connection.health_validated");
    await expect(auditTrail).toContainText("connection.token_refreshed");

    // 5. Multi-Viewport Responsive Layout Verification (390x844, 768x1024, 1200x1600, 1440x900)
    const viewports = [
      { width: 390, height: 844, label: "390x844-mobile" },
      { width: 768, height: 1024, label: "768x1024-tablet" },
      { width: 1200, height: 1600, label: "1200x1600-desktop-portrait" },
      { width: 1440, height: 900, label: "1440x900-desktop-wide" },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(150);

      const overflowCheck = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(overflowCheck.scrollWidth).toBeLessThanOrEqual(overflowCheck.innerWidth);

      await page.screenshot({
        path: path.join(ARTIFACT_DIR, `milestone-02-${vp.label}.png`),
        fullPage: false,
      });
    }

    // 6. Unmap resource and then Disconnect provider connection
    await page.setViewportSize({ width: 1440, height: 900 });
    const unmapBtn = drawer.locator('[data-testid^="unmap-resource-"]').first();
    await unmapBtn.click();
    await expect(page.getByTestId("drawer-no-mappings")).toBeVisible();

    await page.getByTestId("drawer-disconnect-button").click();
    await expect(page.getByTestId("drawer-feedback-banner")).toContainText(
      "Connection disconnected, vault credentials revoked",
    );
    await expect(drawer).toContainText("Vault Status: REVOKED");
  });
});
