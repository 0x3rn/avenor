import { type AuthenticatedSessionContext, authorizeWorkspaceAccess } from "@avenor/auth";
import { dbQuery, generateId } from "@avenor/database";
import { AppError, ERROR_CODES } from "@avenor/types";
import { z } from "zod";

export type ReportVisualizationType =
  | "SUMMARY_CARDS"
  | "LINE_CHART"
  | "BAR_CHART"
  | "COMPARISON_TABLE"
  | "BREAKDOWN_TABLE"
  | "INCIDENT_TIMELINE";

export interface SavedReportRecord {
  id: string;
  organizationId: string;
  workspaceId: string;
  createdByUserId: string | null;
  name: string;
  description: string | null;
  projectIds: string[];
  environmentFilter: string;
  metricKeys: string[];
  datePreset: string;
  visualizationType: ReportVisualizationType;
  comparisonEnabled: boolean;
  definitionVersion: number;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface BenchmarkMetricCell {
  projectId: string;
  projectName: string;
  metricKey: string;
  providerKey: string | null;
  value: number | null;
  unit: string;
  currency: string | null;
  observationCount: number;
  freshnessLabel: string;
  nonAdditiveWarning: string | null;
}

export interface ExecutedReportBenchmark {
  report: SavedReportRecord;
  generatedAtIso: string;
  dateStart: string;
  dateEnd: string;
  rows: BenchmarkMetricCell[];
  warnings: string[];
  provenanceSummary: string;
}

const NON_ADDITIVE_METRIC_KEYS = new Set([
  "ga4.active_users",
  "ga4.total_users",
  "ga4.new_users",
  "ga4.engagement_rate",
  "gsc.ctr",
  "gsc.average_position",
  "cloudflare.cache_hit_ratio",
  "vercel.deployment_success_rate",
  "github.workflow_success_rate",
  "sentry.crash_free_session_rate",
]);

const INCOMPATIBLE_METRIC_PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  [
    "ga4.sessions",
    "cloudflare.http_requests_total",
    "GA4 sessions and Cloudflare HTTP requests measure fundamentally different layers and cannot be combined as equivalent visitor counts.",
  ],
  [
    "ga4.active_users",
    "cloudflare.http_requests_total",
    "GA4 active users and Cloudflare HTTP requests cannot be compared on a shared visitor scale.",
  ],
  [
    "ga4.active_users",
    "gsc.clicks",
    "Search Console clicks and GA4 active users use different attribution models and cannot be combined.",
  ],
];

/**
 * Validates that selected metrics do not violate cross-metric semantic compatibility.
 */
export function assertComparableBenchmarkMetrics(
  metricKeys: readonly string[],
  options?: { currencies?: readonly string[] },
): { warnings: string[] } {
  const warnings: string[] = [];
  const keySet = new Set(metricKeys);

  for (const [a, b, reason] of INCOMPATIBLE_METRIC_PAIRS) {
    if (keySet.has(a) && keySet.has(b)) {
      warnings.push(`Metric separation notice: ${reason}`);
    }
  }

  for (const key of metricKeys) {
    if (NON_ADDITIVE_METRIC_KEYS.has(key)) {
      warnings.push(
        `Non-additive metric "${key}" is displayed per project only and never summed into a portfolio total.`,
      );
    }
  }

  const distinctCurrencies = Array.from(
    new Set((options?.currencies ?? []).filter((c) => Boolean(c)).map((c) => c.toUpperCase())),
  );
  if (distinctCurrencies.length > 1) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Cannot combine heterogeneous currencies (${distinctCurrencies.join(", ")}) in one unnormalized comparison total.`,
    });
  }

  return { warnings };
}

/**
 * Prevents CSV/spreadsheet formula injection (DDE/Excel/Google Sheets) by prefixing
 * cells starting with `=`, `+`, `-`, `@`, `\t`, or `\r` with a single quote (`'`).
 */
export function sanitizeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const formulaSafe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(formulaSafe)) {
    return `"${formulaSafe.replace(/"/g, '""')}"`;
  }
  return formulaSafe;
}

