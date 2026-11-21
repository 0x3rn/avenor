import { type AuthenticatedSessionContext, authorizeProjectAccess } from "@avenor/auth";
import { dbQuery, generateId } from "@avenor/database";
import { AppError, ERROR_CODES } from "@avenor/types";
import { z } from "zod";
import { sharedReportCache } from "@/lib/reports/cache";

export type OperationalEventType =
  | "DEPLOYMENT"
  | "CI_WORKFLOW"
  | "ERROR_SPIKE"
  | "UPTIME_INCIDENT"
  | "EDGE_ANOMALY"
  | "BACKEND_PRESSURE"
  | "TRAFFIC_DAILY_SUMMARY";

export type OperationalGranularity = "EVENT" | "MINUTE" | "HOURLY" | "DAILY";

export type CorrelationEvidenceLevel =
  | "DIRECTLY_LINKED"
  | "TEMPORALLY_ASSOCIATED"
  | "INSUFFICIENT_EVIDENCE";

export interface OperationalEventRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly environmentId: string | null;
  readonly providerKey: string;
  readonly eventType: OperationalEventType;
  readonly externalEventId: string;
  readonly environmentName: string;
  readonly commitSha: string | null;
  readonly releaseTag: string | null;
  readonly status: string;
  readonly summary: string;
  readonly sourceGranularity: OperationalGranularity;
  readonly sourceTimezone: string;
  readonly sourceUrl: string | null;
  readonly occurredAtIso: string;
  readonly metadata: Record<string, unknown>;
}

export interface OperationalCorrelationRecord {
  readonly correlationId: string;
  readonly evidenceLevel: CorrelationEvidenceLevel;
  readonly environmentName: string;
  readonly primaryEventId: string;
  readonly relatedEventId: string;
  readonly primaryProviderKey: string;
  readonly relatedProviderKey: string;
  readonly deltaSeconds: number;
  readonly sharedIdentifier: string | null;
  readonly cautiousStatement: string;
  readonly granularityNote: string;
}

const CAUTIOUS_CORRELATION_DISCLAIMER =
  "Timeline correlations reflect observed timestamps and shared external identifiers (such as commit SHA or release tag). Correlation is not proof of causation.";

/**
 * Pure evidence-based correlation engine enforcing:
 * 1. Strict environment separation (STAGING events never correlate with PRODUCTION events).
 * 2. Granularity safety (DAILY aggregates like GA4 daily traffic are never linked to minute-level deploys).
 * 3. Chronological ordering (errors preceding a deployment are never attributed as following it).
 * 4. Cautious taxonomy: DIRECTLY_LINKED (shared SHA/release) vs TEMPORALLY_ASSOCIATED (bounded window) vs INSUFFICIENT_EVIDENCE.
 */
