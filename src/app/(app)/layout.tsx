import * as React from "react";

import { AppShell, AppShellSkeleton } from "@/components/shell/app-shell";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

async function AuthenticatedShellLoader({ children }: { children: React.ReactNode }) {
  const { session, workspaces, governance, projects } = await requireAuthenticatedAppContext();

  return (
    <AppShell
      user={{
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        onboardingCompletedAt: session.user.onboardingCompletedAt,
      }}
      activeWorkspace={governance.workspace}
      workspaces={workspaces}
      projects={projects}
    >
      {children}
    </AppShell>
  );
}

export default function ApplicationLayout({ children }: { children: React.ReactNode }) {
  return (
    <React.Suspense fallback={<AppShellSkeleton />}>
      <AuthenticatedShellLoader>{children}</AuthenticatedShellLoader>
    </React.Suspense>
  );
}