export function serializeReportToSafeCsv(executed: ExecutedReportBenchmark): string {
  const lines: string[] = [
    `# Avenor Read-Only Product Intelligence Report`,
    `# Report: ${sanitizeCsvCell(executed.report.name)} (v${executed.report.definitionVersion})`,
    `# Window: ${executed.dateStart} to ${executed.dateEnd} | Generated: ${executed.generatedAtIso}`,
    `# Provenance: ${executed.provenanceSummary}`,
    [
      "Project ID",
      "Project Name",
      "Metric Key",
      "Provider",
      "Value",
      "Unit",
      "Currency",
      "Observations",
      "Freshness",
      "Semantic Caveat",
    ]
      .map(sanitizeCsvCell)
      .join(","),
  ];

  for (const row of executed.rows) {
    lines.push(
      [
        row.projectId,
        row.projectName,
        row.metricKey,
        row.providerKey ?? "unconnected",
        row.value === null ? "UNAVAILABLE" : row.value,
        row.unit,
        row.currency ?? "",
        row.observationCount,
        row.freshnessLabel,
        row.nonAdditiveWarning ?? "",
      ]
        .map(sanitizeCsvCell)
        .join(","),
    );
  }

  return `${lines.join("\n")}\n`;
}

export function escapeHtmlForReport(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Renders a self-contained, XSS-escaped printable HTML/PDF report with zero external asset fetches.
 */
export function renderReportToPrintableHtml(executed: ExecutedReportBenchmark): string {
  const rowsHtml = executed.rows
    .map(
      (r) =>
        `<tr><td>${escapeHtmlForReport(r.projectName)}</td><td><code>${escapeHtmlForReport(r.metricKey)}</code></td><td>${escapeHtmlForReport(r.providerKey ?? "unconnected")}</td><td>${r.value === null ? "Unavailable" : escapeHtmlForReport(r.value)}</td><td>${escapeHtmlForReport(r.unit)}</td><td>${escapeHtmlForReport(r.freshnessLabel)}</td></tr>`,
    )
    .join("");

  const warningsHtml = executed.warnings.map((w) => `<li>${escapeHtmlForReport(w)}</li>`).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtmlForReport(executed.report.name)} — Avenor Report</title><style>body{font-family:system-ui,sans-serif;color:#17243A;margin:32px}table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border:1px solid #DFE6F0;padding:8px 10px;text-align:left;font-size:13px}th{background:#F7F9FC}.meta{color:#64748B;font-size:12px}</style></head><body><h1>${escapeHtmlForReport(executed.report.name)}</h1><p class="meta">Window: ${escapeHtmlForReport(executed.dateStart)} to ${escapeHtmlForReport(executed.dateEnd)} • Generated: ${escapeHtmlForReport(executed.generatedAtIso)} • ${escapeHtmlForReport(executed.provenanceSummary)}</p>${warningsHtml ? `<ul>${warningsHtml}</ul>` : ""}<table><thead><tr><th>Project</th><th>Metric</th><th>Provider</th><th>Observed Value</th><th>Unit</th><th>Freshness</th></tr></thead><tbody>${rowsHtml}</tbody></table></body></html>`;
}

const createSavedReportSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(400).nullable().optional(),
  projectIds: z.array(z.string().min(1)).min(1).max(20),
  environmentFilter: z.string().trim().min(2).max(40).default("PRODUCTION"),
  metricKeys: z.array(z.string().trim().min(2).max(120)).min(1).max(20),
  datePreset: z.enum(["7d", "28d", "90d"]).default("28d"),
  visualizationType: z
    .enum([
      "SUMMARY_CARDS",
      "LINE_CHART",
      "BAR_CHART",
      "COMPARISON_TABLE",
      "BREAKDOWN_TABLE",
      "INCIDENT_TIMELINE",
    ])
    .default("COMPARISON_TABLE"),
  comparisonEnabled: z.boolean().default(true),
});

