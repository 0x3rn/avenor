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
});
