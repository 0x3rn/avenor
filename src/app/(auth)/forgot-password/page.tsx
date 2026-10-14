"use client";

import { Button, ErrorState, FormField, TextInput, WarningBanner } from "@avenor/ui";
import { Mail } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { AuthShell } from "@/components/auth/auth-shell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const payload = await res.json();
      if (!res.ok) {
        setErrorMessage(payload?.error?.message ?? "Unable to submit recovery request.");
        setLoading(false);
        return;
      }

      setSubmitted(true);
      setLoading(false);
    } catch {
      setErrorMessage("Network error while submitting recovery request.");
      setLoading(false);
    }
  }

  return (
    <AuthShell
      variant="forgot-password"
      eyebrow="ACCOUNT RECOVERY"
      title="Reset your password"
      subtitle="Enter the email address associated with your Avenor account and we’ll send you a secure password reset link."
      footerSlot={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>Remembered your password?</span>
          <Link href="/login" className="font-medium text-[#5157D9] hover:text-[#4047BD]">
            Return to sign in
          </Link>
        </div>
      }
    >
      {errorMessage ? (
        <ErrorState title="Recovery error" message={errorMessage} code="VALIDATION_ERROR" />
      ) : null}

      {submitted ? (
        <div className="space-y-4">
          <WarningBanner
            tone="signal"
            title="Password reset link sent"
            description={`If an Avenor account exists for ${email}, we’ve sent a single-use password reset link that expires in 60 minutes.`}
          />
          <Link
            href="/login"
            className="inline-flex items-center justify-center h-10 px-4 rounded-[10px] bg-[#5157D9] text-white text-[14px] font-medium no-underline hover:bg-[#4047BD]"
          >
            Return to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <FormField id="reset-email" label="Work email" required>
            <TextInput
              id="reset-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={loading}
            leftIcon={<Mail className="h-4 w-4" aria-hidden="true" />}
            className="w-full"
          >
            Send password reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
