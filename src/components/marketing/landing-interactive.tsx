"use client";

import { ArrowRight, CheckCircle2, Clock3, GitCommitHorizontal, Info } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import {
  GA4Icon,
  GCPIcon,
  GSCIcon,
  NeonIcon,
  SectionEyebrow,
  SentryIcon,
  VercelIcon,
} from "./provider-marks";

type CommandTab = "overview" | "audience" | "spend" | "reliability";

export function HeroProductCommandFrame() {
  const [activeTab, setActiveTab] = React.useState<CommandTab>("overview");

  const tabs: { id: CommandTab; label: string; badge: string }[] = [
    { id: "overview", label: "Portfolio Overview", badge: "6 sources" },
    { id: "audience", label: "Audience & Search", badge: "GA4 + GSC" },
    { id: "spend", label: "Cloud Spend", badge: "BigQuery" },
    { id: "reliability", label: "Backend & Reliability", badge: "Neon + Vercel + Sentry" },
  ];

  return (
    <div className="rounded-xl bg-[#FFFFFF] border border-[#C7D2E3] shadow-[0_20px_50px_rgba(23,36,58,0.08)] overflow-hidden">
      {/* Top Window / Workspace Context Bar */}
      <div className="bg-[#F0F4FA] border-b border-[#DFE6F0] px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[12px] font-mono text-[#30415D]">
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#17243A]">
            <span className="h-2 w-2 rounded-[1px] bg-[#5157D9]" aria-hidden="true" />
            Workspace: Corstack Labs
          </span>
          <span className="text-[#C7D2E3]">/</span>
          <span className="font-semibold text-[#17243A]">Logical Product: Checkout API & Web</span>
          <span className="inline-flex items-center gap-1.5 rounded bg-[#E7F6EF] border border-[#B9E6D2] px-2 py-0.5 text-[11px] font-semibold text-[#147D63]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#147D63]" aria-hidden="true" />
            Environment: Production
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11.5px] font-mono text-[#64748B] tabular-nums">
          <span className="inline-flex items-center gap-1.5 rounded bg-white border border-[#DFE6F0] px-2.5 py-1 text-[#30415D]">
            6 Read-Only Sources Mapped (GA4 · GSC · GCP Billing · Neon · Vercel · Sentry)
          </span>
          <span className="inline-flex items-center gap-1 text-[#147D63] font-medium">
            <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
            Last verified sync: 14m ago
          </span>
        </div>
      </div>

      {/* Interactive Domain Lens Switcher */}
      <div className="border-b border-[#DFE6F0] bg-[#F7F9FC] px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Product intelligence preview tabs"
          className="flex flex-wrap items-center gap-1.5"
        >
          {tabs.map((tab) => {
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-colors cursor-pointer ${
                  isSelected
                    ? "bg-[#FFFFFF] text-[#17243A] border border-[#C7D2E3] shadow-2xs"
                    : "text-[#64748B] hover:text-[#17243A] border border-transparent"
                }`}
              >
                <span>{tab.label}</span>
                <span className="text-[11px] font-mono text-[#64748B] bg-[#F0F4FA] px-1.5 py-0.5 rounded">
                  {tab.badge}
                </span>
              </button>
            );
          })}
        </div>
        <span className="text-[11.5px] font-mono text-[#64748B] tabular-nums">
          Window: Last 30 days (UTC) · Currency: USD
        </span>
      </div>

      {/* 4-Card Domain Summary Row */}
      <div className="p-4 sm:p-6 space-y-6 bg-[#FFFFFF]">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Active Users */}
          <div
            className={`rounded-lg border p-4 flex flex-col justify-between gap-3 transition-colors ${
              activeTab === "audience"
                ? "border-[#5157D9] bg-[#F7F9FC]"
                : "border-[#DFE6F0] bg-[#FFFFFF]"
            }`}
          >
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-medium text-[#30415D]">Active Users (30d)</span>
                <span className="text-[#5157D9]">
                  <GA4Icon className="h-4 w-4" />
                </span>
              </div>
              <div className="text-[28px] leading-tight font-semibold tracking-tight text-[#17243A] tabular-nums">
                48,920
              </div>
              <p className="text-[12px] font-medium text-[#147D63] tabular-nums m-0">
                +14.2% vs prior 30d
              </p>
            </div>
            <div className="pt-2.5 border-t border-[#DFE6F0] bg-[#F0F4FA] -mx-4 -mb-4 px-4 py-2 rounded-b-lg flex items-center gap-1.5 text-[11px] font-mono text-[#30415D] tabular-nums">
              <GA4Icon className="h-3.5 w-3.5 text-[#5157D9] shrink-0" />
              <span className="truncate">GA4 · prop_88412 · Synced 12m ago · Exact window</span>
            </div>
          </div>

          {/* Card 2: Organic Search Clicks */}
          <div
            className={`rounded-lg border p-4 flex flex-col justify-between gap-3 transition-colors ${
              activeTab === "audience"
                ? "border-[#5157D9] bg-[#F7F9FC]"
                : "border-[#DFE6F0] bg-[#FFFFFF]"
            }`}
          >
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-medium text-[#30415D]">
                  Organic Search Clicks (30d)
                </span>
                <span className="text-[#168E99]">
                  <GSCIcon className="h-4 w-4" />
                </span>
              </div>
              <div className="text-[28px] leading-tight font-semibold tracking-tight text-[#17243A] tabular-nums">
                19,410
              </div>
              <p className="text-[12px] font-medium text-[#30415D] tabular-nums m-0">
                CTR 4.8% · Avg Pos 6.4
              </p>
            </div>
            <div className="pt-2.5 border-t border-[#DFE6F0] bg-[#F0F4FA] -mx-4 -mb-4 px-4 py-2 rounded-b-lg flex items-center gap-1.5 text-[11px] font-mono text-[#30415D] tabular-nums">
              <GSCIcon className="h-3.5 w-3.5 text-[#168E99] shrink-0" />
              <span className="truncate">
                Search Console · sc-domain:checkout.dev · 48h attribution lag noted
              </span>
            </div>
          </div>

          {/* Card 3: Month-to-Date Cloud Spend */}
          <div
            className={`rounded-lg border p-4 flex flex-col justify-between gap-3 transition-colors ${
              activeTab === "spend"
                ? "border-[#5157D9] bg-[#F7F9FC]"
                : "border-[#DFE6F0] bg-[#FFFFFF]"
            }`}
          >
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-medium text-[#30415D]">
                  Month-to-Date Cloud Spend
                </span>
                <span className="text-[#5157D9]">
                  <GCPIcon className="h-4 w-4" />
                </span>
              </div>
              <div className="text-[28px] leading-tight font-semibold tracking-tight text-[#17243A] tabular-nums">
                $1,284.60
              </div>
              <p className="text-[12px] font-medium text-[#30415D] tabular-nums m-0">
                Net of -$140.00 GCP credits
              </p>
            </div>
            <div className="pt-2.5 border-t border-[#DFE6F0] bg-[#F0F4FA] -mx-4 -mb-4 px-4 py-2 rounded-b-lg flex items-center gap-1.5 text-[11px] font-mono text-[#30415D] tabular-nums">
              <GCPIcon className="h-3.5 w-3.5 text-[#5157D9] shrink-0" />
              <span className="truncate">
                BigQuery Billing Export · USD · Partition fresh (4h ago)
              </span>
            </div>
          </div>

          {/* Card 4: Database & Edge Health */}
          <div
            className={`rounded-lg border p-4 flex flex-col justify-between gap-3 transition-colors ${
              activeTab === "reliability"
                ? "border-[#5157D9] bg-[#F7F9FC]"
                : "border-[#DFE6F0] bg-[#FFFFFF]"
            }`}
          >
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-medium text-[#30415D]">
                  Database & Edge Health
                </span>
                <span className="inline-flex items-center gap-1 text-[#147D63]">
                  <NeonIcon className="h-3.5 w-3.5" />
                  <VercelIcon className="h-3.5 w-3.5" />
                  <SentryIcon className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="text-[28px] leading-tight font-semibold tracking-tight text-[#17243A] tabular-nums">
                99.98% Uptime
              </div>
              <p className="text-[12px] font-medium text-[#147D63] tabular-nums m-0">
                18.4 GB Neon storage · 0 open P1 issues
              </p>
            </div>
            <div className="pt-2.5 border-t border-[#DFE6F0] bg-[#F0F4FA] -mx-4 -mb-4 px-4 py-2 rounded-b-lg flex items-center gap-1.5 text-[11px] font-mono text-[#30415D] tabular-nums">
              <CheckCircle2 className="h-3.5 w-3.5 text-[#147D63] shrink-0" />
              <span className="truncate">3 sources correlated · 15m probe interval</span>
            </div>
          </div>
        </div>

        {/* Correlated Timeline Strip inside the UI Frame */}
        <div className="rounded-lg border border-[#DFE6F0] bg-[#F7F9FC] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-[1px] bg-[#168E99]" aria-hidden="true" />
              <span className="text-[12px] font-mono font-semibold uppercase tracking-wider text-[#17243A]">
                Time-Window Correlated Signal Timeline (24h Axis)
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11.5px] font-mono text-[#30415D] tabular-nums">
              <span className="inline-flex items-center gap-1.5 rounded bg-white border border-[#DFE6F0] px-2 py-0.5">
                <GitCommitHorizontal className="h-3.5 w-3.5 text-[#5157D9]" aria-hidden="true" />
                Vercel Production Deployment (#a84f21c at 14:10 UTC)
              </span>
              <span className="inline-flex items-center gap-1.5 rounded bg-white border border-[#DFE6F0] px-2 py-0.5">
                Sentry Error Rate: <strong className="text-[#147D63]">0.02%</strong>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded bg-white border border-[#DFE6F0] px-2 py-0.5">
                HTTP Latency: <strong className="text-[#17243A]">142ms p95</strong>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded bg-white border border-[#DFE6F0] px-2 py-0.5">
                GA4 Active Sessions: <strong className="text-[#5157D9]">1,940/hr</strong>
              </span>
            </div>
          </div>

          {/* Visual Dual-Axis Sparkline / Bar Strip */}
          <div className="grid grid-cols-12 gap-1.5 items-end h-16 pt-2 px-2 bg-white rounded border border-[#DFE6F0]">
            {[
              { time: "02:00", h: "h-7", deploy: false },
              { time: "04:00", h: "h-6", deploy: false },
              { time: "06:00", h: "h-8", deploy: false },
              { time: "08:00", h: "h-9", deploy: false },
              { time: "10:00", h: "h-10", deploy: false },
              { time: "12:00", h: "h-11", deploy: false },
              { time: "14:10", h: "h-12", deploy: true },
              { time: "16:00", h: "h-11", deploy: false },
              { time: "18:00", h: "h-10", deploy: false },
              { time: "20:00", h: "h-9", deploy: false },
              { time: "22:00", h: "h-8", deploy: false },
              { time: "00:00", h: "h-7", deploy: false },
            ].map((bar) => (
              <div key={bar.time} className="flex flex-col items-center gap-1">
                <div
                  className={`w-full rounded-t ${bar.h} ${
                    bar.deploy
                      ? "bg-[#168E99] ring-2 ring-[#5157D9]/30"
                      : "bg-[#5157D9]/75 hover:bg-[#5157D9]"
                  }`}
                  title={
                    bar.deploy
                      ? `${bar.time} UTC — Vercel Deploy #a84f21c · 0.02% Sentry Error Rate · 142ms p95`
                      : `${bar.time} UTC — Normal production telemetry`
                  }
                />
                <span className="text-[10px] font-mono text-[#64748B] tabular-nums">
                  {bar.time}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PricingSectionInteractive() {
  const [billingCycle, setBillingCycle] = React.useState<"monthly" | "annual">("annual");

  return (
    <section
      id="pricing"
      className="py-24 px-4 sm:px-6 lg:px-8 bg-[#F7F9FC] border-t border-[#DFE6F0]"
    >
      <div className="max-w-[1280px] mx-auto space-y-12">
        {/* Centered Header */}
        <div className="max-w-3xl mx-auto text-center space-y-4">
          <SectionEyebrow className="justify-center">
            TRANSPARENT, QUOTA-BASED PRICING
          </SectionEyebrow>
          <h2 className="text-[32px] sm:text-[44px] leading-[1.1] font-semibold tracking-[-0.028em] text-[#17243A] m-0">
            Start with a 14-day Pro preview. No credit card required.
          </h2>
          <p className="text-[17px] sm:text-[18px] leading-[1.6] text-[#30415D] m-0">
            Every new workspace starts with a 14-day preview of{" "}
            <strong className="font-semibold text-[#17243A]">Avenor Pro</strong>—giving you up to 5
            logical products, 20 mapped sources, and 6-hour background syncs. When your preview
            ends, you choose to upgrade or revert automatically to the{" "}
            <strong className="font-semibold text-[#17243A]">Free</strong> plan with zero surprise
            charges.
          </p>

          {/* Monthly / Yearly Toggle */}
          <div className="pt-3 flex items-center justify-center">
            <div
              role="tablist"
              aria-label="Billing interval toggle"
              className="inline-flex items-center p-1 rounded-lg bg-[#F0F4FA] border border-[#C7D2E3]"
            >
              <button
                type="button"
                role="tab"
                aria-selected={billingCycle === "monthly"}
                onClick={() => setBillingCycle("monthly")}
                className={`px-4 py-2 rounded-md text-[13.5px] font-medium transition-colors cursor-pointer ${
                  billingCycle === "monthly"
                    ? "bg-[#FFFFFF] text-[#17243A] shadow-2xs border border-[#DFE6F0]"
                    : "text-[#64748B] hover:text-[#17243A]"
                }`}
              >
                Monthly billing
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={billingCycle === "annual"}
                onClick={() => setBillingCycle("annual")}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-[13.5px] font-medium transition-colors cursor-pointer ${
                  billingCycle === "annual"
                    ? "bg-[#FFFFFF] text-[#17243A] shadow-2xs border border-[#DFE6F0]"
                    : "text-[#64748B] hover:text-[#17243A]"
                }`}
              >
                <span>Annual billing</span>
                <span className="text-[11px] font-mono font-semibold text-[#147D63] bg-[#E7F6EF] border border-[#B9E6D2] px-2 py-0.5 rounded tabular-nums">
                  Save up to 21%
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* 3-Column Architectural Pricing Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
          {/* Tier 1: Free */}
          <div className="rounded-xl bg-[#FFFFFF] border border-[#DFE6F0] p-6 sm:p-8 flex flex-col justify-between gap-6">
            <div className="space-y-5">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-[20px] font-semibold text-[#17243A] m-0">Free</h3>
                  <span className="text-[11.5px] font-mono text-[#64748B] bg-[#F0F4FA] border border-[#DFE6F0] px-2 py-0.5 rounded">
                    Starter / Solo
                  </span>
                </div>
                <p className="text-[14px] text-[#30415D] m-0">
                  For solo builders validating a single flagship product.
                </p>
              </div>

              <div className="pt-2 border-t border-[#DFE6F0] tabular-nums">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[38px] font-semibold tracking-tight text-[#17243A]">
                    $0
                  </span>
                  <span className="text-[13.5px] font-mono text-[#64748B]">
                    {billingCycle === "annual" ? "/ year" : "/ month"}
                  </span>
                </div>
                <p className="text-[12px] font-mono text-[#64748B] mt-1 m-0">
                  Free forever · No card required
                </p>
              </div>

              <Link
                href="/signup"
                className="w-full inline-flex items-center justify-center h-11 px-4 rounded-lg bg-[#F0F4FA] hover:bg-[#E5ECF6] border border-[#C7D2E3] text-[#17243A] text-[14px] font-medium no-underline transition-colors"
              >
                Start for free
              </Link>

              <ul className="space-y-3 pt-3 border-t border-[#DFE6F0] text-[13.5px] text-[#30415D] list-none p-0 m-0 tabular-nums">
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#147D63] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#17243A]">1</strong> logical product
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#147D63] shrink-0 mt-0.5" />
                  <span>
                    Up to <strong className="text-[#17243A]">4</strong> read-only sources
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#147D63] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#17243A]">1</strong> member (Owner)
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#147D63] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#17243A]">30 days</strong> normalized history
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#147D63] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#17243A]">Daily</strong> scheduled sync (1 manual
                    refresh/24h)
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#147D63] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#17243A]">1</strong> HTTP/TLS monitor (30-min interval)
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#147D63] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#17243A]">2</strong> alert rules · In-app & email
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#147D63] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#17243A]">1</strong> saved report ·{" "}
                    <strong className="text-[#17243A]">2</strong> CSV exports/mo
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#64748B] shrink-0 mt-0.5" />
                  <span>Deterministic rules only</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Tier 2: Pro (Highlighted) */}
          <div className="rounded-xl bg-[#FFFFFF] border-2 border-[#5157D9] shadow-lg p-6 sm:p-8 flex flex-col justify-between gap-6 relative">
            <div className="space-y-5">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[20px] font-semibold text-[#17243A] m-0">Pro</h3>
                  <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-white bg-[#5157D9] px-2.5 py-0.5 rounded">
                    Most Popular · 14-Day Preview
                  </span>
                </div>
                <p className="text-[14px] text-[#30415D] m-0">
                  For founders and operators running a portfolio of live products.
                </p>
              </div>

              <div className="pt-2 border-t border-[#DFE6F0] tabular-nums">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[38px] font-semibold tracking-tight text-[#17243A]">
                    {billingCycle === "annual" ? "$15" : "$19"}
                  </span>
                  <span className="text-[13.5px] font-mono text-[#64748B]">/ month</span>
                </div>
                <p className="text-[12px] font-mono text-[#147D63] mt-1 m-0">
                  {billingCycle === "annual"
                    ? "$180 billed yearly — Save 21%"
                    : "Billed monthly · Or $15/mo billed yearly (Save 21%)"}
                </p>
              </div>

              <Link
                href="/signup?plan=pro"
                className="w-full inline-flex items-center justify-center gap-2 h-11 px-4 rounded-lg bg-[#5157D9] hover:bg-[#4348C2] text-white text-[14px] font-medium no-underline transition-colors shadow-xs"
              >
                <span>Start 14-day Pro preview</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>

              <ul className="space-y-3 pt-3 border-t border-[#DFE6F0] text-[13.5px] text-[#30415D] list-none p-0 m-0 tabular-nums">
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#5157D9] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#17243A]">5</strong> logical products
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#5157D9] shrink-0 mt-0.5" />
                  <span>
                    Up to <strong className="text-[#17243A]">20</strong> read-only sources
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#5157D9] shrink-0 mt-0.5" />
                  <span>
                    Up to <strong className="text-[#17243A]">2</strong> workspace members
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#5157D9] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#17243A]">12 months</strong> normalized history
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#5157D9] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#17243A]">Every 6 hours</strong> (5 manual
                    refreshes/day)
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#5157D9] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#17243A]">5</strong> HTTP/TLS monitors (15-min
                    interval)
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#5157D9] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#17243A]">15</strong> alert rules ·{" "}
                    <strong className="text-[#17243A]">3</strong> scheduled digests
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#5157D9] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#17243A]">Unlimited</strong> saved reports ·{" "}
                    <strong className="text-[#17243A]">50</strong> CSV &{" "}
                    <strong className="text-[#17243A]">20</strong> PDF/mo
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#5157D9] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#17243A]">20</strong> AI briefings/mo ·{" "}
                    <strong className="text-[#17243A]">2,000</strong> API reqs/mo ·{" "}
                    <strong className="text-[#17243A]">2</strong> webhooks
                  </span>
                </li>
              </ul>
            </div>
          </div>

          {/* Tier 3: Team */}
          <div className="rounded-xl bg-[#FFFFFF] border border-[#DFE6F0] p-6 sm:p-8 flex flex-col justify-between gap-6">
            <div className="space-y-5">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-[20px] font-semibold text-[#17243A] m-0">Team</h3>
                  <span className="text-[11.5px] font-mono text-[#168E99] bg-[#E7F6F7] border border-[#B8E5E8] px-2 py-0.5 rounded">
                    Shared Operations & Studios
                  </span>
                </div>
                <p className="text-[14px] text-[#30415D] m-0">
                  For product teams, studios, and agencies operating shared portfolios.
                </p>
              </div>

              <div className="pt-2 border-t border-[#DFE6F0] tabular-nums">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[38px] font-semibold tracking-tight text-[#17243A]">
                    {billingCycle === "annual" ? "$49" : "$59"}
                  </span>
                  <span className="text-[13.5px] font-mono text-[#64748B]">/ month</span>
                </div>
                <p className="text-[12px] font-mono text-[#147D63] mt-1 m-0">
                  {billingCycle === "annual"
                    ? "$588 billed yearly — Save 17%"
                    : "Billed monthly · Or $49/mo billed yearly (Save 17%)"}
                </p>
              </div>

              <Link
                href="/signup?plan=team"
                className="w-full inline-flex items-center justify-center h-11 px-4 rounded-lg bg-[#17243A] hover:bg-[#10192B] text-white text-[14px] font-medium no-underline transition-colors"
              >
                Start Team workspace
              </Link>

              <ul className="space-y-3 pt-3 border-t border-[#DFE6F0] text-[13.5px] text-[#30415D] list-none p-0 m-0 tabular-nums">
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#168E99] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#17243A]">20</strong> logical products
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#168E99] shrink-0 mt-0.5" />
                  <span>
                    Up to <strong className="text-[#17243A]">60</strong> read-only sources
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#168E99] shrink-0 mt-0.5" />
                  <span>
                    Up to <strong className="text-[#17243A]">10</strong> members (Owner, Admin,
                    Analyst, Viewer)
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#168E99] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#17243A]">24 months</strong> normalized history
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#168E99] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#17243A]">Hourly</strong> priority sync (20 manual
                    refreshes/day)
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#168E99] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#17243A]">20</strong> HTTP/TLS monitors (10-min
                    interval)
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#168E99] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#17243A]">75</strong> alert rules ·{" "}
                    <strong className="text-[#17243A]">20</strong> scheduled digests
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#168E99] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#17243A]">Unlimited</strong> saved reports ·{" "}
                    <strong className="text-[#17243A]">250</strong> CSV &{" "}
                    <strong className="text-[#17243A]">100</strong> PDF/mo
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#168E99] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#17243A]">150</strong> AI briefings/mo ·{" "}
                    <strong className="text-[#17243A]">25,000</strong> API reqs/mo ·{" "}
                    <strong className="text-[#17243A]">10</strong> webhooks
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Calm Downgrade Guarantee Footnote */}
        <div className="rounded-xl bg-[#F0F4FA] border border-[#DFE6F0] p-5 sm:p-6 flex items-start gap-3.5 text-[13.5px] leading-[1.6] text-[#30415D]">
          <Info className="h-5 w-5 text-[#5157D9] shrink-0 mt-0.5" aria-hidden="true" />
          <p className="m-0">
            <strong className="font-semibold text-[#17243A]">Calm Downgrade Guarantee:</strong> If
            your 14-day Pro preview expires or you downgrade with more products or sources than your
            plan allows, Avenor{" "}
            <strong className="font-semibold text-[#17243A]">
              never deletes your configuration or historical data
            </strong>
            . Your primary active product remains live, and excess products/sources enter a clean{" "}
            <code className="font-mono text-[12px] bg-white border border-[#DFE6F0] px-1.5 py-0.5 rounded text-[#17243A]">
              Paused (Plan Limit)
            </code>{" "}
            state until you archive them or upgrade. Billing is securely processed via{" "}
            <strong className="font-semibold text-[#17243A]">Lemon Squeezy</strong> as Merchant of
            Record with automatic global tax/VAT handling.
          </p>
        </div>
      </div>
    </section>
  );
}
