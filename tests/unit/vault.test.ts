// @vitest-environment node
import util from "node:util";
import {
  createMultiVersionVaultKeyRing,
  decryptCredentialEnvelope,
  encryptCredentialPayload,
  getDefaultVaultKeyRing,
  type VaultAadContext,
} from "@avenor/auth";
import { ERROR_CODES } from "@avenor/types";
import { describe, expect, it } from "vitest";

const KEY_V1 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const KEY_V2 = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

const BASE_AAD: Omit<VaultAadContext, "version"> = {
  organizationId: "org_alpha_01",
  workspaceId: "wks_alpha_01",
  connectionId: "con_alpha_01",
  providerKey: "ga4",
  credentialType: "oauth_tokens",
};

const SAMPLE_PAYLOAD = {
  accessToken: "ya29_secretAccessTokenValue123456789",
  refreshToken: "1//0gSecretRefreshTokenValue987654321",
  tokenType: "Bearer",
  scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  expiresAtIso: "2026-10-15T12:00:00.000Z",
};

describe("THE-118: Encrypted connection vault cryptographic invariants & tamper resistance", () => {
  it("performs a valid AES-256-GCM encrypt/decrypt round-trip and preserves exact payload", () => {
    const keyRing = getDefaultVaultKeyRing(KEY_V1);
    const envelope = encryptCredentialPayload(SAMPLE_PAYLOAD, BASE_AAD, keyRing);

    expect(envelope.algorithm).toBe("aes-256-gcm");
    expect(envelope.keyId).toBe("avenor-kms-primary");
    expect(envelope.version).toBe(1);
    expect(envelope.ciphertextBase64).not.toContain(SAMPLE_PAYLOAD.accessToken);
    expect(envelope.ciphertextBase64).not.toContain(SAMPLE_PAYLOAD.refreshToken);

    const handle = decryptCredentialEnvelope(envelope, { ...BASE_AAD, version: 1 }, keyRing);
    expect(handle.exposeSecretForServerAdapter()).toEqual(SAMPLE_PAYLOAD);
  });

  it("produces distinct CSPRNG nonces and distinct ciphertexts when encrypting identical secrets twice", () => {
    const keyRing = getDefaultVaultKeyRing(KEY_V1);
    const env1 = encryptCredentialPayload(SAMPLE_PAYLOAD, BASE_AAD, keyRing);
    const env2 = encryptCredentialPayload(SAMPLE_PAYLOAD, BASE_AAD, keyRing);

    expect(env1.nonceBase64).not.toBe(env2.nonceBase64);
    expect(env1.ciphertextBase64).not.toBe(env2.ciphertextBase64);
    expect(env1.authTagBase64).not.toBe(env2.authTagBase64);
  });

  it("fails decryption when ciphertext, nonce, or authentication tag is tampered with", () => {
    const keyRing = getDefaultVaultKeyRing(KEY_V1);
    const envelope = encryptCredentialPayload(SAMPLE_PAYLOAD, BASE_AAD, keyRing);
    const fullAad: VaultAadContext = { ...BASE_AAD, version: 1 };

    // 1. Tamper ciphertext
    const cipherBuf = Buffer.from(envelope.ciphertextBase64, "base64");
    cipherBuf[0] ^= 0xff;
    expect(() =>
      decryptCredentialEnvelope(
        { ...envelope, ciphertextBase64: cipherBuf.toString("base64") },
        fullAad,
        keyRing,
      ),
    ).toThrow(/authentication failed/i);

    // 2. Tamper nonce
    const nonceBuf = Buffer.from(envelope.nonceBase64, "base64");
    nonceBuf[0] ^= 0xff;
    expect(() =>
      decryptCredentialEnvelope(
        { ...envelope, nonceBase64: nonceBuf.toString("base64") },
        fullAad,
        keyRing,
      ),
    ).toThrow(/authentication failed/i);

    // 3. Tamper authTag
    const tagBuf = Buffer.from(envelope.authTagBase64, "base64");
    tagBuf[0] ^= 0xff;
    expect(() =>
      decryptCredentialEnvelope(
        { ...envelope, authTagBase64: tagBuf.toString("base64") },
        fullAad,
        keyRing,
      ),
    ).toThrow(/authentication failed/i);
  });

  it("fails decryption when any field of the canonical AAD (organizationId, workspaceId, connectionId, providerKey, credentialType, version) is modified", () => {
    const keyRing = getDefaultVaultKeyRing(KEY_V1);
    const envelope = encryptCredentialPayload(SAMPLE_PAYLOAD, BASE_AAD, keyRing);
    const validAad: VaultAadContext = { ...BASE_AAD, version: 1 };

    // Modify organizationId
    expect(() =>
      decryptCredentialEnvelope(
        envelope,
        { ...validAad, organizationId: "org_attacker_99" },
        keyRing,
      ),
    ).toThrow(/authentication failed/i);

    // Modify workspaceId
    expect(() =>
      decryptCredentialEnvelope(envelope, { ...validAad, workspaceId: "wks_attacker_99" }, keyRing),
    ).toThrow(/authentication failed/i);

    // Modify connectionId
    expect(() =>
      decryptCredentialEnvelope(envelope, { ...validAad, connectionId: "con_other_99" }, keyRing),
    ).toThrow(/authentication failed/i);

    // Modify providerKey
    expect(() =>
      decryptCredentialEnvelope(envelope, { ...validAad, providerKey: "gsc" }, keyRing),
    ).toThrow(/authentication failed/i);

    // Modify credentialType
    expect(() =>
      decryptCredentialEnvelope(envelope, { ...validAad, credentialType: "api_token" }, keyRing),
    ).toThrow(/authentication failed/i);

    // Modify version
    expect(() => decryptCredentialEnvelope(envelope, { ...validAad, version: 2 }, keyRing)).toThrow(
      /version mismatch/i,
    );
  });

  it("supports multi-version key rings and seamless key rotation from v1 to v2", () => {
    const ringV1 = createMultiVersionVaultKeyRing({
      activeKeyId: "avenor-kms-primary",
      activeVersion: 1,
      keys: [{ keyId: "avenor-kms-primary", version: 1, masterKeyHex: KEY_V1 }],
    });

    const v1Envelope = encryptCredentialPayload(SAMPLE_PAYLOAD, BASE_AAD, ringV1);
    expect(v1Envelope.version).toBe(1);

    // Rotate active key to v2 while retaining v1 in keyring
    const ringV2 = createMultiVersionVaultKeyRing({
      activeKeyId: "avenor-kms-primary",
      activeVersion: 2,
      keys: [
        { keyId: "avenor-kms-primary", version: 1, masterKeyHex: KEY_V1 },
        { keyId: "avenor-kms-primary", version: 2, masterKeyHex: KEY_V2 },
      ],
    });

    // Old v1 envelope is still decryptable under ringV2
    const decryptedFromV1 = decryptCredentialEnvelope(
      v1Envelope,
      { ...BASE_AAD, version: 1 },
      ringV2,
    );
    expect(decryptedFromV1.exposeSecretForServerAdapter()).toEqual(SAMPLE_PAYLOAD);

    // Re-encrypt under active v2
    const v2Envelope = encryptCredentialPayload(
      decryptedFromV1.exposeSecretForServerAdapter(),
      BASE_AAD,
      ringV2,
    );
    expect(v2Envelope.version).toBe(2);
    expect(v2Envelope.ciphertextBase64).not.toBe(v1Envelope.ciphertextBase64);

    // Ring with ONLY v2 cannot decrypt v1 envelope
    const ringOnlyV2 = createMultiVersionVaultKeyRing({
      activeKeyId: "avenor-kms-primary",
      activeVersion: 2,
      keys: [{ keyId: "avenor-kms-primary", version: 2, masterKeyHex: KEY_V2 }],
    });
    expect(() =>
      decryptCredentialEnvelope(v1Envelope, { ...BASE_AAD, version: 1 }, ringOnlyV2),
    ).toThrow(/Unknown encryption key version/i);
  });

  it("rejects malformed master keys and missing active key entries", () => {
    expect(() => getDefaultVaultKeyRing("not-a-64-char-hex-key")).toThrow(
      /64-character hexadecimal/i,
    );

    expect(() =>
      createMultiVersionVaultKeyRing({
        activeKeyId: "avenor-kms-primary",
        activeVersion: 3,
        keys: [{ keyId: "avenor-kms-primary", version: 1, masterKeyHex: KEY_V1 }],
      }),
    ).toThrow(/missing from the provided key ring/i);
  });

  it("redacts ProtectedCredentialHandle in JSON.stringify, String(), and util.inspect, and blocks browser runtime access", () => {
    const keyRing = getDefaultVaultKeyRing(KEY_V1);
    const envelope = encryptCredentialPayload(SAMPLE_PAYLOAD, BASE_AAD, keyRing);
    const handle = decryptCredentialEnvelope(envelope, { ...BASE_AAD, version: 1 }, keyRing);

    expect(JSON.stringify({ credential: handle })).toBe(
      '{"credential":"[REDACTED_CREDENTIAL_HANDLE]"}',
    );
    expect(String(handle)).toBe("[REDACTED_CREDENTIAL_HANDLE]");
    expect(util.inspect(handle)).toBe("[REDACTED_CREDENTIAL_HANDLE]");

    // Simulate browser window object to verify client-side boundary protection
    const fakeWindow = {} as Window & typeof globalThis;
    Object.defineProperty(globalThis, "window", {
      value: fakeWindow,
      configurable: true,
      writable: true,
    });
    try {
      expect(() => encryptCredentialPayload(SAMPLE_PAYLOAD, BASE_AAD, keyRing)).toThrowError(
        expect.objectContaining({ code: ERROR_CODES.FORBIDDEN }),
      );
      expect(() => handle.exposeSecretForServerAdapter()).toThrowError(
        expect.objectContaining({ code: ERROR_CODES.FORBIDDEN }),
      );
    } finally {
      Reflect.deleteProperty(globalThis, "window");
    }
  });
});
