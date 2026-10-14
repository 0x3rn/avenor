// @vitest-environment node
import {
  assertReadOnlyScopesOnly,
  generatePkcePair,
  getAllowedOAuthRedirectUris,
  validateOAuthRedirectUri,
  verifyPkceCodeChallenge,
} from "@avenor/auth";
import { ERROR_CODES } from "@avenor/types";
import { describe, expect, it } from "vitest";

describe("THE-119: OAuth PKCE (S256), read-only scope guard, and redirect URI allowlist unit tests", () => {
  it("generates cryptographically valid S256 PKCE pairs and rejects mismatched or short verifiers", () => {
    const pkce1 = generatePkcePair();
    const pkce2 = generatePkcePair();

    expect(pkce1.codeChallengeMethod).toBe("S256");
    expect(pkce1.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(pkce1.codeVerifier).not.toBe(pkce2.codeVerifier);
    expect(pkce1.codeChallenge).not.toBe(pkce2.codeChallenge);

    expect(verifyPkceCodeChallenge(pkce1.codeVerifier, pkce1.codeChallenge)).toBe(true);
    expect(verifyPkceCodeChallenge(pkce2.codeVerifier, pkce1.codeChallenge)).toBe(false);
    expect(verifyPkceCodeChallenge("too-short", pkce1.codeChallenge)).toBe(false);
  });

  it("permits read-only scopes and rejects any write, admin, delete, or full-control scopes", () => {
    expect(() =>
      assertReadOnlyScopesOnly("ga4", ["https://www.googleapis.com/auth/analytics.readonly"]),
    ).not.toThrow();

    expect(() =>
      assertReadOnlyScopesOnly("github", ["read:user", "repo:status", "public_repo"]),
    ).not.toThrow();

    const prohibitedScopes = [
      "https://www.googleapis.com/auth/analytics.edit",
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/webmasters",
      "repo",
      "delete_repo",
      "projects:write",
      "org:admin",
      "resources.mutate",
    ];

    for (const badScope of prohibitedScopes) {
      expect(() => assertReadOnlyScopesOnly("ga4", [badScope])).toThrowError(
        expect.objectContaining({
          code: ERROR_CODES.PRODUCTION_SAFETY_VIOLATION,
        }),
      );
    }
  });

  it("enforces exact redirect URI allowlist matching and rejects open redirects, query strings, fragments, and path traversal", () => {
    const allowlist = getAllowedOAuthRedirectUris({
      NEXT_PUBLIC_APP_URL: "https://avenor.corstack.dev",
      BETTER_AUTH_URL: "http://localhost:3000",
    });

    expect(
      validateOAuthRedirectUri(
        "https://avenor.corstack.dev/api/connections/oauth/callback",
        allowlist,
      ),
    ).toBe("https://avenor.corstack.dev/api/connections/oauth/callback");

    expect(
      validateOAuthRedirectUri("http://localhost:3000/api/connections/oauth/callback", allowlist),
    ).toBe("http://localhost:3000/api/connections/oauth/callback");

    // Reject external attacker origin
    expect(() =>
      validateOAuthRedirectUri(
        "https://evil.example.com/api/connections/oauth/callback",
        allowlist,
      ),
    ).toThrowError(expect.objectContaining({ code: ERROR_CODES.FORBIDDEN }));

    // Reject query parameter injection
    expect(() =>
      validateOAuthRedirectUri(
        "https://avenor.corstack.dev/api/connections/oauth/callback?next=https://evil.com",
        allowlist,
      ),
    ).toThrowError(expect.objectContaining({ code: ERROR_CODES.VALIDATION_ERROR }));

    // Reject fragment injection
    expect(() =>
      validateOAuthRedirectUri(
        "https://avenor.corstack.dev/api/connections/oauth/callback#token",
        allowlist,
      ),
    ).toThrowError(expect.objectContaining({ code: ERROR_CODES.VALIDATION_ERROR }));

    // Reject path traversal
    expect(() =>
      validateOAuthRedirectUri(
        "https://avenor.corstack.dev/api/connections/oauth/../callback",
        allowlist,
      ),
    ).toThrowError(expect.objectContaining({ code: ERROR_CODES.VALIDATION_ERROR }));

    // Reject non-http protocol
    expect(() => validateOAuthRedirectUri("javascript:alert(1)", allowlist)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.VALIDATION_ERROR }),
    );
  });
});
