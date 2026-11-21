import crypto from "node:crypto";
import { type AuthenticatedSessionContext, authorizeWorkspaceAccess } from "@avenor/auth";
import { dbQuery, generateId } from "@avenor/database";
import { AppError, ERROR_CODES } from "@avenor/types";
import { z } from "zod";
import { sanitizeCsvCell } from "@/lib/reports/custom-reports";

export type DataExportType =
  | "REPORT_CSV"
  | "REPORT_PDF"
  | "HISTORICAL_METRICS_CSV"
  | "HISTORICAL_METRICS_JSON"
  | "PERSONAL_ACCOUNT_JSON";

export interface DataExportJobSummary {
  id: string;
  workspaceId: string;
  exportType: DataExportType;
  status: "QUEUED" | "READY" | "EXPIRED" | "FAILED";
  projectIds: string[];
  dateStart: string | null;
  dateEnd: string | null;
  rowCount: number;
  checksumSha256: string;
  provenanceHeader: string;
  expiresAtIso: string;
  createdAtIso: string;
}

export interface WorkspaceRetentionPolicyRecord {
  workspaceId: string;
  metricRetentionDays: number;
  eventRetentionDays: number;
  exportExpiryHours: number;
  backupLimitationNote: string;
  updatedAtIso: string;
}

const BACKUP_LIMITATION_NOTE =
  "Active retention cleanup removes rows from the live Neon PostgreSQL database and invalidates expired export artifacts. Historical Neon point-in-time recovery backups roll off automatically according to the Neon plan retention window rather than instantaneous retroactive rewrite.";

function getExportSigningSecret(): string {
  return (
    process.env.AVENOR_JOB_SIGNING_SECRET ??
    process.env.BETTER_AUTH_SECRET ??
    "avenor-local-dev-export-signing-secret"
  );
}

/**
 * Generates an expiring HMAC-SHA256 download token bound to `(exportId, workspaceId, expiresAtSec)`.
 */
export function createSignedExportDownloadToken(options: {
  exportId: string;
  workspaceId: string;
  expiresAtIso: string;
}): string {
  const expSec = Math.floor(Date.parse(options.expiresAtIso) / 1000);
  const payload = `${options.exportId}.${options.workspaceId}.${expSec}`;
  const sig = crypto.createHmac("sha256", getExportSigningSecret()).update(payload).digest("hex");
  return `${expSec}.${sig}`;
}

export function verifySignedExportDownloadToken(options: {
  exportId: string;
  workspaceId: string;
  token: string;
  nowMs?: number;
}): boolean {
  const [expStr, providedSig] = options.token.split(".");
  const expSec = Number(expStr);
  if (!Number.isFinite(expSec) || !providedSig || !/^[0-9a-f]{64}$/i.test(providedSig)) {
    return false;
  }
  const nowSec = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (nowSec > expSec) {
    return false;
  }
  const payload = `${options.exportId}.${options.workspaceId}.${expSec}`;
  const expectedSig = crypto
    .createHmac("sha256", getExportSigningSecret())
    .update(payload)
    .digest("hex");
  const a = Buffer.from(providedSig, "hex");
  const b = Buffer.from(expectedSig, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function getWorkspaceRetentionPolicy(
  session: AuthenticatedSessionContext | null,
  workspaceId?: string,
): Promise<WorkspaceRetentionPolicyRecord> {
  const targetWs = workspaceId ?? session?.activeWorkspace.id ?? "";
  await authorizeWorkspaceAccess({
    session,
    workspaceId: targetWs,
    requiredPermission: "project:read",
  });

  const res = await dbQuery<Record<string, unknown>>(
    `SELECT * FROM workspace_retention_policies WHERE workspace_id = $1`,
    [targetWs],
  );
  const row = res.rows[0];
  if (!row) {
    return {
      workspaceId: targetWs,
      metricRetentionDays: 365,
      eventRetentionDays: 180,
      exportExpiryHours: 24,
      backupLimitationNote: BACKUP_LIMITATION_NOTE,
      updatedAtIso: new Date().toISOString(),
    };
  }
  return {
    workspaceId: targetWs,
    metricRetentionDays: Number(row.metric_retention_days),
    eventRetentionDays: Number(row.event_retention_days),
    exportExpiryHours: Number(row.export_expiry_hours),
    backupLimitationNote: BACKUP_LIMITATION_NOTE,
    updatedAtIso: new Date(String(row.updated_at)).toISOString(),
  };
}

const updateRetentionSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  metricRetentionDays: z.number().int().min(30).max(1095),
  eventRetentionDays: z.number().int().min(14).max(730),
  exportExpiryHours: z.number().int().min(1).max(168),
});

