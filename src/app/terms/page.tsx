import Link from "next/link";

export const metadata = {
  title: "Terms of Service — Avenor",
  description:
    "Terms governing Avenor read-only product intelligence workspaces, subscriptions, and acceptable use.",
};

export default function TermsOfServicePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-[#17243A] space-y-8">
      <div className="space-y-2">
        <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#5157D9]">
          Avenor Terms
        </p>
        <h1 className="text-[32px] font-semibold tracking-tight">Terms of Service</h1>
        <p className="text-[14px] text-[#64748B]">Policy Version: 2026-11-v1</p>
      </div>

      <section className="space-y-3 text-[15px] leading-relaxed text-[#334155]">
        <h2 className="text-[19px] font-semibold text-[#17243A]">1. Authorized Monitoring Only</h2>
        <p>
          You may only connect external analytics, cloud, database, hosting, and repository accounts
          that you own or are explicitly authorized to observe. Uptime monitors may target only
          publicly resolvable HTTPS endpoints you are authorized to monitor; private-network and
          internal-metadata probing is blocked.
        </p>

        <h2 className="text-[19px] font-semibold text-[#17243A] pt-3">
          2. Subscriptions, Trials & Cancellation
        </h2>
        <p>
          Avenor subscriptions are billed per workspace via Lemon Squeezy as merchant of record and
          are separate from charges billed by your connected cloud or hosting providers. New
          eligible workspaces may activate one 14-day card-free Pro trial that reverts to the Free
          plan without automatic billing if you do not subscribe. Cancelled paid subscriptions
          retain access through the end of the confirmed paid period, and historical data is not
          abruptly erased on downgrade.
        </p>

        <h2 className="text-[19px] font-semibold text-[#17243A] pt-3">
          3. Observational Intelligence Disclaimer
        </h2>
        <p>
          Avenor presents metrics, freshness indicators, anomaly alerts, and optional AI summaries
          derived from connected third-party providers. Upstream provider delays, sampling, and
          outages remain outside Avenor&apos;s control, and timeline correlations do not constitute
          proven root-cause determinations.
        </p>
      </section>

      <div className="pt-4 border-t border-[#DFE6F0] flex gap-4 text-[14px]">
        <Link href="/" className="text-[#5157D9] hover:underline">
          Back to Homepage
        </Link>
        <Link href="/privacy" className="text-[#5157D9] hover:underline">
          Privacy Policy
        </Link>
        <Link href="/pricing" className="text-[#5157D9] hover:underline">
          Pricing
        </Link>
      </div>
    </main>
  );
}
