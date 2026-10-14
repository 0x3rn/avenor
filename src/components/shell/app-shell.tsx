"use client";

import type { LogicalProjectSummary, WorkspaceSummary } from "@avenor/types";
import {
  Badge,
  Button,
  Dialog,
  FormField,
  Select,
  SignalAtlasLogo,
  Skeleton,
  TextInput,
} from "@avenor/ui";
import {
  BarChart3,
  Building2,
  Compass,
  Database,
  FileSpreadsheet,
  FolderKanban,
  Globe,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Plus,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

export interface AppShellProps {
  user: {
    id: string;
    email: string;
    name: string;
    onboardingCompletedAt: string | null;
  };
  activeWorkspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  projects: LogicalProjectSummary[];
  children: React.ReactNode;
}

interface PrimaryNavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  matchPrefix?: string;
}

const PRIMARY_NAV_ITEMS: PrimaryNavItem[] = [
  {
    label: "Overview",
    href: "/dashboard",
    icon: LayoutDashboard,
    matchPrefix: "/dashboard",
  },
  {
    label: "Projects",
    href: "/projects",
    icon: FolderKanban,
    matchPrefix: "/projects",
  },
  {
    label: "Guided Setup",
    href: "/onboarding",
    icon: Compass,
    matchPrefix: "/onboarding",
  },
  {
    label: "Connections",
    href: "/connections",
    icon: Globe,
    matchPrefix: "/connections",
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
    matchPrefix: "/settings",
  },
];

const PLANNED_SIGNAL_MODULES = [
  { label: "Audience & Traffic", milestone: "M03", icon: BarChart3 },
  { label: "Search Visibility", milestone: "M03", icon: Search },
  { label: "Cloud Costs", milestone: "M05", icon: Wallet },
  { label: "Backend & Databases", milestone: "M06", icon: Database },
  { label: "Hosting & Reliability", milestone: "M08", icon: Server },
  { label: "Reports & Alerts", milestone: "M09", icon: FileSpreadsheet },
];

