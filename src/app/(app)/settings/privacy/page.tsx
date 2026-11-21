import { Badge, Card, PageHeader, WarningBanner } from "@avenor/ui";
import Link from "next/link";
import * as React from "react";
import { listUserPrivacyConsents } from "@/lib/privacy/compliance";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

async function PrivacySettingsPageContent() {
  const { session, governance } = await requireAuthenticatedAppContext();
  const consents = await listUserPrivacyConsents(session);

  return (
    <div className="space-y-6" data-testid="privacy-settings-page">
      <PageHeader
        breadcrumbs={[
          { label: governance.workspace.name, href: "/dashboard" },
          { label: "Settings", href: "/settings" },
          { label: "Privacy & Data Controls" },
        ]}
        title="Privacy, Consent & Account Data Portability"
        description="Review recorded policy consents, download your personal account data bundle, and inspect active erasure and backup retention boundaries."
        badges={<Badge tone="read-only">Policy v2026-11-v1</Badge>}
      />

      <WarningBanner
        tone="signal"
        title="Deletion & Backup Retention Transparency"
        description="Deleting a workspace purges live database records, encrypted credentials, and caches immediately. Historical Neon backups expire automatically on schedule, and Lemon Squeezy retains merchant-of-record invoice records where legally required."
      />

      <Card className="p-5 sm:p-6 space-y-3">
        <h2 className="text-[16px] font-semibold text-[#17243A]">Personal Account Data Export</h2>
        <p className="text-[13.5px] text-[#475569]">
          Download your account profile, workspace memberships, and consent ledger as JSON (excludes
          password hashes, OAuth tokens, encryption keys, and other tenants&apos; metrics).
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="/api/privacy?action=export_account"
            className="inline-flex h-9 items-center rounded-[8px] bg-[#5157D9] px-4 text-[13px] font-medium text-white hover:bg-[#4348C7]"
          >
            Download Personal Data JSON
          </a>
          <Link
            href="/privacy"
            className="inline-flex h-9 items-center rounded-[8px] border border-[#C7D2E3] bg-[#FFFFFF] px-4 text-[13px] font-medium text-[#17243A]"
          >
            Read Privacy Policy
          </Link>
        </div>
      </Card>

      <Card className="p-5 sm:p-6 space-y-3">
        <h2 className="text-[16px] font-semibold text-[#17243A]">
          Recorded Consent Ledger ({consents.length})
        </h2>
        {consents.length === 0 ? (
          <p className="text-[13.5px] text-[#64748B]">No explicit consent records logged yet.</p>
        ) : (
          <div className="space-y-2">
            {consents.map((c) => (
              <div
                key={c.id}
                className="rounded-[8px] border border-[#DFE6F0] px-4 py-2.5 flex items-center justify-between text-[13px]"
              >
                <span className="font-medium text-[#17243A]">
                  {c.consentType} ({c.policyVersion})
                </span>
                <Badge tone={c.granted ? "success" : "neutral"}>
                  {c.granted ? "Granted" : "Withdrawn"}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export default function PrivacySettingsPage() {
  return (
    <React.Suspense fallback={<div className="min-h-[480px]" />}>
      <PrivacySettingsPageContent />
    </React.Suspense>
  );
}
