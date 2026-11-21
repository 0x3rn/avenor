import { describe, expect, it } from "vitest";
import {
  createSignedExportDownloadToken,
  verifySignedExportDownloadToken,
} from "@/lib/exports/service";

describe("THE-158: Expiring HMAC-signed export download token verification", () => {
  it("validates authentic tokens before expiry and rejects expired, tampered, or cross-workspace tokens", () => {
    const expiresAtIso = "2026-11-22T12:00:00.000Z";
    const token = createSignedExportDownloadToken({
      exportId: "expj_1",
      workspaceId: "ws_alpha",
      expiresAtIso,
    });

    expect(
      verifySignedExportDownloadToken({
        exportId: "expj_1",
        workspaceId: "ws_alpha",
        token,
        nowMs: Date.parse("2026-11-22T11:00:00.000Z"),
      }),
    ).toBe(true);

    // Expired
    expect(
      verifySignedExportDownloadToken({
        exportId: "expj_1",
        workspaceId: "ws_alpha",
        token,
        nowMs: Date.parse("2026-11-22T12:01:00.000Z"),
      }),
    ).toBe(false);

    // Wrong workspace
    expect(
      verifySignedExportDownloadToken({
        exportId: "expj_1",
        workspaceId: "ws_beta",
        token,
        nowMs: Date.parse("2026-11-22T11:00:00.000Z"),
      }),
    ).toBe(false);

    // Tampered token
    expect(
      verifySignedExportDownloadToken({
        exportId: "expj_1",
        workspaceId: "ws_alpha",
        token: `${token.slice(0, -1)}0`,
        nowMs: Date.parse("2026-11-22T11:00:00.000Z"),
      }),
    ).toBe(false);
  });
});
