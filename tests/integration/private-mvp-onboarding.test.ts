import "dotenv/config";
import {
  createLogicalProject,
  registerUserWithDefaultOwnership,
  resolveSessionByToken,
} from "@avenor/auth";
import { closeAllDatabasePools, dbQuery, runMigrations } from "@avenor/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertPrivateSignupAllowed,
  evaluatePrivateAccessGate,
  getOnboardingProgress,
  submitPrivateAccessRequest,
  upsertOnboardingProgress,
} from "@/lib/onboarding/private-access";

describe("THE-144: Private MVP Access Request, Server Gating & Resumable Onboarding Integration", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await closeAllDatabasePools();
  });

  it("records private access requests with duplicate suppression, enforces IP throttling, approves invite-only signup, and persists resumable onboarding progress without duplicates", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const applicantEmail = `preview.${suffix}@avenor.test`;

    // 1. Submit private access request
    const firstReq = await submitPrivateAccessRequest({
      name: "Preview Founder",
      email: applicantEmail,
      productCountHint: "2-5 products",
      sourceIp: `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
    });
    expect(firstReq.status).toBe("PENDING");
    expect(firstReq.alreadyRequested).toBe(false);

    // 2. Duplicate submission for same email returns alreadyRequested without creating duplicate row
    const dupReq = await submitPrivateAccessRequest({
      name: "Preview Founder",
      email: applicantEmail.toUpperCase(),
      productCountHint: "2-5 products",
      sourceIp: `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
    });
    expect(dupReq.alreadyRequested).toBe(true);
    expect(dupReq.id).toBe(firstReq.id);

    // 3. Pending request is blocked under invite_only mode
    await expect(
      assertPrivateSignupAllowed(applicantEmail, {
        rawEnv: { AVENOR_PRIVATE_ACCESS_MODE: "invite_only" },
      }),
    ).rejects.toThrow(/private preview/i);

    // 4. Approving the access request in DB unlocks signup cleanly under invite_only mode
    await dbQuery(`UPDATE private_access_requests SET status = 'APPROVED' WHERE id = $1`, [
      firstReq.id,
    ]);
    const approvedVerdict = await evaluatePrivateAccessGate(applicantEmail, {
      rawEnv: { AVENOR_PRIVATE_ACCESS_MODE: "invite_only" },
    });
    expect(approvedVerdict.allowed).toBe(true);

    // 5. Resumable onboarding progress persists across interrupted sessions with zero duplicates
    const registered = await registerUserWithDefaultOwnership({
      name: "Onboarding Founder",
      email: `onb.${suffix}@avenor.test`,
      password: "CorrectHorseBatteryStaple!99",
      organizationName: `Onb Org ${suffix}`,
      workspaceName: `Onb Workspace ${suffix}`,
    });
    const session = await resolveSessionByToken(registered.rawSessionToken);
    const workspaceId = registered.context.activeWorkspace.id;

    const initial = await getOnboardingProgress(session, workspaceId);
    expect(initial.currentStep).toBe("project");
    expect(initial.completedSteps).toContain("workspace");

    const project = await createLogicalProject(session, workspaceId, {
      name: "Resumable Product",
      slug: `resumable-${suffix}`,
      primaryDomain: "https://resumable.avenor.test",
      initialEnvironments: ["PRODUCTION", "STAGING"],
    });

    const resumed = await upsertOnboardingProgress(session, {
      workspaceId,
      currentStep: "connections",
      completedSteps: ["project", "environments"],
      draftProjectId: project.id,
    });
    expect(resumed.currentStep).toBe("connections");
    expect(resumed.draftProjectId).toBe(project.id);
    expect(resumed.completedSteps).toEqual(
      expect.arrayContaining(["workspace", "project", "environments"]),
    );

    // Reloading onboarding progress returns the exact persisted checkpoint
    const reloaded = await getOnboardingProgress(session, workspaceId);
    expect(reloaded.id).toBe(initial.id);
    expect(reloaded.currentStep).toBe("connections");
    expect(reloaded.draftProjectId).toBe(project.id);
  });
});
