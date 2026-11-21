import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PrivateAccessRequestForm } from "@/components/marketing/private-access-form";
import {
  assertPrivateSignupAllowed,
  evaluatePrivateAccessGate,
  hashRequestSourceIp,
} from "@/lib/onboarding/private-access";

describe("THE-144: Private MVP access gating, homepage access request, and onboarding polish", () => {
  it("enforces server-side private allowlist signup gating without relying on hardcoded emails", async () => {
    const allowlistEnv = {
      AVENOR_PRIVATE_ACCESS_MODE: "allowlist",
      AVENOR_ALLOWED_SIGNUP_EMAILS: "owner@avenor.dev, founder@studio.io",
    };

    const allowedVerdict = await evaluatePrivateAccessGate("OWNER@avenor.dev", {
      rawEnv: allowlistEnv,
      checkDatabaseApproval: false,
    });
    expect(allowedVerdict.allowed).toBe(true);
    expect(allowedVerdict.mode).toBe("allowlist");

    const deniedVerdict = await evaluatePrivateAccessGate("stranger@public.example", {
      rawEnv: allowlistEnv,
      checkDatabaseApproval: false,
    });
    expect(deniedVerdict.allowed).toBe(false);

    await expect(
      assertPrivateSignupAllowed("stranger@public.example", {
        rawEnv: allowlistEnv,
        checkDatabaseApproval: false,
      }),
    ).rejects.toThrow(/private preview/i);

    // Open mode permits registration cleanly
    const openVerdict = await evaluatePrivateAccessGate("anyone@avenor.test", {
      rawEnv: { AVENOR_PRIVATE_ACCESS_MODE: "open" },
      checkDatabaseApproval: false,
    });
    expect(openVerdict.allowed).toBe(true);
  });

  it("hashes source IPs deterministically without preserving raw IP strings", () => {
    const hashA = hashRequestSourceIp("203.0.113.10");
    const hashB = hashRequestSourceIp("203.0.113.10");
    expect(hashA).toBe(hashB);
    expect(hashA).not.toContain("203.0.113.10");
    expect(hashRequestSourceIp("")).toBeNull();
  });

  it("validates and submits the public homepage PrivateAccessRequestForm with confirmation state", async () => {
    const mockFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          id: "par_123",
          status: "PENDING",
          alreadyRequested: false,
          confirmationMessage:
            "Private preview request recorded securely. You will be notified once access is granted.",
        }),
        { status: 201 },
      );
    }) as unknown as typeof fetch;

    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      render(<PrivateAccessRequestForm />);
      expect(screen.getByTestId("private-access-request-card")).toBeInTheDocument();

      // Empty submit shows inline validation error
      fireEvent.click(screen.getByRole("button", { name: /Request private access/i }));
      expect(screen.getByRole("alert")).toHaveTextContent(/enter your name/i);

      // Valid submit calls POST /api/access-request and renders confirmation
      fireEvent.change(screen.getByLabelText(/Your name/i), { target: { value: "Ada Lovelace" } });
      fireEvent.change(screen.getByLabelText(/Work or personal email/i), {
        target: { value: "ada@analytical.dev" },
      });
      fireEvent.click(screen.getByRole("button", { name: /Request private access/i }));

      await waitFor(() => {
        expect(screen.getByTestId("private-access-confirmation")).toHaveTextContent(
          /Private preview request recorded securely/i,
        );
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
