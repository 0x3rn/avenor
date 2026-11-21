import "dotenv/config";
import { createLogicalProject, registerUserWithDefaultOwnership } from "@avenor/auth";
import { closeAllDatabasePools, resetTestDatabaseRecords, runMigrations } from "@avenor/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acceptWorkspaceInvitation,
  createWorkspaceInvitation,
  listProjectAccessGrants,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
} from "@/lib/team/memberships";

describe("THE-159 PostgreSQL Integration: Hashed invitations, email identity lock, replay denial, and last-owner safety", () => {
  beforeAll(async () => {
    await runMigrations();
    await resetTestDatabaseRecords();
  });

  afterAll(async () => {
    await resetTestDatabaseRecords();
    await closeAllDatabasePools();
  });

  it("redeems invitation atomically for matching email, blocks replay and wrong-email hijack, and protects last owner", async () => {
    const owner = await registerUserWithDefaultOwnership({
      email: "team-owner@avenor.test",
      name: "Team Owner",
      password: "ValidPassword!2026",
      organizationName: "Team Org",
      workspaceName: "Team WS",
    });
    const invitee = await registerUserWithDefaultOwnership({
      email: "analyst@avenor.test",
      name: "Analyst Member",
      password: "ValidPassword!2026",
      organizationName: "Analyst Personal Org",
      workspaceName: "Analyst Personal WS",
    });
    const attacker = await registerUserWithDefaultOwnership({
      email: "attacker@avenor.test",
      name: "Wrong User",
      password: "ValidPassword!2026",
      organizationName: "Attacker Org",
      workspaceName: "Attacker WS",
    });

    const project = await createLogicalProject(owner.context, owner.context.activeWorkspace.id, {
      name: "Shared Product",
      primaryDomain: "shared.avenor.dev",
    });

    const { invitation, rawInviteToken } = await createWorkspaceInvitation(owner.context, {
      email: "analyst@avenor.test",
      role: "ANALYST",
      projectIds: [project.id],
    });
    expect(invitation.status).toBe("PENDING");

    // Wrong email cannot redeem stolen invite token
    await expect(acceptWorkspaceInvitation(attacker.context, rawInviteToken)).rejects.toThrow(
      /different email address/i,
    );

    // Matching user redeems cleanly
    const accepted = await acceptWorkspaceInvitation(invitee.context, rawInviteToken);
    expect(accepted.role).toBe("ANALYST");
    expect(accepted.grantedProjectIds).toEqual([project.id]);

    // Replay of already-accepted token is blocked
    await expect(acceptWorkspaceInvitation(invitee.context, rawInviteToken)).rejects.toThrow(
      /cannot be accepted/i,
    );

    const grants = await listProjectAccessGrants(owner.context);
    expect(grants).toHaveLength(1);
    expect(grants[0]?.userId).toBe(invitee.context.user.id);

    // Last-owner demotion & removal MUST fail
    await expect(
      updateWorkspaceMemberRole(owner.context, {
        targetUserId: owner.context.user.id,
        newRole: "ADMIN",
      }),
    ).rejects.toThrow(/sole remaining OWNER/i);
    await expect(
      removeWorkspaceMember(owner.context, { targetUserId: owner.context.user.id }),
    ).rejects.toThrow(/sole remaining OWNER/i);

    // Removing non-owner member succeeds
    const removed = await removeWorkspaceMember(owner.context, {
      targetUserId: invitee.context.user.id,
    });
    expect(removed.removed).toBe(true);
  });
});
