import { SignalAtlasLogo } from "@avenor/ui";
import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  CheckCircle2,
  Clock3,
  Database,
  EyeOff,
  FileCheck2,
  GitCommitHorizontal,
  GitMerge,
  Globe,
  HeartPulse,
  Info,
  KeyRound,
  Layers,
  ReceiptText,
  Scale,
  SlidersHorizontal,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import {
  HeroProductCommandFrame,
  PricingSectionInteractive,
} from "@/components/marketing/landing-interactive";
import {
  ArchitecturalIconTile,
  CloudflareIcon,
  GA4Icon,
  GCPIcon,
  GitHubIcon,
  GSCIcon,
  NeonIcon,
  SectionEyebrow,
  SentryIcon,
  SupabaseIcon,
  VercelIcon,
} from "@/components/marketing/provider-marks";

const ECOSYSTEM_PROVIDERS = [
  {
    name: "Google Analytics 4",
    mode: "Analytics Data API v1 · Read-Only",
    icon: <GA4Icon className="h-4 w-4 text-[#5157D9]" />,
  },
  {
    name: "Google Search Console",
    mode: "Webmasters API · Read-Only",
    icon: <GSCIcon className="h-4 w-4 text-[#168E99]" />,
  },
  {
    name: "Google Cloud Billing",
    mode: "BigQuery Billing Export · Read-Only",
    icon: <GCPIcon className="h-4 w-4 text-[#5157D9]" />,
  },
  {
    name: "Neon Postgres",
    mode: "Management API · Metadata Only",
    icon: <NeonIcon className="h-4 w-4 text-[#147D63]" />,
  },
  {
    name: "Supabase",
    mode: "Management API · Project Health",
    icon: <SupabaseIcon className="h-4 w-4 text-[#147D63]" />,
  },
  {
    name: "Cloudflare",
    mode: "GraphQL Analytics · Traffic & Edge",
    icon: <CloudflareIcon className="h-4 w-4 text-[#A66A16]" />,
  },
  {
    name: "Vercel",
    mode: "Deployments & Project Telemetry",
    icon: <VercelIcon className="h-3.5 w-3.5 text-[#17243A]" />,
  },
  {
    name: "GitHub",
    mode: "Actions Workflows & Release Events",
    icon: <GitHubIcon className="h-4 w-4 text-[#17243A]" />,
  },
  {
    name: "Sentry",
    mode: "Issues, Release Health & Error Volume",
    icon: <SentryIcon className="h-4 w-4 text-[#BF4256]" />,
  },
];

const FRAGMENTATION_ROWS = [
  {
    question: "“How are all 6 of my products performing this week?”",
    withoutAvenor:
      "Open 6 GA4 properties, 6 Search Console sites, 4 cloud billing accounts, and 6 deployment dashboards.",
    withAvenor:
      "Open one Portfolio Matrix sorted by traffic growth, net cloud cost, error delta, or uptime.",
  },
  {
    question: "“Why don’t my Search Console clicks match my GA4 sessions?”",
    withoutAvenor:
      "Argue in Slack over conflicting numbers with no context on attribution models or reporting lag.",
    withAvenor:
      "Side-by-side comparison with built-in Attribution & Lag Diagnostics explaining exact scope and delay differences.",
  },
  {
    question: "“Did our database or cloud bill spike after the v2.4 deploy?”",
    withoutAvenor:
      "Cross-reference GitHub commit timestamps against Neon storage graphs and delayed GCP billing CSVs.",
    withAvenor:
      "View Time-Window Correlated Signals aligning deployments, Sentry errors, database growth, and daily cost on one timeline.",
  },
  {
    question: "“Is a metric actually zero, or is the integration broken?”",
    withoutAvenor:
      "Dashboards silently render 0 when an OAuth token expires or a billing export lags by 36 hours.",
    withAvenor:
      "Strict Zero-Fabrication Contract: Avenor distinguishes true 0 from Delayed, Stale, Permission Revoked, or Not Mapped.",
  },
];

const INTEGRATION_ATLAS_ROWS = [
  {
    provider: "Google Analytics 4",
    domain: "Audience & Engagement",
    authMode: "Google OAuth (analytics.readonly)",
    signals: "Users, sessions, views, engagement rate, channels, geo/device, top pages, realtime",
    risk: "0% (Read-Only)",
    icon: <GA4Icon className="h-4 w-4 text-[#5157D9]" />,
  },
  {
    provider: "Google Search Console",
    domain: "Search Visibility",
    authMode: "Google OAuth (webmasters.readonly)",
    signals: "Clicks, impressions, CTR, avg position, query & page breakdowns",
    risk: "0% (Read-Only)",
    icon: <GSCIcon className="h-4 w-4 text-[#168E99]" />,
  },
  {
    provider: "Google Cloud Billing",
    domain: "Cloud Costs (FinOps)",
    authMode: "Service Account / OAuth (bigquery.readonly)",
    signals: "Gross cost, credits, net spend by service, project, SKU & currency",
    risk: "0% (Read-Only)",
    icon: <GCPIcon className="h-4 w-4 text-[#5157D9]" />,
  },
  {
    provider: "Neon",
    domain: "Backend & Databases",
    authMode: "Scoped Personal / Org API Key",
    signals: "Project/branch inventory, storage size, compute usage, connection metrics",
    risk: "0% (Metadata Only)",
    icon: <NeonIcon className="h-4 w-4 text-[#147D63]" />,
  },
  {
    provider: "Supabase",
    domain: "Backend & Databases",
    authMode: "Management API Access Token",
    signals: "Project health, database size/usage metadata, supported aggregate auth counts",
    risk: "0% (Metadata Only)",
    icon: <SupabaseIcon className="h-4 w-4 text-[#147D63]" />,
  },
  {
    provider: "Cloudflare",
    domain: "Hosting & Edge",
    authMode: "Scoped API Token (Analytics:Read)",
    signals: "Requests, bandwidth, cache hit ratio, HTTP status classes, threat/edge summary",
    risk: "0% (Read-Only)",
    icon: <CloudflareIcon className="h-4 w-4 text-[#A66A16]" />,
  },
  {
    provider: "Vercel",
    domain: "Hosting & Deploys",
    authMode: "Access Token (User / Team Scope)",
    signals: "Project inventory, production/preview deployment events, build durations & status",
    risk: "0% (Read-Only)",
    icon: <VercelIcon className="h-3.5 w-3.5 text-[#17243A]" />,
  },
  {
    provider: "GitHub",
    domain: "Developer Velocity",
    authMode: "Fine-Grained PAT / GitHub App (Read)",
    signals: "Repository releases, workflow run pass/fail rates, deployment event timestamps",
    risk: "0% (Read-Only)",
    icon: <GitHubIcon className="h-4 w-4 text-[#17243A]" />,
  },
  {
    provider: "Sentry",
    domain: "Error & Release Health",
    authMode: "Auth Token (project:read, event:read)",
    signals: "Unresolved issue counts, error event volume, release regression & crash-free trends",
    risk: "0% (Read-Only)",
    icon: <SentryIcon className="h-4 w-4 text-[#BF4256]" />,
  },
];