export function correlateOperationalEvents(
  events: readonly OperationalEventRecord[],
  options?: { temporalWindowMinutes?: number },
): OperationalCorrelationRecord[] {
  const windowSeconds = (options?.temporalWindowMinutes ?? 30) * 60;
  const sorted = [...events].sort(
    (a, b) => Date.parse(a.occurredAtIso) - Date.parse(b.occurredAtIso),
  );

  const correlations: OperationalCorrelationRecord[] = [];
  const seenPairs = new Set<string>();

  for (let i = 0; i < sorted.length; i++) {
    const first = sorted[i];
    if (!first) continue;

    for (let j = i + 1; j < sorted.length; j++) {
      const second = sorted[j];
      if (!second) continue;

      // Never correlate across different projects or environments
      if (first.projectId !== second.projectId) continue;
      if (first.environmentName.toUpperCase() !== second.environmentName.toUpperCase()) continue;
      // Only correlate cross-signal pairs (skip identical event types from same provider)
      if (first.providerKey === second.providerKey && first.eventType === second.eventType)
        continue;

      const pairKey = [first.id, second.id].sort().join("::");
      if (seenPairs.has(pairKey)) continue;

      const t1 = Date.parse(first.occurredAtIso);
      const t2 = Date.parse(second.occurredAtIso);
      const deltaSeconds = Math.max(0, Math.round((t2 - t1) / 1000));

      // Rule 1: Daily aggregates cannot support sub-day event correlation
      if (first.sourceGranularity === "DAILY" || second.sourceGranularity === "DAILY") {
        seenPairs.add(pairKey);
        correlations.push({
          correlationId: `corr_${first.id}_${second.id}`,
          evidenceLevel: "INSUFFICIENT_EVIDENCE",
          environmentName: first.environmentName,
          primaryEventId: first.id,
          relatedEventId: second.id,
          primaryProviderKey: first.providerKey,
          relatedProviderKey: second.providerKey,
          deltaSeconds,
          sharedIdentifier: null,
          cautiousStatement: `Daily aggregate (${first.sourceGranularity === "DAILY" ? first.providerKey : second.providerKey}) cannot establish sub-day association with ${first.sourceGranularity === "DAILY" ? second.eventType : first.eventType}.`,
          granularityNote: "Day-level reporting resolution; sub-day timing is not comparable.",
        });
        continue;
      }

      // Rule 2: Shared verified commit SHA or release tag -> DIRECTLY_LINKED
      const sha1 = first.commitSha?.trim().toLowerCase() ?? "";
      const sha2 = second.commitSha?.trim().toLowerCase() ?? "";
      const rel1 = first.releaseTag?.trim().toLowerCase() ?? "";
      const rel2 = second.releaseTag?.trim().toLowerCase() ?? "";

      const sharedSha = sha1.length >= 7 && sha1 === sha2 ? sha1 : null;
      const sharedRelease = !sharedSha && rel1.length >= 3 && rel1 === rel2 ? rel1 : null;
      const releaseContainsSha =
        !sharedSha && !sharedRelease && sha1.length >= 7 && rel2.includes(sha1)
          ? sha1
          : !sharedSha && !sharedRelease && sha2.length >= 7 && rel1.includes(sha2)
            ? sha2
            : null;

      const verifiedSharedId = sharedSha ?? sharedRelease ?? releaseContainsSha;
      if (verifiedSharedId) {
        seenPairs.add(pairKey);
        correlations.push({
          correlationId: `corr_${first.id}_${second.id}`,
          evidenceLevel: "DIRECTLY_LINKED",
          environmentName: first.environmentName,
          primaryEventId: first.id,
          relatedEventId: second.id,
          primaryProviderKey: first.providerKey,
          relatedProviderKey: second.providerKey,
          deltaSeconds,
          sharedIdentifier: verifiedSharedId,
          cautiousStatement: `${first.providerKey} (${first.eventType}) and ${second.providerKey} (${second.eventType}) share verified identifier "${verifiedSharedId}" in ${first.environmentName}.`,
          granularityNote: `Exact event timestamps (${first.sourceTimezone} / ${second.sourceTimezone}).`,
        });
        continue;
      }

      // Rule 3: Bounded temporal proximity -> TEMPORALLY_ASSOCIATED (strictly preserving order!)
      if (deltaSeconds <= windowSeconds) {
        seenPairs.add(pairKey);
        const deltaMins = Math.max(1, Math.round(deltaSeconds / 60));
        correlations.push({
          correlationId: `corr_${first.id}_${second.id}`,
          evidenceLevel: "TEMPORALLY_ASSOCIATED",
          environmentName: first.environmentName,
          primaryEventId: first.id,
          relatedEventId: second.id,
          primaryProviderKey: first.providerKey,
          relatedProviderKey: second.providerKey,
          deltaSeconds,
          sharedIdentifier: null,
          cautiousStatement: `${second.providerKey} (${second.eventType}) was observed ~${deltaMins}m after ${first.providerKey} (${first.eventType}) in ${first.environmentName}. Observed proximity does not prove causation.`,
          granularityNote: `Bounded ${Math.round(windowSeconds / 60)}-minute window (${first.sourceGranularity} -> ${second.sourceGranularity}).`,
        });
      }
    }
  }

  return correlations;
}

const recordOperationalEventSchema = z.object({
  projectId: z.string().min(1),
  environmentId: z.string().nullable().optional(),
  providerKey: z.string().trim().min(2).max(60),
  eventType: z.enum([
    "DEPLOYMENT",
    "CI_WORKFLOW",
    "ERROR_SPIKE",
    "UPTIME_INCIDENT",
    "EDGE_ANOMALY",
    "BACKEND_PRESSURE",
    "TRAFFIC_DAILY_SUMMARY",
  ]),
  externalEventId: z.string().trim().min(2).max(180),
  environmentName: z.string().trim().min(2).max(40).default("PRODUCTION"),
  commitSha: z.string().trim().max(64).nullable().optional(),
  releaseTag: z.string().trim().max(120).nullable().optional(),
  status: z.string().trim().min(1).max(60),
  summary: z.string().trim().min(2).max(300),
  sourceGranularity: z.enum(["EVENT", "MINUTE", "HOURLY", "DAILY"]).default("EVENT"),
  sourceTimezone: z.string().trim().min(2).max(60).default("UTC"),
  sourceUrl: z.string().url().nullable().optional(),
  occurredAtIso: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type RecordOperationalEventInput = z.input<typeof recordOperationalEventSchema>;

function mapEventRow(row: Record<string, unknown>): OperationalEventRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    projectId: String(row.project_id),
    environmentId: row.environment_id ? String(row.environment_id) : null,
    providerKey: String(row.provider_key),
    eventType: String(row.event_type) as OperationalEventType,
    externalEventId: String(row.external_event_id),
    environmentName: String(row.environment_name),
    commitSha: row.commit_sha ? String(row.commit_sha) : null,
    releaseTag: row.release_tag ? String(row.release_tag) : null,
    status: String(row.status),
    summary: String(row.summary),
    sourceGranularity: String(row.source_granularity) as OperationalGranularity,
    sourceTimezone: String(row.source_timezone),
    sourceUrl: row.source_url ? String(row.source_url) : null,
    occurredAtIso: new Date(String(row.occurred_at)).toISOString(),
    metadata:
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {},
  };
}

