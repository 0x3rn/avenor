import { Badge, Card, PageHeader, WarningBanner } from "@avenor/ui";
import Link from "next/link";
import * as React from "react";
import {
  getWorkspaceEffectiveEntitlements,
  listWorkspaceSubscriptionInvoices,
} from "@/lib/billing/lemon-squeezy";
import { requireAuthenticatedAppContext } from "@/lib/workspace-context";

async function WorkspaceBillingPageContent() {
  const { session, governance } = await requireAuthenticatedAppContext();
  const [entitlements, invoices] = await Promise.all([
    getWorkspaceEffectiveEntitlements(session, governance.workspace.id),
    listWorkspaceSubscriptionInvoices(session, governance.workspace.id),
  ]);

  return (
    <div className="space-y-6" data-testid="workspace-billing-page">
      <PageHeader
        breadcrumbs={[
          { label: governance.organization.name },
          { label: governance.workspace.name, href: "/dashboard" },
          { label: "Subscription & Billing" },
        ]}
        title="Avenor Workspace Subscription & Invoices"
        description="Manage your workspace subscription plan, card-free Pro trial, and Lemon Squeezy merchant invoices."
        badges={
          <div className="flex items-center gap-2">
            <Badge tone="indigo">Plan: {entitlements.effectivePlanCode}</Badge>
            <Badge tone="neutral">{entitlements.status}</Badge>
          </div>
        }
        actions={
          <div className="flex gap-2">
            <Link
              href="/usage"
              className="inline-flex h-9 items-center rounded-[8px] border border-[#C7D2E3] bg-[#FFFFFF] px-3.5 text-[13px] font-medium text-[#17243A]"
            >
              View Usage &amp; Quotas
            </Link>
            <Link
              href="/pricing"
              className="inline-flex h-9 items-center rounded-[8px] bg-[#5157D9] px-3.5 text-[13px] font-medium text-white"
            >
              Compare Plans
            </Link>
          </div>
        }
      />

      <WarningBanner
        tone="signal"
        title="Avenor Subscription vs Monitored Cloud Spending"
        description={entitlements.billingBoundaryNote}
      />

      <Card className="p-5 sm:p-6 space-y-3">
        <h2 className="text-[16px] font-semibold text-[#17243A]">Current Workspace Entitlements</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-[13.5px]">
          <div className="rounded-[8px] border border-[#DFE6F0] bg-[#F7F9FC] p-3">
            <p className="text-[#64748B]">Active Tier</p>
            <p className="font-semibold text-[#17243A]">
              {entitlements.effectivePlanCode} ({entitlements.billingInterval})
            </p>
          </div>
          <div className="rounded-[8px] border border-[#DFE6F0] bg-[#F7F9FC] p-3">
            <p className="text-[#64748B]">Billing Source</p>
            <p className="font-mono text-[#17243A]">{entitlements.providerName}</p>
          </div>
          <div className="rounded-[8px] border border-[#DFE6F0] bg-[#F7F9FC] p-3">
            <p className="text-[#64748B]">Products / Sources / Seats</p>
            <p className="font-mono text-[#17243A]">
              {entitlements.limits.maxProjects} / {entitlements.limits.maxMappedSources} /{" "}
              {entitlements.limits.maxMembers}
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-5 sm:p-6 space-y-3">
        <h2 className="text-[16px] font-semibold text-[#17243A]">
          Merchant Invoice History ({invoices.length})
        </h2>
        {invoices.length === 0 ? (
          <p className="text-[13.5px] text-[#64748B]">
            No Lemon Squeezy subscription invoices recorded for this workspace yet.
          </p>
        ) : (
          <div className="space-y-2">
            {invoices.map((inv) => (
              <div
                key={inv.id}
                className="rounded-[8px] border border-[#DFE6F0] px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-[13px]"
              >
                <div>
                  <span className="font-mono font-semibold text-[#17243A]">
                    {inv.currency} {(inv.amountMinor / 100).toFixed(2)}
                  </span>
                  <span className="ml-2 text-[#64748B]">
                    Order {inv.providerOrderId} • {inv.issuedAtIso.slice(0, 10)}
                  </span>
                </div>
                <Badge tone={inv.status === "paid" ? "success" : "warning"}>{inv.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export default function WorkspaceBillingPage() {
  return (
    <React.Suspense fallback={<div className="min-h-[480px]" />}>
      <WorkspaceBillingPageContent />
    </React.Suspense>
  );
}