export async function updateWorkspaceRetentionPolicy(
  session: AuthenticatedSessionContext | null,
  rawInput: z.input<typeof updateRetentionSchema>,
): Promise<WorkspaceRetentionPolicyRecord> {
  const parsed = updateRetentionSchema.safeParse(rawInput);
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
    requiredPermission: "workspace:update",
  });

  const res = await dbQuery<Record<string, unknown>>(
    `INSERT INTO workspace_retention_policies (
      workspace_id, organization_id, metric_retention_days, event_retention_days,
      export_expiry_hours, updated_by_user_id, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, now())
    ON CONFLICT (workspace_id) DO UPDATE SET
      metric_retention_days = EXCLUDED.metric_retention_days,
      event_retention_days = EXCLUDED.event_retention_days,
      export_expiry_hours = EXCLUDED.export_expiry_hours,
      updated_by_user_id = EXCLUDED.updated_by_user_id,
      updated_at = now()
    RETURNING *`,
    [
      workspaceId,
      access.organizationId,
      input.metricRetentionDays,
      input.eventRetentionDays,
      input.exportExpiryHours,
      session?.user.id ?? null,
    ],
  );

  const row = res.rows[0] ?? {};
  return {
    workspaceId,
    metricRetentionDays: Number(row.metric_retention_days),
    eventRetentionDays: Number(row.event_retention_days),
    exportExpiryHours: Number(row.export_expiry_hours),
    backupLimitationNote: BACKUP_LIMITATION_NOTE,
    updatedAtIso: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapExportSummary(row: Record<string, unknown>): DataExportJobSummary {
  const expiresAt = new Date(String(row.expires_at));
  const rawStatus = String(row.status) as DataExportJobSummary["status"];
  const effectiveStatus =
    rawStatus === "READY" && expiresAt.getTime() < Date.now() ? "EXPIRED" : rawStatus;

  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    exportType: String(row.export_type) as DataExportType,
    status: effectiveStatus,
    projectIds: Array.isArray(row.project_ids) ? row.project_ids.map(String) : [],
    dateStart: row.date_start ? String(row.date_start) : null,
    dateEnd: row.date_end ? String(row.date_end) : null,
    rowCount: Number(row.row_count ?? 0),
    checksumSha256: String(row.checksum_sha256),
    provenanceHeader: String(row.provenance_header),
    expiresAtIso: expiresAt.toISOString(),
    createdAtIso: new Date(String(row.created_at)).toISOString(),
  };
}

