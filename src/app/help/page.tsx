import Link from "next/link";
import { SupportRequestForm } from "@/components/support/support-request-form";

export const metadata = {
  title: "Help Center & Support — Avenor",
  description: "Documentation, FAQ, and sanitized support request intake for Avenor workspaces.",
};

export default function HelpCenterPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16 text-[#17243A] space-y-10">
      <div className="space-y-2">
        <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#5157D9]">
          Avenor Help Center
        </p>
        <h1 className="text-[32px] font-semibold tracking-tight">Help, FAQ &amp; Support</h1>
        <p className="text-[15px] text-[#475569]">
          Answers on read-only provider setup, metric definitions, subscriptions, and privacy
          controls.
        </p>
      </div>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 text-[14px]">
        <div className="rounded-[10px] border border-[#DFE6F0] bg-[#FFFFFF] p-5 space-y-1.5">
          <h2 className="font-semibold">Does Avenor mutate my cloud or database?</h2>
          <p className="text-[#475569]">
            No. All external connectors enforce read-only scopes and GET-only endpoint allowlists.
            Avenor never executes SQL against customer databases, alters DNS, or triggers deploys.
          </p>
        </div>
        <div className="rounded-[10px] border border-[#DFE6F0] bg-[#FFFFFF] p-5 space-y-1.5">
          <h2 className="font-semibold">Are Avenor invoices mixed with cloud bills?</h2>
          <p className="text-[#475569]">
            Never. Avenor workspace subscriptions are managed by Lemon Squeezy and kept completely
            separate from observed Google Cloud or Vercel spending dashboards.
          </p>
        </div>
      </section>

      <SupportRequestForm />

      <div className="flex gap-5 text-[14px]">
        <Link href="/" className="text-[#5157D9] hover:underline">
          Homepage
        </Link>
        <Link href="/pricing" className="text-[#5157D9] hover:underline">
          Pricing
        </Link>
        <Link href="/privacy" className="text-[#5157D9] hover:underline">
          Privacy Policy
        </Link>
      </div>
    </main>
  );
}
