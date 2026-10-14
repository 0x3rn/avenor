"use client";

import { Button, ErrorState, FormField, TextInput } from "@avenor/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { AuthShell } from "@/components/auth/auth-shell";

export default function LoginPage() {
  const router = useRouter();
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

      router.push("/dashboard");
      router.refresh();
    } catch {
      setErrorMessage("Network error while signing in. Please verify your connection and retry.");
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Sign in to Avenor"
      subtitle="Access your organization workspaces, logical projects, and environment signal maps."
      footerSlot={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>New to Avenor?</span>
          <Link href="/signup" className="font-medium text-[#5157D9] hover:text-[#4047BD]">
            Create an account and workspace
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

        <FormField id="login-password" label="Password" required hint="Minimum 8 characters.">
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
        </FormField>

        <div className="flex items-center justify-end">
          <Link
            href="/forgot-password"
            className="text-[13px] font-medium text-[#5157D9] hover:text-[#4047BD] no-underline"
          >
            Forgot password?
          </Link>
        </div>

        <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
          Sign in to workspace
        </Button>
      </form>
    </AuthShell>
  );
}
