import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  MetricCard,
  SignalAtlasLogo,
  StatusIndicator,
} from "@avenor/ui";
import { ArrowRight, Layers, Lock, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#F7F9FC] text-[#30415D]">
      <header className="sticky top-0 z-30 h-16 bg-white/95 backdrop-blur-xs border-b border-[#DFE6F0]">
        <div className="max-w-[1240px] mx-auto h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="no-underline">
              <SignalAtlasLogo />
            </Link>
            <nav
              aria-label="Primary marketing navigation"
              className="hidden md:flex items-center gap-6 text-[14px] font-medium text-[#30415D]"
            >
              <a
                href="#product-model"
                className="hover:text-[#17243A] no-underline transition-colors"
              >
                Product Model
              </a>
              <a
                href="#read-only-security"
                className="hover:text-[#17243A] no-underline transition-colors"
              >
                Read-Only Security
              </a>
              <a
                href="#signal-atlas"
                className="hover:text-[#17243A] no-underline transition-colors"
              >
                Signal Atlas
              </a>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="inline-flex items-center justify-center h-9 px-3.5 rounded-[10px] text-[13.5px] font-medium text-[#17243A] hover:bg-[#F0F4FA] no-underline transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center justify-center h-9 px-4 rounded-[10px] text-[13.5px] font-medium bg-[#5157D9] text-white hover:bg-[#4047BD] no-underline transition-colors shadow-xs"
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8 max-w-[1240px] mx-auto">
          <div className="max-w-3xl space-y-6">
            <div className="flex flex-wrap items-center gap-2.5">
              <Badge tone="indigo" icon={<Sparkles className="h-3.5 w-3.5" />}>
                Signal Atlas Architecture
              </Badge>
              <Badge tone="read-only">Strict Read-Only External Boundary</Badge>
            </div>
            <h1 className="text-[38px] sm:text-[56px] leading-[1.08] font-semibold tracking-[-0.03em] text-[#17243A] m-0">
              A clearer view of every digital product you run.
            </h1>
            <p className="text-[16px] sm:text-[18px] leading-[1.6] text-[#30415D] max-w-2xl m-0">
              Avenor organizes analytics, search visibility, cloud billing, backend storage, and
              deployment reliability around your logical applications and environments—never around
              disconnected provider silos.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-[11px] bg-[#5157D9] text-white font-medium text-[15px] hover:bg-[#4047BD] no-underline transition-colors shadow-xs"
              >
                <span>Create workspace</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center h-11 px-5 rounded-[11px] bg-white border border-[#C7D2E3] text-[#17243A] font-medium text-[15px] hover:bg-[#F0F4FA] no-underline transition-colors"
              >
                Open workspace overview
              </Link>
            </div>
          </div>

          <div
            id="signal-atlas"
            className="mt-14 rounded-[24px] bg-[#10192B] border border-[#19243B] p-6 sm:p-8 text-[#F7F9FE] shadow-lg"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#19243B]">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <span className="text-[13px] font-mono uppercase tracking-wider text-[#B8C5DC]">
                    Logical Product Map
                  </span>
                  <Badge tone="signal">Product-Centered Model</Badge>
                </div>
                <h2 className="text-[20px] sm:text-[24px] font-semibold text-[#F7F9FE] m-0">
                  Organization → Workspace → Logical Project → Environment
                </h2>
              </div>
              <StatusIndicator
                tone="success"
                label="Zero external mutation endpoints"
                className="text-[#B8C5DC]"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-6">
              <div className="rounded-[16px] bg-[#19243B] border border-[#263554] p-5 space-y-2">
                <span className="text-[12px] font-mono uppercase tracking-wider text-[#B8C5DC]">
                  01 / Tenant Isolation
                </span>
                <h3 className="text-[16px] font-semibold text-[#F7F9FE] m-0">
                  Workspace-Scoped Ownership
                </h3>
                <p className="text-[13.5px] leading-[20px] text-[#B8C5DC] m-0">
                  Every project, environment, and audit event is strictly isolated by organization
                  and workspace RBAC (`OWNER`, `ADMIN`, `ANALYST`, `VIEWER`).
                </p>
              </div>
              <div className="rounded-[16px] bg-[#19243B] border border-[#263554] p-5 space-y-2">
                <span className="text-[12px] font-mono uppercase tracking-wider text-[#B8C5DC]">
                  02 / Environment Context
                </span>
                <h3 className="text-[16px] font-semibold text-[#F7F9FE] m-0">
                  Production, Staging & Development
                </h3>
                <p className="text-[13.5px] leading-[20px] text-[#B8C5DC] m-0">
                  Separate production signals from staging and development environments while
                  preserving a unified product portfolio view.
                </p>
              </div>
              <div className="rounded-[16px] bg-[#19243B] border border-[#263554] p-5 space-y-2">
                <span className="text-[12px] font-mono uppercase tracking-wider text-[#B8C5DC]">
                  03 / Metric Integrity
                </span>
                <h3 className="text-[16px] font-semibold text-[#F7F9FE] m-0">
                  Honest Signal States
                </h3>
                <p className="text-[13.5px] leading-[20px] text-[#B8C5DC] m-0">
                  Unconnected or unconfigured sources are never rendered as fake zero values. Every
                  card reports provenance and freshness.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section
          id="product-model"
          className="py-12 sm:py-16 px-4 sm:px-6 lg:px-8 max-w-[1240px] mx-auto space-y-8"
        >
          <div className="space-y-2 max-w-2xl">
            <h2 className="text-[28px] sm:text-[36px] font-semibold text-[#17243A] m-0">
              Designed for calm, trustworthy signal clarity
            </h2>
            <p className="text-[15.5px] text-[#30415D] m-0">
              Avenor distinguishes between verified observations, syncing sources, and unconnected
              environments so operators never confuse missing configuration with zero activity.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <MetricCard
              title="Configured Environments"
              definition="Active logical environments across Production, Staging, and Development."
              state="connected_healthy"
              value={3}
              unit="environments"
              sourceLabel="Avenor Core"
              freshnessLabel="Verified real-time"
              comparisonDeltaText="Production default active"
            />
            <MetricCard
              title="Audience & Search Signals"
              definition="GA4 and Google Search Console read-only property mappings."
              state="unconnected"
              sourceLabel="Read-Only Connector"
              freshnessLabel="Awaiting connection"
            />
            <MetricCard
              title="Cloud Cost & Infrastructure"
              definition="BigQuery billing export and backend storage observation status."
              state="empty_first_use"
              sourceLabel="Read-Only Connector"
              freshnessLabel="No source mapped"
            />
          </div>
        </section>

        <section
          id="read-only-security"
          className="py-12 sm:py-16 px-4 sm:px-6 lg:px-8 max-w-[1240px] mx-auto"
        >
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-[#168E99]" aria-hidden="true" />
                <CardTitle>Architectural Read-Only Guarantee</CardTitle>
              </div>
              <CardDescription>
                Avenor is an observation and intelligence system—never an infrastructure control
                plane.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex items-start gap-3">
                <Layers className="h-5 w-5 text-[#5157D9] shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1">
                  <h4 className="text-[14.5px] font-semibold text-[#17243A] m-0">
                    What Avenor Manages
                  </h4>
                  <p className="text-[13.5px] text-[#30415D] m-0">
                    Organizations, workspaces, role memberships, logical projects, environments,
                    resource mappings, and immutable audit logs stored in Avenor&apos;s PostgreSQL
                    database.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Lock className="h-5 w-5 text-[#147D63] shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1">
                  <h4 className="text-[14.5px] font-semibold text-[#17243A] m-0">
                    What Avenor Never Mutates
                  </h4>
                  <p className="text-[13.5px] text-[#30415D] m-0">
                    Avenor never edits customer databases, executes arbitrary SQL, modifies DNS,
                    triggers deployments, alters cloud budgets, or mutates external provider state.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>

      <footer className="border-t border-[#DFE6F0] bg-white py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-[1240px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-[13px] text-[#64748B]">
          <div className="flex items-center gap-3">
            <SignalAtlasLogo showWordmark />
            <span>•</span>
            <span>Digital Product Intelligence</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-[#64748B] hover:text-[#17243A] no-underline">
              Sign in
            </Link>
            <Link href="/signup" className="text-[#64748B] hover:text-[#17243A] no-underline">
              Create account
            </Link>
            <Link href="/dashboard" className="text-[#64748B] hover:text-[#17243A] no-underline">
              Workspace
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
