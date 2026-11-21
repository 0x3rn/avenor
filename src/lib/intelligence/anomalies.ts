import {
  type AuthenticatedSessionContext,
  authorizeProjectAccess,
  authorizeWorkspaceAccess,
} from "@avenor/auth";
import { dbQuery, generateId } from "@avenor/database";
import { AppError, ERROR_CODES } from "@avenor/types";

export type AnomalyEvaluationOutcome =
  | "ANOMALY_DETECTED"
  | "NORMAL"
  | "INSUFFICIENT_HISTORY"
  | "SKIPPED_INCOMPLETE_DATA";

export type AnomalySeverity = "INFO" | "WARNING" | "CRITICAL";

export interface HistoricalMetricPoint {
  readonly dateIso: string;
  readonly value: number;
}

export interface StatisticalAnomalyInput {
  readonly metricKey: string;
  readonly providerKey: string;
  readonly history: readonly HistoricalMetricPoint[];
  readonly currentValue: number | null;
  readonly currentDateIso: string;
  readonly completenessState?: "COMPLETE" | "PARTIAL" | "PROVISIONAL" | "STALE" | "UNAVAILABLE";
  readonly minSamples?: number;
  readonly zThreshold?: number;
  readonly minAbsoluteDelta?: number;
  readonly useWeeklySeasonality?: boolean;
}

