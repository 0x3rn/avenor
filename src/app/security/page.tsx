import Link from "next/link";
import {
  evaluateSecurityReleaseGate,
  OWASP_ASVS_5_CONTROLS,
  PROVIDER_PRIVILEGE_MATRIX,
} from "@/lib/ops/security-audit";

export const metadata = {
  title: "Security Architecture — Avenor",
  description:
    "How Avenor enforces strictly read-only external integrations, AES-256-GCM credential encryption, tenant isolation, and OWASP ASVS 5.0 security controls.",
};

export default function SecurityPage() {
  const gate = evaluateSecurityReleaseGate();

  return (
    <main className="mx-auto max-w-5xl space-y-10 px-6 py-12 text-slate-900">
      <header className="space-y-3 border-b border-slate-200 pb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">
          Security &amp; Trust Architecture
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Avenor Security Overview</h1>
        <p className="max-w-3xl text-sm text-slate-600">
          Avenor is architected from the ground up as a <strong>strictly read-only</strong> digital
          intelligence and observability plane. Avenor never deploys your code, modifies DNS, edits
          databases, changes cloud budgets, or resolves issues on connected third-party platforms.
        </p>
      </header>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
        <h2 className="font-semibold">Truthful Compliance &amp; Audit Status</h2>
        <p className="mt-1">{gate.truthfulCertificationStatement}</p>
        <p className="mt-2 text-xs text-amber-900">
          Internal automated security gate:{" "}
          <strong>{gate.internalAuditPassed ? "PASSING (0 open critical/high)" : "BLOCKED"}</strong>{" "}
          | External independent penetration test:{" "}
          <strong>Pending external reviewer sign-off before public GA</strong>.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Core Security Controls (OWASP ASVS 5.0 Baseline)</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {OWASP_ASVS_5_CONTROLS.map((ctrl) => (
            <div key={ctrl.asvsRef} className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {ctrl.asvsRef}
              </p>
              <h3 className="mt-1 text-base font-semibold">{ctrl.domain}</h3>
              <p className="mt-2 text-sm text-slate-600">{ctrl.controlSummary}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Provider Read-Only Privilege Matrix</h2>
        <p className="text-sm text-slate-600">
          Every external integration enforces an explicit read-only HTTP method/path allowlist and
          minimum required scopes.
        </p>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-semibold text-slate-700">
              <tr>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Requested Scopes</th>
                <th className="px-4 py-3">Explicitly Blocked Mutations</th>
                <th className="px-4 py-3">Residual Data Boundary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {PROVIDER_PRIVILEGE_MATRIX.map((row) => (
                <tr key={row.providerKey}>
                  <td className="px-4 py-3 font-medium text-slate-900">{row.displayName}</td>
                  <td className="px-4 py-3 font-mono text-[11px]">
                    {row.requestedScopes.join(", ")}
                  </td>
                  <td className="px-4 py-3">{row.blockedMutationSurface}</td>
                  <td className="px-4 py-3">{row.residualRiskNote}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-700">
        <h2 className="text-base font-semibold text-slate-900">
          Responsible Vulnerability Disclosure
        </h2>
        <p className="mt-2">
          If you discover a security vulnerability, please report it via our{" "}
          <Link href="/contact" className="font-medium text-emerald-700 underline">
            Security Support Intake
          </Link>{" "}
          (selecting category <code>SECURITY</code>). Never paste live OAuth refresh tokens, API
          keys, or database connection strings into support forms—our intake layer automatically
          redacts detected secrets prior to storage.
        </p>
      </section>
    </main>
  );
}
