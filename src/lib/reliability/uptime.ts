import {
  type AuthenticatedSessionContext,
  authorizeProjectAccess,
  authorizeWorkspaceAccess,
} from "@avenor/auth";
import { dbQuery, generateId } from "@avenor/database";
import { AppError, ERROR_CODES } from "@avenor/types";
import { z } from "zod";
import {
  type ControlledDnsResolver,
  type PinnedPublicTarget,
  resolveAndPinSafePublicAddress,
  validatePublicTargetUrl,
} from "./ssrf";

export type MonitorStatus =
  | "PENDING"
  | "HEALTHY"
  | "DEGRADED"
  | "SUSPECTED_OUTAGE"
  | "CONFIRMED_OUTAGE"
  | "RECOVERING"
  | "PAUSED";

export type ProbeOutcome =
  | "OK"
  | "HTTP_STATUS_MISMATCH"
  | "TIMEOUT"
  | "TLS_ERROR"
  | "DNS_ERROR"
  | "SSRF_BLOCKED"
  | "CONNECTION_ERROR";

export interface UptimeMonitorRecord {
  id: string;
  organizationId: string;
  workspaceId: string;
  projectId: string;
  environmentId: string | null;
  name: string;
  targetUrl: string;
  httpMethod: "HEAD" | "GET";
  expectedStatusMin: number;
  expectedStatusMax: number;
  intervalSeconds: number;
  timeoutMs: number;
  failureThreshold: number;
  recoveryThreshold: number;
  status: MonitorStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  probeRegion: string;
  isEnabled: boolean;
  lastCheckedAtIso: string | null;
  createdAtIso: string;
}

export interface UptimeIncidentRecord {
  id: string;
  monitorId: string;
  projectId: string;
  status: "CONFIRMED_OUTAGE" | "RECOVERED";
  firstFailedAtIso: string;
  confirmedAtIso: string;
  lastFailedAtIso: string;
  recoveredAtIso: string | null;
  failureCategory: string;
  probeRegion: string;
  consecutiveFailureCount: number;
  durationSeconds: number | null;
}

export interface UptimeProbeExecutionResult {
  probeId: string;
  monitorId: string;
  checkedAtIso: string;
  probeRegion: string;
  resolvedIp: string | null;
  outcome: ProbeOutcome;
  httpStatus: number | null;
  responseTimeMs: number | null;
  tlsValid: boolean | null;
  errorCategory: string | null;
  nextMonitorStatus: MonitorStatus;
  incidentAction: "NONE" | "OPENED" | "UPDATED" | "RESOLVED";
}

export interface MonitorStateSnapshot {
  status: MonitorStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  failureThreshold: number;
  recoveryThreshold: number;
}

export interface MonitorTransitionDecision {
  nextStatus: MonitorStatus;
  nextConsecutiveFailures: number;
  nextConsecutiveSuccesses: number;
  incidentAction: "NONE" | "OPENED" | "UPDATED" | "RESOLVED";
}

/**
 * Pure noise-resistant incident state machine.
 * - Single probe failure -> SUSPECTED_OUTAGE (never opens a confirmed outage on 1 failure)
 * - `failureThreshold` consecutive failures -> CONFIRMED_OUTAGE (opens 1 incident)
 * - Alternating success/failure during CONFIRMED_OUTAGE -> RECOVERING -> CONFIRMED_OUTAGE without flip-flopping incidents
 * - `recoveryThreshold` consecutive successes -> HEALTHY (resolves active incident)
 */
