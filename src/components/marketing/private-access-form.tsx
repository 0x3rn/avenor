"use client";

import { Badge, Button, TextInput } from "@avenor/ui";
import { CheckCircle2, Lock } from "lucide-react";
import * as React from "react";

export function PrivateAccessRequestForm() {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [productCountHint, setProductCountHint] = React.useState("2-5 products");
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [confirmationMessage, setConfirmationMessage] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    setConfirmationMessage(null);

    if (name.trim().length < 2) {
      setErrorMessage("Please enter your name (at least 2 characters).");
      return;
    }
    if (!email.includes("@")) {
      setErrorMessage("Please enter a valid email address.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/access-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          productCountHint,
        }),
      });
      const data = (await response.json()) as {
        confirmationMessage?: string;
        error?: { message?: string };
      };
      if (!response.ok) {
        setErrorMessage(data.error?.message ?? "Unable to record your private access request.");
        return;
      }
      setConfirmationMessage(
        data.confirmationMessage ??
          "Private preview request recorded securely. We will follow up when access is enabled.",
      );
      setName("");
      setEmail("");
    } catch {
      setErrorMessage("Network error while submitting your request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      id="request-access"
      data-testid="private-access-request-card"
      className="mx-auto mt-8 max-w-xl rounded-xl border border-[#2E4066] bg-[#162138] p-6 text-left space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[14px] font-semibold text-[#F8FAFC]">
          <Lock className="h-4 w-4 text-[#7C83FF]" aria-hidden="true" />
          <span>Request Private Preview Access</span>
        </div>
        <Badge tone="indigo">Invite-Gated MVP</Badge>
      </div>

      {confirmationMessage ? (
        <div
          role="status"
          data-testid="private-access-confirmation"
          className="flex items-start gap-2.5 rounded-lg border border-[#147D63] bg-[#0F2A24] p-3.5 text-[13px] text-[#B9E6D2]"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-[#34D399]" aria-hidden="true" />
          <span>{confirmationMessage}</span>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3" noValidate>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="access-request-name"
                className="block text-[12px] font-medium text-[#CBD5E1] mb-1"
              >
                Your name
              </label>
              <TextInput
                id="access-request-name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada Lovelace"
                required
                className="bg-[#0F172A] border-[#334155] text-[#F8FAFC] placeholder:text-[#64748B]"
              />
            </div>
            <div>
              <label
                htmlFor="access-request-email"
                className="block text-[12px] font-medium text-[#CBD5E1] mb-1"
              >
                Work or personal email
              </label>
              <TextInput
                id="access-request-email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="founder@product.dev"
                required
                className="bg-[#0F172A] border-[#334155] text-[#F8FAFC] placeholder:text-[#64748B]"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <select
              aria-label="Number of digital products"
              value={productCountHint}
              onChange={(e) => setProductCountHint(e.target.value)}
              className="h-10 rounded-[10px] border border-[#334155] bg-[#0F172A] px-3 text-[13px] text-[#E2E8F0]"
            >
              <option value="1 product">Managing 1 product</option>
              <option value="2-5 products">Managing 2–5 products</option>
              <option value="6+ products">Managing 6+ products</option>
            </select>
            <Button type="submit" loading={submitting} size="md">
              Request private access
            </Button>
          </div>

          {errorMessage ? (
            <p role="alert" className="text-[12.5px] text-[#FDA4AF] m-0">
              {errorMessage}
            </p>
          ) : null}

          <p className="text-[11.5px] text-[#94A3B8] m-0">
            Stored solely in Avenor&apos;s access ledger for private preview authorization. Never
            sold or shared with third-party brokers.
          </p>
        </form>
      )}
    </div>
  );
}
