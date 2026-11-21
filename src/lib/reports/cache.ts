import crypto from "node:crypto";
import type { AvenorUxState, WorkspaceRole } from "@avenor/types";
import type { MetricCompletenessState } from "@/lib/metrics";

export type ReportCacheSurface =
  | "portfolio_overview"
  | "project_control_center"
  | "project_reconciliation"
  | "ga4_report"
  | "gsc_report";

export type ReportCachePolicyTier =
  | "finalized_historical"
  | "recent_standard"
  | "intraday_provisional"
  | "connection_health"
  | "realtime_snapshot";

export type ReportFreshnessState =
  | "FRESH"
  | "RECENTLY_COLLECTED"
  | "STALE"
  | "INCOMPLETE"
  | "PARTIAL"
  | "UNAVAILABLE"
  | "PROVIDER_ERROR"
  | "RATE_LIMITED"
  | "PERMISSION_DENIED"
  | "NOT_SYNCHRONIZED";

export interface ReportCacheKeyInput {
  organizationId: string;
  workspaceId: string;
  projectId?: string | null;
  environmentId?: string | null;
  role: WorkspaceRole;
  surface: ReportCacheSurface;
  startDate: string;
  endDate: string;
  compareEnabled?: boolean;
  filters?: Record<string, unknown>;
  schemaVersion?: number;
}

export interface ReportCachePolicyConfig {
  tier: ReportCachePolicyTier;
  freshTtlMs: number;
  staleFallbackTtlMs: number;
}

export interface ReportFreshnessClassification {
  state: ReportFreshnessState;
  uxState: AvenorUxState;
  badgeLabel: string;
  detailLabel: string;
  ageMinutes: number | null;
  lastSuccessfulSyncIso: string | null;
  lastAttemptedSyncIso: string | null;
  isStaleFallback: boolean;
}

export interface ReportCacheEnvelopeMetadata {
  cacheKeyHash: string;
  cacheStatus: "HIT" | "MISS" | "COALESCED_HIT" | "STALE_FALLBACK" | "BYPASSED";
  policyTier: ReportCachePolicyTier;
  computedAtIso: string;
  expiresAtIso: string;
  staleUntilIso: string;
  ageSeconds: number;
}

export interface SourcePartitionHealthStatus {
  sourceKey: string;
  displayName: string;
  status: "healthy" | "stale_fallback" | "degraded" | "unavailable";
  freshnessState: ReportFreshnessState;
  lastSyncedAtIso: string | null;
  errorCode: string | null;
  safeErrorMessage: string | null;
  latencyMs: number;
}

export interface ResilientReportEnvelope<T> {
  status: "complete" | "partial_success" | "stale_fallback";
  data: T;
  freshness: ReportFreshnessClassification;
  cache: ReportCacheEnvelopeMetadata;
  sources: SourcePartitionHealthStatus[];
  warnings: string[];
}

interface InternalCacheEntry<T> {
  fullKey: string;
  keyHash: string;
  organizationId: string;
  workspaceId: string;
  projectId: string | null;
  environmentId: string | null;
  role: WorkspaceRole;
  surface: ReportCacheSurface;
  policyTier: ReportCachePolicyTier;
  value: T;
  computedAtMs: number;
  computedAtIso: string;
  freshUntilMs: number;
  staleUntilMs: number;
}

function canonicalSortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalSortObject);
  }
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = canonicalSortObject((value as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return value;
}

/**
 * Resolves the differentiated cache TTL policy based on reporting period finality and surface type.
 */
export function resolveReportCachePolicy(input: {
  tier?: ReportCachePolicyTier;
  endDate?: string;
  todayDate?: string;
  yesterdayDate?: string;
}): ReportCachePolicyConfig {
  if (input.tier) {
    switch (input.tier) {
      case "finalized_historical":
        return {
          tier: "finalized_historical",
          freshTtlMs: 15 * 60_000,
          staleFallbackTtlMs: 60 * 60_000,
        };
      case "recent_standard":
        return {
          tier: "recent_standard",
          freshTtlMs: 5 * 60_000,
          staleFallbackTtlMs: 30 * 60_000,
        };
      case "intraday_provisional":
        return {
          tier: "intraday_provisional",
          freshTtlMs: 60_000,
          staleFallbackTtlMs: 10 * 60_000,
        };
      case "connection_health":
        return {
          tier: "connection_health",
          freshTtlMs: 30_000,
          staleFallbackTtlMs: 5 * 60_000,
        };
      case "realtime_snapshot":
        return {
          tier: "realtime_snapshot",
          freshTtlMs: 15_000,
          staleFallbackTtlMs: 60_000,
        };
    }
  }

  const today = input.todayDate ?? new Date().toISOString().slice(0, 10);
  const yesterday =
    input.yesterdayDate ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  if (input.endDate && input.endDate >= today) {
    return {
      tier: "intraday_provisional",
      freshTtlMs: 60_000,
      staleFallbackTtlMs: 10 * 60_000,
    };
  }

  if (input.endDate && input.endDate < yesterday) {
    return {
      tier: "finalized_historical",
      freshTtlMs: 15 * 60_000,
      staleFallbackTtlMs: 60 * 60_000,
    };
  }

  return {
    tier: "recent_standard",
    freshTtlMs: 5 * 60_000,
    staleFallbackTtlMs: 30 * 60_000,
  };
}

/**
 * Builds a collision-resistant, strictly tenant-and-role-scoped cache key.
 * Rejects any key missing `organizationId` or `workspaceId`.
 */
export function buildTenantReportCacheKey(input: ReportCacheKeyInput): {
  fullKey: string;
  keyHash: string;
} {
  const orgId = input.organizationId?.trim();
  const wksId = input.workspaceId?.trim();
  if (!orgId || !wksId) {
    throw new Error(
      "Report cache key requires non-empty organizationId and workspaceId to guarantee tenant isolation.",
    );
  }

  const filterDigest = crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalSortObject(input.filters ?? {})), "utf8")
    .digest("hex")
    .slice(0, 24);

  const fullKey = [
    `v${input.schemaVersion ?? 1}`,
    `org:${orgId}`,
    `wks:${wksId}`,
    `prj:${input.projectId ?? "_"}`,
    `env:${input.environmentId ?? "_"}`,
    `role:${input.role}`,
    `surface:${input.surface}`,
    `win:${input.startDate}..${input.endDate}`,
    `cmp:${input.compareEnabled ? "1" : "0"}`,
    `flt:${filterDigest}`,
  ].join("::");

  const keyHash = crypto.createHash("sha256").update(fullKey, "utf8").digest("hex").slice(0, 20);
  return { fullKey, keyHash };
}

/**
 * Classifies reporting freshness honestly based on actual collection timestamps, watermark state,
 * and completeness flags. Never labels database-cached observations as "Live".
 */
