"use client";

import { Button, ErrorState, FormField, TextInput, WarningBanner } from "@avenor/ui";
import Link from "next/link";
import * as React from "react";
import { AuthShell } from "@/components/auth/auth-shell";

export default function VerifyEmailPage() {
  const [email, setEmail] = React.useState("");
  const [token, setToken] = React.useState("");
  const [verified, setVerified] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token }),
      });

      const payload = await res.json();
      if (!res.ok) {
        setErrorMessage(payload?.error?.message ?? "Verification token could not be confirmed.");
        setLoading(false);
        return;
      }

      setVerified(true);
      setLoading(false);
    } catch {
      setErrorMessage("Network error while verifying email token.");
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Verify your email address"
      subtitle="Confirm your email verification token to mark your Avenor operator identity as verified."
      footerSlot={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>Already signed in?</span>
          <Link href="/dashboard" className="font-medium text-[#5157D9] hover:text-[#4047BD]">
            Go to workspace overview
          </Link>
        </div>
      }
    >
      {errorMessage ? (
        <ErrorState title="Verification failed" message={errorMessage} code="VALIDATION_ERROR" />
      ) : null}

      {verified ? (
        <div className="space-y-4">
          <WarningBanner
            tone="signal"
            title="Email address verified"
            description="Your operator email address has been confirmed in Avenor."
          />
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center h-10 px-4 rounded-[10px] bg-[#5157D9] text-white text-[14px] font-medium no-underline hover:bg-[#4047BD]"
          >
            Continue to workspace
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <FormField id="verify-email" label="Account email address" required>
            <TextInput
              id="verify-email"
              name="email"
              type="email"
              required
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>

          <FormField
            id="verify-token"
            label="Verification token"
            required
            hint="Enter the ver_... token issued during account registration."
          >
            <TextInput
              id="verify-token"
              name="token"
              type="text"
              required
              placeholder="ver_..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </FormField>

          <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
            Verify email address
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
