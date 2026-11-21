import { describe, expect, it } from "vitest";
import {
  assertRoleAssignmentAllowed,
  hashInvitationToken,
  normalizeCanonicalEmail,
} from "@/lib/team/memberships";

describe("THE-159: Team RBAC role assignment rules and invitation token hashing", () => {
  it("enforces role elevation hierarchy and deterministic token hashing", () => {
    expect(() => assertRoleAssignmentAllowed("OWNER", "OWNER")).not.toThrow();
    expect(() => assertRoleAssignmentAllowed("OWNER", "ADMIN")).not.toThrow();
    expect(() => assertRoleAssignmentAllowed("ADMIN", "ANALYST")).not.toThrow();
    expect(() => assertRoleAssignmentAllowed("ADMIN", "OWNER")).toThrow(/Only a workspace OWNER/i);
    expect(() => assertRoleAssignmentAllowed("ANALYST", "VIEWER")).toThrow(/not authorized/i);
    expect(() => assertRoleAssignmentAllowed("VIEWER", "VIEWER")).toThrow(/not authorized/i);

    expect(normalizeCanonicalEmail("  Alice@Example.COM ")).toBe("alice@example.com");
    const h = hashInvitationToken("avinv_test123");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("avinv_test123");
  });
});