export interface StatisticalAnomalyDecision {
  readonly outcome: AnomalyEvaluationOutcome;
  readonly isAnomaly: boolean;
  readonly direction: "SPIKE" | "DROP" | "NONE";
  readonly severity: AnomalySeverity | null;
  readonly observedValue: number | null;
  readonly baselineMedian: number | null;
  readonly baselineMad: number | null;
  readonly modifiedZScore: number | null;
  readonly sampleCount: number;
  readonly seasonalFiltered: boolean;
  readonly explanation: string;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

/**
 * Conservative, explainable statistical anomaly detector using Rolling Median & MAD
 * (Median Absolute Deviation) with minimum sample guard, completeness/staleness guard,
 * and optional day-of-week seasonality matching.
 */
export function evaluateRobustStatisticalAnomaly(
  input: StatisticalAnomalyInput,
): StatisticalAnomalyDecision {
  const minSamples = Math.max(5, input.minSamples ?? 7);
  const zThreshold = input.zThreshold ?? 3.5;
  const minAbsDelta = input.minAbsoluteDelta ?? 5;

  if (
    input.currentValue === null ||
    !Number.isFinite(input.currentValue) ||
    (input.completenessState && input.completenessState !== "COMPLETE")
  ) {
    return {
      outcome: "SKIPPED_INCOMPLETE_DATA",
      isAnomaly: false,
      direction: "NONE",
      severity: null,
      observedValue: input.currentValue,
      baselineMedian: null,
      baselineMad: null,
      modifiedZScore: null,
      sampleCount: input.history.length,
      seasonalFiltered: false,
      explanation: `Skipped anomaly evaluation for ${input.metricKey}: current observation is ${input.completenessState ?? "missing"} (never treated as zero).`,
    };
  }

  let effectiveHistory = input.history.filter((p) => Number.isFinite(p.value));
  let seasonalFiltered = false;

  if (input.useWeeklySeasonality && effectiveHistory.length >= 21) {
    const targetDow = new Date(input.currentDateIso).getUTCDay();
    const sameWeekday = effectiveHistory.filter(
      (p) => new Date(p.dateIso).getUTCDay() === targetDow,
    );
    if (sameWeekday.length >= 4) {
      effectiveHistory = sameWeekday;
      seasonalFiltered = true;
    }
  }

  if (effectiveHistory.length < (seasonalFiltered ? 4 : minSamples)) {
    return {
      outcome: "INSUFFICIENT_HISTORY",
      isAnomaly: false,
      direction: "NONE",
      severity: null,
      observedValue: input.currentValue,
      baselineMedian: null,
      baselineMad: null,
      modifiedZScore: null,
      sampleCount: effectiveHistory.length,
      seasonalFiltered,
      explanation: `Insufficient historical baseline for ${input.metricKey} (${effectiveHistory.length} observations; at least ${minSamples} required).`,
    };
  }

  const values = effectiveHistory.map((p) => p.value);
  const med = median(values);
  const absDeviations = values.map((v) => Math.abs(v - med));
  const mad = median(absDeviations);
  const absDelta = Math.abs(input.currentValue - med);

  // Modified Z-score: 0.6745 * (x - median) / MAD
  // When MAD === 0 (constant baseline), use 5% of |median| (min 1) as conservative scale floor
  let modifiedZ: number;
  if (mad > 0) {
    modifiedZ = (0.6745 * (input.currentValue - med)) / mad;
  } else {
    const scaleFloor = Math.max(1, Math.abs(med) * 0.05);
    modifiedZ = (input.currentValue - med) / scaleFloor;
  }

  const roundedZ = Math.round(modifiedZ * 1000) / 1000;
  const isOutlier = Math.abs(modifiedZ) >= zThreshold && absDelta >= minAbsDelta;

  if (!isOutlier) {
    return {
      outcome: "NORMAL",
      isAnomaly: false,
      direction: "NONE",
      severity: null,
      observedValue: input.currentValue,
      baselineMedian: Math.round(med * 1000) / 1000,
      baselineMad: Math.round(mad * 1000) / 1000,
      modifiedZScore: roundedZ,
      sampleCount: effectiveHistory.length,
      seasonalFiltered,
      explanation: `${input.metricKey} observed value (${input.currentValue}) is within expected baseline range (median ${med}, MAD ${mad}, modified z=${roundedZ}).`,
    };
  }

  const direction = input.currentValue > med ? "SPIKE" : "DROP";
  const absZ = Math.abs(modifiedZ);
  const severity: AnomalySeverity = absZ >= 7 ? "CRITICAL" : absZ >= 4.5 ? "WARNING" : "INFO";

  return {
    outcome: "ANOMALY_DETECTED",
    isAnomaly: true,
    direction,
    severity,
    observedValue: input.currentValue,
    baselineMedian: Math.round(med * 1000) / 1000,
    baselineMad: Math.round(mad * 1000) / 1000,
    modifiedZScore: roundedZ,
    sampleCount: effectiveHistory.length,
    seasonalFiltered,
    explanation: `Observed ${direction.toLowerCase()} in ${input.metricKey}: current value ${input.currentValue} deviates from ${seasonalFiltered ? "same-weekday " : ""}baseline median ${med} (MAD ${mad}, modified z=${roundedZ}, n=${effectiveHistory.length}). Statistical deviation is not a proven root cause.`,
  };
}

/**
 * Cross-metric explainable signal (e.g. cost increased while sessions remained flat).
 */
export function evaluateCrossMetricCostTrafficSignal(options: {
  priorCost: number;
  currentCost: number;
  currency: string;
  priorSessions: number;
  currentSessions: number;
}): { triggered: boolean; statement: string } {
  if (options.priorCost <= 0 || options.priorSessions <= 0) {
    return {
      triggered: false,
      statement: "Insufficient non-zero prior baseline to compare cost vs session trajectory.",
    };
  }
  const costChangePct = ((options.currentCost - options.priorCost) / options.priorCost) * 100;
  const sessionChangePct =
    ((options.currentSessions - options.priorSessions) / options.priorSessions) * 100;

  if (costChangePct >= 25 && Math.abs(sessionChangePct) <= 10) {
    return {
      triggered: true,
      statement: `Cost increased by ${costChangePct.toFixed(1)}% (${options.currency} ${options.priorCost.toFixed(2)} → ${options.currentCost.toFixed(2)}) without a comparable rise in sessions (${sessionChangePct.toFixed(1)}%). Review service breakdowns to verify drivers.`,
    };
  }
  return {
    triggered: false,
    statement: "Cost and session trajectories remain within normal relative movement.",
  };
}

export interface PersistedAnomalyRecord {
  id: string;
  workspaceId: string;
  projectId: string;
  metricKey: string;
  providerKey: string;
  method: string;
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "INVALIDATED_BY_REVISION";
  severity: AnomalySeverity;
  observedValue: number;
  baselineMedian: number;
  baselineMad: number;
  zScore: number;
  sampleCount: number;
  explanation: string;
  detectedAtIso: string;
  acknowledgedAtIso: string | null;
  resolvedAtIso: string | null;
}

function mapAnomalyRow(row: Record<string, unknown>): PersistedAnomalyRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    projectId: String(row.project_id),
    metricKey: String(row.metric_key),
    providerKey: String(row.provider_key),
    method: String(row.method),
    status: String(row.status) as PersistedAnomalyRecord["status"],
    severity: String(row.severity) as AnomalySeverity,
    observedValue: Number(row.observed_value),
    baselineMedian: Number(row.baseline_median),
    baselineMad: Number(row.baseline_mad),
    zScore: Number(row.z_score),
    sampleCount: Number(row.sample_count),
    explanation: String(row.explanation),
    detectedAtIso: new Date(String(row.detected_at)).toISOString(),
    acknowledgedAtIso: row.acknowledged_at
      ? new Date(String(row.acknowledged_at)).toISOString()
      : null,
    resolvedAtIso: row.resolved_at ? new Date(String(row.resolved_at)).toISOString() : null,
  };
}

