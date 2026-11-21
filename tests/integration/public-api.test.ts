import "dotenv/config";
import { createLogicalProject, registerUserWithDefaultOwnership } from "@avenor/auth";
import {
  closeAllDatabasePools,
  dbQuery,
  resetTestDatabaseRecords,
  runMigrations,
} from "@avenor/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyOutboundWebhookSignature } from "@/lib/alerts/digests";
import {
  authenticatePublicApiToken,
  buildPublicApiOpenApiSpec,
  buildSignedPublicWebhookHeaders,
  createOutgoingWebhookSubscription,
  createWorkspaceApiToken,
  queryPublicProjectMetrics,
  queryPublicProjects,
  revokeWorkspaceApiToken,
} from "@/lib/public-api/tokens";

describe("THE-167 PostgreSQL Integration: Read-only Public API Tokens, Cursor Pagination & Signed Webhooks", () => {
  beforeAll(async () => {
    await runMigrations();
    await resetTestDatabaseRecords();
  });

  afterAll(async () => {
    await resetTestDatabaseRecords();
    await closeAllDatabasePools();
  });

  it("enforces hashed scoped tokens, project allowlists, cursor pagination, revocation, and SSRF-safe webhooks", async () => {
    const ownerA = await registerUserWithDefaultOwnership({
      email: "pubapi-a@avenor.test",
      name: "Public API Owner A",
      password: "ValidPassword!2026",
      organizationName: "PubAPI Org A",
      workspaceName: "PubAPI WS A",
    });
    const ownerB = await registerUserWithDefaultOwnership({
      email: "pubapi-b@avenor.test",
      name: "Public API Owner B",
      password: "ValidPassword!2026",
      organizationName: "PubAPI Org B",
      workspaceName: "PubAPI WS B",
    });

    const projA1 = await createLogicalProject(ownerA.context, ownerA.context.activeWorkspace.id, {
      name: "Alpha Web",
      primaryDomain: "alpha.example.com",
    });
    const projA2 = await createLogicalProject(ownerA.context, ownerA.context.activeWorkspace.id, {
      name: "Beta Store",
      primaryDomain: "beta.example.com",
    });
    const projB1 = await createLogicalProject(ownerB.context, ownerB.context.activeWorkspace.id, {
      name: "Tenant B Secret App",
      primaryDomain: "b.example.com",
    });

    // Issue a workspace-wide projects:read token (without metrics:read)
    const wideToken = await createWorkspaceApiToken(ownerA.context, {
      name: "CI Projects Reader",
      scopes: ["projects:read"],
    });
    expect(wideToken.plaintextToken.startsWith("avpat_")).toBe(true);

    // Confirm plaintext token is NOT stored in PostgreSQL
    const dbRow = await dbQuery<{ token_hash: string }>(
      `SELECT token_hash FROM api_tokens WHERE id = $1`,
      [wideToken.token.id],
    );
    expect(dbRow.rows[0]?.token_hash).not.toBe(wideToken.plaintextToken);
    expect(dbRow.rows[0]?.token_hash).toHaveLength(64);

    // Cursor pagination over workspace A's 2 projects (never leaking tenant B)
    const principalWide = await authenticatePublicApiToken({
      authorizationHeader: `Bearer ${wideToken.plaintextToken}`,
      requiredScope: "projects:read",
    });
    const page1 = await queryPublicProjects(principalWide, { limit: 1 });
    expect(page1.data).toHaveLength(1);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = await queryPublicProjects(principalWide, {
      limit: 1,
      cursor: page1.nextCursor,
    });
    expect(page2.data).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    const returnedIds = [page1.data[0]?.id, page2.data[0]?.id];
    expect(returnedIds).toContain(projA1.id);
    expect(returnedIds).toContain(projA2.id);
    expect(returnedIds).not.toContain(projB1.id);

    // Scope enforcement: projects:read token must be denied metrics:read
    await expect(
      authenticatePublicApiToken({
        authorizationHeader: `Bearer ${wideToken.plaintextToken}`,
        requiredScope: "metrics:read",
        targetProjectId: projA1.id,
      }),
    ).rejects.toThrow(/lacks required read-only scope/i);

    // Project allowlist enforcement: token scoped strictly to projA1 cannot access projA2 or projB1
    const scopedToken = await createWorkspaceApiToken(ownerA.context, {
      name: "Alpha Metrics Reader",
      scopes: ["projects:read", "metrics:read"],
      allowedProjectIds: [projA1.id],
    });
    const principalA1 = await authenticatePublicApiToken({
      authorizationHeader: `Bearer ${scopedToken.plaintextToken}`,
      requiredScope: "metrics:read",
      targetProjectId: projA1.id,
    });
    const metricsRes = await queryPublicProjectMetrics(principalA1, projA1.id);
    expect(Array.isArray(metricsRes.data)).toBe(true);

    await expect(
      authenticatePublicApiToken({
        authorizationHeader: `Bearer ${scopedToken.plaintextToken}`,
        requiredScope: "metrics:read",
        targetProjectId: projA2.id,
      }),
    ).rejects.toThrow(/not authorized to access the requested project/i);

    // Revocation immediately blocks reuse
    await revokeWorkspaceApiToken(ownerA.context, scopedToken.token.id);
    await expect(
      authenticatePublicApiToken({
        authorizationHeader: `Bearer ${scopedToken.plaintextToken}`,
        requiredScope: "projects:read",
      }),
    ).rejects.toThrow(/revoked/i);

    // Outgoing webhook subscription enforces SSRF guard and signs payloads cleanly
    await expect(
      createOutgoingWebhookSubscription(ownerA.context, {
        name: "Bad Internal Hook",
        targetUrl: "https://169.254.169.254/latest/meta-data/",
        subscribedEvents: ["incident.opened"],
      }),
    ).rejects.toThrow(/SSRF/i);

    const hook = await createOutgoingWebhookSubscription(ownerA.context, {
      name: "Ops Pager Webhook",
      targetUrl: "https://hooks.example.com/avenor",
      subscribedEvents: ["incident.opened", "anomaly.detected"],
    });
    const payload = JSON.stringify({ event: "incident.opened", projectId: projA1.id });
    const headers = buildSignedPublicWebhookHeaders({
      rawBody: payload,
      deliveryId: "del_test_001",
      eventType: "incident.opened",
      signingSecret: hook.signingSecretPlaintext,
    });
    expect(
      verifyOutboundWebhookSignature({
        rawBody: payload,
        deliveryId: "del_test_001",
        signatureHeader: headers["X-Avenor-Signature"] ?? "",
        signingSecret: hook.signingSecretPlaintext,
      }),
    ).toBe(true);

    // OpenAPI 3.1 document exposes read-only endpoints cleanly
    const spec = buildPublicApiOpenApiSpec("https://app.avenor.dev");
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths as Record<string, unknown>)).toContain("/api/v1/projects");
  });
});
