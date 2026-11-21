import Link from "next/link";
import { AVENOR_PLAN_CATALOG } from "@/lib/billing/plan-catalog";

export const metadata = {
  title: "Pricing — Avenor",
  description:
    "Predictable per-workspace pricing for Avenor digital product intelligence. Free, Pro ($19/mo), and Team ($59/mo) with 14-day card-free Pro trial and zero automatic overages.",
};

export default function PublicPricingPage() {
  const plans = [AVENOR_PLAN_CATALOG.FREE, AVENOR_PLAN_CATALOG.PRO, AVENOR_PLAN_CATALOG.TEAM];

  return (
    <main className="mx-auto max-w-6xl px-6 py-16 text-[#17243A] space-y-10">
      <div className="max-w-2xl space-y-3">
        <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#5157D9]">
          Simple Plans. Clear Capabilities.
        </p>
        <h1 className="text-[36px] font-semibold tracking-tight">
          Choose the workspace that fits what you&apos;re building.
        </h1>
        <p className="text-[15px] text-[#475569]">
          One subscription per workspace — billed via Lemon Squeezy as merchant of record, separate
          from your monitored Google Cloud, Vercel, or database provider invoices. New eligible
          workspaces can start a 14-day card-free Pro trial with zero automatic charge.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {plans.map((plan) => (
          <div
            key={plan.planCode}
            className="rounded-[14px] border border-[#DFE6F0] bg-[#FFFFFF] p-6 flex flex-col justify-between space-y-6 shadow-xs"
          >
            <div className="space-y-4">
              <div>
                <h2 className="text-[20px] font-semibold">{plan.displayName}</h2>
                <p className="text-[13px] text-[#64748B] mt-1">{plan.audienceLabel}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[32px] font-semibold font-mono">
                  ${plan.monthlyPriceUsd}
                  <span className="text-[14px] font-sans font-normal text-[#64748B]"> /month</span>
                </p>
                {plan.annualTotalUsd > 0 ? (
                  <p className="text-[12.5px] text-[#5157D9] font-medium">
                    Or ${plan.annualTotalUsd}/year (${plan.annualMonthlyEquivalentUsd}/mo equivalent
                    — save ${plan.annualSavingsUsd}/yr)
                  </p>
                ) : (
                  <p className="text-[12.5px] text-[#64748B]">Free forever — no payment card</p>
                )}
              </div>

              <ul className="space-y-2 text-[13.5px] text-[#334155] border-t border-[#F1F5F9] pt-4">
                <li>Up to {plan.limits.maxProjects} logical product(s)</li>
                <li>Up to {plan.limits.maxMappedSources} mapped provider sources</li>
                <li>Up to {plan.limits.maxMembers} workspace member(s)</li>
                <li>{plan.limits.retentionDays}-day historical metric retention</li>
                <li>
                  {plan.limits.maxUptimeMonitors} uptime monitor(s) (
                  {plan.limits.uptimePollingMinutes}m target)
                </li>
                <li>
                  {plan.limits.csvExportsPerMonth} CSV &amp; {plan.limits.pdfExportsPerMonth} PDF
                  exports/mo
                </li>
                <li>{plan.limits.aiInsightsPerMonth} AI insight generations/mo</li>
                <li>
                  {plan.limits.publicApiRequestsPerMonth.toLocaleString("en-US")} Public API
                  calls/mo
                </li>
                <li>Support: {plan.limits.supportTier}</li>
              </ul>
            </div>

            <Link
              href={plan.planCode === "FREE" ? "/signup" : "/billing"}
              className="inline-flex h-10 w-full items-center justify-center rounded-[8px] bg-[#5157D9] px-4 text-[13.5px] font-medium text-white hover:bg-[#4348C7]"
            >
              {plan.planCode === "FREE" ? "Get Started Free" : `Choose ${plan.displayName}`}
            </Link>
          </div>
        ))}
      </div>

      <div className="rounded-[12px] border border-[#DFE6F0] bg-[#F7F9FC] p-5 text-[13.5px] text-[#475569] space-y-1">
        <p className="font-semibold text-[#17243A]">
          No surprise overage invoices • External cloud bills stay separate
        </p>
        <p>
          All launch plans are flat recurring subscriptions with server-enforced fair-use limits.
          Prices are denominated in USD and confirmed at hosted Lemon Squeezy checkout once merchant
          activation is enabled.
        </p>
      </div>

      <div className="flex flex-wrap gap-5 text-[14px]">
        <Link href="/" className="text-[#5157D9] hover:underline">
          Homepage
        </Link>
        <Link href="/help" className="text-[#5157D9] hover:underline">
          Help Center &amp; FAQ
        </Link>
        <Link href="/privacy" className="text-[#5157D9] hover:underline">
          Privacy
        </Link>
        <Link href="/terms" className="text-[#5157D9] hover:underline">
          Terms
        </Link>
      </div>
    </main>
  );
}
