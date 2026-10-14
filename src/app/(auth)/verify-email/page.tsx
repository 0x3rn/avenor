"use client";

import { Button, ErrorState, FormField, TextInput, WarningBanner } from "@avenor/ui";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { AuthShell } from "@/components/auth/auth-shell";

export default function VerifyEmailPage() {
  const [email, setEmail] = React.useState("");
  const [token, setToken] = React.useState("");
  const [verified, setVerified] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get("token");
    const emailParam = params.get("email");
    if (tokenParam) {
      setToken(tokenParam);
    }
    if (emailParam) {
      setEmail(emailParam);
    }
  }, []);

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
        setErrorMessage(payload?.error?.message ?? "Verification code could not be confirmed.");
        setLoading(false);
        return;
      }

      setVerified(true);
      setLoading(false);
    } catch {
      setErrorMessage("Network error while verifying email address.");
      setLoading(false);
    }
  }

  return (
    <AuthShell
      variant="verify-email"
      eyebrow="IDENTITY VERIFICATION"
      title="Verify your email address"
      subtitle="Click the verification link sent to your inbox, or paste your verification code below to confirm your email address."
      footerSlot={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href="/dashboard" className="font-medium text-[#5157D9] hover:text-[#4047BD]">
            Open workspace dashboard
          </Link>
          <span>·</span>
          <Link href="/login" className="font-medium text-[#5157D9] hover:text-[#4047BD]">
            Back to sign in
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
            description="Your email address has been confirmed in Avenor."
          />
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center h-10 px-4 rounded-[10px] bg-[#5157D9] text-white text-[14px] font-medium no-underline hover:bg-[#4047BD]"
          >
            Open workspace dashboard
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <FormField id="verify-email" label="Work email" required>
            <TextInput
              id="verify-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>

          <FormField id="verify-token" label="Verification code" required>
            <TextInput
              id="verify-token"
              name="token"
              type="text"
              required
              placeholder="Paste verification code"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </FormField>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={loading}
            leftIcon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
            className="w-full"
          >
            Confirm email address
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
