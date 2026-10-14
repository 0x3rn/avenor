"use client";

import { Button, ErrorState, FormField, TextInput } from "@avenor/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { AuthShell } from "@/components/auth/auth-shell";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [organizationName, setOrganizationName] = React.useState("");
  const [workspaceName, setWorkspaceName] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setFieldErrors({});
    setLoading(true);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          password,
          organizationName: organizationName.trim() || undefined,
          workspaceName: workspaceName.trim() || undefined,
        }),
      });

      const payload = await res.json();
      if (!res.ok) {
        setErrorMessage(payload?.error?.message ?? "Unable to create account.");
        if (payload?.error?.details) {
          setFieldErrors(payload.error.details);
        }
        setLoading(false);
        return;
      }

      router.push("/onboarding");
      router.refresh();
    } catch {
      setErrorMessage("Network error while creating your account. Please retry.");
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Create your Avenor account"
      subtitle="Provision your organization and default workspace in a single atomic step."
      footerSlot={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>Already have an account?</span>
          <Link href="/login" className="font-medium text-[#5157D9] hover:text-[#4047BD]">
            Sign in
          </Link>
        </div>
      }
    >
      {errorMessage ? (
        <ErrorState title="Registration error" message={errorMessage} code="VALIDATION_ERROR" />
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <FormField id="signup-name" label="Full name" required error={fieldErrors.name?.[0]}>
          <TextInput
            id="signup-name"
            name="name"
            type="text"
            autoComplete="name"
            required
            hasError={Boolean(fieldErrors.name)}
            placeholder="Ada Lovelace"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>

        <FormField id="signup-email" label="Work email" required error={fieldErrors.email?.[0]}>
          <TextInput
            id="signup-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            hasError={Boolean(fieldErrors.email)}
            placeholder="ada@analytical-engine.org"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>

        <FormField
          id="signup-password"
          label="Password"
          required
          hint="At least 8 characters. Used to protect your workspace session."
          error={fieldErrors.password?.[0]}
        >
          <TextInput
            id="signup-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            hasError={Boolean(fieldErrors.password)}
            placeholder="Create a strong password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormField>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <FormField
            id="signup-organization"
            label="Organization name"
            hint="Optional — defaults to your name."
          >
            <TextInput
              id="signup-organization"
              name="organizationName"
              type="text"
              placeholder="Acme Systems"
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
            />
          </FormField>

          <FormField
            id="signup-workspace"
            label="Initial workspace name"
            hint="Optional — defaults to Primary Workspace."
          >
            <TextInput
              id="signup-workspace"
              name="workspaceName"
              type="text"
              placeholder="Core Product"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
            />
          </FormField>
        </div>

        <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
          Create account and workspace
        </Button>
      </form>
    </AuthShell>
  );
}
