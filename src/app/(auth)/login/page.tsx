"use client";

import { Button, ErrorState, FormField, TextInput } from "@avenor/ui";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { AuthShell } from "@/components/auth/auth-shell";

export default function LoginPage() {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const payload = await res.json();
      if (!res.ok) {
        setErrorMessage(payload?.error?.message ?? "Unable to sign in with those credentials.");
        setLoading(false);
        return;
      }

      window.location.assign("/dashboard");
    } catch {
      setErrorMessage("Network error while signing in. Please verify your connection and retry.");
      setLoading(false);
    }
  }

  return (
    <AuthShell
      variant="login"
      eyebrow="WORKSPACE ACCESS"
      title="Sign in to Avenor"
      subtitle="Enter your credentials to open your product portfolio, intelligence domains, and operational alerts."
      footerSlot={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>New to Avenor?</span>
          <Link href="/signup" className="font-medium text-[#5157D9] hover:text-[#4047BD]">
            Create a free workspace
          </Link>
        </div>
      }
    >
      {errorMessage ? (
        <ErrorState title="Sign-in failed" message={errorMessage} code="UNAUTHENTICATED" />
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <FormField id="login-email" label="Work email" required>
          <TextInput
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="login-password" className="text-[13.5px] font-medium text-[#17243A]">
              Password
              <span className="text-[#BF4256] ml-1" aria-hidden="true">
                *
              </span>
            </label>
            <Link
              href="/forgot-password"
              className="text-[13px] font-medium text-[#5157D9] hover:text-[#4047BD] no-underline"
            >
              Forgot password?
            </Link>
          </div>
          <TextInput
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={loading}
          rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
          className="w-full"
        >
          Sign in to workspace
        </Button>
      </form>
    </AuthShell>
  );
}