/**
 * Idempotently persists an operational event keyed by `(workspace_id, provider_key, external_event_id)`
 * so duplicate webhook + polling observations update one effective event rather than duplicating rows.
 */
export async function recordOperationalEvent(
  session: AuthenticatedSessionContext | null,
  rawInput: RecordOperationalEventInput,
): Promise<OperationalEventRecord> {
  const parsed = recordOperationalEventSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }
  const input = parsed.data;
  const access = await authorizeProjectAccess({
    session,
    projectId: input.projectId,
    requiredPermission: "project:update",
  });

  const id = generateId("opev");
  const res = await dbQuery<Record<string, unknown>>(
    `INSERT INTO operational_events (
      id, organization_id, workspace_id, project_id, environment_id, provider_key, event_type,
      external_event_id, environment_name, commit_sha, release_tag, status, summary,
      source_granularity, source_timezone, source_url, occurred_at, metadata
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb
    )
    ON CONFLICT (workspace_id, provider_key, external_event_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      summary = EXCLUDED.summary,
      commit_sha = COALESCE(EXCLUDED.commit_sha, operational_events.commit_sha),
      release_tag = COALESCE(EXCLUDED.release_tag, operational_events.release_tag),
      metadata = operational_events.metadata || EXCLUDED.metadata,
      updated_at = now()
    RETURNING *`,
    [
      id,
      access.organizationId,
      access.workspaceId,
      input.projectId,
      input.environmentId ?? null,
      input.providerKey,
      input.eventType,
      input.externalEventId,
      input.environmentName.toUpperCase(),
      input.commitSha ?? null,
      input.releaseTag ?? null,
      input.status,
      input.summary,
      input.sourceGranularity,
      input.sourceTimezone,
      input.sourceUrl ?? null,
      input.occurredAtIso,
      JSON.stringify(input.metadata ?? {}),
    ],
  );

  sharedReportCache.invalidateWorkspace(access.organizationId, access.workspaceId);
  return mapEventRow(res.rows[0] ?? {});
}

export async function getProjectOperationalTimeline(
  session: AuthenticatedSessionContext | null,
  projectId: string,
  options?: { environmentName?: string; bypassCache?: boolean },
): Promise<{
  projectId: string;
  workspaceId: string;
  events: OperationalEventRecord[];
  correlations: OperationalCorrelationRecord[];
  causationDisclaimer: string;
}> {
  const access = await authorizeProjectAccess({
    session,
    projectId,
    requiredPermission: "project:read",
  });

  const envFilter = options?.environmentName?.trim().toUpperCase() || null;

  const todayIso = new Date().toISOString().slice(0, 10);
  const { value } = await sharedReportCache.getOrLoad(
    {
      organizationId: access.organizationId,
      workspaceId: access.workspaceId,
      projectId,
      role: access.role,
      surface: "project_control_center",
      startDate: todayIso,
      endDate: todayIso,
      filters: { subkey: "reliability_correlation_timeline", envFilter },
    },
    async () => {
      const eventsRes = envFilter
        ? await dbQuery<Record<string, unknown>>(
            `SELECT * FROM operational_events
             WHERE workspace_id = $1 AND project_id = $2 AND environment_name = $3
             ORDER BY occurred_at DESC LIMIT 100`,
            [access.workspaceId, projectId, envFilter],
          )
        : await dbQuery<Record<string, unknown>>(
            `SELECT * FROM operational_events
             WHERE workspace_id = $1 AND project_id = $2
             ORDER BY occurred_at DESC LIMIT 100`,
            [access.workspaceId, projectId],
          );

      const events = eventsRes.rows.map(mapEventRow);
      const correlations = correlateOperationalEvents(events);
      return {
        projectId,
        workspaceId: access.workspaceId,
        events,
        correlations,
        causationDisclaimer: CAUTIOUS_CORRELATION_DISCLAIMER,
      };
    },
    { bypassCache: options?.bypassCache },
  );

  return value;
}
