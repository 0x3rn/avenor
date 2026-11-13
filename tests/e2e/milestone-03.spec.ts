import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

const ARTIFACT_DIR =
  process.env.PLAYWRIGHT_ARTIFACT_DIR ??
  "C:/Users/divin/.gemini/antigravity/brain/b0fbef27-67c6-4272-8716-c2bb79f3fd59";
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

async function assertNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
    };
  });
  expect(
    overflow.scrollWidth,
    `Horizontal overflow detected on ${label}: scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth}`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

async function connectAndMapProvider(page: Page, providerKey: "ga4" | "gsc", displayName: string) {
  await page.getByTestId(`connect-provider-${providerKey}`).click();
  await expect(page.getByTestId("wizard-step-1")).toBeVisible();
  await page.getByTestId("wizard-display-name-input").fill(displayName);
  await page.getByTestId("wizard-next-to-step-2").click();

  await expect(page.getByTestId("wizard-step-2")).toBeVisible();
  await page.getByTestId("wizard-initiate-oauth-button").click();

  await expect(page.getByTestId("wizard-step-3")).toBeVisible();
  await page.getByTestId("wizard-complete-oauth-consent").click();

  await expect(page.getByTestId("wizard-step-4")).toBeVisible();
  await expect(page.getByTestId("wizard-discovered-resources-list")).toBeVisible();
  await page.getByTestId("wizard-next-to-step-5").click();

  await expect(page.getByTestId("wizard-step-5")).toBeVisible();
  await page.getByTestId("wizard-create-mapping-button").click();
  await expect(page.getByTestId("wizard-created-mappings-list")).toBeVisible();
  await page.getByTestId("wizard-next-to-step-6").click();

  await expect(page.getByTestId("wizard-step-6")).toBeVisible();
  await page.getByTestId("wizard-run-validation-button").click();
  await expect(page.getByTestId("wizard-validation-result")).toBeVisible();
  await page.getByTestId("wizard-next-to-step-7").click();

  await expect(page.getByTestId("wizard-step-7")).toBeVisible();
  await page.getByTestId("wizard-finish-button").click();
  await expect(page.getByTestId(`workspace-connection-card-${providerKey}`)).toBeVisible();
}

test.describe("Milestone 03 — GA4 & Search Console Reporting E2E (THE-127)", () => {
  test("verifies unconnected honesty, connects & maps GA4 + GSC, validates Audience & Search reports, chart/table toggles, reconciliation, and responsive viewports", async ({
    page,
  }) => {
    test.setTimeout(240_000);

    const uniqueSuffix = Date.now().toString(36);
    const userEmail = `m03.${uniqueSuffix}@avenor-e2e.dev`;
    const userPassword = "AvenorStrongPassword!2026";
    const orgName = `Avenor M03 ${uniqueSuffix}`;
    const workspaceName = `Growth Analytics ${uniqueSuffix}`;

    // 1. Sign up and create primary logical product in onboarding
    await page.goto("/signup");
    await page.locator("#signup-name").fill("Grace Hopper");
    await page.locator("#signup-email").fill(userEmail);
    await page.locator("#signup-password").fill(userPassword);
    await page.locator("#signup-organization").fill(orgName);
    await page.locator("#signup-workspace").fill(workspaceName);
    await page
      .getByRole("button", { name: /Create workspace & start 14-day Pro preview/i })
      .click();

    await expect(page).toHaveURL(/\/onboarding$/);
    await page.getByTestId("onboarding-project-name-input").fill("Avenor Atlas Web");
    await page.getByTestId("onboarding-project-domain-input").fill("https://atlas.avenor.dev");
    await page.getByTestId("onboarding-create-project-submit").click();
    await expect(page.getByTestId("onboarding-project-list")).toContainText("Avenor Atlas Web");
    await page.getByTestId("complete-onboarding-button").click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // 2. Verify honest blocked / unconnected states before GA4 & GSC are mapped
    await page.goto("/audience");
    await expect(page.getByTestId("audience-traffic-report-page")).toBeVisible();
    await expect(page.getByTestId("ga4-blocked-state")).toBeVisible();
    await expect(page.getByTestId("ga4-kpi-grid")).toHaveCount(0);

    await page.goto("/search");
    await expect(page.getByTestId("search-visibility-report-page")).toBeVisible();
    await expect(page.getByTestId("gsc-blocked-state")).toBeVisible();
    await expect(page.getByTestId("gsc-kpi-grid")).toHaveCount(0);

    // 3. Connect GA4 and Search Console read-only via PKCE OAuth wizard and map both to the product
    await page.goto("/connections");
    await expect(page.getByTestId("connections-readiness-page")).toBeVisible();
    await connectAndMapProvider(page, "ga4", "GA4 Sandbox Property");
    await connectAndMapProvider(page, "gsc", "Search Console Sandbox Property");

    // 4. Open logical project detail and navigate into project-scoped Audience report
    await page.goto("/projects");
    await page.getByTestId("manage-project-avenor-atlas-web").click();
    await expect(page.getByTestId("project-detail-view")).toBeVisible();
    await page.getByTestId("project-open-audience-report").click();
    await expect(page).toHaveURL(/\/projects\/prj_[^/]+\/audience/);

    await expect(page.getByTestId("ga4-kpi-grid")).toBeVisible();
    await expect(page.getByTestId("ga4-realtime-panel")).toBeVisible();
    await expect(page.getByTestId("ga4-realtime-active-users")).toBeVisible();

    // Verify chart <-> accessible table toggle
    await expect(page.getByTestId("trend-svg-panel-ga4-trend")).toBeVisible();
    await page.getByTestId("toggle-chart-table-ga4-trend").click();
    await expect(page.getByTestId("trend-table-panel-ga4-trend")).toBeVisible();
    await page.getByTestId("toggle-chart-table-ga4-trend").click();
    await expect(page.getByTestId("trend-svg-panel-ga4-trend")).toBeVisible();

    // Verify preset change (7d) & breakdown tab switching
    await page.getByTestId("ga4-preset-7d").click();
    await expect(page.getByTestId("ga4-refresh-button")).toHaveText("Refresh");
    await page.getByRole("tab", { name: /Landing Pages/i }).click();
    await expect(page.getByTestId("ga4-breakdown-card")).toBeVisible();

    await page.setViewportSize({ width: 1440, height: 900 });
    await assertNoHorizontalOverflow(page, "project audience 1440x900");
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, "m03-audience-1440.png"),
      fullPage: true,
    });

    // 5. Navigate to project-scoped Search Console report and verify SEO metrics + reconciliation
    await page.getByRole("link", { name: /Search Visibility →/i }).click();
    await expect(page).toHaveURL(/\/projects\/prj_[^/]+\/search/);
    await expect(page.getByTestId("gsc-kpi-grid")).toBeVisible();
    await expect(page.getByTestId("gsc-canonical-site")).toBeVisible();
    await expect(page.getByTestId("ga4-gsc-reconciliation-panel")).toBeVisible();
    await expect(page.getByTestId("ga4-gsc-reconciliation-panel")).toContainText(
      "GSC Clicks and GA4 Sessions measure different funnel events",
    );

    // Accessible Search Trend table toggle
    await page.getByTestId("toggle-chart-table-gsc-trend").click();
    await expect(page.getByTestId("trend-table-panel-gsc-trend")).toBeVisible();
    await page.getByTestId("toggle-chart-table-gsc-trend").click();

    // Switch searchType to DISCOVER and confirm query filter disables cleanly
    await page.getByTestId("gsc-search-type-select").selectOption("DISCOVER");
    await expect(page.getByTestId("gsc-query-filter-input")).toBeDisabled();
    await page.getByTestId("gsc-search-type-select").selectOption("WEB");
    await expect(page.getByTestId("gsc-query-filter-input")).toBeEnabled();

    await page.setViewportSize({ width: 1440, height: 900 });
    await assertNoHorizontalOverflow(page, "project search 1440x900");
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, "m03-search-1440.png"),
      fullPage: true,
    });

    // 6. Responsive viewports check across 1200x1600, 768x1024, and 390x844
    await page.setViewportSize({ width: 1200, height: 1600 });
    await assertNoHorizontalOverflow(page, "search 1200x1600");

    await page.setViewportSize({ width: 768, height: 1024 });
    await assertNoHorizontalOverflow(page, "search 768x1024");

    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoHorizontalOverflow(page, "search 390x844");
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, "m03-search-mobile-390.png"),
      fullPage: false,
    });

    await page.goto("/audience");
    await expect(page.getByTestId("ga4-kpi-grid")).toBeVisible();
    await assertNoHorizontalOverflow(page, "audience 390x844");
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, "m03-audience-mobile-390.png"),
      fullPage: false,
    });
  });
});