export function evaluateMonitorTransition(
  current: MonitorStateSnapshot,
  isProbeSuccess: boolean,
): MonitorTransitionDecision {
  if (current.status === "PAUSED") {
    return {
      nextStatus: "PAUSED",
      nextConsecutiveFailures: current.consecutiveFailures,
      nextConsecutiveSuccesses: current.consecutiveSuccesses,
      incidentAction: "NONE",
    };
  }

  const inActiveOutage = current.status === "CONFIRMED_OUTAGE" || current.status === "RECOVERING";

  if (isProbeSuccess) {
    const nextSuccesses = current.consecutiveSuccesses + 1;
    if (inActiveOutage) {
      if (nextSuccesses >= current.recoveryThreshold) {
        return {
          nextStatus: "HEALTHY",
          nextConsecutiveFailures: 0,
          nextConsecutiveSuccesses: nextSuccesses,
          incidentAction: "RESOLVED",
        };
      }
      return {
        nextStatus: "RECOVERING",
        nextConsecutiveFailures: 0,
        nextConsecutiveSuccesses: nextSuccesses,
        incidentAction: "NONE",
      };
    }
    return {
      nextStatus: "HEALTHY",
      nextConsecutiveFailures: 0,
      nextConsecutiveSuccesses: nextSuccesses,
      incidentAction: "NONE",
    };
  }

  // Probe failed
  const nextFailures = current.consecutiveFailures + 1;
  if (inActiveOutage) {
    return {
      nextStatus: "CONFIRMED_OUTAGE",
      nextConsecutiveFailures: nextFailures,
      nextConsecutiveSuccesses: 0,
      incidentAction: "UPDATED",
    };
  }

  if (nextFailures >= current.failureThreshold) {
    return {
      nextStatus: "CONFIRMED_OUTAGE",
      nextConsecutiveFailures: nextFailures,
      nextConsecutiveSuccesses: 0,
      incidentAction: "OPENED",
    };
  }

  return {
    nextStatus: "SUSPECTED_OUTAGE",
    nextConsecutiveFailures: nextFailures,
    nextConsecutiveSuccesses: 0,
    incidentAction: "NONE",
  };
}

export type SafeProbeTransport = (
  target: PinnedPublicTarget,
  options: { method: "HEAD" | "GET"; timeoutMs: number },
) => Promise<{
  status: number;
  locationHeader?: string | null;
  tlsValid?: boolean;
}>;

const MAX_PROBE_REDIRECTS = 3;
const MAX_MONITORS_PER_WORKSPACE = 25;

/**
 * Executes a bounded, SSRF- and DNS-rebinding-safe HTTP availability check.
 * Re-resolves and validates EVERY redirect destination before any outbound request occurs
 * and never follows redirects to private/internal addresses or downgrades https -> http.
 */
