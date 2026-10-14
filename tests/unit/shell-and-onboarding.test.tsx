import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { ProjectsDirectory } from "@/components/projects/projects-directory";
import { AppShell } from "@/components/shell/app-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const MOCK_WORKSPACE = {
  id: "wks_test_1",
  organizationId: "org_test_1",
  organizationName: "Avenor Systems",
  name: "Primary Product Workspace",
  slug: "primary-product-workspace",
  defaultTimezone: "UTC",
  defaultCurrency: "USD",
  role: "OWNER" as const,
  projectCount: 1,
  memberCount: 1,
};

const MOCK_PROJECT = {
  id: "prj_test_1",
  workspaceId: "wks_test_1",
  name: "Avenor Web App",
  slug: "avenor-web-app",
  description: "Customer portal and marketing website",
  primaryDomain: "https://avenor.dev",
  status: "ACTIVE" as const,
  mappedResourceCount: 0,
  createdAt: "2026-10-14T10:00:00.000Z",
  updatedAt: "2026-10-14T10:00:00.000Z",
  environments: [
    {
      id: "env_prod",
      projectId: "prj_test_1",
      name: "Production",
      slug: "production",
      type: "PRODUCTION" as const,
      primaryDomain: "https://avenor.dev",
      isDefault: true,
      mappedResourceCount: 0,
      createdAt: "2026-10-14T10:00:00.000Z",
    },
    {
      id: "env_stg",
      projectId: "prj_test_1",
      name: "Staging",
      slug: "staging",
      type: "STAGING" as const,
      primaryDomain: "https://staging.avenor.dev",
      isDefault: false,
      mappedResourceCount: 0,
      createdAt: "2026-10-14T10:00:00.000Z",
    },
  ],
};

