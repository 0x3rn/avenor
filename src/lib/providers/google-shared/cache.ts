import crypto from "node:crypto";

export interface TelemetryCacheKeyParts {
  organizationId: string;
  workspaceId: string;
  projectId?: string | null;
  connectionId: string;
  providerKey: string;
  externalResourceId: string;
  operation: string;
  params: Record<string, unknown>;
}

interface CachedTelemetryEntry<T> {
  key: string;
  organizationId: string;
  workspaceId: string;
  connectionId: string;
  providerKey: string;
  value: T;
  fetchedAtIso: string;
  expiresAtMs: number;
}

/**
 * Bounded, strictly tenant-and-connection-isolated telemetry cache to protect Google API quotas.
 * Never shares cache entries across organizations, workspaces, projects, or connections.
 */
export class ScopedTelemetryCache {
  private readonly entries = new Map<string, CachedTelemetryEntry<unknown>>();
  private readonly maxEntries: number;

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }

  public static buildKey(parts: TelemetryCacheKeyParts): string {
    const stableParams = JSON.stringify(sortObjectKeys(parts.params));
    const paramsDigest = crypto
      .createHash("sha256")
      .update(stableParams)
      .digest("hex")
      .slice(0, 24);
    return [
      parts.organizationId,
      parts.workspaceId,
      parts.projectId ?? "_",
      parts.connectionId,
      parts.providerKey,
      parts.externalResourceId,
      parts.operation,
      paramsDigest,
    ].join("::");
  }

  public get<T>(parts: TelemetryCacheKeyParts): {
    value: T;
    fetchedAtIso: string;
    expiresAtIso: string;
  } | null {
    const key = ScopedTelemetryCache.buildKey(parts);
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() >= entry.expiresAtMs) {
      this.entries.delete(key);
      return null;
    }

    // LRU refresh
    this.entries.delete(key);
    this.entries.set(key, entry);

    return {
      value: entry.value as T,
      fetchedAtIso: entry.fetchedAtIso,
      expiresAtIso: new Date(entry.expiresAtMs).toISOString(),
    };
  }

  public set<T>(
    parts: TelemetryCacheKeyParts,
    value: T,
    ttlMs: number,
  ): {
    fetchedAtIso: string;
    expiresAtIso: string;
  } {
    const key = ScopedTelemetryCache.buildKey(parts);
    const nowMs = Date.now();
    const fetchedAtIso = new Date(nowMs).toISOString();
    const expiresAtMs = nowMs + Math.max(1000, ttlMs);

    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey) {
        this.entries.delete(oldestKey);
      }
    }

    this.entries.set(key, {
      key,
      organizationId: parts.organizationId,
      workspaceId: parts.workspaceId,
      connectionId: parts.connectionId,
      providerKey: parts.providerKey,
      value,
      fetchedAtIso,
      expiresAtMs,
    });

    return {
      fetchedAtIso,
      expiresAtIso: new Date(expiresAtMs).toISOString(),
    };
  }

  public invalidateConnection(
    organizationId: string,
    workspaceId: string,
    connectionId: string,
  ): number {
    let removed = 0;
    for (const [key, entry] of this.entries.entries()) {
      if (
        entry.organizationId === organizationId &&
        entry.workspaceId === workspaceId &&
        entry.connectionId === connectionId
      ) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  public invalidateWorkspace(organizationId: string, workspaceId: string): number {
    let removed = 0;
    for (const [key, entry] of this.entries.entries()) {
      if (entry.organizationId === organizationId && entry.workspaceId === workspaceId) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  public clear(): void {
    this.entries.clear();
  }

  public get size(): number {
    return this.entries.size;
  }
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortObjectKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export const sharedGoogleTelemetryCache = new ScopedTelemetryCache(500);
