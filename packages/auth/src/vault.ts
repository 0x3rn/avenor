import crypto from "node:crypto";
import { assertServerRuntime } from "@avenor/config";
import {
  dbQuery,
  generateId,
  type Queryable,
  withTransaction,
  writeAuditLog,
} from "@avenor/database";
import { AppError, ERROR_CODES } from "@avenor/types";

export const CREDENTIAL_TYPES = ["oauth_tokens", "api_token", "service_account"] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

export interface VaultAadContext {
  organizationId: string;
  workspaceId: string;
  connectionId: string;
  providerKey: string;
  credentialType: CredentialType;
  version: number;
}

export interface DecryptedCredentialPayload {
  accessToken?: string;
  refreshToken?: string;
  apiToken?: string;
  tokenType?: string;
  scopes: readonly string[];
  expiresAtIso?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface EncryptedCredentialEnvelope {
  keyId: string;
  version: number;
  algorithm: "aes-256-gcm";
  nonceBase64: string;
  ciphertextBase64: string;
  authTagBase64: string;
  aadHash: string;
}

export interface StoredCredentialMetadata {
  credentialId: string;
  organizationId: string;
  workspaceId: string;
  connectionId: string;
  providerKey: string;
  credentialType: CredentialType;
  keyId: string;
  encryptionVersion: number;
  status: "ACTIVE" | "ROTATED" | "REVOKED";
  refreshTokenPresent: boolean;
  tokenExpiresAtIso: string | null;
  rotatedAtIso: string | null;
  revokedAtIso: string | null;
  updatedAtIso: string;
}

export interface VaultKeyEntry {
  keyId: string;
  version: number;
  masterKeyHex: string;
}

export interface VaultKeyRing {
  activeKeyId: string;
  activeVersion: number;
  keys: ReadonlyMap<string, VaultKeyEntry>;
}

const CUSTOM_INSPECT_SYMBOL = Symbol.for("nodejs.util.inspect.custom");

export class ProtectedCredentialHandle {
  readonly #payload: Readonly<DecryptedCredentialPayload>;

  constructor(payload: DecryptedCredentialPayload) {
    assertServerRuntime("ProtectedCredentialHandle");
    this.#payload = Object.freeze({
      ...payload,
      scopes: Object.freeze([...payload.scopes]),
      ...(payload.metadata ? { metadata: Object.freeze({ ...payload.metadata }) } : {}),
    });
  }

  public exposeSecretForServerAdapter(): Readonly<DecryptedCredentialPayload> {
    assertServerRuntime("ProtectedCredentialHandle.exposeSecretForServerAdapter");
    return this.#payload;
  }

  public toJSON(): string {
    return "[REDACTED_CREDENTIAL_HANDLE]";
  }

  public toString(): string {
    return "[REDACTED_CREDENTIAL_HANDLE]";
  }

  public [CUSTOM_INSPECT_SYMBOL](): string {
    return "[REDACTED_CREDENTIAL_HANDLE]";
  }
}

export function serializeCanonicalAad(aad: VaultAadContext): string {
  if (
    !aad.organizationId ||
    !aad.workspaceId ||
    !aad.connectionId ||
    !aad.providerKey ||
    !aad.credentialType ||
    !Number.isInteger(aad.version) ||
    aad.version < 1
  ) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "Invalid Vault AAD context: all tenant and connection binding fields are required.",
    });
  }

  return [
    "avenor-vault-aad",
    `v=${aad.version}`,
    `org=${aad.organizationId}`,
    `ws=${aad.workspaceId}`,
    `conn=${aad.connectionId}`,
    `prov=${aad.providerKey}`,
    `type=${aad.credentialType}`,
  ].join("|");
}

export function computeAadHash(aad: VaultAadContext): string {
  const canonical = serializeCanonicalAad(aad);
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

function validateMasterKeyHex(masterKeyHex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(masterKeyHex)) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "Vault master key must be a 64-character hexadecimal string (256 bits).",
    });
  }
  return Buffer.from(masterKeyHex, "hex");
}