export async function createHistoricalDataExportJob(
  session: AuthenticatedSessionContext | null,
  input: {
    workspaceId?: string;
    exportType: "HISTORICAL_METRICS_CSV" | "HISTORICAL_METRICS_JSON";
    projectIds: string[];
    dateStart: string;
    dateEnd: string;
  },
): Promise<{ job: DataExportJobSummary; downloadToken: string }> {
  const workspaceId = input.workspaceId ?? session?.activeWorkspace.id ?? "";
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "project:read",
  });

  if (input.projectIds.length === 0) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "At least one authorized projectId is required for historical export.",
    });
  }

  const ownedRes = await dbQuery<{ id: string }>(
    `SELECT id FROM logical_projects WHERE workspace_id = $1 AND id = ANY($2::text[])`,
    [workspaceId, input.projectIds],
  );
  if (ownedRes.rows.length !== new Set(input.projectIds).size) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "Cannot export projects outside the authorized workspace.",
    });
  }

  const policy = await getWorkspaceRetentionPolicy(session, workspaceId);
  const obsRes = await dbQuery<{
    project_id: string;
    provider_key: string;
    canonical_metric_key: string;
    period_start_date: string;
    numeric_value: string | null;
    unit: string;
    currency: string | null;
    completeness_state: string;
    collected_at: Date;
  }>(
    `SELECT project_id, provider_key, canonical_metric_key, period_start_date,
            numeric_value::text, unit, currency, completeness_state, collected_at
     FROM metric_observations
     WHERE workspace_id = $1
       AND project_id = ANY($2::text[])
       AND period_start_date >= $3
       AND period_start_date <= $4
     ORDER BY period_start_date ASC, canonical_metric_key ASC
     LIMIT 5000`,
    [workspaceId, input.projectIds, input.dateStart, input.dateEnd],
  );

  const generatedAtIso = new Date().toISOString();
  const provenanceHeader = `Avenor Historical Export | Workspace=${workspaceId} | Window=${input.dateStart}..${input.dateEnd} | Generated=${generatedAtIso} | Rows=${obsRes.rows.length}`;

  let payload: string;
  if (input.exportType === "HISTORICAL_METRICS_CSV") {
    const csvRows = [
      `# ${provenanceHeader}`,
      [
        "project_id",
        "provider_key",
        "canonical_metric_key",
        "period_start_date",
        "numeric_value",
        "unit",
        "currency",
        "completeness_state",
        "collected_at",
      ]
        .map(sanitizeCsvCell)
        .join(","),
      ...obsRes.rows.map((r) =>
        [
          r.project_id,
          r.provider_key,
          r.canonical_metric_key,
          r.period_start_date,
          r.numeric_value ?? "UNAVAILABLE",
          r.unit,
          r.currency ?? "",
          r.completeness_state,
          new Date(r.collected_at).toISOString(),
        ]
          .map(sanitizeCsvCell)
          .join(","),
      ),
    ];
    payload = `${csvRows.join("\n")}\n`;
  } else {
    payload = JSON.stringify(
      {
        schemaVersion: "1.0",
        provenance: provenanceHeader,
        workspaceId,
        dateStart: input.dateStart,
        dateEnd: input.dateEnd,
        generatedAtIso,
        rowCount: obsRes.rows.length,
        observations: obsRes.rows.map((r) => ({
          projectId: r.project_id,
          providerKey: r.provider_key,
          metricKey: r.canonical_metric_key,
          date: r.period_start_date,
          value: r.numeric_value !== null ? Number(r.numeric_value) : null,
          unit: r.unit,
          currency: r.currency,
          completeness: r.completeness_state,
          collectedAtIso: new Date(r.collected_at).toISOString(),
        })),
      },
      null,
      2,
    );
  }

  const checksumSha256 = crypto.createHash("sha256").update(payload).digest("hex");
  const expiresAtIso = new Date(Date.now() + policy.exportExpiryHours * 3_600_000).toISOString();
  const id = generateId("expj");

  const inserted = await dbQuery<Record<string, unknown>>(
    `INSERT INTO data_export_jobs (
      id, organization_id, workspace_id, requested_by_user_id, export_type, status,
      project_ids, date_start, date_end, row_count, checksum_sha256, content_payload,
      provenance_header, expires_at
    ) VALUES (
      $1, $2, $3, $4, $5, 'READY', $6::text[], $7, $8, $9, $10, $11, $12, $13
    ) RETURNING *`,
    [
      id,
      access.organizationId,
      workspaceId,
      session?.user.id ?? null,
      input.exportType,
      Array.from(new Set(input.projectIds)),
      input.dateStart,
      input.dateEnd,
      obsRes.rows.length,
      checksumSha256,
      payload,
      provenanceHeader,
      expiresAtIso,
    ],
  );

  await dbQuery(
    `INSERT INTO audit_logs (
      id, organization_id, workspace_id, actor_user_id, action, entity_type, entity_id, summary, metadata
    ) VALUES ($1, $2, $3, $4, 'export.created', 'data_export_job', $5, $6, $7::jsonb)`,
    [
      generateId("aud"),
      access.organizationId,
      workspaceId,
      session?.user.id ?? null,
      id,
      `Created ${input.exportType} export (${obsRes.rows.length} rows)`,
      JSON.stringify({ checksumSha256, expiresAtIso }),
    ],
  );

  const downloadToken = createSignedExportDownloadToken({
    exportId: id,
    workspaceId,
    expiresAtIso,
  });

  return { job: mapExportSummary(inserted.rows[0] ?? {}), downloadToken };
}

