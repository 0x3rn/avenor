# Avenor

**A clearer view of every digital product you run.**

Avenor is a read-only digital product intelligence platform. It connects external observations across analytics, search visibility, cloud billing, database usage, hosting, and reliability back to recognizable logical projects and environments—without ever mutating external provider resources.

---

## Architecture & Monorepo Structure

```text
avenor/
├── src/                      # Next.js 16.4 App Router web application
│   ├── app/                  # Routes, layouts, API endpoints, Signal Atlas tokens
│   └── components/           # Application shell and domain-specific views
├── packages/
│   ├── types/                # @avenor/types — Error taxonomy, 21 UX states, RBAC & domain contracts
│   ├── config/               # @avenor/config — Zod runtime environment validation & safety guards
│   ├── ui/                   # @avenor/ui — Signal Atlas design tokens & accessible UI primitives
│   ├── database/             # @avenor/database — Prisma schema, migrations, tenant & audit helpers
│   └── auth/                 # @avenor/auth — Better Auth session lifecycle & workspace RBAC
├── scripts/                  # Operational & database lifecycle CLI scripts
└── tests/                    # Unit, integration, security, and Playwright E2E suites
```

## Core Principles

1. **Product-Centered Intelligence:** Every signal maps to `Organization -> Workspace -> LogicalProject -> ProjectEnvironment`.
2. **Read-Only External Boundary:** Avenor only reads external provider telemetry using least-privilege viewer scopes. It never executes destructive or mutating operations against external infrastructure.
3. **Metric Integrity (Signal Atlas):** Empty or unconnected sources are never rendered as `0`. Every metric carries its definition, source provenance, and freshness state.

## Getting Started

1. Copy `.env.example` to `.env` and configure your PostgreSQL connection string and secrets.
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Run verification scripts:
   ```bash
   pnpm lint
   pnpm format:check
   pnpm typecheck
   pnpm test
   pnpm build
   ```