function deriveSubkey(entry: VaultKeyEntry): Buffer {
  const masterBuf = validateMasterKeyHex(entry.masterKeyHex);
  const derived = crypto.hkdfSync(
    "sha256",
    masterBuf,
    Buffer.from("avenor-vault-hkdf-salt-v1", "utf8"),
    Buffer.from(`${entry.keyId}:v${entry.version}`, "utf8"),
    32,
  );
  return Buffer.from(derived);
}

export function createMultiVersionVaultKeyRing(options: {
  activeKeyId: string;
  activeVersion: number;
  keys: readonly VaultKeyEntry[];
}): VaultKeyRing {
  assertServerRuntime("createMultiVersionVaultKeyRing");
  const map = new Map<string, VaultKeyEntry>();
  for (const k of options.keys) {
    validateMasterKeyHex(k.masterKeyHex);
    map.set(`${k.keyId}:v${k.version}`, k);
  }
  if (!map.has(`${options.activeKeyId}:v${options.activeVersion}`)) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Active vault key "${options.activeKeyId}:v${options.activeVersion}" is missing from the provided key ring.`,
    });
  }
  return {
    activeKeyId: options.activeKeyId,
    activeVersion: options.activeVersion,
    keys: map,
  };
}

export function getDefaultVaultKeyRing(overrideMasterKeyHex?: string): VaultKeyRing {
  assertServerRuntime("getDefaultVaultKeyRing");
  const rawKey =
    overrideMasterKeyHex ??
    process.env.ENCRYPTION_MASTER_KEY ??
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  return createMultiVersionVaultKeyRing({
    activeKeyId: "avenor-kms-primary",
    activeVersion: 1,
    keys: [
      {
        keyId: "avenor-kms-primary",
        version: 1,
        masterKeyHex: rawKey,
      },
    ],
  });
}

export function encryptCredentialPayload(
  payload: DecryptedCredentialPayload,
  aadWithoutVersion: Omit<VaultAadContext, "version">,
  keyRing: VaultKeyRing = getDefaultVaultKeyRing(),
): EncryptedCredentialEnvelope {
  assertServerRuntime("encryptCredentialPayload");

  const activeLookup = `${keyRing.activeKeyId}:v${keyRing.activeVersion}`;
  const keyEntry = keyRing.keys.get(activeLookup);
  if (!keyEntry) {
    throw new AppError({
      code: ERROR_CODES.INTERNAL_ERROR,
      message: "Active encryption key entry could not be resolved.",
    });
  }

  const fullAad: VaultAadContext = {
    ...aadWithoutVersion,
    version: keyEntry.version,
  };
  const canonicalAad = serializeCanonicalAad(fullAad);
  const aadHash = computeAadHash(fullAad);
  const subkey = deriveSubkey(keyEntry);
  const nonce = crypto.randomBytes(12); // 96-bit CSPRNG nonce for AES-256-GCM

  const cipher = crypto.createCipheriv("aes-256-gcm", subkey, nonce, {
    authTagLength: 16,
  });
  cipher.setAAD(Buffer.from(canonicalAad, "utf8"));

  const plaintext = JSON.stringify(payload);
  const encryptedBuf = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    keyId: keyEntry.keyId,
    version: keyEntry.version,
    algorithm: "aes-256-gcm",
    nonceBase64: nonce.toString("base64"),
    ciphertextBase64: encryptedBuf.toString("base64"),
    authTagBase64: authTag.toString("base64"),
    aadHash,
  };
}

export function decryptCredentialEnvelope(
  envelope: EncryptedCredentialEnvelope,
  expectedAad: VaultAadContext,
  keyRing: VaultKeyRing = getDefaultVaultKeyRing(),
): ProtectedCredentialHandle {
  assertServerRuntime("decryptCredentialEnvelope");

  if (envelope.algorithm !== "aes-256-gcm") {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "Unsupported credential encryption algorithm.",
    });
  }

  if (envelope.version !== expectedAad.version) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "Credential envelope version mismatch against expected AAD context.",
    });
  }

  const lookup = `${envelope.keyId}:v${envelope.version}`;
  const keyEntry = keyRing.keys.get(lookup);
  if (!keyEntry) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: `Unknown encryption key version "${lookup}".`,
    });
  }

  let nonceBuf: Buffer;
  let ciphertextBuf: Buffer;
  let authTagBuf: Buffer;
  try {
    nonceBuf = Buffer.from(envelope.nonceBase64, "base64");
    ciphertextBuf = Buffer.from(envelope.ciphertextBase64, "base64");
    authTagBuf = Buffer.from(envelope.authTagBase64, "base64");
  } catch {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "Malformed base64 encoding in credential envelope.",
    });
  }

  if (nonceBuf.length !== 12 || authTagBuf.length !== 16 || ciphertextBuf.length === 0) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "Invalid nonce, authentication tag, or ciphertext length in credential envelope.",
    });
  }

  const canonicalAad = serializeCanonicalAad(expectedAad);
  const subkey = deriveSubkey(keyEntry);

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", subkey, nonceBuf, {
      authTagLength: 16,
    });
    decipher.setAAD(Buffer.from(canonicalAad, "utf8"));
    decipher.setAuthTag(authTagBuf);

    const decryptedBuf = Buffer.concat([decipher.update(ciphertextBuf), decipher.final()]);
    const parsed = JSON.parse(decryptedBuf.toString("utf8")) as DecryptedCredentialPayload;
    return new ProtectedCredentialHandle(parsed);
  } catch {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "Credential envelope authentication failed: integrity or tenant binding mismatch.",
    });
  }
}

export async function storeConnectionCredential(
  input: {
    organizationId: string;
    workspaceId: string;
    connectionId: string;
    providerKey: string;
    credentialType: CredentialType;
    payload: DecryptedCredentialPayload;
    actorUserId?: string | null;
    keyRing?: VaultKeyRing;
  },
  executor?: Queryable,
): Promise<StoredCredentialMetadata> {
  assertServerRuntime("storeConnectionCredential");

  // Verify the connection belongs to the exact workspace and organization
  const connRes = await dbQuery<{
    id: string;
    workspace_id: string;
    provider_key: string;
    org_id: string;
  }>(
    `SELECT pc.id, pc.workspace_id, pc.provider_key, w.organization_id AS org_id
     FROM provider_connections pc
     INNER JOIN workspaces w ON w.id = pc.workspace_id
     WHERE pc.id = $1
     LIMIT 1`,
    [input.connectionId],
    executor,
  );

  if (connRes.rows.length === 0) {
    throw new AppError({
      code: ERROR_CODES.NOT_FOUND,
      message: "Provider connection not found.",
    });
  }

  const conn = connRes.rows[0];
  if (
    conn.workspace_id !== input.workspaceId ||
    conn.org_id !== input.organizationId ||
    conn.provider_key !== input.providerKey
  ) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message:
        "Tenant boundary violation: connection does not belong to the specified workspace and organization.",
    });
  }

  const envelope = encryptCredentialPayload(
    input.payload,
    {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
      providerKey: input.providerKey,
      credentialType: input.credentialType,
    },
    input.keyRing,
  );

  const credentialId = generateId("crd");
  const refreshTokenPresent = Boolean(input.payload.refreshToken);
  const tokenExpiresAt = input.payload.expiresAtIso ? new Date(input.payload.expiresAtIso) : null;

  const upsertRes = await dbQuery<{
    id: string;
    organization_id: string;
    workspace_id: string;
    provider_connection_id: string;
    provider_key: string;
    credential_type: CredentialType;
    key_id: string;
    encryption_version: number;
    status: "ACTIVE" | "ROTATED" | "REVOKED";
    refresh_token_present: boolean;
    token_expires_at: Date | null;
    rotated_at: Date | null;
    revoked_at: Date | null;
    updated_at: Date;
  }>(
    `INSERT INTO provider_credentials (
       id,
       organization_id,
       workspace_id,
       provider_connection_id,
       provider_key,
       credential_type,
       key_id,
       encryption_version,
       algorithm,
       nonce_base64,
       ciphertext_base64,
       auth_tag_base64,
       aad_hash,
       token_expires_at,
       refresh_token_present,
       status,
       revoked_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'aes-256-gcm', $9, $10, $11, $12, $13, $14, 'ACTIVE', NULL, now())
     ON CONFLICT (provider_connection_id) DO UPDATE SET
       credential_type = EXCLUDED.credential_type,
       key_id = EXCLUDED.key_id,
       encryption_version = EXCLUDED.encryption_version,
       nonce_base64 = EXCLUDED.nonce_base64,
       ciphertext_base64 = EXCLUDED.ciphertext_base64,
       auth_tag_base64 = EXCLUDED.auth_tag_base64,
       aad_hash = EXCLUDED.aad_hash,
       token_expires_at = EXCLUDED.token_expires_at,
       refresh_token_present = EXCLUDED.refresh_token_present,
       status = 'ACTIVE',
       revoked_at = NULL,
       updated_at = now()
     RETURNING
       id,
       organization_id,
       workspace_id,
       provider_connection_id,
       provider_key,
       credential_type,
       key_id,
       encryption_version,
       status,
       refresh_token_present,
       token_expires_at,
       rotated_at,
       revoked_at,
       updated_at`,
    [
      credentialId,
      input.organizationId,
      input.workspaceId,
      input.connectionId,
      input.providerKey,
      input.credentialType,
      envelope.keyId,
      envelope.version,
      envelope.nonceBase64,
      envelope.ciphertextBase64,
      envelope.authTagBase64,
      envelope.aadHash,
      tokenExpiresAt,
      refreshTokenPresent,
    ],
    executor,
  );

  await dbQuery(
    `UPDATE provider_connections
     SET encrypted_credentials_ciphertext = $1,
         encryption_key_version = $2,
         updated_at = now()
     WHERE id = $3`,
    [
      `v${envelope.version}:${envelope.keyId}:${envelope.aadHash.slice(0, 16)}`,
      envelope.version,
      input.connectionId,
    ],
    executor,
  );

  await writeAuditLog(
    {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId ?? null,
      action: "connection.credential_stored",
      entityType: "ProviderConnection",
      entityId: input.connectionId,
      summary: `Stored encrypted ${input.credentialType} envelope for ${input.providerKey} (key ${envelope.keyId} v${envelope.version}).`,
      metadata: {
        providerKey: input.providerKey,
        credentialType: input.credentialType,
        keyId: envelope.keyId,
        encryptionVersion: envelope.version,
        refreshTokenPresent,
        scopesCount: input.payload.scopes.length,
      },
    },
    executor,
  );

  const row = upsertRes.rows[0];
  return {
    credentialId: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    connectionId: row.provider_connection_id,
    providerKey: row.provider_key,
    credentialType: row.credential_type,
    keyId: row.key_id,
    encryptionVersion: row.encryption_version,
    status: row.status,
    refreshTokenPresent: row.refresh_token_present,
    tokenExpiresAtIso: row.token_expires_at ? new Date(row.token_expires_at).toISOString() : null,
    rotatedAtIso: row.rotated_at ? new Date(row.rotated_at).toISOString() : null,
    revokedAtIso: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    updatedAtIso: new Date(row.updated_at).toISOString(),
  };
}

export async function decryptConnectionCredentialForServer(
  input: {
    organizationId: string;
    workspaceId: string;
    connectionId: string;
    keyRing?: VaultKeyRing;
  },
  executor?: Queryable,
): Promise<ProtectedCredentialHandle> {
  assertServerRuntime("decryptConnectionCredentialForServer");

  const res = await dbQuery<{
    id: string;
    organization_id: string;
    workspace_id: string;
    provider_connection_id: string;
    provider_key: string;
    credential_type: CredentialType;
    key_id: string;
    encryption_version: number;
    algorithm: "aes-256-gcm";
    nonce_base64: string;
    ciphertext_base64: string;
    auth_tag_base64: string;
    aad_hash: string;
    status: "ACTIVE" | "ROTATED" | "REVOKED";
    conn_workspace_id: string;
    conn_org_id: string;
  }>(
    `SELECT
       pc.id,
       pc.organization_id,
       pc.workspace_id,
       pc.provider_connection_id,
       pc.provider_key,
       pc.credential_type,
       pc.key_id,
       pc.encryption_version,
       pc.algorithm,
       pc.nonce_base64,
       pc.ciphertext_base64,
       pc.auth_tag_base64,
       pc.aad_hash,
       pc.status,
       conn.workspace_id AS conn_workspace_id,
       w.organization_id AS conn_org_id
     FROM provider_credentials pc
     INNER JOIN provider_connections conn ON conn.id = pc.provider_connection_id
     INNER JOIN workspaces w ON w.id = conn.workspace_id
     WHERE pc.provider_connection_id = $1
     LIMIT 1`,
    [input.connectionId],
    executor,
  );

  if (res.rows.length === 0) {
    throw new AppError({
      code: ERROR_CODES.NOT_FOUND,
      message: "Encrypted credential not found for this connection.",
    });
  }

  const row = res.rows[0];
  if (
    row.workspace_id !== input.workspaceId ||
    row.organization_id !== input.organizationId ||
    row.conn_workspace_id !== input.workspaceId ||
    row.conn_org_id !== input.organizationId
  ) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message:
        "Cross-tenant credential access denied: connection does not belong to the caller's workspace and organization.",
    });
  }

  if (row.status === "REVOKED") {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "Credential has been revoked and cannot be decrypted.",
    });
  }

  // Reconstruct AAD strictly from the caller's verified tenant parameters so any DB column
  // tampering fails AES-GCM authentication tag verification
  return decryptCredentialEnvelope(
    {
      keyId: row.key_id,
      version: row.encryption_version,
      algorithm: row.algorithm,
      nonceBase64: row.nonce_base64,
      ciphertextBase64: row.ciphertext_base64,
      authTagBase64: row.auth_tag_base64,
      aadHash: row.aad_hash,
    },
    {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
      providerKey: row.provider_key,
      credentialType: row.credential_type,
      version: row.encryption_version,
    },
    input.keyRing,
  );
}

export async function rotateConnectionCredentialKey(input: {
  organizationId: string;
  workspaceId: string;
  connectionId: string;
  keyRing: VaultKeyRing;
  actorUserId?: string | null;
  connectionString?: string;
}): Promise<StoredCredentialMetadata> {
  assertServerRuntime("rotateConnectionCredentialKey");

  return withTransaction(
    async (client) => {
      const handle = await decryptConnectionCredentialForServer(
        {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          connectionId: input.connectionId,
          keyRing: input.keyRing,
        },
        client,
      );

      const metaRes = await dbQuery<{
        provider_key: string;
        credential_type: CredentialType;
        encryption_version: number;
      }>(
        `SELECT provider_key, credential_type, encryption_version
         FROM provider_credentials
         WHERE provider_connection_id = $1
         FOR UPDATE`,
        [input.connectionId],
        client,
      );

      const current = metaRes.rows[0];
      const payload = handle.exposeSecretForServerAdapter();

      const newEnvelope = encryptCredentialPayload(
        payload,
        {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          connectionId: input.connectionId,
          providerKey: current.provider_key,
          credentialType: current.credential_type,
        },
        input.keyRing,
      );

      const updateRes = await dbQuery<{
        id: string;
        organization_id: string;
        workspace_id: string;
        provider_connection_id: string;
        provider_key: string;
        credential_type: CredentialType;
        key_id: string;
        encryption_version: number;
        status: "ACTIVE" | "ROTATED" | "REVOKED";
        refresh_token_present: boolean;
        token_expires_at: Date | null;
        rotated_at: Date | null;
        revoked_at: Date | null;
        updated_at: Date;
      }>(
        `UPDATE provider_credentials
         SET key_id = $1,
             encryption_version = $2,
             nonce_base64 = $3,
             ciphertext_base64 = $4,
             auth_tag_base64 = $5,
             aad_hash = $6,
             rotated_at = now(),
             updated_at = now()
         WHERE provider_connection_id = $7
         RETURNING
           id,
           organization_id,
           workspace_id,
           provider_connection_id,
           provider_key,
           credential_type,
           key_id,
           encryption_version,
           status,
           refresh_token_present,
           token_expires_at,
           rotated_at,
           revoked_at,
           updated_at`,
        [
          newEnvelope.keyId,
          newEnvelope.version,
          newEnvelope.nonceBase64,
          newEnvelope.ciphertextBase64,
          newEnvelope.authTagBase64,
          newEnvelope.aadHash,
          input.connectionId,
        ],
        client,
      );

      await dbQuery(
        `UPDATE provider_connections
         SET encrypted_credentials_ciphertext = $1,
             encryption_key_version = $2,
             updated_at = now()
         WHERE id = $3`,
        [
          `v${newEnvelope.version}:${newEnvelope.keyId}:${newEnvelope.aadHash.slice(0, 16)}`,
          newEnvelope.version,
          input.connectionId,
        ],
        client,
      );

      await writeAuditLog(
        {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId ?? null,
          action: "connection.credential_rotated",
          entityType: "ProviderConnection",
          entityId: input.connectionId,
          summary: `Rotated credential encryption key from v${current.encryption_version} to v${newEnvelope.version} (${newEnvelope.keyId}).`,
          metadata: {
            previousVersion: current.encryption_version,
            newVersion: newEnvelope.version,
            keyId: newEnvelope.keyId,
          },
        },
        client,
      );

      const row = updateRes.rows[0];
      return {
        credentialId: row.id,
        organizationId: row.organization_id,
        workspaceId: row.workspace_id,
        connectionId: row.provider_connection_id,
        providerKey: row.provider_key,
        credentialType: row.credential_type,
        keyId: row.key_id,
        encryptionVersion: row.encryption_version,
        status: row.status,
        refreshTokenPresent: row.refresh_token_present,
        tokenExpiresAtIso: row.token_expires_at
          ? new Date(row.token_expires_at).toISOString()
          : null,
        rotatedAtIso: row.rotated_at ? new Date(row.rotated_at).toISOString() : null,
        revokedAtIso: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
        updatedAtIso: new Date(row.updated_at).toISOString(),
      };
    },
    { connectionString: input.connectionString },
  );
}

export async function revokeAndPurgeConnectionCredential(
  input: {
    organizationId: string;
    workspaceId: string;
    connectionId: string;
    actorUserId?: string | null;
    reason?: string;
  },
  executor?: Queryable,
): Promise<void> {
  assertServerRuntime("revokeAndPurgeConnectionCredential");

  const checkRes = await dbQuery<{
    id: string;
    organization_id: string;
    workspace_id: string;
    provider_key: string;
  }>(
    `SELECT id, organization_id, workspace_id, provider_key
     FROM provider_credentials
     WHERE provider_connection_id = $1
     LIMIT 1`,
    [input.connectionId],
    executor,
  );

  if (checkRes.rows.length === 0) {
    return;
  }

  const row = checkRes.rows[0];
  if (row.organization_id !== input.organizationId || row.workspace_id !== input.workspaceId) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "Cross-tenant credential revocation denied.",
    });
  }

  await dbQuery(
    `UPDATE provider_credentials
     SET status = 'REVOKED',
         nonce_base64 = 'REVOKED_PURGED',
         ciphertext_base64 = 'REVOKED_PURGED',
         auth_tag_base64 = 'REVOKED_PURGED',
         refresh_token_present = false,
         token_expires_at = NULL,
         revoked_at = now(),
         updated_at = now()
     WHERE provider_connection_id = $1`,
    [input.connectionId],
    executor,
  );

  await dbQuery(
    `UPDATE provider_connections
     SET encrypted_credentials_ciphertext = NULL,
         updated_at = now()
     WHERE id = $1`,
    [input.connectionId],
    executor,
  );

  await writeAuditLog(
    {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId ?? null,
      action: "connection.credential_revoked",
      entityType: "ProviderConnection",
      entityId: input.connectionId,
      summary: `Revoked and purged encrypted credential material for ${row.provider_key}.`,
      metadata: {
        providerKey: row.provider_key,
        reason: input.reason ?? "disconnect",
      },
    },
    executor,
  );
}