export async function runSafePublicProbe(options: {
  targetUrl: string;
  httpMethod: "HEAD" | "GET";
  expectedStatusMin: number;
  expectedStatusMax: number;
  timeoutMs: number;
  dnsLookupFn?: ControlledDnsResolver;
  transportFn?: SafeProbeTransport;
}): Promise<{
  resolvedIp: string | null;
  outcome: ProbeOutcome;
  httpStatus: number | null;
  responseTimeMs: number;
  tlsValid: boolean | null;
  errorCategory: string | null;
}> {
  const started = Date.now();
  let currentUrl = options.targetUrl;
  let currentProtocol: "https:" | "http:" = "https:";

  try {
    for (let hop = 0; hop <= MAX_PROBE_REDIRECTS; hop++) {
      const pinned = await resolveAndPinSafePublicAddress(currentUrl, {
        allowHttp: hop === 0 && currentUrl.startsWith("http://"),
        dnsLookupFn: options.dnsLookupFn,
      });

      if (hop > 0 && currentProtocol === "https:" && pinned.protocol === "http:") {
        return {
          resolvedIp: null,
          outcome: "SSRF_BLOCKED",
          httpStatus: null,
          responseTimeMs: Date.now() - started,
          tlsValid: false,
          errorCategory: "Redirect scheme downgrade from HTTPS to HTTP rejected.",
        };
      }
      currentProtocol = pinned.protocol;

      let resp: { status: number; locationHeader?: string | null; tlsValid?: boolean };
      if (options.transportFn) {
        resp = await options.transportFn(pinned, {
          method: options.httpMethod,
          timeoutMs: options.timeoutMs,
        });
      } else {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeoutMs);
        try {
          const fetchRes = await fetch(pinned.normalizedUrl, {
            method: options.httpMethod,
            redirect: "manual",
            signal: controller.signal,
            headers: {
              "User-Agent": "Avenor-ReadOnly-UptimeMonitor/1.0",
              Accept: "*/*",
            },
          });
          // Never read/store response bodies
          if (fetchRes.body) {
            await fetchRes.body.cancel().catch(() => {});
          }
          resp = {
            status: fetchRes.status,
            locationHeader: fetchRes.headers.get("location"),
            tlsValid: pinned.protocol === "https:",
          };
        } finally {
          clearTimeout(timer);
        }
      }

      if (resp.status >= 300 && resp.status < 400 && resp.locationHeader) {
        if (hop === MAX_PROBE_REDIRECTS) {
          return {
            resolvedIp: pinned.pinnedIp,
            outcome: "HTTP_STATUS_MISMATCH",
            httpStatus: resp.status,
            responseTimeMs: Date.now() - started,
            tlsValid: resp.tlsValid ?? pinned.protocol === "https:",
            errorCategory: `Exceeded maximum redirect limit (${MAX_PROBE_REDIRECTS}).`,
          };
        }
        currentUrl = new URL(resp.locationHeader, pinned.normalizedUrl).toString();
        continue;
      }

      const ok =
        resp.status >= options.expectedStatusMin && resp.status <= options.expectedStatusMax;
      return {
        resolvedIp: pinned.pinnedIp,
        outcome: ok ? "OK" : "HTTP_STATUS_MISMATCH",
        httpStatus: resp.status,
        responseTimeMs: Date.now() - started,
        tlsValid: resp.tlsValid ?? pinned.protocol === "https:",
        errorCategory: ok
          ? null
          : `HTTP ${resp.status} outside expected range ${options.expectedStatusMin}-${options.expectedStatusMax}.`,
      };
    }
  } catch (err) {
    const duration = Date.now() - started;
    if (
      err instanceof AppError &&
      (err.code === ERROR_CODES.FORBIDDEN || err.code === ERROR_CODES.VALIDATION_ERROR)
    ) {
      return {
        resolvedIp: null,
        outcome: "SSRF_BLOCKED",
        httpStatus: null,
        responseTimeMs: duration,
        tlsValid: null,
        errorCategory: err.message,
      };
    }
    const msg = err instanceof Error ? err.message : "Probe request failed";
    if (err instanceof Error && (err.name === "AbortError" || /timeout|timed out/i.test(msg))) {
      return {
        resolvedIp: null,
        outcome: "TIMEOUT",
        httpStatus: null,
        responseTimeMs: duration,
        tlsValid: null,
        errorCategory: `Probe timed out after ${options.timeoutMs}ms.`,
      };
    }
    if (/cert|tls|ssl|handshake/i.test(msg)) {
      return {
        resolvedIp: null,
        outcome: "TLS_ERROR",
        httpStatus: null,
        responseTimeMs: duration,
        tlsValid: false,
        errorCategory: "TLS certificate or handshake verification failed.",
      };
    }
    if (/dns|enotfound|eai_again/i.test(msg)) {
      return {
        resolvedIp: null,
        outcome: "DNS_ERROR",
        httpStatus: null,
        responseTimeMs: duration,
        tlsValid: null,
        errorCategory: "DNS lookup failed.",
      };
    }
    return {
      resolvedIp: null,
      outcome: "CONNECTION_ERROR",
      httpStatus: null,
      responseTimeMs: duration,
      tlsValid: null,
      errorCategory: msg.slice(0, 200),
    };
  }

  return {
    resolvedIp: null,
    outcome: "CONNECTION_ERROR",
    httpStatus: null,
    responseTimeMs: Date.now() - started,
    tlsValid: null,
    errorCategory: "Probe loop terminated unexpectedly.",
  };
}

const createMonitorSchema = z.object({
  projectId: z.string().min(1),
  environmentId: z.string().nullable().optional(),
  name: z.string().trim().min(2).max(120),
  targetUrl: z.string().trim().min(8).max(500),
  httpMethod: z.enum(["HEAD", "GET"]).default("HEAD"),
  expectedStatusMin: z.number().int().min(100).max(599).default(200),
  expectedStatusMax: z.number().int().min(100).max(599).default(399),
  intervalSeconds: z.number().int().min(300).max(86400).default(600),
  timeoutMs: z.number().int().min(1000).max(15000).default(8000),
  failureThreshold: z.number().int().min(2).max(10).default(3),
  recoveryThreshold: z.number().int().min(2).max(10).default(2),
});

export type CreateUptimeMonitorInput = z.input<typeof createMonitorSchema>;

