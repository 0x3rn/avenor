import { Badge, Card, SignalAtlasLogo } from "@avenor/ui";
import { Layers, Lock, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type * as React from "react";

export function AuthShell({
  title,
  subtitle,
  children,
  footerSlot,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footerSlot?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#F7F9FC] text-[#30415D] flex flex-col justify-between">
      <header className="h-16 border-b border-[#DFE6F0] bg-white px-4 sm:px-6 lg:px-8 flex items-center justify-between">
        <Link href="/" className="no-underline">
          <SignalAtlasLogo />
        </Link>
        <Badge tone="read-only">Read-Only External Intelligence</Badge>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
        <div className="w-full max-w-[1040px] grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-7">
            <Card className="p-6 sm:p-8 space-y-6">
              <div className="space-y-1.5">
                <h1 className="text-[24px] sm:text-[28px] leading-[1.2] font-semibold tracking-[-0.02em] text-[#17243A] m-0">
                  {title}
                </h1>
                <p className="text-[14.5px] leading-[22px] text-[#64748B] m-0">{subtitle}</p>
              </div>
              {children}
              {footerSlot ? (
                <div className="pt-4 border-t border-[#DFE6F0] text-[13.5px] text-[#64748B]">
                  {footerSlot}
                </div>
              ) : null}
            </Card>
          </div>

          <aside
            aria-label="Avenor security and product architecture"
            className="lg:col-span-5 rounded-[20px] bg-[#10192B] border border-[#19243B] p-6 sm:p-7 text-[#F7F9FE] space-y-5"
          >
            <div className="space-y-1.5">
              <span className="text-[12px] font-mono uppercase tracking-wider text-[#B8C5DC]">
                Signal Atlas Foundation
              </span>
              <h2 className="text-[19px] font-semibold text-[#F7F9FE] m-0">
                A clearer view of every digital product you run.
              </h2>
              <p className="text-[13.5px] leading-[20px] text-[#B8C5DC] m-0">
                Avenor maps external observations back to your logical applications and
                environments—without ever mutating your connected infrastructure.
              </p>
            </div>

            <div className="space-y-3.5 pt-2 border-t border-[#19243B]">
              <div className="flex items-start gap-3">
                <Layers className="h-4 w-4 text-[#168E99] shrink-0 mt-1" aria-hidden="true" />
                <div>
                  <h3 className="text-[13.5px] font-semibold text-[#F7F9FE] m-0">
                    Workspace & Environment Isolation
                  </h3>
                  <p className="text-[12.5px] leading-[18px] text-[#B8C5DC] m-0">
                    Every account provisions an isolated organization and workspace with explicit
                    RBAC (`OWNER`, `ADMIN`, `ANALYST`, `VIEWER`).
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <ShieldCheck className="h-4 w-4 text-[#147D63] shrink-0 mt-1" aria-hidden="true" />
                <div>
                  <h3 className="text-[13.5px] font-semibold text-[#F7F9FE] m-0">
                    Strict Read-Only External Boundary
                  </h3>
                  <p className="text-[12.5px] leading-[18px] text-[#B8C5DC] m-0">
                    Avenor never modifies customer databases, DNS records, deployments, or cloud
                    budgets.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Lock className="h-4 w-4 text-[#5157D9] shrink-0 mt-1" aria-hidden="true" />
                <div>
                  <h3 className="text-[13.5px] font-semibold text-[#F7F9FE] m-0">
                    Audited Session & Ownership Actions
                  </h3>
                  <p className="text-[12.5px] leading-[18px] text-[#B8C5DC] m-0">
                    Sign-ins, workspace creation, and project configuration events are recorded in
                    your workspace audit ledger.
                  </p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>

      <footer className="py-5 px-4 sm:px-6 lg:px-8 border-t border-[#DFE6F0] bg-white text-center text-[12.5px] text-[#64748B]">
        Avenor Digital Product Intelligence • Signal Atlas v1.0
      </footer>
    </div>
  );
}
