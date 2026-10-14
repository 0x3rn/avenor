import crypto from "node:crypto";

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string | null | undefined): boolean {
  if (!storedHash?.startsWith("scrypt$")) {
    return false;
  }
  const parts = storedHash.split("$");
  if (parts.length !== 3) {
    return false;
  }
  const [, salt, expectedHex] = parts;
  const derivedBuffer = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const expectedBuffer = Buffer.from(expectedHex, "hex");
  if (derivedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(derivedBuffer, expectedBuffer);
}

export function getAuthSecret(): string {
  return (
    process.env.BETTER_AUTH_SECRET ?? "dev-only-secret-do-not-use-in-production-0123456789abcdef"
  );
}

export function generateSignedSessionToken(): { rawToken: string; tokenHash: string } {
  const randomPart = crypto.randomBytes(32).toString("hex");
  const signature = crypto.createHmac("sha256", getAuthSecret()).update(randomPart).digest("hex");
  const rawToken = `${randomPart}.${signature}`;
  const tokenHash = hashSessionToken(rawToken);
  return { rawToken, tokenHash };
}

export function verifySignedSessionTokenFormat(rawToken: string): boolean {
  const parts = rawToken.split(".");
  if (parts.length !== 2) {
    return false;
  }
  const [randomPart, providedSig] = parts;
  if (!randomPart || !providedSig) {
    return false;
  }
  const expectedSig = crypto.createHmac("sha256", getAuthSecret()).update(randomPart).digest("hex");
  const providedBuf = Buffer.from(providedSig, "hex");
  const expectedBuf = Buffer.from(expectedSig, "hex");
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

export function hashSessionToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function slugifyIdentifier(input: string, fallback = "workspace"): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base.length >= 2 ? base : fallback;
}