export type CreateSavedReportInput = z.input<typeof createSavedReportSchema>;

function mapReportRow(row: Record<string, unknown>): SavedReportRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    workspaceId: String(row.workspace_id),
    createdByUserId: row.created_by_user_id ? String(row.created_by_user_id) : null,
    name: String(row.name),
    description: row.description ? String(row.description) : null,
    projectIds: Array.isArray(row.project_ids) ? row.project_ids.map(String) : [],
    environmentFilter: String(row.environment_filter),
    metricKeys: Array.isArray(row.metric_keys) ? row.metric_keys.map(String) : [],
    datePreset: String(row.date_preset),
    visualizationType: String(row.visualization_type) as ReportVisualizationType,
    comparisonEnabled: Boolean(row.comparison_enabled),
    definitionVersion: Number(row.definition_version ?? 1),
    createdAtIso: new Date(String(row.created_at)).toISOString(),
    updatedAtIso: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function createSavedReport(
  session: AuthenticatedSessionContext | null,
  rawInput: CreateSavedReportInput,
): Promise<SavedReportRecord> {
  const parsed = createSavedReportSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }
  const input = parsed.data;
  const workspaceId = input.workspaceId ?? session?.activeWorkspace.id ?? "";
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "project:update",
  });

  // Verify ALL referenced projectIds belong to this workspace (prevents cross-tenant smuggling)
  const ownedRes = await dbQuery<{ id: string }>(
    `SELECT id FROM logical_projects WHERE workspace_id = $1 AND id = ANY($2::text[])`,
    [workspaceId, input.projectIds],
  );
  if (ownedRes.rows.length !== new Set(input.projectIds).size) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "One or more selected projects do not belong to the authorized workspace.",
    });
  }

  const id = generateId("srep");
  const inserted = await dbQuery<Record<string, unknown>>(
    `INSERT INTO saved_reports (
      id, organization_id, workspace_id, created_by_user_id, name, description,
      project_ids, environment_filter, metric_keys, date_preset, visualization_type,
      comparison_enabled
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9::text[], $10, $11, $12)
    RETURNING *`,
    [
      id,
      access.organizationId,
      workspaceId,
      session?.user.id ?? null,
      input.name,
      input.description ?? null,
      Array.from(new Set(input.projectIds)),
      input.environmentFilter.toUpperCase(),
      Array.from(new Set(input.metricKeys)),
      input.datePreset,
      input.visualizationType,
      input.comparisonEnabled,
    ],
  );
  return mapReportRow(inserted.rows[0] ?? {});
}

export async function listSavedReports(
  session: AuthenticatedSessionContext | null,
  workspaceId?: string,
): Promise<SavedReportRecord[]> {
  const targetWorkspaceId = workspaceId ?? session?.activeWorkspace.id ?? "";
  await authorizeWorkspaceAccess({
    session,
    workspaceId: targetWorkspaceId,
    requiredPermission: "project:read",
  });

  const res = await dbQuery<Record<string, unknown>>(
    `SELECT * FROM saved_reports WHERE workspace_id = $1 ORDER BY updated_at DESC`,
    [targetWorkspaceId],
  );
  return res.rows.map(mapReportRow);
}

export async function deleteSavedReport(
  session: AuthenticatedSessionContext | null,
  reportId: string,
): Promise<{ deleted: true; reportId: string }> {
  const found = await dbQuery<{ workspace_id: string }>(
    `SELECT workspace_id FROM saved_reports WHERE id = $1`,
    [reportId],
  );
  const row = found.rows[0];
  if (!row) {
    throw new AppError({ code: ERROR_CODES.NOT_FOUND, message: "Saved report not found." });
  }
  await authorizeWorkspaceAccess({
    session,
    workspaceId: row.workspace_id,
    requiredPermission: "project:update",
  });
  await dbQuery(`DELETE FROM saved_reports WHERE id = $1`, [reportId]);
  return { deleted: true, reportId };
}

