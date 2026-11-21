import "dotenv/config";
import { registerUserWithDefaultOwnership } from "@avenor/auth";
import { closeAllDatabasePools, resetTestDatabaseRecords, runMigrations } from "@avenor/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  deletePersonalAccountSafely,
  deleteWorkspaceCascade,
  exportPersonalAccountData,
  recordPrivacyConsent,
} from "@/lib/privacy/compliance";
import { acceptWorkspaceInvitation, createWorkspaceInvitation } from "@/lib/team/memberships";

describe("THE-162 PostgreSQL Integration: Consents, personal data portability, shared-workspace safety, and deletion cascade", () => {
  beforeAll(async () => {
    await runMigrations();
    await resetTestDatabaseRecords();
  });

  afterAll(async () => {
    await resetTestDatabaseRecords();
    await closeAllDatabasePools();
  });

  it("records consents, exports personal data without secrets, protects shared workspaces from orphaning, and deletes confirmed workspaces safely", async () => {
    const owner = await registerUserWithDefaultOwnership({
      email: "priv-owner@avenor.test",
      name: "Privacy Owner",
      password: "ValidPassword!2026",
      organizationName: "Priv Org",
      workspaceName: "Priv WS",
    });
    const member = await registerUserWithDefaultOwnership({
      email: "priv-member@avenor.test",
      name: "Privacy Member",
      password: "ValidPassword!2026",
      organizationName: "Member Org",
      workspaceName: "Member WS",
    });

    await recordPrivacyConsent(owner.context, {
      consentType: "PRIVACY_POLICY",
      policyVersion: "2026-11-v1",
      granted: true,
    });
    await recordPrivacyConsent(owner.context, {
      consentType: "MARKETING_OPT_IN",
      policyVersion: "2026-11-v1",
      granted: false,
    });

    const exported = await exportPersonalAccountData(owner.context);
    expect(exported.account.email).toBe("priv-owner@avenor.test");
    expect(exported.consents).toHaveLength(2);
    expect(JSON.stringify(exported)).not.toContain("ValidPassword!2026");

    // Add second member to owner's workspace
    const { rawInviteToken } = await createWorkspaceInvitation(owner.context, {
      email: "priv-member@avenor.test",
      role: "VIEWER",
    });
    await acceptWorkspaceInvitation(member.context, rawInviteToken);

    // Non-owner cannot delete workspace
    await expect(
      deleteWorkspaceCascade(member.context, {
        workspaceId: owner.context.activeWorkspace.id,
        confirmationSlug: owner.context.activeWorkspace.slug,
      }),
    ).rejects.toThrow();

    // Sole OWNER of a shared workspace cannot delete personal account without transferring or deleting workspace first
    await expect(
      deletePersonalAccountSafely(owner.context, {
        confirmationEmail: "priv-owner@avenor.test",
      }),
    ).rejects.toThrow(/sole OWNER of one or more shared workspaces/i);

    // Owner deletes workspace with exact confirmationSlug
    const wsDeleted = await deleteWorkspaceCascade(owner.context, {
      workspaceId: owner.context.activeWorkspace.id,
      confirmationSlug: owner.context.activeWorkspace.slug,
    });
    expect(wsDeleted.deleted).toBe(true);
    expect(wsDeleted.disclosureNote).toMatch(/Neon point-in-time recovery/i);

    // Now personal account deletion succeeds cleanly
    const acctDeleted = await deletePersonalAccountSafely(owner.context, {
      confirmationEmail: "priv-owner@avenor.test",
    });
    expect(acctDeleted.deleted).toBe(true);
  });
});