function mapMonitorRow(row: Record<string, unknown>): UptimeMonitorRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    workspaceId: String(row.workspace_id),
    projectId: String(row.project_id),
    environmentId: row.environment_id ? String(row.environment_id) : null,
    name: String(row.name),
    targetUrl: String(row.target_url),
    httpMethod: String(row.http_method) === "GET" ? "GET" : "HEAD",
    expectedStatusMin: Number(row.expected_status_min),
    expectedStatusMax: Number(row.expected_status_max),
    intervalSeconds: Number(row.interval_seconds),
    timeoutMs: Number(row.timeout_ms),
    failureThreshold: Number(row.failure_threshold),
    recoveryThreshold: Number(row.recovery_threshold),
    status: String(row.status) as MonitorStatus,
    consecutiveFailures: Number(row.consecutive_failures),
    consecutiveSuccesses: Number(row.consecutive_successes),
    probeRegion: String(row.probe_region),
    isEnabled: Boolean(row.is_enabled),
    lastCheckedAtIso: row.last_checked_at
      ? new Date(String(row.last_checked_at)).toISOString()
      : null,
    createdAtIso: new Date(String(row.created_at)).toISOString(),
  };
}

function mapIncidentRow(row: Record<string, unknown>): UptimeIncidentRecord {
  return {
    id: String(row.id),
    monitorId: String(row.monitor_id),
    projectId: String(row.project_id),
    status: String(row.status) === "RECOVERED" ? "RECOVERED" : "CONFIRMED_OUTAGE",
    firstFailedAtIso: new Date(String(row.first_failed_at)).toISOString(),
    confirmedAtIso: new Date(String(row.confirmed_at)).toISOString(),
    lastFailedAtIso: new Date(String(row.last_failed_at)).toISOString(),
    recoveredAtIso: row.recovered_at ? new Date(String(row.recovered_at)).toISOString() : null,
    failureCategory: String(row.failure_category),
    probeRegion: String(row.probe_region),
    consecutiveFailureCount: Number(row.consecutive_failure_count),
    durationSeconds:
      row.duration_seconds !== null && row.duration_seconds !== undefined
        ? Number(row.duration_seconds)
        : null,
  };
}

