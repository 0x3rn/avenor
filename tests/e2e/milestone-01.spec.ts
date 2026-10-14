import path from "node:path";
import { expect, test } from "@playwright/test";

const ARTIFACT_DIR = "C:/Users/User/.gemini/antigravity/brain/8794b1c7-b8ca-424c-8f1a-1cd01113be75";

test.describe("Milestone 01 — Signal Atlas E2E Journey & Multi-Viewport Verification (THE-116)", () => {
  test("completes full user journey: public home -> signup -> onboarding -> project & environment management -> settings -> multi-workspace -> archive/restore -> signout/signin + responsive viewports", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const uniqueSuffix = Date.now().toString(36);
    const userEmail = `founder.${uniqueSuffix}@avenor-e2e.dev`;
    const userPassword = "AvenorStrongPassword!2026";
    const orgName = `Avenor Labs ${uniqueSuffix}`;
    const primaryWorkspaceName = `Core Product ${uniqueSuffix}`;
    const secondaryWorkspaceName = `EU Region ${uniqueSuffix}`;

    // 1. Unauthenticated protected route access redirects to /login
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);

    // 2. Public Homepage (/) and Signal Atlas architecture verification
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: /Every signal behind every product you run\. Organized by product, not provider\./i,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: /Think in products and environments—not in disconnected vendor accounts\./i,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: /Architecturally read-only\. Zero write paths to your infrastructure\./i,
      }),
    ).toBeVisible();

    // 3. Verify Forgot Password, Verify Email, and /register -> /signup redirect
    await page.goto("/forgot-password");
    await expect(page.getByRole("heading", { name: /Reset your password/i })).toBeVisible();

    await page.goto("/verify-email");
    await expect(page.getByRole("heading", { name: /Verify your email/i })).toBeVisible();

    await page.goto("/register");
    await expect(page).toHaveURL(/\/signup$/);

    // 4. Sign up and provision Organization + Workspace + OWNER membership
    await page.locator("#signup-name").fill("Elena Vance");
    await page.locator("#signup-email").fill(userEmail);
    await page.locator("#signup-password").fill(userPassword);
    await page.locator("#signup-organization").fill(orgName);
    await page.locator("#signup-workspace").fill(primaryWorkspaceName);
    await page
      .getByRole("button", { name: /Create workspace & start 14-day Pro preview/i })
      .click();

    // 5. Guided Onboarding (/onboarding)
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole("heading", { name: /Signal Atlas Guided Setup/i })).toBeVisible();

    // Create first logical project in Onboarding Step 02 (with PRODUCTION + STAGING, leaving DEVELOPMENT for project detail)
    await page.getByTestId("onboarding-project-name-input").fill("Avenor Web App");
    await expect(page.getByTestId("onboarding-project-slug-input")).toHaveValue("avenor-web-app");
    await page.getByTestId("onboarding-project-domain-input").fill("https://app.avenor.dev");
    await page.getByTestId("onboarding-env-development-checkbox").uncheck();
    await page
      .getByTestId("onboarding-project-description-input")
      .fill("Primary customer-facing web application.");
    await page.getByTestId("onboarding-create-project-submit").click();

    await expect(page.getByTestId("onboarding-project-list")).toContainText("Avenor Web App");

    // Complete onboarding and navigate to Portfolio Overview (/dashboard)
    await page.getByTestId("complete-onboarding-button").click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // 6. Portfolio Overview (/dashboard) — Real DB counts + Honest Unconnected States (never fake 0)
    await expect(page.getByRole("heading", { name: /Portfolio Signal Atlas/i })).toBeVisible();
    await expect(page.getByTestId("dashboard-projects-list")).toContainText("Avenor Web App");
    await expect(page.getByTestId("metric-card-non-numeric-state").first()).toContainText(
      "Not connected",
    );

    // 7. Navigate to Logical Project Detail (/projects/[projectId])
    await page.getByTestId("inspect-project-avenor-web-app").click();
    await expect(page).toHaveURL(/\/projects\/prj_/);
    await expect(page.getByTestId("project-detail-view")).toBeVisible();
    await expect(page.getByTestId("environment-row-PRODUCTION")).toBeVisible();
    await expect(page.getByTestId("environment-row-STAGING")).toBeVisible();

    // Switch Environment Lens to STAGING
    const stagingLensTab = page.getByRole("tab", { name: "STAGING" });
    await stagingLensTab.click();
    await expect(stagingLensTab).toHaveAttribute("aria-selected", "true");

    // Add DEVELOPMENT environment on Project Detail page
    await page.getByTestId("detail-env-kind-select").selectOption("DEVELOPMENT");
    await page.getByTestId("detail-env-domain-input").fill("https://dev.avenor.dev");
    await page.getByTestId("detail-save-env-button").click();

    await expect(page.getByTestId("environment-feedback")).toContainText(
      "DEVELOPMENT environment saved.",
    );
    await expect(page.getByTestId("environment-row-DEVELOPMENT")).toBeVisible();

    // Edit project metadata (name + domain)
    await page.getByTestId("edit-project-name-input").fill("Avenor Flagship Platform");
    await page.getByTestId("edit-project-domain-input").fill("https://platform.avenor.dev");
    await page.getByTestId("edit-project-submit").click();
    await expect(page.getByTestId("edit-project-feedback")).toContainText(
      "Product metadata saved.",
    );
    await expect(page.getByRole("heading", { name: "Avenor Flagship Platform" })).toBeVisible();

    // 8. Workspace Governance Settings (/settings)
    await page.goto("/settings");
    await expect(page.getByTestId("workspace-settings-page")).toBeVisible();
    await page.getByTestId("settings-timezone-select").selectOption("Europe/London");
    await page.getByTestId("settings-currency-select").selectOption("EUR");
    await page.getByTestId("settings-save-button").click();
    await expect(page.getByTestId("settings-saved-feedback")).toContainText(
      "Workspace & organization settings saved.",
    );

    // 9. Create Second Workspace & Switch Between Workspaces
    await page.getByTestId("open-create-workspace-dialog").click();
    await page.getByTestId("new-workspace-name-input").fill(secondaryWorkspaceName);
    await page.getByTestId("new-workspace-timezone-select").selectOption("Europe/Berlin");
    await page.getByTestId("new-workspace-currency-select").selectOption("EUR");
    await page.getByTestId("submit-create-workspace").click();

    await expect(page.getByTestId("header-active-workspace-name")).toContainText(
      secondaryWorkspaceName,
    );

    // Switch back to the primary workspace
    const workspaceSelect = page.getByTestId("workspace-switcher");
    const primaryOption = workspaceSelect.locator("option", {
      hasText: primaryWorkspaceName,
    });
    const primaryWorkspaceId = await primaryOption.getAttribute("value");
    expect(primaryWorkspaceId).toBeTruthy();
    await workspaceSelect.selectOption(primaryWorkspaceId as string);
    await expect(page.getByTestId("header-active-workspace-name")).toContainText(
      primaryWorkspaceName,
    );

    // 10. Projects Directory (/projects) — Archive and Restore lifecycle
    await page.goto("/projects");
    await expect(page.getByTestId("projects-directory")).toBeVisible();
    await expect(page.getByTestId("project-card-avenor-web-app")).toContainText(
      "Avenor Flagship Platform",
    );

    await page.getByTestId("toggle-archive-avenor-web-app").click();
    await page.getByRole("tab", { name: /Archived \(1\)/i }).click();
    await expect(page.getByTestId("project-card-avenor-web-app")).toContainText("ARCHIVED");

    // Restore back to ACTIVE
    await page.getByTestId("toggle-archive-avenor-web-app").click();
    await page.getByRole("tab", { name: /Active \(1\)/i }).click();
    await expect(page.getByTestId("project-card-avenor-web-app")).toContainText("ACTIVE");

    // 11. Read-Only Connections Readiness (/connections)
    await page.goto("/connections");
    await expect(page.getByTestId("connections-readiness-page")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Read-Only Provider Connections/i }),
    ).toBeVisible();

    // 12. Multi-Viewport Responsive Layout Verification (390x844, 768x1024, 1200x1600, 1440x900)
    await page.goto("/dashboard");
    await expect(page.getByTestId("dashboard-overview")).toBeVisible();

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

      if (vp.width < 1024) {
        // Verify mobile navigation drawer opens and closes cleanly
        const mobileMenuBtn = page.getByTestId("mobile-menu-button");
        await expect(mobileMenuBtn).toBeVisible();
        await mobileMenuBtn.click();
        await expect(page.getByTestId("mobile-navigation-drawer")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("mobile-navigation-drawer")).toBeHidden();
      }

      await page.screenshot({
        path: path.join(ARTIFACT_DIR, `milestone-01-${vp.label}.png`),
        fullPage: false,
      });
    }

    // 13. Sign Out -> Verify Protected Route Redirect -> Sign Back In -> Verify Persisted Data
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByTestId("sign-out-button").click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/projects");
    await expect(page).toHaveURL(/\/login$/);

    // Sign back in
    await page.locator("#login-email").fill(userEmail);
    await page.locator("#login-password").fill(userPassword);
    await page.getByRole("button", { name: /Sign in to workspace/i }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId("dashboard-projects-list")).toContainText(
      "Avenor Flagship Platform",
    );
  });
});