export async function downloadExportArtifactWithToken(
  session: AuthenticatedSessionContext | null,
  exportId: string,
  token: string,
): Promise<{ content: string; contentType: string; filename: string; checksumSha256: string }> {
  const found = await dbQuery<Record<string, unknown>>(
    `SELECT * FROM data_export_jobs WHERE id = $1`,
    [exportId],
  );
  const row = found.rows[0];
  if (!row) {
    throw new AppError({ code: ERROR_CODES.NOT_FOUND, message: "Export artifact not found." });
  }
  const workspaceId = String(row.workspace_id);
  await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "project:read",
  });

  if (!verifySignedExportDownloadToken({ exportId, workspaceId, token })) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "Export download token is invalid or has expired.",
    });
  }

  const expiresAt = new Date(String(row.expires_at));
  if (expiresAt.getTime() < Date.now() || String(row.status) === "EXPIRED") {
    await dbQuery(
      `UPDATE data_export_jobs SET status = 'EXPIRED', updated_at = now() WHERE id = $1`,
      [exportId],
    );
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "Export artifact has expired according to workspace retention policy.",
    });
  }

  const isCsv = String(row.export_type).endsWith("_CSV");
  return {
    content: String(row.content_payload),
    contentType: isCsv ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
    filename: `avenor-export-${exportId}.${isCsv ? "csv" : "json"}`,
    checksumSha256: String(row.checksum_sha256),
  };
}

export async function listWorkspaceExportJobs(
  session: AuthenticatedSessionContext | null,
  workspaceId?: string,
): Promise<DataExportJobSummary[]> {
  const targetWs = workspaceId ?? session?.activeWorkspace.id ?? "";
  await authorizeWorkspaceAccess({
    session,
    workspaceId: targetWs,
    requiredPermission: "project:read",
  });
  const res = await dbQuery<Record<string, unknown>>(
    `SELECT * FROM data_export_jobs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [targetWs],
  );
  return res.rows.map(mapExportSummary);
}

export async function executeWorkspaceRetentionCleanup(
  session: AuthenticatedSessionContext | null,
  workspaceId?: string,
): Promise<{
  workspaceId: string;
  expiredExportsPurged: number;
  oldEventsPurged: number;
  backupLimitationNote: string;
}> {
  const targetWs = workspaceId ?? session?.activeWorkspace.id ?? "";
  await authorizeWorkspaceAccess({
    session,
    workspaceId: targetWs,
    requiredPermission: "workspace:update",
  });
  const policy = await getWorkspaceRetentionPolicy(session, targetWs);

  const expRes = await dbQuery(
    `UPDATE data_export_jobs
     SET status = 'EXPIRED', content_payload = '', updated_at = now()
     WHERE workspace_id = $1 AND expires_at < now() AND status != 'EXPIRED'`,
    [targetWs],
  );
  const evRes = await dbQuery(
    `DELETE FROM operational_events
     WHERE workspace_id = $1 AND occurred_at < now() - ($2 || ' days')::interval`,
    [targetWs, String(policy.eventRetentionDays)],
  );

  return {
    workspaceId: targetWs,
    expiredExportsPurged: expRes.rowCount ?? 0,
    oldEventsPurged: evRes.rowCount ?? 0,
    backupLimitationNote: BACKUP_LIMITATION_NOTE,
  };
}