const FAQ_ITEMS = [
  {
    q: "What does “Product-Centered, Not Provider-Centered” mean?",
    a: "Most dashboard tools force you to build separate views per vendor (a GA4 board, a Vercel board, a GCP board). Avenor lets you define a Logical Product (e.g., Acme Web App) with Production and Staging environments, and binds all 9 external data sources directly to that product.",
  },
  {
    q: "Can Avenor modify my cloud infrastructure, deployments, or databases?",
    a: "No. Avenor is strictly read-only. Every OAuth integration requests read-only scopes, and every API token connector is verified against read-only metadata endpoints. Avenor has zero write paths to your providers.",
  },
  {
    q: "Does Avenor read rows from my Neon or Supabase application tables?",
    a: "Never. Avenor connects to Neon and Supabase management APIs to read infrastructure metadata—such as storage byte consumption, compute unit hours, branch counts, and active connection telemetry. We never connect to your Postgres data plane or run SQL queries on customer data.",
  },
  {
    q: "Why do my Google Search Console clicks and GA4 organic sessions differ?",
    a: "Search Console measures Google search result clicks (with a 24–48 hour finalization window), whereas GA4 measures browser sessions initiated after JavaScript loads and consent banners are resolved. Avenor displays both side-by-side with explicit attribution and lag notes so your team never misinterprets the delta.",
  },
  {
    q: "How does Google Cloud Billing ingestion work?",
    a: "Google Cloud’s production-grade way to analyze cost data is via BigQuery Billing Export (Standard or Detailed usage cost export). You authorize read-only access to the BigQuery dataset containing your billing export, and Avenor normalizes gross cost, credits, and net spend per product and service.",
  },
  {
    q: "What happens if a connected source fails to sync or is not mapped?",
    a: "Avenor enforces a strict Zero-Fabrication Contract. We never display a fake 0 when data is missing. Unmapped domains show Not Mapped, delayed upstream exports show Provider Lag, and failed credentials show Sync Error with actionable remediation steps.",
  },
  {
    q: "How does the 14-day Pro preview work? Do I need a credit card?",
    a: "No credit card is required to sign up. Every new workspace receives 14 days of Avenor Pro entitlements managed directly inside Avenor. If you don't subscribe before day 14, your workspace automatically transitions to the Free plan ($0/mo) with zero charges.",
  },
  {
    q: "What happens to my data if I downgrade from Pro or Team to Free?",
    a: "Nothing is deleted. If you have 5 logical products on Pro and revert to Free (which includes 1 active product), your primary product keeps syncing daily while the remaining 4 are marked Paused (Plan Limit) in read-only mode until you upgrade or change your active selection.",
  },
  {
    q: "Can I sum unique users across all products in my portfolio?",
    a: "Avenor sums additive metrics across products (such as total sessions, pageviews, search clicks, and same-currency cloud spend). However, because a single person visiting two of your products cannot be deduplicated across separate GA4 properties, Avenor labels portfolio user rollups accurately and prevents statistically invalid aggregations.",
  },
  {
    q: "How are my API tokens and OAuth credentials stored?",
    a: "All credentials are encrypted at rest using AES-256-GCM envelope encryption prior to database persistence, never returned in plaintext to the browser, and automatically scrubbed from application logs.",
  },
  {
    q: "Are AI summaries required, and does Avenor send my raw credentials to an LLM?",
    a: "AI briefings are strictly optional and disabled on the Free tier. When enabled on Pro or Team, Avenor passes only aggregated, normalized metric deltas to generate concise summaries—and every claim must attach a verifiable source chip back to the underlying metric card.",
  },
  {
    q: "How are payments, invoices, and VAT handled?",
    a: "All paid subscriptions are processed by Lemon Squeezy as our official Merchant of Record, supporting major credit cards, Apple Pay, Google Pay, and automatic global sales tax/VAT calculation and invoicing.",
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#F7F9FC] text-[#30415D]">
      {/* SECTION 01: Sticky Top Navigation Bar */}
      <header className="sticky top-0 z-30 h-16 bg-[#F7F9FC]/90 backdrop-blur-md border-b border-[#DFE6F0]">
        <div className="max-w-[1280px] mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="no-underline">
              <SignalAtlasLogo showWordmark showTag />
            </Link>
          </div>

          <nav
            aria-label="Primary marketing navigation"
            className="hidden lg:flex items-center gap-6 text-[13.5px] font-medium text-[#30415D]"
          >
            <a
              href="#product-model"
              className="hover:text-[#17243A] no-underline transition-colors"
            >
              Product Model
            </a>
            <a href="#domains" className="hover:text-[#17243A] no-underline transition-colors">
              Intelligence Domains
            </a>
            <a href="#security" className="hover:text-[#17243A] no-underline transition-colors">
              Provenance & Security
            </a>
            <a href="#integrations" className="hover:text-[#17243A] no-underline transition-colors">
              Integrations
            </a>
            <a href="#pricing" className="hover:text-[#17243A] no-underline transition-colors">
              Pricing
            </a>
            <a href="#faq" className="hover:text-[#17243A] no-underline transition-colors">
              FAQ
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-[#30415D] hover:text-[#17243A] px-3 py-2 rounded-lg no-underline transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center gap-1.5 bg-[#5157D9] hover:bg-[#4348C2] text-white text-sm font-medium px-4 py-2 rounded-lg shadow-xs no-underline transition-colors"
            >
              <span>Start free workspace</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* SECTION 02: Hero Section + Interactive Product Command Frame */}
        <section
          className="relative overflow-hidden border-b border-[#DFE6F0]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #EAEFF7 1px, transparent 1px), linear-gradient(to bottom, #EAEFF7 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        >
          <div className="max-w-[1280px] mx-auto px-4 sm:px-6 pt-14 sm:pt-16 pb-20 space-y-12">
            {/* Top Row: 12-column asymmetric split */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
              {/* Left 7 Columns */}
              <div className="lg:col-span-7 space-y-6">
                <div className="inline-flex items-center gap-2 rounded-md bg-[#EEF0FF] border border-[#D8DCFF] px-3 py-1 text-[12px] font-mono font-semibold uppercase tracking-[0.08em] text-[#5157D9]">
                  <span
                    className="h-1.5 w-1.5 rounded-[1px] bg-[#5157D9] shrink-0"
                    aria-hidden="true"
                  />
                  <span>READ-ONLY DIGITAL PRODUCT INTELLIGENCE</span>
                </div>

                <h1 className="text-[40px] sm:text-[54px] lg:text-[62px] leading-[1.05] font-semibold tracking-[-0.035em] text-[#17243A] m-0">
                  Every signal behind every product you run. Organized by product, not provider.
                </h1>

                <p className="text-[18px] sm:text-[19px] leading-[1.6] text-[#30415D] max-w-[64ch] m-0">
                  Stop stitching together ten browser tabs to understand one application. Avenor
                  maps your analytics, search visibility, cloud billing, databases, deployments, and
                  uptime into a single, read-only command surface—with explicit source provenance on
                  every number.
                </p>

                <div className="flex flex-wrap items-center gap-3.5 pt-2">
                  <Link
                    href="/signup"
                    className="inline-flex items-center justify-center gap-2 h-12 px-6 rounded-lg bg-[#5157D9] hover:bg-[#4348C2] text-white font-medium text-[15px] no-underline transition-colors shadow-xs"
                  >
                    <span>Start free — 14-day Pro preview</span>
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  <a
                    href="#product-model"
                    className="inline-flex items-center justify-center gap-2 h-12 px-5 rounded-lg bg-[#FFFFFF] hover:bg-[#F0F4FA] border border-[#C7D2E3] text-[#17243A] font-medium text-[15px] no-underline transition-colors"
                  >
                    <Layers className="h-4 w-4 text-[#5157D9]" aria-hidden="true" />
                    <span>Explore the product model</span>
                  </a>
                </div>

                <p className="text-[12px] font-mono text-[#64748B] m-0 pt-1">
                  No credit card required · 100% read-only credentials · Reverts cleanly to Free
                  after 14 days
                </p>
              </div>

              {/* Right 5 Columns: Live Product Topology Card */}
              <div className="lg:col-span-5">
                <div className="rounded-xl bg-[#FFFFFF] border border-[#C7D2E3] shadow-sm overflow-hidden">
                  <div className="bg-[#F0F4FA] border-b border-[#DFE6F0] px-5 py-3.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-[1px] bg-[#168E99]" aria-hidden="true" />
                      <span className="text-[11.5px] font-mono font-semibold uppercase tracking-wider text-[#17243A]">
                        Live Product Topology
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-[#147D63] bg-[#E7F6EF] border border-[#B9E6D2] px-2 py-0.5 rounded">
                      Zero Mutation Paths
                    </span>
                  </div>

                  <div className="p-5 space-y-4">
                    <div className="rounded-lg border border-[#DFE6F0] bg-[#F7F9FC] p-3.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-mono uppercase tracking-wider text-[#64748B]">
                          Logical Product
                        </span>
                        <span className="text-[11px] font-mono text-[#5157D9] font-semibold tabular-nums">
                          checkout.corstack.dev
                        </span>
                      </div>
                      <div className="text-[16px] font-semibold text-[#17243A]">
                        Checkout API & Web Platform
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px] font-mono tabular-nums">
                        <span className="px-2 py-0.5 rounded bg-[#E7F6EF] text-[#147D63] border border-[#B9E6D2] font-semibold">
                          Production (Default)
                        </span>
                        <span className="px-2 py-0.5 rounded bg-white text-[#30415D] border border-[#DFE6F0]">
                          Staging
                        </span>
                        <span className="px-2 py-0.5 rounded bg-white text-[#64748B] border border-[#DFE6F0]">
                          Development
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[11.5px] font-mono text-[#64748B]">
                        <span>BOUND READ-ONLY SOURCES (PRODUCTION)</span>
                        <span className="tabular-nums text-[#17243A] font-semibold">
                          6 / 6 Active
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[12px] font-mono tabular-nums">
                        <div className="rounded border border-[#DFE6F0] bg-white px-2.5 py-2 flex items-center gap-2 text-[#17243A]">
                          <GA4Icon className="h-3.5 w-3.5 text-[#5157D9] shrink-0" />
                          <span className="truncate">GA4 · prop_88412</span>
                        </div>
                        <div className="rounded border border-[#DFE6F0] bg-white px-2.5 py-2 flex items-center gap-2 text-[#17243A]">
                          <GSCIcon className="h-3.5 w-3.5 text-[#168E99] shrink-0" />
                          <span className="truncate">GSC · checkout.dev</span>
                        </div>
                        <div className="rounded border border-[#DFE6F0] bg-white px-2.5 py-2 flex items-center gap-2 text-[#17243A]">
                          <GCPIcon className="h-3.5 w-3.5 text-[#5157D9] shrink-0" />
                          <span className="truncate">BQ Billing · prod_fin</span>
                        </div>
                        <div className="rounded border border-[#DFE6F0] bg-white px-2.5 py-2 flex items-center gap-2 text-[#17243A]">
                          <NeonIcon className="h-3.5 w-3.5 text-[#147D63] shrink-0" />
                          <span className="truncate">Neon · br-main-db</span>
                        </div>
                        <div className="rounded border border-[#DFE6F0] bg-white px-2.5 py-2 flex items-center gap-2 text-[#17243A]">
                          <VercelIcon className="h-3 w-3 text-[#17243A] shrink-0" />
                          <span className="truncate">Vercel · prj_checkout</span>
                        </div>
                        <div className="rounded border border-[#DFE6F0] bg-white px-2.5 py-2 flex items-center gap-2 text-[#17243A]">
                          <SentryIcon className="h-3.5 w-3.5 text-[#BF4256] shrink-0" />
                          <span className="truncate">Sentry · checkout-api</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Row: Full-Width Interactive Product Intelligence Frame */}
            <HeroProductCommandFrame />
          </div>
        </section>

        {/* SECTION 03: Ecosystem & Telemetry Strip */}
        <section className="border-b border-[#DFE6F0] bg-[#FFFFFF] py-7 px-4 sm:px-6">
          <div className="max-w-[1280px] mx-auto space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-[12px] font-mono font-semibold uppercase tracking-[0.08em] text-[#64748B]">
                UNIFIED READ-ONLY TELEMETRY ACROSS 9 CORE ECOSYSTEMS
              </span>
              <span className="text-[12px] font-mono text-[#168E99]">
                Pre-flight verified scopes · Zero remote write methods
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-9 gap-2.5">
              {ECOSYSTEM_PROVIDERS.map((provider) => (
                <div
                  key={provider.name}
                  className="rounded-lg border border-[#DFE6F0] bg-[#F7F9FC] hover:bg-[#F0F4FA] hover:border-[#C7D2E3] p-3 flex flex-col justify-between gap-2 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="h-6 w-6 rounded bg-white border border-[#DFE6F0] inline-flex items-center justify-center shrink-0">
                      {provider.icon}
                    </span>
                    <span className="text-[12.5px] font-semibold text-[#17243A] leading-tight">
                      {provider.name}
                    </span>
                  </div>
                  <span className="text-[10.5px] font-mono text-[#64748B] leading-snug">
                    {provider.mode}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* SECTION 04: The Problem Narrative ("The Fragmentation Tax") */}
        <section className="py-24 px-4 sm:px-6 bg-[#F7F9FC]">
          <div className="max-w-[1280px] mx-auto space-y-12">
            <div className="max-w-3xl space-y-4">
              <SectionEyebrow>THE MULTI-PRODUCT VISIBILITY GAP</SectionEyebrow>
              <h2 className="text-[32px] sm:text-[44px] leading-[1.1] font-semibold tracking-[-0.028em] text-[#17243A] m-0">
                Your products are unified experiences. Your operational data is scattered across ten
                consoles.
              </h2>
              <p className="text-[18px] leading-[1.6] text-[#30415D] max-w-[64ch] m-0">
                When you run three, five, or twenty digital products, answering a simple operational
                question—
                <em>
                  “Did Tuesday&apos;s release increase cloud spend or hurt organic landing page
                  conversion?”
                </em>
                —requires logging into separate accounts, reconciling mismatched timezones, and
                mentally mapping cloud project IDs to analytics properties.
              </p>
            </div>

            <div className="overflow-x-auto rounded-xl border border-[#C7D2E3] bg-[#FFFFFF] shadow-2xs">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-[#C7D2E3]">
                    <th className="p-4 sm:p-5 text-[12px] font-mono font-semibold uppercase tracking-wider text-[#17243A] bg-[#F0F4FA] w-1/4">
                      Operational Question
                    </th>
                    <th className="p-4 sm:p-5 text-[12px] font-mono font-semibold uppercase tracking-wider text-[#64748B] bg-[#F0F4FA] border-l border-[#DFE6F0] w-3/8">
                      Without Avenor (Provider-Siloed Consoles)
                    </th>
                    <th className="p-4 sm:p-5 text-[12px] font-mono font-semibold uppercase tracking-wider text-[#5157D9] bg-[#EEF0FF] border-l border-[#D8DCFF] border-t-2 border-t-[#5157D9] w-3/8">
                      With Avenor (Product-Centered Intelligence)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DFE6F0] text-[14px]">
                  {FRAGMENTATION_ROWS.map((row) => (
                    <tr key={row.question}>
                      <td className="p-4 sm:p-5 font-semibold text-[#17243A] align-top bg-[#F7F9FC]">
                        {row.question}
                      </td>
                      <td className="p-4 sm:p-5 text-[#64748B] align-top bg-[#F0F4FA]/55 border-l border-[#DFE6F0]">
                        {row.withoutAvenor}
                      </td>
                      <td className="p-4 sm:p-5 text-[#17243A] font-medium align-top bg-[#FFFFFF] border-l border-[#DFE6F0]">
                        {row.withAvenor}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* SECTION 05: Meet Avenor — The Logical Product Model (#product-model) */}
        <section
          id="product-model"
          className="py-24 px-4 sm:px-6 bg-[#FFFFFF] border-y border-[#DFE6F0]"
        >
          <div className="max-w-[1280px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            {/* Left 5 Columns */}
            <div className="lg:col-span-5 space-y-6">
              <SectionEyebrow>PRODUCT-CENTERED ARCHITECTURE</SectionEyebrow>
              <h2 className="text-[32px] sm:text-[42px] leading-[1.1] font-semibold tracking-[-0.028em] text-[#17243A] m-0">
                Model your workspace around the products you ship—not the vendors you rent.
              </h2>
              <p className="text-[17px] leading-[1.6] text-[#30415D] m-0">
                In Avenor, the primary unit of analysis is the{" "}
                <strong className="font-semibold text-[#17243A]">Logical Product</strong>. Whether a
                product is a SaaS web app, a marketing site, an API service, or a mobile backend,
                you define it once, configure its{" "}
                <strong className="font-semibold text-[#17243A]">Production</strong>,{" "}
                <strong className="font-semibold text-[#17243A]">Staging</strong>, and{" "}
                <strong className="font-semibold text-[#17243A]">Development</strong> environments,
                and attach read-only provider sources directly to each environment.
              </p>

              <div className="space-y-4 pt-2">
                <div className="flex items-start gap-3.5">
                  <ArchitecturalIconTile accent="indigo">
                    <Layers className="h-[18px] w-[18px]" />
                  </ArchitecturalIconTile>
                  <div className="space-y-1">
                    <h3 className="text-[16px] font-semibold text-[#17243A] m-0">
                      Environment-Scoped Mapping
                    </h3>
                    <p className="text-[14px] leading-[1.55] text-[#30415D] m-0">
                      Map{" "}
                      <code className="font-mono text-[12px] bg-[#F0F4FA] px-1.5 py-0.5 rounded border border-[#DFE6F0]">
                        prod-ga4-property
                      </code>
                      ,{" "}
                      <code className="font-mono text-[12px] bg-[#F0F4FA] px-1.5 py-0.5 rounded border border-[#DFE6F0]">
                        neon-main-branch
                      </code>
                      , and{" "}
                      <code className="font-mono text-[12px] bg-[#F0F4FA] px-1.5 py-0.5 rounded border border-[#DFE6F0]">
                        vercel-production
                      </code>{" "}
                      to <strong>Production</strong>, while keeping <strong>Staging</strong>{" "}
                      telemetry cleanly separated—zero cross-contamination.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3.5">
                  <ArchitecturalIconTile accent="teal">
                    <GitMerge className="h-[18px] w-[18px]" />
                  </ArchitecturalIconTile>
                  <div className="space-y-1">
                    <h3 className="text-[16px] font-semibold text-[#17243A] m-0">
                      Normalized Cross-Domain Schema
                    </h3>
                    <p className="text-[14px] leading-[1.55] text-[#30415D] m-0">
                      Avenor ingests provider-specific APIs into time-partitioned daily, hourly, and
                      event fact tables—preserving provider nuances without flattening away critical
                      metadata.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3.5">
                  <ArchitecturalIconTile accent="indigo">
                    <BadgeCheck className="h-[18px] w-[18px]" />
                  </ArchitecturalIconTile>
                  <div className="space-y-1">
                    <h3 className="text-[16px] font-semibold text-[#17243A] m-0">
                      Explicit Provenance on Every Card
                    </h3>
                    <p className="text-[14px] leading-[1.55] text-[#30415D] m-0">
                      Every number displays its source system, mapped account/property identifier,
                      last successful sync timestamp, and data completeness state.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right 7 Columns: Logical Product Mapping Diagram */}
            <div className="lg:col-span-7">
              <div className="rounded-xl border border-[#C7D2E3] bg-[#F7F9FC] p-6 sm:p-8 space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-[#DFE6F0]">
                  <span className="text-[12px] font-mono font-semibold uppercase tracking-wider text-[#17243A]">
                    LOGICAL PRODUCT RESOURCE GRAPH
                  </span>
                  <span className="text-[11.5px] font-mono text-[#168E99] bg-[#E7F6F7] border border-[#B8E5E8] px-2.5 py-0.5 rounded">
                    1 Logical Product → 3 Isolated Environments
                  </span>
                </div>

                {/* External Provider IDs -> Normalized Environments */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Production Environment Box */}
                  <div className="rounded-lg bg-[#FFFFFF] border-2 border-[#5157D9] p-4 space-y-3 shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-[#17243A]">Production</span>
                      <span className="text-[10.5px] font-mono font-semibold text-[#147D63] bg-[#E7F6EF] px-2 py-0.5 rounded">
                        Default
                      </span>
                    </div>
                    <p className="text-[11.5px] font-mono text-[#64748B] m-0">
                      https://app.corstack.dev
                    </p>
                    <div className="space-y-1.5 pt-2 border-t border-[#DFE6F0] text-[11px] font-mono text-[#30415D] tabular-nums">
                      <div className="rounded bg-[#F0F4FA] px-2 py-1.5 flex items-center justify-between">
                        <span>GA4</span>
                        <span className="text-[#17243A] font-semibold">prop_88412</span>
                      </div>
                      <div className="rounded bg-[#F0F4FA] px-2 py-1.5 flex items-center justify-between">
                        <span>GSC</span>
                        <span className="text-[#17243A] font-semibold">sc:corstack.dev</span>
                      </div>
                      <div className="rounded bg-[#F0F4FA] px-2 py-1.5 flex items-center justify-between">
                        <span>BigQuery</span>
                        <span className="text-[#17243A] font-semibold">gcp_prod_billing</span>
                      </div>
                      <div className="rounded bg-[#F0F4FA] px-2 py-1.5 flex items-center justify-between">
                        <span>Neon DB</span>
                        <span className="text-[#17243A] font-semibold">br-prod-main</span>
                      </div>
                    </div>
                  </div>

                  {/* Staging Environment Box */}
                  <div className="rounded-lg bg-[#FFFFFF] border border-[#DFE6F0] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-[#17243A]">Staging</span>
                      <span className="text-[10.5px] font-mono text-[#30415D] bg-[#F0F4FA] px-2 py-0.5 rounded">
                        Pre-Release
                      </span>
                    </div>
                    <p className="text-[11.5px] font-mono text-[#64748B] m-0">
                      https://staging.corstack.dev
                    </p>
                    <div className="space-y-1.5 pt-2 border-t border-[#DFE6F0] text-[11px] font-mono text-[#30415D] tabular-nums">
                      <div className="rounded bg-[#F0F4FA] px-2 py-1.5 flex items-center justify-between">
                        <span>Vercel</span>
                        <span className="text-[#17243A] font-semibold">env:preview</span>
                      </div>
                      <div className="rounded bg-[#F0F4FA] px-2 py-1.5 flex items-center justify-between">
                        <span>Neon DB</span>
                        <span className="text-[#17243A] font-semibold">br-staging</span>
                      </div>
                      <div className="rounded bg-[#F0F4FA] px-2 py-1.5 flex items-center justify-between">
                        <span>Sentry</span>
                        <span className="text-[#17243A] font-semibold">env:staging</span>
                      </div>
                      <div className="rounded bg-[#F7F9FC] border border-dashed border-[#C7D2E3] px-2 py-1.5 flex items-center justify-between text-[#64748B]">
                        <span>GSC</span>
                        <span>Not Mapped</span>
                      </div>
                    </div>
                  </div>

                  {/* Development Environment Box */}
                  <div className="rounded-lg bg-[#FFFFFF] border border-[#DFE6F0] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-[#17243A]">Development</span>
                      <span className="text-[10.5px] font-mono text-[#64748B] bg-[#F0F4FA] px-2 py-0.5 rounded">
                        Sandbox
                      </span>
                    </div>
                    <p className="text-[11.5px] font-mono text-[#64748B] m-0">
                      https://dev.corstack.dev
                    </p>
                    <div className="space-y-1.5 pt-2 border-t border-[#DFE6F0] text-[11px] font-mono text-[#30415D] tabular-nums">
                      <div className="rounded bg-[#F0F4FA] px-2 py-1.5 flex items-center justify-between">
                        <span>GitHub</span>
                        <span className="text-[#17243A] font-semibold">ci-workflows</span>
                      </div>
                      <div className="rounded bg-[#F0F4FA] px-2 py-1.5 flex items-center justify-between">
                        <span>Neon DB</span>
                        <span className="text-[#17243A] font-semibold">br-dev-ephemeral</span>
                      </div>
                      <div className="rounded bg-[#F7F9FC] border border-dashed border-[#C7D2E3] px-2 py-1.5 flex items-center justify-between text-[#64748B]">
                        <span>GA4</span>
                        <span>Not Mapped</span>
                      </div>
                      <div className="rounded bg-[#F7F9FC] border border-dashed border-[#C7D2E3] px-2 py-1.5 flex items-center justify-between text-[#64748B]">
                        <span>Billing</span>
                        <span>Not Mapped</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 06: The Six Product Intelligence Pillars (#domains) */}
        <section id="domains" className="py-24 px-4 sm:px-6 bg-[#F7F9FC]">
          <div className="max-w-[1280px] mx-auto space-y-12">
            <div className="max-w-3xl space-y-4">
              <SectionEyebrow>SIX PRODUCT INTELLIGENCE DOMAINS</SectionEyebrow>
              <h2 className="text-[32px] sm:text-[44px] leading-[1.1] font-semibold tracking-[-0.028em] text-[#17243A] m-0">
                Every operational dimension of your product, normalized in one place.
              </h2>
              <p className="text-[18px] leading-[1.6] text-[#30415D] m-0">
                Avenor replaces ad-hoc spreadsheets and disconnected vendor consoles with six
                purpose-built intelligence pillars—each backed by live provenance metadata.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Pillar 01: Audience & Engagement */}
              <div className="rounded-xl bg-[#FFFFFF] border border-[#DFE6F0] p-6 flex flex-col justify-between gap-5">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <ArchitecturalIconTile accent="indigo">
                        <UsersRound className="h-[18px] w-[18px]" />
                      </ArchitecturalIconTile>
                      <span className="text-[11.5px] font-mono font-semibold uppercase tracking-wider text-[#64748B]">
                        DOMAIN 01 · AUDIENCE
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-mono bg-[#F0F4FA] border border-[#DFE6F0] px-2 py-1 rounded text-[#17243A]">
                      <GA4Icon className="h-3.5 w-3.5 text-[#5157D9]" />
                      GA4
                    </span>
                  </div>
                  <h3 className="text-[20px] leading-[1.25] font-semibold tracking-[-0.018em] text-[#17243A] m-0">
                    Understand acquisition, retention, and live traffic without GA4 report builder
                    fatigue.
                  </h3>
                  <p className="text-[14px] leading-[1.55] text-[#30415D] m-0">
                    Track active users, sessions, page/screen views, engagement rate, average
                    engagement duration, channel acquisition, geography/device splits, and top
                    landing pages—plus optional live realtime active user snapshots.
                  </p>
                </div>

                <div className="rounded-lg bg-[#F0F4FA] border border-[#DFE6F0] p-3.5 space-y-2 text-[11.5px] font-mono tabular-nums">
                  <div className="flex items-center justify-between text-[#17243A] font-semibold">
                    <span>Top Acquisition Channels (30d)</span>
                    <span className="text-[#147D63]">GA4 · Synced 18m ago</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-[#30415D]">
                    <div className="bg-white rounded px-2 py-1 border border-[#DFE6F0] flex justify-between">
                      <span>Organic Search</span>
                      <strong className="text-[#17243A]">44.2%</strong>
                    </div>
                    <div className="bg-white rounded px-2 py-1 border border-[#DFE6F0] flex justify-between">
                      <span>Direct</span>
                      <strong className="text-[#17243A]">28.1%</strong>
                    </div>
                    <div className="bg-white rounded px-2 py-1 border border-[#DFE6F0] flex justify-between">
                      <span>Referral</span>
                      <strong className="text-[#17243A]">18.4%</strong>
                    </div>
                    <div className="bg-white rounded px-2 py-1 border border-[#DFE6F0] flex justify-between">
                      <span>Paid Social</span>
                      <strong className="text-[#17243A]">9.3%</strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* Pillar 02: Search Visibility */}
              <div className="rounded-xl bg-[#FFFFFF] border border-[#DFE6F0] p-6 flex flex-col justify-between gap-5">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <ArchitecturalIconTile accent="teal">
                        <Globe className="h-[18px] w-[18px]" />
                      </ArchitecturalIconTile>
                      <span className="text-[11.5px] font-mono font-semibold uppercase tracking-wider text-[#64748B]">
                        DOMAIN 02 · SEARCH
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-mono bg-[#F0F4FA] border border-[#DFE6F0] px-2 py-1 rounded text-[#17243A]">
                      <GSCIcon className="h-3.5 w-3.5 text-[#168E99]" />
                      GSC + GA4
                    </span>
                  </div>
                  <h3 className="text-[20px] leading-[1.25] font-semibold tracking-[-0.018em] text-[#17243A] m-0">
                    See which queries and pages drive organic growth—and why GSC clicks differ from
                    GA4 sessions.
                  </h3>
                  <p className="text-[14px] leading-[1.55] text-[#30415D] m-0">
                    Monitor total clicks, impressions, organic CTR, and average position across web
                    properties. Inspect top queries, rising/declining pages, device/country
                    breakdowns, and side-by-side organic landing page performance with explicit
                    24–48h GSC finalization lag indicators.
                  </p>
                </div>

                <div className="rounded-lg bg-[#F0F4FA] border border-[#DFE6F0] p-3.5 space-y-2 text-[11.5px] font-mono tabular-nums">
                  <div className="text-[#17243A] font-semibold truncate">
                    Query: &ldquo;postgres read only observability&rdquo;
                  </div>
                  <div className="bg-white rounded px-2.5 py-1.5 border border-[#DFE6F0] flex flex-wrap items-center justify-between gap-2 text-[#30415D]">
                    <span>
                      <strong className="text-[#17243A]">1,840</strong> clicks
                    </span>
                    <span>·</span>
                    <span>
                      <strong className="text-[#17243A]">28.4k</strong> impr
                    </span>
                    <span>·</span>
                    <span>
                      <strong className="text-[#17243A]">6.4%</strong> CTR
                    </span>
                    <span>·</span>
                    <span className="text-[#147D63] font-semibold">Pos 3.2 (+1.4)</span>
                  </div>
                </div>
              </div>

              {/* Pillar 03: Cloud Cost & Billing FinOps */}
              <div className="rounded-xl bg-[#FFFFFF] border border-[#DFE6F0] p-6 flex flex-col justify-between gap-5">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <ArchitecturalIconTile accent="indigo">
                        <ReceiptText className="h-[18px] w-[18px]" />
                      </ArchitecturalIconTile>
                      <span className="text-[11.5px] font-mono font-semibold uppercase tracking-wider text-[#64748B]">
                        DOMAIN 03 · FINOPS
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-mono bg-[#F0F4FA] border border-[#DFE6F0] px-2 py-1 rounded text-[#17243A]">
                      <GCPIcon className="h-3.5 w-3.5 text-[#5157D9]" />
                      GCP BigQuery
                    </span>
                  </div>
                  <h3 className="text-[20px] leading-[1.25] font-semibold tracking-[-0.018em] text-[#17243A] m-0">
                    Turn raw BigQuery billing exports into product-level cost clarity and spend
                    anomaly alerts.
                  </h3>
                  <p className="text-[14px] leading-[1.55] text-[#30415D] m-0">
                    Attribute GCP spend directly to the products that incur it. Break down gross
                    cost, credits/discounts, and net spend by service (Cloud Run, BigQuery, Compute
                    Engine, Cloud SQL), project, and SKU—with explicit currency tags and billing
                    export partition latency badges.
                  </p>
                </div>

                <div className="rounded-lg bg-[#F0F4FA] border border-[#DFE6F0] p-3.5 space-y-2 text-[11.5px] font-mono tabular-nums">
                  <div className="flex items-center justify-between text-[#17243A] font-semibold">
                    <span>MTD Net Spend: $1,284.60 USD</span>
                    <span className="text-[#64748B]">Export latency: ~6h</span>
                  </div>
                  <div className="bg-white rounded px-2.5 py-1.5 border border-[#DFE6F0] flex flex-wrap items-center justify-between gap-2 text-[#30415D]">
                    <span>Gross $1,424.60</span>
                    <span className="text-[#147D63]">Credits -$140.00</span>
                    <span className="text-[#17243A] font-semibold">Forecast: $1,690.00</span>
                  </div>
                </div>
              </div>

              {/* Pillar 04: Backend & Database Health */}
              <div className="rounded-xl bg-[#FFFFFF] border border-[#DFE6F0] p-6 flex flex-col justify-between gap-5">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <ArchitecturalIconTile accent="teal">
                        <Database className="h-[18px] w-[18px]" />
                      </ArchitecturalIconTile>
                      <span className="text-[11.5px] font-mono font-semibold uppercase tracking-wider text-[#64748B]">
                        DOMAIN 04 · BACKEND
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-mono bg-[#F0F4FA] border border-[#DFE6F0] px-2 py-1 rounded text-[#17243A]">
                      <NeonIcon className="h-3.5 w-3.5 text-[#147D63]" />
                      <SupabaseIcon className="h-3.5 w-3.5 text-[#147D63]" />
                      Neon · Supabase
                    </span>
                  </div>
                  <h3 className="text-[20px] leading-[1.25] font-semibold tracking-[-0.018em] text-[#17243A] m-0">
                    Monitor storage growth, compute consumption, and connection pressure—without
                    touching customer rows.
                  </h3>
                  <p className="text-[14px] leading-[1.55] text-[#30415D] m-0">
                    Track database size trends, branch/project storage consumption, active/idle
                    connection counts, compute unit usage, and supported aggregate auth user counts
                    through strictly read-only management APIs. Avenor never executes arbitrary SQL
                    or reads application tables.
                  </p>
                </div>

                <div className="rounded-lg bg-[#F0F4FA] border border-[#DFE6F0] p-3.5 space-y-2 text-[11.5px] font-mono tabular-nums">
                  <div className="flex items-center justify-between text-[#17243A] font-semibold">
                    <span>Neon Production Branch</span>
                    <span className="text-[#168E99]">Metadata-only scope</span>
                  </div>
                  <div className="bg-white rounded px-2.5 py-1.5 border border-[#DFE6F0] flex flex-wrap items-center justify-between gap-2 text-[#30415D]">
                    <span>18.42 GB (+0.8 GB / 7d)</span>
                    <span>·</span>
                    <span>42.1 CU-hrs</span>
                    <span>·</span>
                    <span>38 peak conns</span>
                  </div>
                </div>
              </div>

              {/* Pillar 05: Hosting, Edge & Deployment Velocity */}
              <div className="rounded-xl bg-[#FFFFFF] border border-[#DFE6F0] p-6 flex flex-col justify-between gap-5">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <ArchitecturalIconTile accent="indigo">
                        <GitCommitHorizontal className="h-[18px] w-[18px]" />
                      </ArchitecturalIconTile>
                      <span className="text-[11.5px] font-mono font-semibold uppercase tracking-wider text-[#64748B]">
                        DOMAIN 05 · DEPLOYS & EDGE
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-mono bg-[#F0F4FA] border border-[#DFE6F0] px-2 py-1 rounded text-[#17243A]">
                      <VercelIcon className="h-3 w-3 text-[#17243A]" />
                      <CloudflareIcon className="h-3.5 w-3.5 text-[#A66A16]" />
                      <GitHubIcon className="h-3.5 w-3.5 text-[#17243A]" />
                    </span>
                  </div>
                  <h3 className="text-[20px] leading-[1.25] font-semibold tracking-[-0.018em] text-[#17243A] m-0">
                    Correlate every production release, workflow run, and edge traffic shift on one
                    timeline.
                  </h3>
                  <p className="text-[14px] leading-[1.55] text-[#30415D] m-0">
                    Combine Cloudflare request/bandwidth/cache/status-code analytics, Vercel
                    deployment history and build durations, and GitHub Actions workflow success
                    rates so you immediately see what shipped before a metric moved.
                  </p>
                </div>

                <div className="rounded-lg bg-[#F0F4FA] border border-[#DFE6F0] p-3.5 space-y-2 text-[11.5px] font-mono tabular-nums">
                  <div className="flex items-center justify-between text-[#17243A] font-semibold">
                    <span>Deploy #dpl_9f3a2 (Production)</span>
                    <span className="text-[#147D63]">42s build · 100% GH pass</span>
                  </div>
                  <div className="bg-white rounded px-2.5 py-1.5 border border-[#DFE6F0] flex items-center justify-between gap-2 text-[#30415D]">
                    <span>Cloudflare 94.2% Cache Hit</span>
                    <span className="text-[#147D63] font-semibold">0.04% 5xx rate</span>
                  </div>
                </div>
              </div>

              {/* Pillar 06: Reliability, Error Tracking & Uptime Monitoring */}
              <div className="rounded-xl bg-[#FFFFFF] border border-[#DFE6F0] p-6 flex flex-col justify-between gap-5">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <ArchitecturalIconTile accent="teal">
                        <HeartPulse className="h-[18px] w-[18px]" />
                      </ArchitecturalIconTile>
                      <span className="text-[11.5px] font-mono font-semibold uppercase tracking-wider text-[#64748B]">
                        DOMAIN 06 · RELIABILITY
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-mono bg-[#F0F4FA] border border-[#DFE6F0] px-2 py-1 rounded text-[#17243A]">
                      <SentryIcon className="h-3.5 w-3.5 text-[#BF4256]" />
                      Sentry + HTTP/TLS
                    </span>
                  </div>
                  <h3 className="text-[20px] leading-[1.25] font-semibold tracking-[-0.018em] text-[#17243A] m-0">
                    Combine external uptime checks with application error spikes for instant
                    incident context.
                  </h3>
                  <p className="text-[14px] leading-[1.55] text-[#30415D] m-0">
                    Pair Avenor’s built-in HTTP/HTTPS availability, response-time, and SSL expiry
                    monitors with Sentry unresolved issue counts, error event volume, and release
                    regression trends—evaluated automatically against your alert rules.
                  </p>
                </div>

                <div className="rounded-lg bg-[#F0F4FA] border border-[#DFE6F0] p-3.5 space-y-2 text-[11.5px] font-mono tabular-nums">
                  <div className="flex items-center justify-between text-[#17243A] font-semibold">
                    <span>https://api.checkout.dev/health</span>
                    <span className="text-[#147D63]">200 OK · 118ms</span>
                  </div>
                  <div className="bg-white rounded px-2.5 py-1.5 border border-[#DFE6F0] flex items-center justify-between gap-2 text-[#30415D]">
                    <span>TLS valid 68d</span>
                    <span className="text-[#A66A16] font-semibold">
                      Sentry: 2 new issues in v2.4.1
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 07: How Avenor Works (3-Step Operational Workflow) */}
        <section className="py-20 px-4 sm:px-6 bg-[#FFFFFF] border-y border-[#DFE6F0]">
          <div className="max-w-[1280px] mx-auto space-y-12">
            <div className="max-w-3xl space-y-3">
              <SectionEyebrow>OPERATIONAL WORKFLOW</SectionEyebrow>
              <h2 className="text-[32px] sm:text-[40px] leading-[1.1] font-semibold tracking-[-0.028em] text-[#17243A] m-0">
                From scattered vendor credentials to a unified product atlas in three steps.
              </h2>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 relative">
              {/* Step 01 */}
              <div className="rounded-xl bg-[#F7F9FC] border border-[#DFE6F0] p-6 flex flex-col justify-between gap-5">
                <div className="space-y-3">
                  <span className="inline-flex items-center gap-2 text-[12px] font-mono font-semibold text-[#5157D9] bg-[#EEF0FF] border border-[#D8DCFF] px-2.5 py-1 rounded tabular-nums">
                    STEP 01
                  </span>
                  <h3 className="text-[20px] font-semibold text-[#17243A] m-0">
                    Define Your Logical Products & Environments
                  </h3>
                  <p className="text-[14.5px] leading-[1.6] text-[#30415D] m-0">
                    Create your workspace and register the digital products you operate. Separate{" "}
                    <code className="font-mono text-[12.5px] bg-white px-1.5 py-0.5 rounded border border-[#DFE6F0]">
                      Production
                    </code>
                    ,{" "}
                    <code className="font-mono text-[12.5px] bg-white px-1.5 py-0.5 rounded border border-[#DFE6F0]">
                      Staging
                    </code>
                    , and{" "}
                    <code className="font-mono text-[12.5px] bg-white px-1.5 py-0.5 rounded border border-[#DFE6F0]">
                      Development
                    </code>{" "}
                    environments so test noise never pollutes production KPIs.
                  </p>
                </div>
                <div className="pt-3 border-t border-[#DFE6F0] text-[11.5px] font-mono text-[#64748B]">
                  Multi-product hierarchy · Environment isolation
                </div>
              </div>

              {/* Step 02 */}
              <div className="rounded-xl bg-[#F7F9FC] border border-[#DFE6F0] p-6 flex flex-col justify-between gap-5">
                <div className="space-y-3">
                  <span className="inline-flex items-center gap-2 text-[12px] font-mono font-semibold text-[#5157D9] bg-[#EEF0FF] border border-[#D8DCFF] px-2.5 py-1 rounded tabular-nums">
                    STEP 02
                  </span>
                  <h3 className="text-[20px] font-semibold text-[#17243A] m-0">
                    Connect Scoped, Read-Only Provider Credentials
                  </h3>
                  <p className="text-[14.5px] leading-[1.6] text-[#30415D] m-0">
                    Authorize Google OAuth with read-only scopes, link your BigQuery billing export
                    dataset, or paste scoped read-only API tokens for Neon, Supabase, Cloudflare,
                    Vercel, GitHub, and Sentry.
                  </p>
                </div>
                <div className="pt-3 border-t border-[#DFE6F0] text-[11.5px] font-mono text-[#64748B]">
                  AES-256-GCM encrypted vault · Pre-flight scope verifier
                </div>
              </div>

              {/* Step 03 */}
              <div className="rounded-xl bg-[#F7F9FC] border border-[#DFE6F0] p-6 flex flex-col justify-between gap-5">
                <div className="space-y-3">
                  <span className="inline-flex items-center gap-2 text-[12px] font-mono font-semibold text-[#5157D9] bg-[#EEF0FF] border border-[#D8DCFF] px-2.5 py-1 rounded tabular-nums">
                    STEP 03
                  </span>
                  <h3 className="text-[20px] font-semibold text-[#17243A] m-0">
                    Monitor, Correlate, Alert & Export from One Atlas
                  </h3>
                  <p className="text-[14.5px] leading-[1.6] text-[#30415D] m-0">
                    Avenor’s background sync engine normalizes your telemetry on a scheduled
                    cadence, powers cross-product comparisons, evaluates threshold/anomaly alerts,
                    and delivers scheduled digests.
                  </p>
                </div>
                <div className="pt-3 border-t border-[#DFE6F0] text-[11.5px] font-mono text-[#64748B]">
                  Idempotent background sync · Provenance-stamped metrics
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 08: Multi-Product Portfolio Command View Showcase */}
        <section className="py-24 px-4 sm:px-6 bg-[#F7F9FC]">
          <div className="max-w-[1280px] mx-auto space-y-10">
            <div className="max-w-3xl space-y-4">
              <SectionEyebrow>PORTFOLIO-SCALE COMMAND</SectionEyebrow>
              <h2 className="text-[32px] sm:text-[44px] leading-[1.1] font-semibold tracking-[-0.028em] text-[#17243A] m-0">
                Run five products or twenty. Spot the outlier in three seconds.
              </h2>
              <p className="text-[18px] leading-[1.6] text-[#30415D] m-0">
                Most observability and analytics tools assume your entire company runs a single
                application. Avenor’s{" "}
                <strong className="font-semibold text-[#17243A]">Portfolio Command View</strong>{" "}
                ranks every product in your workspace side-by-side—surfacing which product is
                growing fastest in organic search, which one is burning cloud credits, and which one
                needs engineering attention today.
              </p>
            </div>

            <div className="rounded-xl bg-[#FFFFFF] border border-[#C7D2E3] shadow-sm overflow-hidden">
              <div className="bg-[#F0F4FA] border-b border-[#DFE6F0] px-5 py-3.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12px] font-mono font-semibold uppercase tracking-wider text-[#17243A]">
                  WORKSPACE PORTFOLIO MATRIX · CORSTACK LABS (4 LOGICAL PRODUCTS)
                </span>
                <span className="text-[11.5px] font-mono text-[#64748B] tabular-nums">
                  Sorted by: Traffic & Spend Activity (30d Window)
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left tabular-nums">
                  <thead>
                    <tr className="border-b border-[#DFE6F0] bg-[#F7F9FC] text-[11.5px] font-mono uppercase tracking-wider text-[#64748B]">
                      <th className="py-3.5 px-4">Logical Product & Env</th>
                      <th className="py-3.5 px-4 text-right">Users (30d)</th>
                      <th className="py-3.5 px-4 text-right">GSC Clicks (30d)</th>
                      <th className="py-3.5 px-4 text-right">MTD Cloud Spend</th>
                      <th className="py-3.5 px-4">DB Storage</th>
                      <th className="py-3.5 px-4">Reliability & Sync</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#DFE6F0] text-[13.5px]">
                    <tr className="hover:bg-[#F7F9FC]">
                      <td className="py-4 px-4 font-semibold text-[#17243A]">
                        Checkout API{" "}
                        <span className="ml-1.5 text-[11px] font-mono font-medium bg-[#E7F6EF] text-[#147D63] border border-[#B9E6D2] px-1.5 py-0.5 rounded">
                          Prod
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right font-medium text-[#17243A]">
                        48,920{" "}
                        <span className="text-[11.5px] font-mono text-[#147D63] ml-1">+14.2%</span>
                      </td>
                      <td className="py-4 px-4 text-right font-medium text-[#17243A]">19,410</td>
                      <td className="py-4 px-4 text-right font-medium text-[#17243A]">$1,284.60</td>
                      <td className="py-4 px-4 font-mono text-[12.5px] text-[#30415D]">
                        18.4 GB Neon
                      </td>
                      <td className="py-4 px-4">
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-mono text-[#147D63]">
                          <span className="h-2 w-2 rounded-full bg-[#147D63]" />
                          99.98% · 6/6 Fresh
                        </span>
                      </td>
                    </tr>

                    <tr className="hover:bg-[#F7F9FC]">
                      <td className="py-4 px-4 font-semibold text-[#17243A]">
                        Docs & Marketing{" "}
                        <span className="ml-1.5 text-[11px] font-mono font-medium bg-[#E7F6EF] text-[#147D63] border border-[#B9E6D2] px-1.5 py-0.5 rounded">
                          Prod
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right font-medium text-[#17243A]">
                        112,400{" "}
                        <span className="text-[11.5px] font-mono text-[#147D63] ml-1">+8.1%</span>
                      </td>
                      <td className="py-4 px-4 text-right font-medium text-[#17243A]">64,890</td>
                      <td className="py-4 px-4 text-right font-medium text-[#17243A]">$142.10</td>
                      <td className="py-4 px-4 font-mono text-[12.5px] text-[#30415D]">
                        2.1 GB Supabase
                      </td>
                      <td className="py-4 px-4">
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-mono text-[#147D63]">
                          <span className="h-2 w-2 rounded-full bg-[#147D63]" />
                          100% · 4/4 Fresh
                        </span>
                      </td>
                    </tr>

                    <tr className="hover:bg-[#F7F9FC]">
                      <td className="py-4 px-4 font-semibold text-[#17243A]">
                        Pulse Mobile Backend{" "}
                        <span className="ml-1.5 text-[11px] font-mono font-medium bg-[#E7F6EF] text-[#147D63] border border-[#B9E6D2] px-1.5 py-0.5 rounded">
                          Prod
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right font-medium text-[#17243A]">
                        14,210{" "}
                        <span className="text-[11.5px] font-mono text-[#64748B] ml-1">-2.4%</span>
                      </td>
                      <td className="py-4 px-4 text-right">
                        <span className="text-[11.5px] font-mono text-[#64748B] bg-[#F0F4FA] border border-[#DFE6F0] px-2 py-0.5 rounded">
                          Not mapped
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right font-medium text-[#17243A]">
                        $618.90{" "}
                        <span className="ml-1 text-[11px] font-mono bg-[#FFF5E5] text-[#A66A16] border border-[#F5D9A6] px-1.5 py-0.5 rounded">
                          +31% spike
                        </span>
                      </td>
                      <td className="py-4 px-4 font-mono text-[12.5px] text-[#30415D]">
                        9.8 GB Neon
                      </td>
                      <td className="py-4 px-4">
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-mono text-[#A66A16]">
                          <span className="h-2 w-2 rounded-full bg-[#A66A16]" />
                          99.41% · 1 Alert Open
                        </span>
                      </td>
                    </tr>

                    <tr className="hover:bg-[#F7F9FC]">
                      <td className="py-4 px-4 font-semibold text-[#17243A]">
                        Staging Sandbox{" "}
                        <span className="ml-1.5 text-[11px] font-mono font-medium bg-[#F0F4FA] text-[#30415D] border border-[#DFE6F0] px-1.5 py-0.5 rounded">
                          Staging
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right font-medium text-[#17243A]">
                        412{" "}
                        <span className="text-[11.5px] font-mono text-[#64748B] ml-1">+0.9%</span>
                      </td>
                      <td className="py-4 px-4 text-right">
                        <span className="text-[11.5px] font-mono text-[#64748B] bg-[#F0F4FA] border border-[#DFE6F0] px-2 py-0.5 rounded">
                          Not mapped
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right font-medium text-[#17243A]">$38.40</td>
                      <td className="py-4 px-4 font-mono text-[12.5px] text-[#30415D]">
                        1.2 GB Neon
                      </td>
                      <td className="py-4 px-4">
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-mono text-[#147D63]">
                          <span className="h-2 w-2 rounded-full bg-[#147D63]" />
                          100% · 3/3 Fresh
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 09: Metric Provenance, Freshness & The Zero-Fabrication Contract */}
        <section className="py-24 px-4 sm:px-6 bg-[#FFFFFF] border-y border-[#DFE6F0]">
          <div className="max-w-[1280px] mx-auto space-y-12">
            <div className="max-w-3xl space-y-4">
              <SectionEyebrow>DATA INTEGRITY & METRIC PROVENANCE</SectionEyebrow>
              <h2 className="text-[32px] sm:text-[44px] leading-[1.1] font-semibold tracking-[-0.028em] text-[#17243A] m-0">
                Dashboards shouldn’t ask you to take numbers on faith.
              </h2>
              <p className="text-[18px] leading-[1.6] text-[#30415D] m-0">
                Every metric in Avenor carries an explicit provenance contract. You never have to
                guess where a number came from, when it was last synchronized, or whether a flat
                line is a real outage or a delayed provider export.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Bento Card 1 */}
              <div className="rounded-xl bg-[#F7F9FC] border border-[#DFE6F0] p-6 flex flex-col justify-between gap-6">
                <div className="space-y-3">
                  <div className="flex items-center gap-2.5">
                    <ArchitecturalIconTile accent="indigo">
                      <Clock3 className="h-[18px] w-[18px]" />
                    </ArchitecturalIconTile>
                    <h3 className="text-[19px] font-semibold text-[#17243A] m-0">
                      Complete Source & Scope Lineage
                    </h3>
                  </div>
                  <p className="text-[14px] leading-[1.6] text-[#30415D] m-0">
                    Every KPI card and chart exposes its exact upstream source (GA4, GSC, BigQuery
                    Billing, Neon, Sentry), the bound property or project ID, the timezone
                    alignment, and the exact sync timestamp.
                  </p>
                </div>

                <div className="rounded-lg bg-[#FFFFFF] border border-[#C7D2E3] p-4 space-y-2 text-[11.5px] font-mono tabular-nums shadow-2xs">
                  <div className="flex items-center justify-between text-[#17243A] font-semibold border-b border-[#DFE6F0] pb-2">
                    <span>Metric Provenance Popover</span>
                    <span className="text-[#147D63]">Verified</span>
                  </div>
                  <div className="space-y-1 text-[#30415D]">
                    <div>Source: Google Search Console</div>
                    <div>Property: sc-domain:avenor.dev</div>
                    <div>Finalized through: Oct 12 (48h GSC window)</div>
                    <div className="text-[#147D63]">Sync Job: #sync_9941 (Succeeded in 1.4s)</div>
                  </div>
                </div>
              </div>

              {/* Bento Card 2 */}
              <div className="rounded-xl bg-[#F7F9FC] border border-[#DFE6F0] p-6 flex flex-col justify-between gap-6">
                <div className="space-y-3">
                  <div className="flex items-center gap-2.5">
                    <ArchitecturalIconTile accent="teal">
                      <CheckCircle2 className="h-[18px] w-[18px]" />
                    </ArchitecturalIconTile>
                    <h3 className="text-[19px] font-semibold text-[#17243A] m-0">
                      The Zero-Fabrication Contract (True 0 vs. Unavailable)
                    </h3>
                  </div>
                  <p className="text-[14px] leading-[1.6] text-[#30415D] m-0">
                    Avenor never renders a fake{" "}
                    <code className="font-mono text-[12px] bg-white px-1.5 py-0.5 rounded border border-[#DFE6F0]">
                      0
                    </code>{" "}
                    when a source is unmapped, a credential is revoked, or an upstream API times
                    out. We distinguish <strong>Verified Zero (0)</strong> from{" "}
                    <strong>Awaiting First Sync</strong>, <strong>Provider Lag</strong>,{" "}
                    <strong>Stale</strong>, and <strong>Not Mapped</strong>.
                  </p>
                </div>

                <div className="rounded-lg bg-[#FFFFFF] border border-[#C7D2E3] p-4 space-y-2 text-[11.5px] font-mono tabular-nums shadow-2xs">
                  <div className="rounded bg-[#E7F6EF] border border-[#B9E6D2] px-3 py-2 text-[#147D63] flex items-center justify-between">
                    <span className="font-semibold">● Verified 0 Errors</span>
                    <span>Sentry synced 8m ago</span>
                  </div>
                  <div className="rounded bg-[#FFF5E5] border border-[#F5D9A6] px-3 py-2 text-[#A66A16] flex items-center justify-between">
                    <span className="font-semibold">◐ Export Lag ~24h</span>
                    <span>GSC finalizing latest day</span>
                  </div>
                  <div className="rounded bg-[#F0F4FA] border border-[#DFE6F0] px-3 py-2 text-[#64748B] flex items-center justify-between">
                    <span className="font-semibold">○ Not Mapped</span>
                    <span>No billing source on Staging</span>
                  </div>
                </div>
              </div>

              {/* Bento Card 3 */}
              <div className="rounded-xl bg-[#F7F9FC] border border-[#DFE6F0] p-6 flex flex-col justify-between gap-6">
                <div className="space-y-3">
                  <div className="flex items-center gap-2.5">
                    <ArchitecturalIconTile accent="indigo">
                      <Info className="h-[18px] w-[18px]" />
                    </ArchitecturalIconTile>
                    <h3 className="text-[19px] font-semibold text-[#17243A] m-0">
                      Guarded, Evidence-Linked Briefings
                    </h3>
                  </div>
                  <p className="text-[14px] leading-[1.6] text-[#30415D] m-0">
                    When you enable optional workspace briefings, every sentence is
                    deterministically grounded in your normalized metric deltas and stamped with
                    clickable source chips—never open-ended chatbot speculation.
                  </p>
                </div>

                <div className="rounded-lg bg-[#FFFFFF] border border-[#C7D2E3] p-4 space-y-3 shadow-2xs">
                  <p className="text-[13px] leading-[1.55] text-[#17243A] m-0 tabular-nums">
                    “Cloud spend on <strong>Pulse Mobile Backend</strong> rose{" "}
                    <strong className="text-[#A66A16]">+31.2% ($148.20)</strong> over the last 7
                    days, driven by{" "}
                    <code className="font-mono text-[11.5px] bg-[#F0F4FA] px-1 py-0.5 rounded">
                      Cloud Run
                    </code>{" "}
                    SKU growth following deploy{" "}
                    <code className="font-mono text-[11.5px] bg-[#F0F4FA] px-1 py-0.5 rounded">
                      v1.9.0
                    </code>
                    .”
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                    <span className="rounded bg-[#EEF0FF] text-[#5157D9] border border-[#D8DCFF] px-2 py-0.5 font-semibold">
                      [BQ Billing · p_881]
                    </span>
                    <span className="rounded bg-[#E7F6F7] text-[#168E99] border border-[#B8E5E8] px-2 py-0.5 font-semibold">
                      [GitHub · v1.9.0]
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 10: Read-Only Security & Zero-Mutation Architecture (#security) */}
        <section id="security" className="py-24 px-4 sm:px-6 bg-[#10192B] text-[#F8FAFC]">
          <div className="max-w-[1280px] mx-auto space-y-12">
            <div className="max-w-3xl space-y-4">
              <SectionEyebrow tone="dark">ZERO-MUTATION SECURITY ARCHITECTURE</SectionEyebrow>
              <h2 className="text-[32px] sm:text-[44px] leading-[1.1] font-semibold tracking-[-0.028em] text-[#F8FAFC] m-0">
                Architecturally read-only. Zero write paths to your infrastructure. Zero access to
                customer rows.
              </h2>
              <p className="text-[18px] leading-[1.6] text-[#94A3B8] m-0">
                Avenor is engineered from the ground up as an observational plane. Even if you
                wanted Avenor to mutate a production resource, drop a database branch, or query a
                user table, the code paths and OAuth scopes simply do not exist.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="rounded-xl bg-[#19243B] border border-[#263554] p-6 sm:p-7 space-y-3.5">
                <div className="flex items-center gap-3">
                  <ArchitecturalIconTile tone="dark">
                    <EyeOff className="h-[18px] w-[18px]" />
                  </ArchitecturalIconTile>
                  <h3 className="text-[19px] font-semibold text-[#F8FAFC] m-0">
                    Strictly Scoped Read-Only Ingestion
                  </h3>
                </div>
                <p className="text-[14.5px] leading-[1.6] text-[#94A3B8] m-0">
                  Google integrations request only read-only OAuth scopes (
                  <code className="font-mono text-[12.5px] text-[#E2E8F0]">analytics.readonly</code>
                  ,{" "}
                  <code className="font-mono text-[12.5px] text-[#E2E8F0]">
                    webmasters.readonly
                  </code>
                  ,{" "}
                  <code className="font-mono text-[12.5px] text-[#E2E8F0]">bigquery.readonly</code>
                  ). Token-based connectors (Neon, Supabase, Cloudflare, Vercel, GitHub, Sentry) are
                  validated against read-only endpoints during pre-flight verification.
                </p>
              </div>

              <div className="rounded-xl bg-[#19243B] border border-[#263554] p-6 sm:p-7 space-y-3.5">
                <div className="flex items-center gap-3">
                  <ArchitecturalIconTile tone="dark">
                    <Database className="h-[18px] w-[18px]" />
                  </ArchitecturalIconTile>
                  <h3 className="text-[19px] font-semibold text-[#F8FAFC] m-0">
                    Metadata Only — Never Customer Table Rows
                  </h3>
                </div>
                <p className="text-[14.5px] leading-[1.6] text-[#94A3B8] m-0">
                  For Neon and Supabase, Avenor queries project/branch management metadata (storage
                  bytes, compute time, connection counts). Avenor never asks for your database
                  superuser connection string and never executes{" "}
                  <code className="font-mono text-[12.5px] text-[#E2E8F0]">SELECT</code> queries
                  against your application tables.
                </p>
              </div>

              <div className="rounded-xl bg-[#19243B] border border-[#263554] p-6 sm:p-7 space-y-3.5">
                <div className="flex items-center gap-3">
                  <ArchitecturalIconTile tone="dark">
                    <KeyRound className="h-[18px] w-[18px]" />
                  </ArchitecturalIconTile>
                  <h3 className="text-[19px] font-semibold text-[#F8FAFC] m-0">
                    Envelope Encryption & Redacted Logs
                  </h3>
                </div>
                <p className="text-[14.5px] leading-[1.6] text-[#94A3B8] m-0">
                  All OAuth refresh tokens, service-account credentials, and API keys are encrypted
                  at rest using{" "}
                  <code className="font-mono text-[12.5px] text-[#E2E8F0]">AES-256-GCM</code> with
                  versioned key rotation. Secrets are strictly masked in UI responses, structured
                  server logs, and error telemetry.
                </p>
              </div>

              <div className="rounded-xl bg-[#19243B] border border-[#263554] p-6 sm:p-7 space-y-3.5">
                <div className="flex items-center gap-3">
                  <ArchitecturalIconTile tone="dark">
                    <SlidersHorizontal className="h-[18px] w-[18px]" />
                  </ArchitecturalIconTile>
                  <h3 className="text-[19px] font-semibold text-[#F8FAFC] m-0">
                    Role-Based Access & Immutable Audit Trail
                  </h3>
                </div>
                <p className="text-[14.5px] leading-[1.6] text-[#94A3B8] m-0">
                  Granular workspace permissions (<strong className="text-[#F8FAFC]">Owner</strong>,{" "}
                  <strong className="text-[#F8FAFC]">Admin</strong>,{" "}
                  <strong className="text-[#F8FAFC]">Analyst</strong>, and{" "}
                  <strong className="text-[#F8FAFC]">Viewer</strong>) govern who can connect
                  sources, configure alerts, or manage billing, backed by an append-only security
                  audit log.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 11: Cross-Product Comparisons, Alerts & Scheduled Digests */}
        <section className="py-24 px-4 sm:px-6 bg-[#F7F9FC]">
          <div className="max-w-[1280px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left Card */}
            <div className="rounded-xl bg-[#FFFFFF] border border-[#DFE6F0] p-6 sm:p-8 flex flex-col justify-between gap-6">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <ArchitecturalIconTile accent="indigo">
                    <Scale className="h-[18px] w-[18px]" />
                  </ArchitecturalIconTile>
                  <span className="text-[12px] font-mono font-semibold uppercase tracking-wider text-[#5157D9]">
                    STATISTICALLY HONEST COMPARISONS
                  </span>
                </div>
                <h3 className="text-[24px] font-semibold text-[#17243A] m-0">
                  Cross-Product Comparison Guardrails
                </h3>
                <p className="text-[15px] leading-[1.6] text-[#30415D] m-0">
                  Compare traffic, search clicks, cloud spend, and error rates across products and
                  time periods while enforcing strict statistical honesty. Avenor sums additive
                  metrics (total sessions, clicks, same-currency net spend) while preventing invalid
                  summation of deduplicated unique users across separate GA4 properties or mixed
                  currencies.
                </p>
              </div>

              <div className="rounded-lg bg-[#F0F4FA] border border-[#DFE6F0] p-4 space-y-2 text-[12px] font-mono tabular-nums">
                <div className="flex items-center justify-between text-[#147D63]">
                  <span>✓ Additive Rollup Permitted</span>
                  <span>Sessions · Clicks · Same-Currency Spend</span>
                </div>
                <div className="flex items-center justify-between text-[#A66A16]">
                  <span>! Deduplication Guard Active</span>
                  <span>Distinct GA4 Users compared side-by-side</span>
                </div>
              </div>
            </div>

            {/* Right Card */}
            <div className="rounded-xl bg-[#FFFFFF] border border-[#DFE6F0] p-6 sm:p-8 flex flex-col justify-between gap-6">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <ArchitecturalIconTile accent="teal">
                    <BellRing className="h-[18px] w-[18px]" />
                  </ArchitecturalIconTile>
                  <span className="text-[12px] font-mono font-semibold uppercase tracking-wider text-[#168E99]">
                    PROACTIVE SIGNAL MONITORING
                  </span>
                </div>
                <h3 className="text-[24px] font-semibold text-[#17243A] m-0">
                  Threshold Alerts, Anomaly Detection & Scheduled Digests
                </h3>
                <p className="text-[15px] leading-[1.6] text-[#30415D] m-0">
                  Configure deterministic alert rules across cost, traffic, uptime, and error rates
                  with built-in cooldown windows to prevent notification fatigue—paired with
                  automated weekly or monthly executive email and webhook digests.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11.5px] font-mono tabular-nums">
                <div className="rounded bg-[#F0F4FA] border border-[#DFE6F0] px-3 py-2 text-[#17243A]">
                  Spend &gt; <strong>$50/day</strong>
                </div>
                <div className="rounded bg-[#F0F4FA] border border-[#DFE6F0] px-3 py-2 text-[#17243A]">
                  5xx rate &gt; <strong>1.5%</strong>
                </div>
                <div className="rounded bg-[#F0F4FA] border border-[#DFE6F0] px-3 py-2 text-[#17243A]">
                  Uptime check failed <strong>2×</strong>
                </div>
                <div className="rounded bg-[#F0F4FA] border border-[#DFE6F0] px-3 py-2 text-[#17243A]">
                  Sync stale &gt; <strong>12h</strong>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 12: Built for Multi-Product Operators */}
        <section className="py-20 px-4 sm:px-6 bg-[#FFFFFF] border-t border-[#DFE6F0]">
          <div className="max-w-[1280px] mx-auto space-y-12">
            <div className="max-w-3xl space-y-3">
              <SectionEyebrow>WHO RUNS ON AVENOR</SectionEyebrow>
              <h2 className="text-[32px] sm:text-[42px] leading-[1.1] font-semibold tracking-[-0.028em] text-[#17243A] m-0">
                Designed for teams that ship more than one thing.
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="rounded-xl bg-[#F7F9FC] border border-[#DFE6F0] p-6 space-y-3">
                <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[#5157D9]">
                  01 / FOUNDERS & STUDIOS
                </span>
                <h3 className="text-[18px] font-semibold text-[#17243A] m-0">
                  Multi-Product SaaS Founders & Indie Studios
                </h3>
                <p className="text-[14px] leading-[1.6] text-[#30415D] m-0">
                  Track acquisition, SEO traction, Neon/Supabase footprint, and GCP/Vercel costs
                  across your entire portfolio of micro-SaaS products from a single morning
                  briefing.
                </p>
              </div>

              <div className="rounded-xl bg-[#F7F9FC] border border-[#DFE6F0] p-6 space-y-3">
                <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[#168E99]">
                  02 / PRODUCT & GROWTH
                </span>
                <h3 className="text-[18px] font-semibold text-[#17243A] m-0">
                  Product & Growth Leads
                </h3>
                <p className="text-[14px] leading-[1.6] text-[#30415D] m-0">
                  Connect organic search queries and GA4 landing page engagement directly to release
                  timelines—without waiting on data engineering to maintain fragile warehouse
                  pipelines.
                </p>
              </div>

              <div className="rounded-xl bg-[#F7F9FC] border border-[#DFE6F0] p-6 space-y-3">
                <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[#5157D9]">
                  03 / PLATFORM & FINOPS
                </span>
                <h3 className="text-[18px] font-semibold text-[#17243A] m-0">
                  Platform, DevOps & FinOps Engineers
                </h3>
                <p className="text-[14px] leading-[1.6] text-[#30415D] m-0">
                  Keep developers informed on cloud spend anomalies, database storage growth,
                  deployment health, and SSL/HTTP uptime without handing out production cloud
                  console IAM roles.
                </p>
              </div>

              <div className="rounded-xl bg-[#F7F9FC] border border-[#DFE6F0] p-6 space-y-3">
                <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[#168E99]">
                  04 / AGENCIES & VENTURES
                </span>
                <h3 className="text-[18px] font-semibold text-[#17243A] m-0">
                  Digital Agencies & Venture Studios
                </h3>
                <p className="text-[14px] leading-[1.6] text-[#30415D] m-0">
                  Standardize operational reporting across every client product or studio venture
                  with clean role-based viewer access, scheduled digests, and one-click CSV/PDF
                  executive exports.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 13: The Complete Integration Atlas (#integrations) */}
        <section
          id="integrations"
          className="py-24 px-4 sm:px-6 bg-[#F7F9FC] border-t border-[#DFE6F0]"
        >
          <div className="max-w-[1280px] mx-auto space-y-10">
            <div className="max-w-3xl space-y-4">
              <SectionEyebrow>CONNECTOR CAPABILITY MATRIX</SectionEyebrow>
              <h2 className="text-[32px] sm:text-[44px] leading-[1.1] font-semibold tracking-[-0.028em] text-[#17243A] m-0">
                Nine ecosystems. Explicit auth modes. Zero black boxes.
              </h2>
            </div>

            <div className="overflow-x-auto rounded-xl border border-[#C7D2E3] bg-[#FFFFFF] shadow-2xs">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-[#C7D2E3] bg-[#F0F4FA] text-[11.5px] font-mono uppercase tracking-wider text-[#17243A]">
                    <th className="py-3.5 px-4">Provider</th>
                    <th className="py-3.5 px-4">Domain</th>
                    <th className="py-3.5 px-4">Authentication Mode</th>
                    <th className="py-3.5 px-4">Normalized Signals Ingested</th>
                    <th className="py-3.5 px-4 text-right">Mutation Risk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DFE6F0] text-[13.5px]">
                  {INTEGRATION_ATLAS_ROWS.map((row) => (
                    <tr key={row.provider} className="hover:bg-[#F7F9FC]">
                      <td className="py-3.5 px-4 font-semibold text-[#17243A]">
                        <div className="flex items-center gap-2.5">
                          <span className="h-6 w-6 rounded bg-[#F0F4FA] border border-[#DFE6F0] inline-flex items-center justify-center shrink-0">
                            {row.icon}
                          </span>
                          <span>{row.provider}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-[#30415D]">{row.domain}</td>
                      <td className="py-3.5 px-4 font-mono text-[12px] text-[#30415D]">
                        {row.authMode}
                      </td>
                      <td className="py-3.5 px-4 text-[#30415D]">{row.signals}</td>
                      <td className="py-3.5 px-4 text-right font-mono text-[12px] font-semibold text-[#147D63] tabular-nums">
                        <span className="inline-flex items-center gap-1 bg-[#E7F6EF] border border-[#B9E6D2] px-2 py-0.5 rounded">
                          <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
                          {row.risk}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* SECTION 14: Commercial Pricing & Plan Comparison (#pricing) */}
        <PricingSectionInteractive />

        {/* SECTION 15: 12-Question Technical, Security & Commercial FAQ (#faq) */}
        <section id="faq" className="py-24 px-4 sm:px-6 bg-[#FFFFFF] border-t border-[#DFE6F0]">
          <div className="max-w-[1280px] mx-auto space-y-12">
            <div className="max-w-3xl space-y-4">
              <SectionEyebrow>TECHNICAL, SECURITY & COMMERCIAL FAQ</SectionEyebrow>
              <h2 className="text-[32px] sm:text-[42px] leading-[1.1] font-semibold tracking-[-0.028em] text-[#17243A] m-0">
                Direct answers on architecture, provenance, and billing.
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {FAQ_ITEMS.map((item, idx) => (
                <div
                  key={item.q}
                  className="rounded-xl bg-[#F7F9FC] border border-[#DFE6F0] p-6 space-y-2.5"
                >
                  <div className="flex items-start gap-2.5">
                    <span className="text-[11.5px] font-mono font-semibold text-[#5157D9] tabular-nums mt-0.5">
                      {String(idx + 1).padStart(2, "0")}.
                    </span>
                    <h3 className="text-[16.5px] font-semibold text-[#17243A] m-0">{item.q}</h3>
                  </div>
                  <p className="text-[14px] leading-[1.6] text-[#30415D] m-0 pl-6">{item.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* SECTION 16: Final High-Contrast Conversion Section */}
        <section className="px-4 sm:px-6">
          <div className="max-w-7xl mx-auto my-16 rounded-2xl bg-[#10192B] px-6 sm:px-10 py-16 text-center border border-[#263554] space-y-6">
            <SectionEyebrow tone="dark" className="justify-center">
              READY FOR CALM OPERATIONAL CLARITY?
            </SectionEyebrow>
            <h2 className="text-[32px] sm:text-[44px] leading-[1.1] font-semibold tracking-[-0.028em] text-[#F8FAFC] max-w-3xl mx-auto m-0">
              Bring every product you run into one trustworthy view.
            </h2>
            <p className="text-[17px] sm:text-[18px] leading-[1.6] text-[#94A3B8] max-w-2xl mx-auto m-0">
              Create your workspace in under sixty seconds, define your first logical product, and
              connect your read-only telemetry with a 14-day Pro preview.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center gap-2 bg-[#5157D9] hover:bg-[#4348C2] text-white px-6 py-3 rounded-lg font-medium text-[15px] no-underline transition-colors"
              >
                <span>Create free workspace</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center bg-[#19243B] hover:bg-[#233252] text-[#F8FAFC] border border-[#2E4066] px-6 py-3 rounded-lg font-medium text-[15px] no-underline transition-colors"
              >
                Sign in to existing workspace
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* SECTION 17: Multi-Column Architectural Footer */}
      <footer className="bg-[#F0F4FA] border-t border-[#DFE6F0] pt-16 pb-12 px-4 sm:px-6 text-sm text-[#30415D]">
        <div className="max-w-[1280px] mx-auto space-y-12">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-8">
            {/* Col 1 (2 Cols wide) */}
            <div className="lg:col-span-2 space-y-4">
              <SignalAtlasLogo showWordmark showTag />
              <p className="text-[13.5px] leading-[1.6] text-[#30415D] max-w-sm m-0">
                Read-only digital product intelligence for founders, product teams, and
                multi-product studios.
              </p>
              <div className="inline-flex items-center gap-2 rounded-md bg-white border border-[#DFE6F0] px-3 py-1.5 text-[11.5px] font-mono text-[#147D63]">
                <span className="h-2 w-2 rounded-full bg-[#147D63]" aria-hidden="true" />
                <span>All ingestion pipelines operational</span>
              </div>
            </div>

            {/* Col 2: Product */}
            <div className="space-y-3">
              <h4 className="text-[12px] font-mono font-semibold uppercase tracking-wider text-[#17243A] m-0">
                Product
              </h4>
              <ul className="space-y-2 list-none p-0 m-0 text-[13.5px]">
                <li>
                  <a
                    href="#product-model"
                    className="text-[#30415D] hover:text-[#17243A] no-underline"
                  >
                    Logical Product Model
                  </a>
                </li>
                <li>
                  <a href="#domains" className="text-[#30415D] hover:text-[#17243A] no-underline">
                    Portfolio Command View
                  </a>
                </li>
                <li>
                  <a href="#security" className="text-[#30415D] hover:text-[#17243A] no-underline">
                    Metric Provenance
                  </a>
                </li>
                <li>
                  <a href="#domains" className="text-[#30415D] hover:text-[#17243A] no-underline">
                    Alerts & Digests
                  </a>
                </li>
                <li>
                  <a href="#pricing" className="text-[#30415D] hover:text-[#17243A] no-underline">
                    Pricing
                  </a>
                </li>
              </ul>
            </div>

            {/* Col 3: Intelligence Domains */}
            <div className="space-y-3">
              <h4 className="text-[12px] font-mono font-semibold uppercase tracking-wider text-[#17243A] m-0">
                Intelligence Domains
              </h4>
              <ul className="space-y-2 list-none p-0 m-0 text-[13.5px]">
                <li>
                  <a href="#domains" className="text-[#30415D] hover:text-[#17243A] no-underline">
                    Audience (GA4)
                  </a>
                </li>
                <li>
                  <a href="#domains" className="text-[#30415D] hover:text-[#17243A] no-underline">
                    Search Visibility (GSC)
                  </a>
                </li>
                <li>
                  <a href="#domains" className="text-[#30415D] hover:text-[#17243A] no-underline">
                    Cloud Costs (BigQuery)
                  </a>
                </li>
                <li>
                  <a href="#domains" className="text-[#30415D] hover:text-[#17243A] no-underline">
                    Databases (Neon & Supabase)
                  </a>
                </li>
                <li>
                  <a href="#domains" className="text-[#30415D] hover:text-[#17243A] no-underline">
                    Edge & Deploys (CF, Vercel, GH)
                  </a>
                </li>
                <li>
                  <a href="#domains" className="text-[#30415D] hover:text-[#17243A] no-underline">
                    Reliability (Sentry & Uptime)
                  </a>
                </li>
              </ul>
            </div>

            {/* Col 4: Security & Governance */}
            <div className="space-y-3">
              <h4 className="text-[12px] font-mono font-semibold uppercase tracking-wider text-[#17243A] m-0">
                Security & Governance
              </h4>
              <ul className="space-y-2 list-none p-0 m-0 text-[13.5px]">
                <li>
                  <a href="#security" className="text-[#30415D] hover:text-[#17243A] no-underline">
                    Read-Only Security Architecture
                  </a>
                </li>
                <li>
                  <a href="#security" className="text-[#30415D] hover:text-[#17243A] no-underline">
                    Zero-Mutation Guarantee
                  </a>
                </li>
                <li>
                  <a href="#security" className="text-[#30415D] hover:text-[#17243A] no-underline">
                    Envelope Encryption
                  </a>
                </li>
                <li>
                  <a href="#security" className="text-[#30415D] hover:text-[#17243A] no-underline">
                    Role-Based Access Control
                  </a>
                </li>
                <li>
                  <a href="#faq" className="text-[#30415D] hover:text-[#17243A] no-underline">
                    Data Retention & Privacy
                  </a>
                </li>
              </ul>
            </div>

            {/* Col 5: Account */}
            <div className="space-y-3">
              <h4 className="text-[12px] font-mono font-semibold uppercase tracking-wider text-[#17243A] m-0">
                Account
              </h4>
              <ul className="space-y-2 list-none p-0 m-0 text-[13.5px]">
                <li>
                  <Link href="/login" className="text-[#30415D] hover:text-[#17243A] no-underline">
                    Sign In
                  </Link>
                </li>
                <li>
                  <Link href="/signup" className="text-[#30415D] hover:text-[#17243A] no-underline">
                    Create Workspace
                  </Link>
                </li>
                <li>
                  <Link
                    href="/forgot-password"
                    className="text-[#30415D] hover:text-[#17243A] no-underline"
                  >
                    Reset Password
                  </Link>
                </li>
                <li>
                  <Link
                    href="/verify-email"
                    className="text-[#30415D] hover:text-[#17243A] no-underline"
                  >
                    Verify Email
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="pt-8 border-t border-[#DFE6F0] flex flex-col sm:flex-row items-center justify-between gap-4 text-[12.5px] text-[#64748B]">
            <span>© 2026 Avenor. All rights reserved.</span>
            <div className="flex items-center gap-6">
              <a href="#security" className="text-[#64748B] hover:text-[#17243A] no-underline">
                Privacy Policy
              </a>
              <a href="#pricing" className="text-[#64748B] hover:text-[#17243A] no-underline">
                Terms of Service
              </a>
              <a href="#security" className="text-[#64748B] hover:text-[#17243A] no-underline">
                Security Disclosure
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
