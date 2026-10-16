import * as React from "react";
import {
  type AuthenticatedSessionContext,
  getWorkspaceGovernanceDetails,
  listWorkspaceProjects,
  type WorkspaceGovernanceDetails,
} from "@avenor/auth";
import type { LogicalProjectSummary, WorkspaceSummary } from "@avenor/types";
import { redirect } from "next/navigation";

import { getServerSession } from "./auth-server";

export interface AuthenticatedAppContext {
  session: AuthenticatedSessionContext;
  workspaces: WorkspaceSummary[];
  governance: WorkspaceGovernanceDetails;
  projects: LogicalProjectSummary[];
}

export const requireAuthenticatedAppContext = React.cache(
  async (): Promise<AuthenticatedAppContext> => {
    const session = await getServerSession();
    if (!session) {
      redirect("/login");
    }

    const activeWorkspaceId = session.activeWorkspace.id;

    const [governance, projects] = await Promise.all([
      getWorkspaceGovernanceDetails(session, activeWorkspaceId),
      listWorkspaceProjects(session, activeWorkspaceId, {
        includeArchived: true,
      }),
    ]);

    return {
      session,
      workspaces: session.workspaces,
      governance,
      projects,
    };
  },
);
