"use client";

import { Button, Card, FormField, Select, TextInput } from "@avenor/ui";
import * as React from "react";
import type { SupportCategory } from "@/lib/support/service";

export function SupportRequestForm() {
  const [contactEmail, setContactEmail] = React.useState("");
  const [category, setCategory] = React.useState<SupportCategory>("GENERAL");
  const [subject, setSubject] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [confirmationId, setConfirmationId] = React.useState<string | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);
    setConfirmationId(null);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactEmail, category, subject, description }),
      });
      const payload = (await res.json()) as {
        ticket?: { id: string };
        error?: { message?: string };
      };
      if (!res.ok || !payload.ticket) {
        setErrorMessage(payload.error?.message ?? "Unable to submit support request.");
        return;
      }
      setConfirmationId(payload.ticket.id);
      setSubject("");
      setDescription("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-6 space-y-4">
      <h2 className="text-[18px] font-semibold text-[#17243A]">Contact Avenor Support</h2>
      <p className="text-[13.5px] text-[#475569]">
        Never paste OAuth tokens, API keys, or database passwords. Any accidentally included secret
        patterns are automatically redacted before storage.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField id="support-email" label="Contact Email">
            <TextInput
              id="support-email"
              type="email"
              required
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="founder@company.com"
            />
          </FormField>
          <FormField id="support-category" label="Topic">
            <Select
              id="support-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as SupportCategory)}
            >
              <option value="GENERAL">General Question</option>
              <option value="INTEGRATION">Provider Connection</option>
              <option value="BILLING">Subscription & Billing</option>
              <option value="BUG">Bug / Data Discrepancy</option>
              <option value="SECURITY">Security Report</option>
              <option value="FEEDBACK">Product Feedback</option>
            </Select>
          </FormField>
        </div>

        <FormField id="support-subject" label="Subject">
          <TextInput
            id="support-subject"
            required
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Brief summary of your question or issue"
          />
        </FormField>

        <FormField id="support-description" label="Details">
          <textarea
            id="support-description"
            required
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-[8px] border border-[#C7D2E3] bg-[#FFFFFF] px-3 py-2 text-[14px] text-[#17243A] focus:border-[#5157D9] focus:outline-none"
            placeholder="Describe what you observed, including project or provider context without credentials..."
          />
        </FormField>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Sending..." : "Submit Support Request"}
          </Button>
          {confirmationId && (
            <span className="text-[13px] font-medium text-[#15803D]">
              Request recorded (Reference: {confirmationId}).
            </span>
          )}
          {errorMessage && (
            <span className="text-[13px] font-medium text-[#B91C1C]" role="alert">
              {errorMessage}
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}
