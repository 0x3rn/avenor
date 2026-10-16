import "dotenv/config";
import {
  createMultiVersionVaultKeyRing,
  decryptConnectionCredentialForServer,
  registerUserWithDefaultOwnership,
  revokeAndPurgeConnectionCredential,
  rotateConnectionCredentialKey,
  storeConnectionCredential,
} from "@avenor/auth";
import {
  closeAllDatabasePools,
  dbQuery,
  generateId,
  listAuditLogsForWorkspace,
  resetTestDatabaseRecords,
  runMigrations,
} from "@avenor/database";
import { ERROR_CODES } from "@avenor/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const KEY_V1 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const KEY_V2 = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

describe("THE-118: PostgreSQL encrypted connection vault persistence, tenant isolation, and key rotation", () => {
  beforeAll(async () => {
    await runMigrations({ connectionString: TEST_DB_URL });
    await resetTestDatabaseRecords({ connectionString: TEST_DB_URL });
  });

  afterAll(async () => {
    await resetTestDatabaseRecords({ connectionString: TEST_DB_URL });
    await closeAllDatabasePools();
  });

  it("encrypts credentials at rest, isolates decryption by tenant/workspace, rotates keys without data loss, and purges on revocation", async () => {
    const tenantA = await registerUserWithDefaultOwnership({
      name: "Tenant A Owner",
      email: "vault-tenant-a@avenor.test",
      password: "VaultSecurePassword!123",
      organizationName: "Vault Org A",
      workspaceName: "Vault Workspace A",
    });

    const tenantB = await registerUserWithDefaultOwnership({
      name: "Tenant B Owner",
      email: "vault-tenant-b@avenor.test",
      password: "VaultSecurePassword!123",
      organizationName: "Vault Org B",
      workspaceName: "Vault Workspace B",
    });

    const connectionIdA = generateId("con");
    await dbQuery(
      `INSERT INTO provider_connections (
         id, workspace_id, provider_key, display_name, auth_mode, status, granted_scopes, created_by_user_id
       )
       VALUES ($1, $2, 'ga4', 'GA4 Production Connection', 'oauth2', 'HEALTHY', ARRAY['https://www.googleapis.com/auth/analytics.readonly'], $3)`,
      [connectionIdA, tenantA.context.activeWorkspace.id, tenantA.context.user.id],
    );

    const ringV1 = createMultiVersionVaultKeyRing({
      activeKeyId: "avenor-kms-primary",
      activeVersion: 1,
      keys: [{ keyId: "avenor-kms-primary", version: 1, masterKeyHex: KEY_V1 }],
    });

    const rawSecretPayload = {
      accessToken: "ya29_liveSecretAccessTokenValueForTenantA",
      refreshToken: "1//0gLiveRefreshTokenValueForTenantA",
      tokenType: "Bearer",
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
      expiresAtIso: "2026-10-16T00:00:00.000Z",
    };

    const storedMeta = await storeConnectionCredential({
      organizationId: tenantA.context.activeWorkspace.organizationId,
      workspaceId: tenantA.context.activeWorkspace.id,
      connectionId: connectionIdA,
      providerKey: "ga4",
      credentialType: "oauth_tokens",
      payload: rawSecretPayload,
      actorUserId: tenantA.context.user.id,
      keyRing: ringV1,
    });

    // Public metadata never contains raw tokens or ciphertexts
    expect(JSON.stringify(storedMeta)).not.toContain(rawSecretPayload.accessToken);
    expect(JSON.stringify(storedMeta)).not.toContain(rawSecretPayload.refreshToken);
    expect(storedMeta.encryptionVersion).toBe(1);
    expect(storedMeta.refreshTokenPresent).toBe(true);

    // Inspect raw PostgreSQL columns to prove encryption at rest
    const rawDbRow = await dbQuery<{
      nonce_base64: string;
      ciphertext_base64: string;
      auth_tag_base64: string;
    }>(
      `SELECT nonce_base64, ciphertext_base64, auth_tag_base64
       FROM provider_credentials
       WHERE provider_connection_id = $1`,
      [connectionIdA],
    );
    expect(rawDbRow.rows).toHaveLength(1);
    expect(rawDbRow.rows[0].ciphertext_base64).not.toContain(rawSecretPayload.accessToken);
    expect(rawDbRow.rows[0].ciphertext_base64).not.toContain(rawSecretPayload.refreshToken);

    // Tenant A server context can decrypt its own connection credential
    const decryptedA = await decryptConnectionCredentialForServer({
      organizationId: tenantA.context.activeWorkspace.organizationId,
      workspaceId: tenantA.context.activeWorkspace.id,
      connectionId: connectionIdA,
      keyRing: ringV1,
    });
    expect(decryptedA.exposeSecretForServerAdapter()).toEqual(rawSecretPayload);

    // Tenant B attempting to decrypt Tenant A's connectionId is rejected with FORBIDDEN
    await expect(
      decryptConnectionCredentialForServer({
        organizationId: tenantB.context.activeWorkspace.organizationId,
        workspaceId: tenantB.context.activeWorkspace.id,
        connectionId: connectionIdA,
        keyRing: ringV1,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });

    // Tenant B attempting to overwrite Tenant A's connection credential is rejected with FORBIDDEN
    await expect(
      storeConnectionCredential({
        organizationId: tenantB.context.activeWorkspace.organizationId,
        workspaceId: tenantB.context.activeWorkspace.id,
        connectionId: connectionIdA,
        providerKey: "ga4",
        credentialType: "oauth_tokens",
        payload: rawSecretPayload,
        keyRing: ringV1,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });

    // Rotate key from v1 to v2 atomically
    const ringV2 = createMultiVersionVaultKeyRing({
      activeKeyId: "avenor-kms-primary",
      activeVersion: 2,
      keys: [
        { keyId: "avenor-kms-primary", version: 1, masterKeyHex: KEY_V1 },
        { keyId: "avenor-kms-primary", version: 2, masterKeyHex: KEY_V2 },
      ],
    });

    const rotatedMeta = await rotateConnectionCredentialKey({
      organizationId: tenantA.context.activeWorkspace.organizationId,
      workspaceId: tenantA.context.activeWorkspace.id,
      connectionId: connectionIdA,
      keyRing: ringV2,
      actorUserId: tenantA.context.user.id,
      connectionString: TEST_DB_URL,
    });

    expect(rotatedMeta.encryptionVersion).toBe(2);
    expect(rotatedMeta.rotatedAtIso).not.toBeNull();

    const decryptedAfterRotation = await decryptConnectionCredentialForServer({
      organizationId: tenantA.context.activeWorkspace.organizationId,
      workspaceId: tenantA.context.activeWorkspace.id,
      connectionId: connectionIdA,
      keyRing: ringV2,
    });
    expect(decryptedAfterRotation.exposeSecretForServerAdapter()).toEqual(rawSecretPayload);

    // Revoke and purge credential material
    await revokeAndPurgeConnectionCredential({
      organizationId: tenantA.context.activeWorkspace.organizationId,
      workspaceId: tenantA.context.activeWorkspace.id,
      connectionId: connectionIdA,
      actorUserId: tenantA.context.user.id,
      reason: "user_disconnect",
    });

    await expect(
      decryptConnectionCredentialForServer({
        organizationId: tenantA.context.activeWorkspace.organizationId,
        workspaceId: tenantA.context.activeWorkspace.id,
        connectionId: connectionIdA,
        keyRing: ringV2,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });

    // Verify audit logs contain zero raw secret values
    const logs = await listAuditLogsForWorkspace(tenantA.context.activeWorkspace.id, 20);
    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).not.toContain(rawSecretPayload.accessToken);
    expect(serializedLogs).not.toContain(rawSecretPayload.refreshToken);
    expect(logs.map((l) => l.action)).toEqual(
      expect.arrayContaining([
        "connection.credential_stored",
        "connection.credential_rotated",
        "connection.credential_revoked",
      ]),
    );
  });
});