export async function createUptimeMonitor(
  session: AuthenticatedSessionContext | null,
  rawInput: CreateUptimeMonitorInput,
): Promise<UptimeMonitorRecord> {
  const parsed = createMonitorSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }
  const input = parsed.data;
  if (input.expectedStatusMin > input.expectedStatusMax) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "expectedStatusMin must be less than or equal to expectedStatusMax.",
    });
  }

  const access = await authorizeProjectAccess({
    session,
    projectId: input.projectId,
    requiredPermission: "project:update",
  });

  // Strict server-side URL & SSRF validation before persisting monitor
  const validatedTarget = validatePublicTargetUrl(input.targetUrl, { allowHttp: false });

  // Enforce per-workspace monitor cap
  const countRes = await dbQuery<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM uptime_monitors WHERE workspace_id = $1`,
    [access.workspaceId],
  );
  if (Number(countRes.rows[0]?.total ?? 0) >= MAX_MONITORS_PER_WORKSPACE) {
    throw new AppError({
      code: ERROR_CODES.RATE_LIMITED,
      message: `Workspace uptime monitor limit (${MAX_MONITORS_PER_WORKSPACE}) reached.`,
    });
  }

  const id = generateId("umon");
  const inserted = await dbQuery<Record<string, unknown>>(
    `INSERT INTO uptime_monitors (
      id, organization_id, workspace_id, project_id, environment_id, name, target_url,
      http_method, expected_status_min, expected_status_max, interval_seconds, timeout_ms,
      failure_threshold, recovery_threshold, status, probe_region, is_enabled, created_by_user_id
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'PENDING', 'us-east-primary', true, $15
    ) RETURNING *`,
    [
      id,
      access.organizationId,
      access.workspaceId,
      input.projectId,
      input.environmentId ?? null,
      input.name,
      validatedTarget.normalizedUrl,
      input.httpMethod,
      input.expectedStatusMin,
      input.expectedStatusMax,
      input.intervalSeconds,
      input.timeoutMs,
      input.failureThreshold,
      input.recoveryThreshold,
      session?.user.id ?? null,
    ],
  );

  return mapMonitorRow(inserted.rows[0] ?? {});
}

export async function listWorkspaceReliabilitySnapshot(
  session: AuthenticatedSessionContext | null,
  options?: { workspaceId?: string; projectId?: string },
): Promise<{
  workspaceId: string;
  monitors: UptimeMonitorRecord[];
  incidents: UptimeIncidentRecord[];
  singleRegionCaveat: string;
}> {
  const workspaceId = options?.workspaceId ?? session?.activeWorkspace.id ?? "";
  if (options?.projectId) {
    await authorizeProjectAccess({
      session,
      projectId: options.projectId,
      requiredPermission: "project:read",
    });
  } else {
    await authorizeWorkspaceAccess({
      session,
      workspaceId,
      requiredPermission: "project:read",
    });
  }

  const monitorRes = options?.projectId
    ? await dbQuery<Record<string, unknown>>(
        `SELECT * FROM uptime_monitors WHERE workspace_id = $1 AND project_id = $2 ORDER BY created_at DESC`,
        [workspaceId, options.projectId],
      )
    : await dbQuery<Record<string, unknown>>(
        `SELECT * FROM uptime_monitors WHERE workspace_id = $1 ORDER BY created_at DESC`,
        [workspaceId],
      );

  const incidentRes = options?.projectId
    ? await dbQuery<Record<string, unknown>>(
        `SELECT * FROM uptime_incidents WHERE workspace_id = $1 AND project_id = $2 ORDER BY confirmed_at DESC LIMIT 50`,
        [workspaceId, options.projectId],
      )
    : await dbQuery<Record<string, unknown>>(
        `SELECT * FROM uptime_incidents WHERE workspace_id = $1 ORDER BY confirmed_at DESC LIMIT 50`,
        [workspaceId],
      );

  return {
    workspaceId,
    monitors: monitorRes.rows.map(mapMonitorRow),
    incidents: incidentRes.rows.map(mapIncidentRow),
    singleRegionCaveat:
      "Observed from Avenor's primary probe region (us-east-primary). A single regional probe does not establish global availability, and one failed check triggers Suspected Outage rather than a Confirmed Outage.",
  };
}

export async function toggleUptimeMonitor(
  session: AuthenticatedSessionContext | null,
  monitorId: string,
  isEnabled: boolean,
): Promise<UptimeMonitorRecord> {
  const existing = await dbQuery<Record<string, unknown>>(
    `SELECT * FROM uptime_monitors WHERE id = $1`,
    [monitorId],
  );
  const row = existing.rows[0];
  if (!row) {
    throw new AppError({ code: ERROR_CODES.NOT_FOUND, message: "Uptime monitor not found." });
  }
  await authorizeProjectAccess({
    session,
    projectId: String(row.project_id),
    requiredPermission: "project:update",
  });

  const nextStatus = isEnabled ? "PENDING" : "PAUSED";
  const updated = await dbQuery<Record<string, unknown>>(
    `UPDATE uptime_monitors SET is_enabled = $1, status = $2, updated_at = now() WHERE id = $3 RETURNING *`,
    [isEnabled, nextStatus, monitorId],
  );
  return mapMonitorRow(updated.rows[0] ?? {});
}

export async function deleteUptimeMonitor(
  session: AuthenticatedSessionContext | null,
  monitorId: string,
): Promise<{ deleted: true; monitorId: string }> {
  const existing = await dbQuery<Record<string, unknown>>(
    `SELECT project_id FROM uptime_monitors WHERE id = $1`,
    [monitorId],
  );
  const row = existing.rows[0];
  if (!row) {
    throw new AppError({ code: ERROR_CODES.NOT_FOUND, message: "Uptime monitor not found." });
  }
  await authorizeProjectAccess({
    session,
    projectId: String(row.project_id),
    requiredPermission: "project:update",
  });
  await dbQuery(`DELETE FROM uptime_monitors WHERE id = $1`, [monitorId]);
  return { deleted: true, monitorId };
}

export async function executeUptimeProbeAndRecord(
  session: AuthenticatedSessionContext | null,
  monitorId: string,
  options?: { dnsLookupFn?: ControlledDnsResolver; transportFn?: SafeProbeTransport },
): Promise<UptimeProbeExecutionResult> {
  const existing = await dbQuery<Record<string, unknown>>(
    `SELECT * FROM uptime_monitors WHERE id = $1`,
    [monitorId],
  );
  const row = existing.rows[0];
  if (!row) {
    throw new AppError({ code: ERROR_CODES.NOT_FOUND, message: "Uptime monitor not found." });
  }
  const monitor = mapMonitorRow(row);
  await authorizeProjectAccess({
    session,
    projectId: monitor.projectId,
    requiredPermission: "project:read",
  });

  const checkedAtIso = new Date().toISOString();
  const probe = await runSafePublicProbe({
    targetUrl: monitor.targetUrl,
    httpMethod: monitor.httpMethod,
    expectedStatusMin: monitor.expectedStatusMin,
    expectedStatusMax: monitor.expectedStatusMax,
    timeoutMs: monitor.timeoutMs,
    dnsLookupFn: options?.dnsLookupFn,
    transportFn: options?.transportFn,
  });

  const probeId = generateId("uprb");
  await dbQuery(
    `INSERT INTO uptime_probe_results (
      id, monitor_id, organization_id, workspace_id, project_id, checked_at, probe_region,
      resolved_ip, outcome, http_status, response_time_ms, tls_valid, error_category
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      probeId,
      monitor.id,
      monitor.organizationId,
      monitor.workspaceId,
      monitor.projectId,
      checkedAtIso,
      monitor.probeRegion,
      probe.resolvedIp,
      probe.outcome,
      probe.httpStatus,
      probe.responseTimeMs,
      probe.tlsValid,
      probe.errorCategory,
    ],
  );

  const decision = evaluateMonitorTransition(
    {
      status: monitor.status,
      consecutiveFailures: monitor.consecutiveFailures,
      consecutiveSuccesses: monitor.consecutiveSuccesses,
      failureThreshold: monitor.failureThreshold,
      recoveryThreshold: monitor.recoveryThreshold,
    },
    probe.outcome === "OK",
  );

  await dbQuery(
    `UPDATE uptime_monitors
     SET status = $1, consecutive_failures = $2, consecutive_successes = $3,
         last_checked_at = $4, updated_at = now()
     WHERE id = $5`,
    [
      decision.nextStatus,
      decision.nextConsecutiveFailures,
      decision.nextConsecutiveSuccesses,
      checkedAtIso,
      monitor.id,
    ],
  );

  if (decision.incidentAction === "OPENED") {
    const incidentId = generateId("uinc");
    await dbQuery(
      `INSERT INTO uptime_incidents (
        id, monitor_id, organization_id, workspace_id, project_id, status,
        first_failed_at, confirmed_at, last_failed_at, failure_category, probe_region,
        consecutive_failure_count
      ) VALUES ($1, $2, $3, $4, $5, 'CONFIRMED_OUTAGE', $6, $6, $6, $7, $8, $9)`,
      [
        incidentId,
        monitor.id,
        monitor.organizationId,
        monitor.workspaceId,
        monitor.projectId,
        checkedAtIso,
        probe.errorCategory ?? probe.outcome,
        monitor.probeRegion,
        decision.nextConsecutiveFailures,
      ],
    );
  } else if (decision.incidentAction === "UPDATED") {
    await dbQuery(
      `UPDATE uptime_incidents
       SET last_failed_at = $1, consecutive_failure_count = $2, updated_at = now()
       WHERE monitor_id = $3 AND status = 'CONFIRMED_OUTAGE'`,
      [checkedAtIso, decision.nextConsecutiveFailures, monitor.id],
    );
  } else if (decision.incidentAction === "RESOLVED") {
    await dbQuery(
      `UPDATE uptime_incidents
       SET status = 'RECOVERED', recovered_at = $1,
           duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM ($1::timestamptz - first_failed_at))::int),
           updated_at = now()
       WHERE monitor_id = $2 AND status = 'CONFIRMED_OUTAGE'`,
      [checkedAtIso, monitor.id],
    );
  }

  return {
    probeId,
    monitorId: monitor.id,
    checkedAtIso,
    probeRegion: monitor.probeRegion,
    resolvedIp: probe.resolvedIp,
    outcome: probe.outcome,
    httpStatus: probe.httpStatus,
    responseTimeMs: probe.responseTimeMs,
    tlsValid: probe.tlsValid,
    errorCategory: probe.errorCategory,
    nextMonitorStatus: decision.nextStatus,
    incidentAction: decision.incidentAction,
  };
}