export function classifyReportDataFreshness(input: {
  lastSuccessfulSyncIso?: string | null;
  lastAttemptedSyncIso?: string | null;
  completenessState?: MetricCompletenessState | null;
  syncState?: string | null;
  connectionStatus?: string | null;
  freshnessWindowMinutes?: number;
  isStaleFallback?: boolean;
  hasPartialSourceFailure?: boolean;
  now?: Date;
}): ReportFreshnessClassification {
  const nowMs = (input.now ?? new Date()).getTime();
  const lastSyncIso = input.lastSuccessfulSyncIso ?? null;
  const lastAttemptIso = input.lastAttemptedSyncIso ?? lastSyncIso;
  const freshnessWindowMinutes = input.freshnessWindowMinutes ?? 360;

  const ageMinutes =
    lastSyncIso && Number.isFinite(Date.parse(lastSyncIso))
      ? Math.max(0, Math.round((nowMs - Date.parse(lastSyncIso)) / 60_000))
      : null;

  if (
    input.connectionStatus === "PERMISSION_MISSING" ||
    input.connectionStatus === "TOKEN_EXPIRED" ||
    input.connectionStatus === "REVOKED" ||
    input.syncState === "CONNECTION_REVOKED"
  ) {
    return {
      state: "PERMISSION_DENIED",
      uxState: "permission_insufficient",
      badgeLabel: "Authorization required",
      detailLabel: lastSyncIso
        ? `Source authorization expired or revoked; showing last collected snapshot (${ageMinutes ?? 0}m old)`
        : "Source authorization expired or revoked",
      ageMinutes,
      lastSuccessfulSyncIso: lastSyncIso,
      lastAttemptedSyncIso: lastAttemptIso,
      isStaleFallback: Boolean(input.isStaleFallback),
    };
  }

  if (input.connectionStatus === "RATE_LIMITED" || input.syncState === "RATE_LIMITED") {
    return {
      state: "RATE_LIMITED",
      uxState: "rate_limited",
      badgeLabel: "Rate-limited backoff",
      detailLabel: lastSyncIso
        ? `Provider quota cooldown active; serving stored observations collected ${ageMinutes ?? 0}m ago`
        : "Provider quota cooldown active",
      ageMinutes,
      lastSuccessfulSyncIso: lastSyncIso,
      lastAttemptedSyncIso: lastAttemptIso,
      isStaleFallback: true,
    };
  }

  if (input.hasPartialSourceFailure) {
    return {
      state: "PARTIAL",
      uxState: "partial_coverage",
      badgeLabel: "Partial source coverage",
      detailLabel:
        "One or more connected sources returned a transient error; unaffected sources remain available.",
      ageMinutes,
      lastSuccessfulSyncIso: lastSyncIso,
      lastAttemptedSyncIso: lastAttemptIso,
      isStaleFallback: Boolean(input.isStaleFallback),
    };
  }

  if (input.connectionStatus === "FAILED" || input.syncState === "FAILED") {
    return {
      state: input.isStaleFallback && lastSyncIso ? "STALE" : "PROVIDER_ERROR",
      uxState: input.isStaleFallback && lastSyncIso ? "stale_cached" : "provider_error",
      badgeLabel:
        input.isStaleFallback && lastSyncIso ? "Stale cached fallback" : "Source sync error",
      detailLabel: lastSyncIso
        ? `Last sync attempt failed; displaying stored observations from ${ageMinutes ?? 0}m ago`
        : "Source synchronization failed with no stored observations yet",
      ageMinutes,
      lastSuccessfulSyncIso: lastSyncIso,
      lastAttemptedSyncIso: lastAttemptIso,
      isStaleFallback: Boolean(input.isStaleFallback),
    };
  }

  if (!lastSyncIso) {
    return {
      state: "NOT_SYNCHRONIZED",
      uxState: "empty_first_use",
      badgeLabel: "Not yet synchronized",
      detailLabel: "No historical observations have been committed for this scope yet.",
      ageMinutes: null,
      lastSuccessfulSyncIso: null,
      lastAttemptedSyncIso: lastAttemptIso,
      isStaleFallback: false,
    };
  }

  if (input.isStaleFallback) {
    return {
      state: "STALE",
      uxState: "stale_cached",
      badgeLabel: `Stale snapshot (${ageMinutes ?? 0}m ago)`,
      detailLabel: `Serving cached snapshot collected at ${lastSyncIso.slice(0, 16).replace("T", " ")} UTC`,
      ageMinutes,
      lastSuccessfulSyncIso: lastSyncIso,
      lastAttemptedSyncIso: lastAttemptIso,
      isStaleFallback: true,
    };
  }

  if (
    input.completenessState === "PROVISIONAL" ||
    input.completenessState === "PARTIAL" ||
    input.completenessState === "SAMPLED" ||
    input.completenessState === "THRESHOLDED"
  ) {
    return {
      state: "INCOMPLETE",
      uxState: "partial_coverage",
      badgeLabel: `Provisional (${ageMinutes ?? 0}m ago)`,
      detailLabel: `Collected ${ageMinutes ?? 0}m ago; period remains within provider finalization or sampling window (${input.completenessState}).`,
      ageMinutes,
      lastSuccessfulSyncIso: lastSyncIso,
      lastAttemptedSyncIso: lastAttemptIso,
      isStaleFallback: false,
    };
  }

  if (ageMinutes !== null && ageMinutes <= 60) {
    return {
      state: "FRESH",
      uxState: "connected_healthy",
      badgeLabel: ageMinutes <= 2 ? "Collected <2m ago" : `Collected ${ageMinutes}m ago`,
      detailLabel: `Synchronized at ${lastSyncIso.slice(0, 16).replace("T", " ")} UTC`,
      ageMinutes,
      lastSuccessfulSyncIso: lastSyncIso,
      lastAttemptedSyncIso: lastAttemptIso,
      isStaleFallback: false,
    };
  }

  if (ageMinutes !== null && ageMinutes <= freshnessWindowMinutes) {
    return {
      state: "RECENTLY_COLLECTED",
      uxState: "connected_healthy",
      badgeLabel: `Collected ${Math.round(ageMinutes / 60)}h ago`,
      detailLabel: `Within expected ${Math.round(freshnessWindowMinutes / 60)}h refresh cadence (${lastSyncIso.slice(0, 16).replace("T", " ")} UTC)`,
      ageMinutes,
      lastSuccessfulSyncIso: lastSyncIso,
      lastAttemptedSyncIso: lastAttemptIso,
      isStaleFallback: false,
    };
  }

  return {
    state: "STALE",
    uxState: "stale_cached",
    badgeLabel:
      ageMinutes !== null && ageMinutes >= 120
        ? `Stale (${Math.round(ageMinutes / 60)}h old)`
        : `Stale (${ageMinutes ?? 0}m old)`,
    detailLabel: `Last successful sync at ${lastSyncIso.slice(0, 16).replace("T", " ")} UTC exceeds ${Math.round(freshnessWindowMinutes / 60)}h freshness target.`,
    ageMinutes,
    lastSuccessfulSyncIso: lastSyncIso,
    lastAttemptedSyncIso: lastAttemptIso,
    isStaleFallback: false,
  };
}

