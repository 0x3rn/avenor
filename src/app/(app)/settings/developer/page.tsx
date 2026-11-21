import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth-server";
import {
  listWorkspaceApiTokens,
  OUTGOING_WEBHOOK_EVENTS,
  PUBLIC_API_SCOPES,
} from "@/lib/public-api/tokens";

export default async function DeveloperSettingsPage() {
  const session = await getServerSession();
  if (!session) {
    redirect("/login");
  }

  const tokens = await listWorkspaceApiTokens(session);

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">
            Read-Only Developer API
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            API Tokens &amp; Outgoing Webhooks
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Scoped workspace tokens grant read-only access to projects, metrics, and incidents via{" "}
            <code>/api/v1/*</code>. No connected provider mutation endpoints exist.
          </p>
        </div>
        <Link
          href="/api/v1/openapi.json"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
        >
          View OpenAPI 3.1 Spec
        </Link>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-900">Active &amp; Revoked Tokens</h2>
        <p className="mt-1 text-xs text-slate-600">
          Plaintext tokens (<code>avpat_*</code>) are shown once at creation and stored strictly as
          SHA-256 digests. Available scopes: <code>{PUBLIC_API_SCOPES.join(", ")}</code>.
        </p>

        {tokens.length === 0 ? (
          <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
            No workspace API tokens issued yet. Create a scoped read-only token via{" "}
            <code>POST /api/developer/tokens</code>.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 font-semibold text-slate-700">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Prefix</th>
                  <th className="px-3 py-2">Scopes</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Expires</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tokens.map((tok) => (
                  <tr key={tok.id}>
                    <td className="px-3 py-2 font-medium text-slate-900">{tok.name}</td>
                    <td className="px-3 py-2 font-mono">{tok.tokenPrefix}...</td>
                    <td className="px-3 py-2 font-mono">{tok.scopes.join(", ")}</td>
                    <td className="px-3 py-2">{tok.revokedAtIso ? "Revoked" : "Active"}</td>
                    <td className="px-3 py-2">{tok.expiresAtIso ?? "Never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-xs">
          <h3 className="text-sm font-semibold text-slate-900">Quickstart Read Request</h3>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-3 text-emerald-300">
            {`curl -H "Authorization: Bearer avpat_..." \\
  "${process.env.NEXT_PUBLIC_APP_URL || "https://app.avenor.dev"}/api/v1/projects?limit=20"`}
          </pre>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-xs">
          <h3 className="text-sm font-semibold text-slate-900">Signed Outgoing Webhook Events</h3>
          <p className="mt-2 text-slate-600">
            Supported events: <code>{OUTGOING_WEBHOOK_EVENTS.join(", ")}</code>.
          </p>
          <p className="mt-2 text-slate-600">
            Every delivery is HTTPS-only (SSRF-guarded) and signed with{" "}
            <code>X-Avenor-Signature: t=&lt;unix&gt;,v1=&lt;hmac-sha256&gt;</code> over{" "}
            <code>{`\${timestamp}.\${deliveryId}.\${rawBody}`}</code>.
          </p>
        </div>
      </section>
    </div>
  );
}