describe("THE-116: Responsive Application Shell, Onboarding Flow, and Projects Directory", () => {
  it("renders AppShell with workspace switcher, progressive navigation, and mobile drawer toggle", () => {
    render(
      <AppShell
        user={{
          id: "usr_1",
          email: "founder@avenor.dev",
          name: "Ada Lovelace",
          onboardingCompletedAt: null,
        }}
        activeWorkspace={MOCK_WORKSPACE}
        workspaces={[MOCK_WORKSPACE]}
        projects={[MOCK_PROJECT]}
      >
        <div data-testid="child-view">Portfolio Content</div>
      </AppShell>,
    );

    expect(screen.getByTestId("child-view")).toHaveTextContent("Portfolio Content");
    expect(screen.getByTestId("workspace-switcher")).toHaveValue("wks_test_1");
    expect(screen.getByText("Read-only external boundary")).toBeInTheDocument();

    // Open mobile navigation drawer
    const mobileBtn = screen.getByTestId("mobile-menu-button");
    fireEvent.click(mobileBtn);
    expect(screen.getByTestId("mobile-navigation-drawer")).toBeInTheDocument();

    // Open Create Workspace dialog
    const createWsBtn = screen.getByTestId("open-create-workspace-dialog");
    fireEvent.click(createWsBtn);
    expect(screen.getByTestId("create-workspace-form")).toBeInTheDocument();
  });

  it("renders OnboardingFlow with 4-step progress indicator and auto-slug generation", () => {
    render(
      <OnboardingFlow
        governance={{
          workspace: MOCK_WORKSPACE,
          organization: {
            id: "org_test_1",
            name: "Avenor Systems",
            slug: "avenor-systems",
          },
          members: [
            {
              userId: "usr_1",
              name: "Ada Lovelace",
              email: "founder@avenor.dev",
              role: "OWNER",
              joinedAt: "2026-10-14T10:00:00.000Z",
            },
          ],
          auditLogs: [],
        }}
        onboardingCompletedAt={null}
        initialProjects={[MOCK_PROJECT]}
      />,
    );

    expect(screen.getByRole("heading", { name: /Signal Atlas Guided Setup/i })).toBeInTheDocument();

    const nameInput = screen.getByTestId("onboarding-project-name-input");
    fireEvent.change(nameInput, { target: { value: "Analytics Cloud Suite" } });
    expect(screen.getByTestId("onboarding-project-slug-input")).toHaveValue(
      "analytics-cloud-suite",
    );
  });

  it("filters logical products in ProjectsDirectory by search query and status", () => {
    const archivedProject = {
      ...MOCK_PROJECT,
      id: "prj_test_2",
      name: "Legacy Docs Portal",
      slug: "legacy-docs-portal",
      status: "ARCHIVED" as const,
    };

    render(
      <ProjectsDirectory
        workspaceName="Primary Product Workspace"
        organizationName="Avenor Systems"
        canManageProjects={true}
        canArchiveProjects={true}
        projects={[MOCK_PROJECT, archivedProject]}
      />,
    );

    // By default shows ACTIVE projects only
    expect(screen.getByTestId("project-card-avenor-web-app")).toBeInTheDocument();
    expect(screen.queryByTestId("project-card-legacy-docs-portal")).not.toBeInTheDocument();

    // Switch to Archived tab
    fireEvent.click(screen.getByRole("tab", { name: /Archived \(1\)/i }));
    expect(screen.getByTestId("project-card-legacy-docs-portal")).toBeInTheDocument();
  });

  it("renders uplifted 17-section HomePage with interactive command tabs, pricing toggle, and zero raw SQL enums", async () => {
    const { default: HomePage } = await import("@/app/page");
    const { container } = render(<HomePage />);

    expect(
      screen.getByRole("heading", {
        name: /Every signal behind every product you run\. Organized by product, not provider\./i,
      }),
    ).toBeInTheDocument();

    // Interactive Hero Command Frame tabs switch active tab state
    expect(screen.getAllByText("48,920").length).toBeGreaterThanOrEqual(1);
    const spendTab = screen.getByRole("tab", { name: /Cloud Spend/i });
    fireEvent.click(spendTab);
    expect(spendTab).toHaveAttribute("aria-selected", "true");

    // Interactive Pricing toggle switches Pro between $15/mo annual and $19/month
    expect(screen.getByText("$15")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Monthly billing/i }));
    expect(screen.getByText("$19")).toBeInTheDocument();

    // Verify no raw SQL enum tuple strings leak into public marketing copy
    expect(container.textContent).not.toContain("OWNER, ADMIN, ANALYST, VIEWER");
  });

  it("renders uplifted LoginPage, SignupPage, ForgotPasswordPage, VerifyEmailPage, and NotFound", async () => {
    const { default: LoginPage } = await import("@/app/(auth)/login/page");
    const { default: SignupPage } = await import("@/app/(auth)/signup/page");
    const { default: ForgotPasswordPage } = await import("@/app/(auth)/forgot-password/page");
    const { default: VerifyEmailPage } = await import("@/app/(auth)/verify-email/page");
    const { default: NotFound } = await import("@/app/not-found");

    const { unmount: unmountLogin } = render(<LoginPage />);
    expect(screen.getByRole("heading", { name: "Sign in to Avenor" })).toBeInTheDocument();
    expect(
      screen.getByText("Your entire product portfolio, synchronized and waiting."),
    ).toBeInTheDocument();
    unmountLogin();

    const { unmount: unmountSignup } = render(<SignupPage />);
    expect(
      screen.getByRole("heading", { name: "Create your Avenor workspace" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Create workspace & start 14-day Pro preview/i }),
    ).toBeInTheDocument();
    unmountSignup();

    const { unmount: unmountForgot } = render(<ForgotPasswordPage />);
    expect(screen.getByRole("heading", { name: "Reset your password" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send password reset link/i })).toBeInTheDocument();
    unmountForgot();

    const { unmount: unmountVerify } = render(<VerifyEmailPage />);
    expect(screen.getByRole("heading", { name: "Verify your email address" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirm email address/i })).toBeInTheDocument();
    unmountVerify();

    render(<NotFound />);
    expect(
      screen.getByRole("heading", { name: "This route isn’t mapped in Avenor." }),
    ).toBeInTheDocument();
  });
});