export interface ReportCacheStatsSnapshot {
  size: number;
  hits: number;
  misses: number;
  coalescedHits: number;
  staleFallbacks: number;
  invalidations: number;
  hitRate: number;
}

/**
 * Tenant-isolated report cache with differentiated TTL policies, stale-on-error fallback,
 * concurrent stampede coalescing, and surgical workspace/project invalidation.
 */
export class TenantScopedReportCache {
  private readonly entries = new Map<string, InternalCacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly maxEntries: number;

  private hits = 0;
  private misses = 0;
  private coalescedHits = 0;
  private staleFallbacks = 0;
  private invalidations = 0;

  constructor(maxEntries = 600) {
    this.maxEntries = maxEntries;
  }

  public get<T>(
    keyInput: ReportCacheKeyInput,
    options?: { allowStale?: boolean; nowMs?: number },
  ): {
    value: T;
    metadata: ReportCacheEnvelopeMetadata;
  } | null {
    const { fullKey, keyHash } = buildTenantReportCacheKey(keyInput);
    const entry = this.entries.get(fullKey);
    if (!entry) {
      this.misses += 1;
      return null;
    }

    // Strict defense-in-depth tenant assertion
    if (
      entry.organizationId !== keyInput.organizationId ||
      entry.workspaceId !== keyInput.workspaceId
    ) {
      this.entries.delete(fullKey);
      this.misses += 1;
      return null;
    }

    const nowMs = options?.nowMs ?? Date.now();
    const isFresh = nowMs < entry.freshUntilMs;
    const isWithinStaleWindow = nowMs < entry.staleUntilMs;

    if (!isFresh && !(options?.allowStale && isWithinStaleWindow)) {
      if (!isWithinStaleWindow) {
        this.entries.delete(fullKey);
      }
      this.misses += 1;
      return null;
    }

    // Refresh LRU order
    this.entries.delete(fullKey);
    this.entries.set(fullKey, entry);

    if (isFresh) {
      this.hits += 1;
    } else {
      this.staleFallbacks += 1;
    }

    return {
      value: entry.value as T,
      metadata: {
        cacheKeyHash: keyHash,
        cacheStatus: isFresh ? "HIT" : "STALE_FALLBACK",
        policyTier: entry.policyTier,
        computedAtIso: entry.computedAtIso,
        expiresAtIso: new Date(entry.freshUntilMs).toISOString(),
        staleUntilIso: new Date(entry.staleUntilMs).toISOString(),
        ageSeconds: Math.max(0, Math.round((nowMs - entry.computedAtMs) / 1000)),
      },
    };
  }