export async function executeSavedReportBenchmark(
  session: AuthenticatedSessionContext | null,
  reportId: string,
): Promise<ExecutedReportBenchmark> {
  const found = await dbQuery<Record<string, unknown>>(
    `SELECT * FROM saved_reports WHERE id = $1`,
    [reportId],
  );
  const row = found.rows[0];
  if (!row) {
    throw new AppError({ code: ERROR_CODES.NOT_FOUND, message: "Saved report not found." });
  }
  const report = mapReportRow(row);

  // Revalidate workspace authorization on EVERY execution
  await authorizeWorkspaceAccess({
    session,
    workspaceId: report.workspaceId,
    requiredPermission: "project:read",
  });

  const days = report.datePreset === "7d" ? 7 : report.datePreset === "90d" ? 90 : 28;
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 86_400_000);
  const dateStart = startDate.toISOString().slice(0, 10);
  const dateEnd = endDate.toISOString().slice(0, 10);

  const projRes = await dbQuery<{ id: string; name: string }>(
    `SELECT id, name FROM logical_projects WHERE workspace_id = $1 AND id = ANY($2::text[])`,
    [report.workspaceId, report.projectIds],
  );
  const projMap = new Map(projRes.rows.map((p) => [p.id, p.name]));

  const obsRes = await dbQuery<{
    project_id: string;
    canonical_key: string;
    provider_key: string;
    unit: string;
    currency: string | null;
    total_value: string | null;
    obs_count: string;
    latest_at: Date | null;
  }>(
    `SELECT
       project_id,
       canonical_metric_key AS canonical_key,
       provider_key,
       unit,
       currency,
       SUM(numeric_value)::text AS total_value,
       COUNT(*)::text AS obs_count,
       MAX(collected_at) AS latest_at
     FROM metric_observations
     WHERE workspace_id = $1
       AND project_id = ANY($2::text[])
       AND canonical_metric_key = ANY($3::text[])
       AND period_start_date >= $4
       AND period_start_date <= $5
     GROUP BY project_id, canonical_metric_key, provider_key, unit, currency`,
    [report.workspaceId, report.projectIds, report.metricKeys, dateStart, dateEnd],
  );

  const currencies = obsRes.rows.map((r) => r.currency).filter((c): c is string => Boolean(c));
  const { warnings } = assertComparableBenchmarkMetrics(report.metricKeys, { currencies });

  const obsLookup = new Map(obsRes.rows.map((r) => [`${r.project_id}::${r.canonical_key}`, r]));

  const rows: BenchmarkMetricCell[] = [];
  for (const projectId of report.projectIds) {
    const projectName = projMap.get(projectId);
    if (!projectName) continue;
    for (const metricKey of report.metricKeys) {
      const match = obsLookup.get(`${projectId}::${metricKey}`);
      const isNonAdditive = NON_ADDITIVE_METRIC_KEYS.has(metricKey);
      rows.push({
        projectId,
        projectName,
        metricKey,
        providerKey: match?.provider_key ?? null,
        value:
          match && match.total_value !== null && Number.isFinite(Number(match.total_value))
            ? Number(match.total_value)
            : null,
        unit: match?.unit ?? "unknown",
        currency: match?.currency ?? null,
        observationCount: match ? Number(match.obs_count) : 0,
        freshnessLabel: match?.latest_at
          ? `Synced ${new Date(match.latest_at).toISOString().slice(0, 16)}Z`
          : "No observations in window",
        nonAdditiveWarning: isNonAdditive
          ? "Non-additive metric; do not sum across projects."
          : null,
      });
    }
  }

  return {
    report,
    generatedAtIso: new Date().toISOString(),
    dateStart,
    dateEnd,
    rows,
    warnings,
    provenanceSummary: `Workspace ${report.workspaceId} • ${projRes.rows.length} authorized product(s) • ${report.metricKeys.length} canonical metric(s)`,
  };
}