export function AppShell({ user, activeWorkspace, workspaces, projects, children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();

  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [switchingWorkspace, setSwitchingWorkspace] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = React.useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = React.useState("");
  const [newWorkspaceSlug, setNewWorkspaceSlug] = React.useState("");
  const [newWorkspaceTimezone, setNewWorkspaceTimezone] = React.useState(
    activeWorkspace.defaultTimezone || "UTC",
  );
  const [newWorkspaceCurrency, setNewWorkspaceCurrency] = React.useState(
    activeWorkspace.defaultCurrency || "USD",
  );
  const [createWorkspaceError, setCreateWorkspaceError] = React.useState<string | null>(null);
  const [creatingWorkspace, setCreatingWorkspace] = React.useState(false);

  const activeProjects = React.useMemo(
    () => projects.filter((project) => project.status === "ACTIVE"),
    [projects],
  );

  React.useEffect(() => {
    if (!mobileMenuOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileMenuOpen]);

  async function handleWorkspaceSwitch(targetWorkspaceId: string) {
    if (!targetWorkspaceId || targetWorkspaceId === activeWorkspace.id) {
      return;
    }
    setSwitchingWorkspace(true);
    try {
      const response = await fetch("/api/auth/switch-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: targetWorkspaceId }),
      });
      if (response.ok) {
        router.refresh();
      }
    } finally {
      setSwitchingWorkspace(false);
    }
  }

  async function handleCreateWorkspace(event: React.FormEvent) {
    event.preventDefault();
    setCreateWorkspaceError(null);
    if (newWorkspaceName.trim().length < 2) {
      setCreateWorkspaceError("Enter a workspace name (at least 2 characters).");
      return;
    }

    setCreatingWorkspace(true);
    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newWorkspaceName.trim(),
          slug: newWorkspaceSlug.trim() || undefined,
          defaultTimezone: newWorkspaceTimezone,
          defaultCurrency: newWorkspaceCurrency,
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setCreateWorkspaceError(payload.error?.message ?? "Unable to create workspace.");
        return;
      }

      setNewWorkspaceName("");
      setNewWorkspaceSlug("");
      setCreateWorkspaceOpen(false);
      router.refresh();
    } catch {
      setCreateWorkspaceError("Network error while creating workspace. Please try again.");
    } finally {
      setCreatingWorkspace(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/signout", { method: "POST" });
      window.location.assign("/login");
    } finally {
      setSigningOut(false);
    }
  }

  function handleProjectJump(value: string) {
    if (!value) {
      return;
    }
    if (value === "__new__") {
      router.push("/projects/new");
      return;
    }
    router.push(`/projects/${value}`);
  }

  const currentProjectId = React.useMemo(() => {
    const match = pathname.match(/^\/projects\/([^/]+)$/);
    if (!match || match[1] === "new") {
      return "";
    }
    return match[1] ?? "";
  }, [pathname]);

  const canCreateWorkspace = activeWorkspace.role === "OWNER" || activeWorkspace.role === "ADMIN";

  const renderNavigationContent = (isMobileDrawer: boolean) => (
    <div className="flex h-full flex-col justify-between">
      <div className="space-y-6 p-4">
        {/* Brand + Mobile Close */}
        <div className="flex items-center justify-between px-2">
          <Link
            href="/dashboard"
            onClick={() => setMobileMenuOpen(false)}
            className="flex items-center gap-2 text-[#17243A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5157D9] rounded-[8px]"
          >
            <SignalAtlasLogo />
          </Link>
          {isMobileDrawer ? (
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close navigation menu"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[#64748B] hover:bg-[#F0F4FA] hover:text-[#17243A]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {/* Organization & Workspace Selector Box */}
        <div className="rounded-[12px] border border-[#DFE6F0] bg-[#F7F9FC] p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#64748B] truncate">
              <Building2 className="h-3.5 w-3.5 shrink-0 text-[#5157D9]" />
              <span className="truncate" title={activeWorkspace.organizationName}>
                {activeWorkspace.organizationName}
              </span>
            </div>
            <Badge tone="indigo">{activeWorkspace.role}</Badge>
          </div>

          <div>
            <label
              htmlFor={isMobileDrawer ? "mobile-workspace-switcher" : "desktop-workspace-switcher"}
              className="sr-only"
            >
              Active workspace
            </label>
            <Select
              id={isMobileDrawer ? "mobile-workspace-switcher" : "desktop-workspace-switcher"}
              data-testid={isMobileDrawer ? "mobile-workspace-switcher" : "workspace-switcher"}
              aria-label="Active workspace"
              value={activeWorkspace.id}
              disabled={switchingWorkspace}
              onChange={(event) => handleWorkspaceSwitch(event.target.value)}
              className="h-9 text-[13px] font-medium"
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name} ({ws.defaultCurrency})
                </option>
              ))}
            </Select>
          </div>

          <div className="flex items-center justify-between pt-0.5 text-[11px] text-[#64748B]">
            <span className="tabular-nums">
              {activeWorkspace.defaultTimezone} • {activeWorkspace.defaultCurrency}
            </span>
            {canCreateWorkspace ? (
              <button
                type="button"
                data-testid={
                  isMobileDrawer
                    ? "mobile-open-create-workspace-dialog"
                    : "open-create-workspace-dialog"
                }
                onClick={() => {
                  setMobileMenuOpen(false);
                  setCreateWorkspaceOpen(true);
                }}
                className="inline-flex items-center gap-1 font-medium text-[#5157D9] hover:text-[#4047BD] cursor-pointer"
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
                Workspace
              </button>
            ) : null}
          </div>
        </div>

        {/* Primary Navigation */}
        <nav aria-label="Primary application navigation" className="space-y-1">
          <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[#7B899F]">
            Product Intelligence
          </p>
          {PRIMARY_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = item.matchPrefix
              ? pathname === item.href || pathname.startsWith(`${item.matchPrefix}/`)
              : pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center justify-between rounded-[10px] px-3 py-2 text-[14px] font-medium transition-colors ${
                  isActive
                    ? "bg-[#ECEEFF] text-[#5157D9] border border-[#CED3FF]"
                    : "text-[#30415D] hover:bg-[#F0F4FA] hover:text-[#17243A] border border-transparent"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon
                    className={`h-4 w-4 ${isActive ? "text-[#5157D9]" : "text-[#64748B]"}`}
                    aria-hidden="true"
                  />
                  <span>{item.label}</span>
                </span>
                {item.href === "/onboarding" && !user.onboardingCompletedAt ? (
                  <Badge tone="signal">Setup</Badge>
                ) : null}
                {item.href === "/projects" ? (
                  <span className="text-[12px] font-medium text-[#64748B] tabular-nums">
                    {activeProjects.length}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        {/* Planned Signal Modules (Progressive Disclosure per Design Brief Section 08) */}
        <div className="space-y-1 pt-2 border-t border-[#DFE6F0]">
          <div className="flex items-center justify-between px-2.5 pb-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#7B899F]">
              Signal Modules
            </p>
            <span className="text-[11px] font-medium text-[#7B899F]">Roadmap</span>
          </div>
          {PLANNED_SIGNAL_MODULES.map((mod) => {
            const Icon = mod.icon;
            return (
              <div
                key={mod.label}
                className="flex items-center justify-between rounded-[10px] px-3 py-1.5 text-[13px] text-[#7B899F]"
                title={`${mod.label} unlocks in Milestone ${mod.milestone} once read-only provider adapters are connected.`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-[#7B899F]" />
                  <span className="truncate">{mod.label}</span>
                </span>
                <span className="rounded-[6px] bg-[#F0F4FA] px-1.5 py-0.5 text-[10px] font-medium text-[#64748B] tabular-nums">
                  {mod.milestone}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer Read-Only Guarantee & User Identity */}
      <div className="border-t border-[#DFE6F0] p-4 space-y-3 bg-[#FFFFFF]">
        <div className="flex items-start gap-2 rounded-[10px] border border-[#DFE6F0] bg-[#E7F6F7]/60 px-3 py-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#168E99]" aria-hidden="true" />
          <div className="text-[11px] leading-snug text-[#30415D]">
            <p className="font-semibold text-[#17243A]">Read-only external boundary</p>
            <p className="text-[#64748B]">
              Zero remote mutation routes. Scoped viewer access only.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-[#17243A]">{user.name}</p>
            <p className="truncate text-[12px] text-[#64748B]">{user.email}</p>
          </div>
          <Button
            type="button"
            variant="subtle"
            size="sm"
            data-testid={isMobileDrawer ? "mobile-sign-out-button" : "sign-out-button"}
            onClick={handleSignOut}
            disabled={signingOut}
            aria-label="Sign out"
            className="shrink-0"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span>{signingOut ? "Signing out..." : "Sign out"}</span>
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F7F9FC] text-[#30415D] flex flex-col lg:flex-row">
      {/* Desktop Left Sidebar (256px) */}
      <aside
        aria-label="Desktop sidebar navigation"
        className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-[#DFE6F0] lg:bg-[#FFFFFF] lg:sticky lg:top-0 lg:h-screen"
      >
        {renderNavigationContent(false)}
      </aside>

      {/* Mobile Navigation Drawer (< 1024px) */}
      {mobileMenuOpen ? (
        <div
          className="fixed inset-0 z-50 flex lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Application navigation"
          data-testid="mobile-navigation-drawer"
        >
          <div
            className="fixed inset-0 bg-[#10192B]/40 backdrop-blur-[1px]"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 flex w-72 max-w-[85vw] flex-col bg-[#FFFFFF] shadow-xl">
            {renderNavigationContent(true)}
          </div>
        </div>
      ) : null}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Global Top Header (64px) */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-[#DFE6F0] bg-[#FFFFFF]/95 px-4 backdrop-blur-xs sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              data-testid="mobile-menu-button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-[#DFE6F0] bg-[#FFFFFF] text-[#17243A] hover:bg-[#F0F4FA] lg:hidden"
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </button>

            <div className="flex items-center gap-2 min-w-0">
              <span
                data-testid="header-active-workspace-name"
                className="truncate text-[14px] font-semibold text-[#17243A]"
              >
                {activeWorkspace.name}
              </span>
              <span className="hidden sm:inline text-[#C7D2E3]">/</span>
              <div className="hidden sm:block w-52">
                <label htmlFor="header-project-switcher" className="sr-only">
                  Jump to logical project
                </label>
                <Select
                  id="header-project-switcher"
                  data-testid="project-switcher"
                  aria-label="Jump to logical project"
                  value={currentProjectId}
                  onChange={(event) => handleProjectJump(event.target.value)}
                  className="h-9 text-[13px]"
                >
                  <option value="">All logical products ({activeProjects.length})</option>
                  {activeProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name} ({project.slug})
                    </option>
                  ))}
                  <option value="__new__">+ New logical project...</option>
                </Select>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <span className="hidden md:inline-flex items-center gap-1.5 rounded-[8px] border border-[#DFE6F0] bg-[#F7F9FC] px-2.5 py-1 text-[12px] font-medium text-[#30415D]">
              <Lock className="h-3.5 w-3.5 text-[#168E99]" aria-hidden="true" />
              <span>Read-only mode</span>
            </span>

            <Link
              href="/projects/new"
              data-testid="header-new-project-link"
              className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-[#5157D9] px-3 text-[13px] font-medium text-white hover:bg-[#4047BD] transition-colors"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">New Project</span>
              <span className="sm:hidden">New</span>
            </Link>
          </div>
        </header>

        {/* Page Content */}
        <main className="mx-auto w-full max-w-[1480px] flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {children}
        </main>
      </div>

      {/* Create Workspace Modal Dialog */}
      <Dialog
        open={createWorkspaceOpen}
        onClose={() => setCreateWorkspaceOpen(false)}
        title="Create Workspace"
        description={`Provision an isolated workspace inside ${activeWorkspace.organizationName} with its own logical products, environments, and role memberships.`}
      >
        <form
          onSubmit={handleCreateWorkspace}
          className="space-y-4"
          data-testid="create-workspace-form"
        >
          {createWorkspaceError ? (
            <div
              role="alert"
              className="rounded-[10px] border border-[#BF4256]/30 bg-[#FDECEF] px-3.5 py-2.5 text-[13px] font-medium text-[#BF4256]"
            >
              {createWorkspaceError}
            </div>
          ) : null}

          <FormField
            id="new-workspace-name"
            label="Workspace name"
            required
            hint="Examples: Core Product Suite, Client Operations, EU Region."
          >
            <TextInput
              id="new-workspace-name"
              data-testid="new-workspace-name-input"
              value={newWorkspaceName}
              onChange={(event) => setNewWorkspaceName(event.target.value)}
              placeholder="Core Product Suite"
              required
            />
          </FormField>

          <FormField
            id="new-workspace-slug"
            label="Workspace slug (optional)"
            hint="Lowercase letters, numbers, and hyphens. Auto-generated if left blank."
          >
            <TextInput
              id="new-workspace-slug"
              data-testid="new-workspace-slug-input"
              value={newWorkspaceSlug}
              onChange={(event) => setNewWorkspaceSlug(event.target.value)}
              placeholder="core-product-suite"
            />
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField id="new-workspace-timezone" label="Default timezone">
              <Select
                id="new-workspace-timezone"
                data-testid="new-workspace-timezone-select"
                value={newWorkspaceTimezone}
                onChange={(event) => setNewWorkspaceTimezone(event.target.value)}
              >
                <option value="UTC">UTC</option>
                <option value="America/New_York">America/New_York</option>
                <option value="America/Los_Angeles">America/Los_Angeles</option>
                <option value="Europe/London">Europe/London</option>
                <option value="Europe/Berlin">Europe/Berlin</option>
                <option value="Asia/Tokyo">Asia/Tokyo</option>
              </Select>
            </FormField>

            <FormField id="new-workspace-currency" label="Default currency">
              <Select
                id="new-workspace-currency"
                data-testid="new-workspace-currency-select"
                value={newWorkspaceCurrency}
                onChange={(event) => setNewWorkspaceCurrency(event.target.value)}
              >
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
                <option value="CAD">CAD ($)</option>
                <option value="AUD">AUD ($)</option>
                <option value="JPY">JPY (¥)</option>
              </Select>
            </FormField>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCreateWorkspaceOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              data-testid="submit-create-workspace"
              disabled={creatingWorkspace}
            >
              {creatingWorkspace ? "Creating workspace..." : "Create & switch workspace"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

export function AppShellSkeleton() {
  return (
    <div className="min-h-screen bg-[#F7F9FC] flex">
      <div className="hidden lg:block lg:w-64 border-r border-[#DFE6F0] bg-[#FFFFFF] p-4 space-y-4">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
      <div className="flex-1 p-6 space-y-6">
        <Skeleton className="h-12 w-full" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    </div>
  );
}