export async function evaluateAndPersistProjectAnomaly(
  session: AuthenticatedSessionContext | null,
  projectId: string,
  input: StatisticalAnomalyInput,
): Promise<{
  decision: StatisticalAnomalyDecision;
  anomaly: PersistedAnomalyRecord | null;
}> {
  const access = await authorizeProjectAccess({
    session,
    projectId,
    requiredPermission: "project:read",
  });

  const decision = evaluateRobustStatisticalAnomaly(input);
  if (
    !decision.isAnomaly ||
    decision.observedValue === null ||
    decision.baselineMedian === null ||
    decision.baselineMad === null ||
    decision.modifiedZScore === null ||
    !decision.severity
  ) {
    return { decision, anomaly: null };
  }

  // Dedupe: if an OPEN anomaly already exists for same workspace + project + metric within 24h, return it
  const existing = await dbQuery<Record<string, unknown>>(
    `SELECT * FROM anomaly_detections
     WHERE workspace_id = $1 AND project_id = $2 AND metric_key = $3
       AND status = 'OPEN' AND detected_at >= now() - interval '24 hours'
     ORDER BY detected_at DESC LIMIT 1`,
    [access.workspaceId, projectId, input.metricKey],
  );
  if (existing.rows[0]) {
    return { decision, anomaly: mapAnomalyRow(existing.rows[0]) };
  }

  const id = generateId("anom");
  const windowEnd = new Date(input.currentDateIso);
  const windowStart = new Date(windowEnd.getTime() - decision.sampleCount * 86_400_000);

  const inserted = await dbQuery<Record<string, unknown>>(
    `INSERT INTO anomaly_detections (
      id, organization_id, workspace_id, project_id, metric_key, provider_key, method,
      status, severity, observed_value, baseline_median, baseline_mad, z_score,
      sample_count, window_start, window_end, explanation, evidence_json
    ) VALUES (
      $1, $2, $3, $4, $5, $6, 'ROBUST_MAD_ZSCORE', 'OPEN', $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb
    ) RETURNING *`,
    [
      id,
      access.organizationId,
      access.workspaceId,
      projectId,
      input.metricKey,
      input.providerKey,
      decision.severity,
      decision.observedValue,
      decision.baselineMedian,
      decision.baselineMad,
      decision.modifiedZScore,
      decision.sampleCount,
      windowStart.toISOString(),
      windowEnd.toISOString(),
      decision.explanation,
      JSON.stringify({
        direction: decision.direction,
        seasonalFiltered: decision.seasonalFiltered,
      }),
    ],
  );

  return { decision, anomaly: mapAnomalyRow(inserted.rows[0] ?? {}) };
}

export async function listWorkspaceAnomalies(
  session: AuthenticatedSessionContext | null,
  workspaceId?: string,
): Promise<PersistedAnomalyRecord[]> {
  const targetWorkspaceId = workspaceId ?? session?.activeWorkspace.id ?? "";
  await authorizeWorkspaceAccess({
    session,
    workspaceId: targetWorkspaceId,
    requiredPermission: "project:read",
  });
  const res = await dbQuery<Record<string, unknown>>(
    `SELECT * FROM anomaly_detections WHERE workspace_id = $1 ORDER BY detected_at DESC LIMIT 100`,
    [targetWorkspaceId],
  );
  return res.rows.map(mapAnomalyRow);
}

export async function updateAnomalyStatus(
  session: AuthenticatedSessionContext | null,
  anomalyId: string,
  nextStatus: "ACKNOWLEDGED" | "RESOLVED",
): Promise<PersistedAnomalyRecord> {
  const found = await dbQuery<{ workspace_id: string }>(
    `SELECT workspace_id FROM anomaly_detections WHERE id = $1`,
    [anomalyId],
  );
  const row = found.rows[0];
  if (!row) {
    throw new AppError({ code: ERROR_CODES.NOT_FOUND, message: "Anomaly record not found." });
  }
  await authorizeWorkspaceAccess({
    session,
    workspaceId: row.workspace_id,
    requiredPermission: "project:update",
  });

  const tsColumn = nextStatus === "ACKNOWLEDGED" ? "acknowledged_at" : "resolved_at";
  const updated = await dbQuery<Record<string, unknown>>(
    `UPDATE anomaly_detections SET status = $1, ${tsColumn} = now() WHERE id = $2 RETURNING *`,
    [nextStatus, anomalyId],
  );
  return mapAnomalyRow(updated.rows[0] ?? {});
}
