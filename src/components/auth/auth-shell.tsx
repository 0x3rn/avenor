import { SignalAtlasLogo } from "@avenor/ui";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  KeyRound,
  Layers,
  Lock,
  Radar,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import type * as React from "react";

export type AuthShellVariant = "login" | "signup" | "forgot-password" | "verify-email";

export function AuthShell({
  eyebrow = "WORKSPACE ACCESS",
  title,
  subtitle,
  variant = "login",
  children,
  footerSlot,
}: {
  eyebrow?: string;
  title: string;
  subtitle: string;
  variant?: AuthShellVariant;
  children: React.ReactNode;
  footerSlot?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-[#F7F9FC] text-[#30415D]">
      {/* Left 50%: Form Column */}
      <div className="flex flex-col justify-between px-4 py-6 sm:px-8 lg:px-12 xl:px-16 bg-[#F7F9FC]">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="no-underline">
            <SignalAtlasLogo showTag />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#64748B] hover:text-[#17243A] no-underline transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Back to avenor.corstack.dev</span>
          </Link>
        </header>

        <main className="w-full max-w-[440px] mx-auto my-10">
          <div className="bg-[#FFFFFF] border border-[#DFE6F0] rounded-xl p-6 sm:p-8 shadow-[0_1px_2px_rgba(23,36,58,0.04)] space-y-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5157D9]">
                <span className="h-1.5 w-1.5 rounded-[2px] bg-[#5157D9]" aria-hidden="true" />
                <span>{eyebrow}</span>
              </div>
              <h1 className="text-[24px] sm:text-[26px] leading-[1.2] font-semibold tracking-[-0.02em] text-[#17243A] m-0">
                {title}
              </h1>
              <p className="text-[14px] leading-[21px] text-[#64748B] m-0">{subtitle}</p>
            </div>

            {children}

            {footerSlot ? (
              <div className="pt-4 border-t border-[#DFE6F0] text-[13.5px] text-[#64748B]">
                {footerSlot}
              </div>
            ) : null}
          </div>
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-[#64748B]">
          <span>© 2026 Avenor · Digital Product Intelligence</span>
          <span className="font-mono text-[11px] text-[#7B899F]">
            100% Read-Only External Boundary
          </span>
        </footer>
      </div>

      {/* Right 50%: Contextual Dark Showcase Panel */}
      <aside
        aria-label="Avenor operational intelligence preview"
        className="hidden lg:flex flex-col justify-between bg-[#10192B] border-l border-[#263554] p-10 xl:p-14 text-[#F8FAFC]"
      >
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-2 rounded-md bg-[#19243B] border border-[#263554] px-3 py-1 font-mono text-[11px] text-[#B8C5DC]">
            <ShieldCheck className="h-3.5 w-3.5 text-[#147D63]" aria-hidden="true" />
            <span>ZERO-MUTATION OBSERVATIONAL PLANE</span>
          </span>
          <span className="font-mono text-[11px] text-[#94A3B8]">SIGNAL ATLAS v1.0</span>
        </div>

        <div className="my-auto py-8 max-w-[520px]">
          {variant === "login" ? <LoginShowcasePanel /> : null}
          {variant === "signup" ? <SignupShowcasePanel /> : null}
          {variant === "forgot-password" ? <ForgotPasswordShowcasePanel /> : null}
          {variant === "verify-email" ? <VerifyEmailShowcasePanel /> : null}
        </div>

        <div className="pt-6 border-t border-[#263554] flex items-center justify-between gap-4 text-[12px] text-[#94A3B8]">
          <span>
            Protected by HTTP-only session cookies, CSRF origin verification, and per-workspace
            access controls.
          </span>
        </div>
      </aside>
    </div>
  );
}

function LoginShowcasePanel() {
  const products = [
    {
      name: "Acme Web App",
      env: "Production",
      freshness: "GA4 synced 9m ago",
      secondary: "BigQuery Billing synced 2h ago",
      status: "All HTTP monitors 200 OK",
      metrics: "48,920 users · $1,284.60 MTD",
    },
    {
      name: "Docs & Marketing",
      env: "Production",
      freshness: "GSC synced 18m ago",
      secondary: "Cloudflare Edge synced 4m ago",
      status: "All HTTP monitors 200 OK",
      metrics: "64,890 clicks · 94.2% cache hit",
    },
    {
      name: "Pulse Mobile Backend",
      env: "Production",
      freshness: "Neon & Sentry synced 6m ago",
      secondary: "BigQuery Billing synced 2h ago",
      status: "99.98% crash-free · 18.4 GB Neon",
      metrics: "14,210 users · $618.90 MTD",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-2.5">
        <div className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-[#38BDF8]">
          <span className="h-2 w-2 rounded-[2px] bg-[#38BDF8]" aria-hidden="true" />
          <span>MORNING COMMAND BRIEFING</span>
        </div>
        <h2 className="text-[26px] leading-[1.2] font-semibold tracking-[-0.02em] text-[#F8FAFC] m-0">
          Your entire product portfolio, synchronized and waiting.
        </h2>
        <p className="text-[14.5px] leading-[22px] text-[#94A3B8] m-0">
          Open a single command surface across audience analytics, search visibility, cloud spend,
          database footprint, deployments, and runtime reliability.
        </p>
      </div>

      <div className="rounded-xl bg-[#19243B] border border-[#263554] divide-y divide-[#263554] overflow-hidden">
        <div className="px-4 py-3 bg-[#131D31] flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-[#94A3B8]">
          <span>Logical Product Portfolio (3 Active)</span>
          <span className="text-[#34D399]">● All Pipelines Operational</span>
        </div>
        {products.map((product) => (
          <div key={product.name} className="p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold text-[#F8FAFC]">{product.name}</span>
                <span className="rounded bg-[#10192B] border border-[#263554] px-2 py-0.5 font-mono text-[11px] text-[#38BDF8]">
                  {product.env}
                </span>
              </div>
              <span className="font-mono text-[12px] tabular-nums text-[#E2E8F0]">
                {product.metrics}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11.5px] font-mono text-[#B8C5DC]">
              <span className="rounded bg-[#10192B] border border-[#263554] px-2 py-0.5">
                {product.freshness}
              </span>
              <span className="rounded bg-[#10192B] border border-[#263554] px-2 py-0.5">
                {product.secondary}
              </span>
              <span className="rounded bg-[#147D63]/20 border border-[#147D63]/40 text-[#34D399] px-2 py-0.5">
                {product.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SignupShowcasePanel() {
  const highlights = [
    {
      icon: Layers,
      title: "Up to 5 Logical Products & 20 Mapped Sources",
      body: "Bind Production, Staging, and Development environments across GA4, Search Console, GCP Billing, Neon, Supabase, Cloudflare, Vercel, GitHub, and Sentry.",
    },
    {
      icon: Clock3,
      title: "Automated 6-Hour Background Syncs",
      body: "Keep audience, search, cost, and infrastructure signals fresh without manual CSV exports—plus on-demand manual refreshes.",
    },
    {
      icon: Radar,
      title: "5 Built-In HTTP/TLS Uptime Monitors & 15 Alert Rules",
      body: "Combine external endpoint latency and SSL certificate checks with threshold and anomaly alerts.",
    },
    {
      icon: KeyRound,
      title: "100% Read-Only & Envelope Encrypted",
      body: "Zero write permissions to your cloud providers and zero access to customer database rows.",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-2.5">
        <div className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-[#38BDF8]">
          <span className="h-2 w-2 rounded-[2px] bg-[#38BDF8]" aria-hidden="true" />
          <span>INCLUDED IN YOUR 14-DAY PRO PREVIEW</span>
        </div>
        <h2 className="text-[26px] leading-[1.2] font-semibold tracking-[-0.02em] text-[#F8FAFC] m-0">
          Everything you need to unify your product telemetry.
        </h2>
      </div>

      <div className="space-y-3.5">
        {highlights.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.title}
              className="rounded-xl bg-[#19243B] border border-[#263554] p-4 flex items-start gap-3.5"
            >
              <div className="h-8 w-8 rounded-lg bg-[#10192B] border border-[#263554] flex items-center justify-center shrink-0 mt-0.5">
                <Icon className="h-4 w-4 text-[#38BDF8]" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <h3 className="text-[14px] font-semibold text-[#F8FAFC] m-0">{item.title}</h3>
                <p className="text-[13px] leading-[19px] text-[#94A3B8] m-0">{item.body}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ForgotPasswordShowcasePanel() {
  return (
    <div className="space-y-6">
      <div className="space-y-2.5">
        <div className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-[#38BDF8]">
          <span className="h-2 w-2 rounded-[2px] bg-[#38BDF8]" aria-hidden="true" />
          <span>ACCOUNT SECURITY</span>
        </div>
        <h2 className="text-[26px] leading-[1.2] font-semibold tracking-[-0.02em] text-[#F8FAFC] m-0">
          Automatic session revocation on password reset.
        </h2>
        <p className="text-[15px] leading-[24px] text-[#94A3B8] m-0">
          For your protection, password reset links expire automatically after 60 minutes, can only
          be used once, and immediately invalidate any older active browser sessions across your
          devices.
        </p>
      </div>

      <div className="rounded-xl bg-[#19243B] border border-[#263554] p-5 space-y-3">
        <div className="flex items-center gap-3 text-[13px] text-[#E2E8F0]">
          <Lock className="h-4 w-4 text-[#38BDF8] shrink-0" aria-hidden="true" />
          <span>Single-use cryptographic verification link (60-minute window)</span>
        </div>
        <div className="flex items-center gap-3 text-[13px] text-[#E2E8F0]">
          <ShieldCheck className="h-4 w-4 text-[#34D399] shrink-0" aria-hidden="true" />
          <span>Immediate revocation of prior browser sessions upon password rotation</span>
        </div>
      </div>
    </div>
  );
}

function VerifyEmailShowcasePanel() {
  return (
    <div className="space-y-6">
      <div className="space-y-2.5">
        <div className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-[#38BDF8]">
          <span className="h-2 w-2 rounded-[2px] bg-[#38BDF8]" aria-hidden="true" />
          <span>IDENTITY VERIFICATION</span>
        </div>
        <h2 className="text-[26px] leading-[1.2] font-semibold tracking-[-0.02em] text-[#F8FAFC] m-0">
          Verified identity for alerts, digests, and workspace governance.
        </h2>
        <p className="text-[15px] leading-[24px] text-[#94A3B8] m-0">
          Confirming your email address ensures threshold alerts, anomaly notifications, and
          scheduled portfolio digests are delivered only to verified workspace members.
        </p>
      </div>

      <div className="rounded-xl bg-[#19243B] border border-[#263554] p-5 space-y-3">
        <div className="flex items-center gap-3 text-[13px] text-[#E2E8F0]">
          <CheckCircle2 className="h-4 w-4 text-[#34D399] shrink-0" aria-hidden="true" />
          <span>Enables email delivery for threshold alerts and weekly digests</span>
        </div>
        <div className="flex items-center gap-3 text-[13px] text-[#E2E8F0]">
          <ShieldCheck className="h-4 w-4 text-[#38BDF8] shrink-0" aria-hidden="true" />
          <span>Recorded in your workspace security audit log</span>
        </div>
      </div>
    </div>
  );
}
