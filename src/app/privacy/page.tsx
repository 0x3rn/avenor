import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — Avenor",
  description:
    "How Avenor handles read-only external provider data, encrypted credentials, data retention, exports, and deletion.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-[#17243A] space-y-8">
      <div className="space-y-2">
        <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#5157D9]">
          Avenor Privacy & Data Handling
        </p>
        <h1 className="text-[32px] font-semibold tracking-tight">Privacy Policy</h1>
        <p className="text-[14px] text-[#64748B]">Policy Version: 2026-11-v1</p>
      </div>

      <section className="space-y-3 text-[15px] leading-relaxed text-[#334155]">
        <h2 className="text-[19px] font-semibold text-[#17243A]">
          1. Strictly Read-Only External Monitoring Boundary
        </h2>
        <p>
          Avenor connects to authorized external services (Google Analytics 4, Google Search
          Console, Google Cloud Billing BigQuery exports, Neon, Supabase, Firebase/Cloud Monitoring,
          Cloudflare, Vercel, GitHub, and Sentry) using least-privilege read scopes. Avenor never
          executes SQL against your customer application tables, never reads end-user emails or
          password hashes from your connected databases, and strips sensitive headers, cookies, IPs,
          and tokens before storing aggregated telemetry.
        </p>

        <h2 className="text-[19px] font-semibold text-[#17243A] pt-3">
          2. Credentials, Encryption & Disconnection
        </h2>
        <p>
          OAuth tokens and read-only API keys are encrypted at rest with AES-256-GCM before storage
          in Neon PostgreSQL and never serialized into browser responses or application logs.
          Disconnecting a source immediately ceases scheduled collection, purges local encrypted
          credentials, and invalidates tenant-scoped caches.
        </p>

        <h2 className="text-[19px] font-semibold text-[#17243A] pt-3">
          3. Data Portability, Erasure & Backup Limitations
        </h2>
        <p>
          Authenticated users can export their personal account profile, membership summaries, and
          consent history in machine-readable JSON at any time from Privacy Settings. Workspace
          owners can delete a workspace and purge live credentials and observations. Active database
          deletion removes rows from the live Neon PostgreSQL instance immediately; historical Neon
          point-in-time recovery backups expire automatically on schedule, and Lemon Squeezy retains
          merchant-of-record invoice and tax records as required by applicable accounting law.
        </p>
      </section>

      <div className="pt-4 border-t border-[#DFE6F0] flex gap-4 text-[14px]">
        <Link href="/" className="text-[#5157D9] hover:underline">
          Back to Homepage
        </Link>
        <Link href="/terms" className="text-[#5157D9] hover:underline">
          Terms of Service
        </Link>
        <Link href="/security" className="text-[#5157D9] hover:underline">
          Security Overview
        </Link>
      </div>
    </main>
  );
}
