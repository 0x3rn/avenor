import "dotenv/config";
import { registerUserWithDefaultOwnership } from "@avenor/auth";
import { closeAllDatabasePools, resetTestDatabaseRecords, runMigrations } from "@avenor/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listWorkspaceSupportRequests, submitSupportRequest } from "@/lib/support/service";

describe("THE-163 PostgreSQL Integration: Sanitized support intake and workspace ticket isolation", () => {
  beforeAll(async () => {
    await runMigrations();
    await resetTestDatabaseRecords();
  });

  afterAll(async () => {
    await resetTestDatabaseRecords();
    await closeAllDatabasePools();
  });

  it("persists support requests while scrubbing accidentally pasted DB URIs and tokens and isolates tickets by tenant", async () => {
    const ownerA = await registerUserWithDefaultOwnership({
      email: "sup-owner-a@avenor.test",
      name: "Support Owner A",
      password: "ValidPassword!2026",
      organizationName: "Sup Org A",
      workspaceName: "Sup WS A",
    });
    const ownerB = await registerUserWithDefaultOwnership({
      email: "sup-owner-b@avenor.test",
      name: "Support Owner B",
      password: "ValidPassword!2026",
      organizationName: "Sup Org B",
      workspaceName: "Sup WS B",
    });

    const ticket = await submitSupportRequest(ownerA.context, {
      contactEmail: "sup-owner-a@avenor.test",
      category: "INTEGRATION",
      subject: "Neon connection check",
      description:
        "I accidentally pasted postgres://admin:supersecret@db.neon.tech/app and Bearer ya29_secret_token_99999 here.",
    });

    expect(ticket.description).not.toContain("supersecret");
    expect(ticket.description).not.toContain("ya29_secret_token_99999");
    expect(ticket.description).toContain("[REDACTED_DB_URI]");

    const listA = await listWorkspaceSupportRequests(ownerA.context);
    expect(listA).toHaveLength(1);

    await expect(
      listWorkspaceSupportRequests(ownerB.context, ownerA.context.activeWorkspace.id),
    ).rejects.toThrow();
  });
});