  public set<T>(
    keyInput: ReportCacheKeyInput,
    value: T,
    policy?: ReportCachePolicyConfig,
    nowMs = Date.now(),
  ): ReportCacheEnvelopeMetadata {
    const { fullKey, keyHash } = buildTenantReportCacheKey(keyInput);
    const resolvedPolicy =
      policy ??
      resolveReportCachePolicy({
        endDate: keyInput.endDate,
      });

    if (this.entries.size >= this.maxEntries && !this.entries.has(fullKey)) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey) {
        this.entries.delete(oldestKey);
      }
    }

    const computedAtIso = new Date(nowMs).toISOString();
    const freshUntilMs = nowMs + Math.max(1000, resolvedPolicy.freshTtlMs);
    const staleUntilMs =
      nowMs + Math.max(resolvedPolicy.freshTtlMs, resolvedPolicy.staleFallbackTtlMs);

    this.entries.set(fullKey, {
      fullKey,
      keyHash,
      organizationId: keyInput.organizationId,
      workspaceId: keyInput.workspaceId,
      projectId: keyInput.projectId ?? null,
      environmentId: keyInput.environmentId ?? null,
      role: keyInput.role,
      surface: keyInput.surface,
      policyTier: resolvedPolicy.tier,
      value,
      computedAtMs: nowMs,
      computedAtIso,
      freshUntilMs,
      staleUntilMs,
    });

    return {
      cacheKeyHash: keyHash,
      cacheStatus: "MISS",
      policyTier: resolvedPolicy.tier,
      computedAtIso,
      expiresAtIso: new Date(freshUntilMs).toISOString(),
      staleUntilIso: new Date(staleUntilMs).toISOString(),
      ageSeconds: 0,
    };
  }

  /**
   * Executes `loader` with cache lookup, stampede coalescing for concurrent identical requests,
   * and automatic stale-snapshot fallback if the loader throws a transient error.
   */
  public async getOrLoad<T>(
    keyInput: ReportCacheKeyInput,
    loader: () => Promise<T>,
    options?: {
      policy?: ReportCachePolicyConfig;
      bypassCache?: boolean;
      nowMs?: number;
    },
  ): Promise<{
    value: T;
    metadata: ReportCacheEnvelopeMetadata;
  }> {
    const nowMs = options?.nowMs ?? Date.now();
    const { fullKey, keyHash } = buildTenantReportCacheKey(keyInput);
    const resolvedPolicy =
      options?.policy ?? resolveReportCachePolicy({ endDate: keyInput.endDate });

    if (!options?.bypassCache) {
      const freshHit = this.get<T>(keyInput, { allowStale: false, nowMs });
      if (freshHit) {
        return freshHit;
      }

      const existingPromise = this.inFlight.get(fullKey) as Promise<T> | undefined;
      if (existingPromise) {
        this.coalescedHits += 1;
        const coalescedValue = await existingPromise;
        return {
          value: coalescedValue,
          metadata: {
            cacheKeyHash: keyHash,
            cacheStatus: "COALESCED_HIT",
            policyTier: resolvedPolicy.tier,
            computedAtIso: new Date(nowMs).toISOString(),
            expiresAtIso: new Date(nowMs + resolvedPolicy.freshTtlMs).toISOString(),
            staleUntilIso: new Date(nowMs + resolvedPolicy.staleFallbackTtlMs).toISOString(),
            ageSeconds: 0,
          },
        };
      }
    }

    const loadPromise = loader();
    this.inFlight.set(fullKey, loadPromise);

    try {
      const freshValue = await loadPromise;
      const meta = this.set(keyInput, freshValue, resolvedPolicy, nowMs);
      return {
        value: freshValue,
        metadata: options?.bypassCache ? { ...meta, cacheStatus: "BYPASSED" } : meta,
      };
    } catch (error) {
      const staleFallback = this.get<T>(keyInput, { allowStale: true, nowMs });
      if (staleFallback) {
        return staleFallback;
      }
      throw error;
    } finally {
      this.inFlight.delete(fullKey);
    }
  }

  /**
   * Invalidates all cached project reports AND parent workspace portfolio rollups
   * whenever observations, mappings, or sync watermarks change for a project.
   */
  public invalidateProject(organizationId: string, workspaceId: string, projectId: string): number {
    let removed = 0;
    for (const [key, entry] of this.entries.entries()) {
      if (
        entry.organizationId === organizationId &&
        entry.workspaceId === workspaceId &&
        (entry.projectId === projectId || entry.surface === "portfolio_overview")
      ) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    this.invalidations += removed;
    return removed;
  }

  /**
   * Invalidates all cached reports for a specific workspace (e.g., on connection disconnect,
   * permission change, or membership update) without touching other organizations or workspaces.
   */
  public invalidateWorkspace(organizationId: string, workspaceId: string): number {
    let removed = 0;
    for (const [key, entry] of this.entries.entries()) {
      if (entry.organizationId === organizationId && entry.workspaceId === workspaceId) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    this.invalidations += removed;
    return removed;
  }

  public getStats(): ReportCacheStatsSnapshot {
    const totalLookups = this.hits + this.coalescedHits + this.staleFallbacks + this.misses;
    const hitCount = this.hits + this.coalescedHits;
    return {
      size: this.entries.size,
      hits: this.hits,
      misses: this.misses,
      coalescedHits: this.coalescedHits,
      staleFallbacks: this.staleFallbacks,
      invalidations: this.invalidations,
      hitRate: totalLookups > 0 ? Number((hitCount / totalLookups).toFixed(4)) : 0,
    };
  }

  public clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }
}

export const sharedReportCache = new TenantScopedReportCache(600);

export interface ResilientSourceTask<T> {
  sourceKey: string;
  displayName: string;
  timeoutMs?: number;
  lastSyncedAtIso?: string | null;
  execute: () => Promise<T>;
  fallbackValue: T;
}

/**
 * Executes multiple source partitions concurrently with per-source timeout and error isolation.
 * A failure or timeout in one source (e.g. Search Console) never crashes or blocks healthy
 * metrics from another source (e.g. GA4).
 */
export async function executeResilientMultiSourcePartitions<TMap extends Record<string, unknown>>(
  tasks: {
    [K in keyof TMap]: ResilientSourceTask<TMap[K]>;
  },
): Promise<{
  results: TMap;
  sources: SourcePartitionHealthStatus[];
  hasDegradedSource: boolean;
  warnings: string[];
}> {
  const keys = Object.keys(tasks) as Array<keyof TMap>;
  const results = {} as TMap;
  const sources: SourcePartitionHealthStatus[] = [];
  const warnings: string[] = [];
  let hasDegradedSource = false;

  await Promise.all(
    keys.map(async (key) => {
      const task = tasks[key];
      const timeoutMs = task.timeoutMs ?? 8000;
      const startedAt = Date.now();

      try {
        const value = await withBoundedTimeout(task.execute(), timeoutMs, task.displayName);
        const latencyMs = Date.now() - startedAt;
        results[key] = value;
        const freshness = classifyReportDataFreshness({
          lastSuccessfulSyncIso: task.lastSyncedAtIso ?? new Date().toISOString(),
        });
        sources.push({
          sourceKey: task.sourceKey,
          displayName: task.displayName,
          status: "healthy",
          freshnessState: freshness.state,
          lastSyncedAtIso: task.lastSyncedAtIso ?? null,
          errorCode: null,
          safeErrorMessage: null,
          latencyMs,
        });
      } catch (err) {
        const latencyMs = Date.now() - startedAt;
        hasDegradedSource = true;
        results[key] = task.fallbackValue;
        const rawMsg = err instanceof Error ? err.message : "Source unavailable";
        const safeMsg = sanitizeErrorSummary(rawMsg);
        const isTimeout = /timed out/i.test(safeMsg);
        warnings.push(`${task.displayName}: ${safeMsg}`);
        sources.push({
          sourceKey: task.sourceKey,
          displayName: task.displayName,
          status: "degraded",
          freshnessState: "PROVIDER_ERROR",
          lastSyncedAtIso: task.lastSyncedAtIso ?? null,
          errorCode: isTimeout ? "SOURCE_TIMEOUT" : "SOURCE_UNAVAILABLE",
          safeErrorMessage: safeMsg,
          latencyMs,
        });
      }
    }),
  );

  return {
    results,
    sources,
    hasDegradedSource,
    warnings,
  };
}

async function withBoundedTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} query timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function sanitizeErrorSummary(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]")
    .replace(/ya29\.[A-Za-z0-9\-._]+/g, "[REDACTED_TOKEN]")
    .slice(0, 240);
}

/**
 * Standard private HTTP cache headers for authenticated tenant report responses
 * so browser/CDN intermediaries never share authenticated tenant payloads across sessions.
 */
export function buildAuthenticatedReportResponseHeaders(
  cacheMeta?: ReportCacheEnvelopeMetadata,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Cache-Control": "private, no-store, max-age=0, must-revalidate",
    Pragma: "no-cache",
    Vary: "Cookie, Authorization",
  };
  if (cacheMeta) {
    headers["X-Avenor-Cache-Status"] = cacheMeta.cacheStatus;
    headers["X-Avenor-Cache-Tier"] = cacheMeta.policyTier;
    headers["X-Avenor-Cache-Key"] = cacheMeta.cacheKeyHash;
  }
  return headers;
}
