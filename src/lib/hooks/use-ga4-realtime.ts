"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectGa4RealtimeResponseDto } from "@/lib/reports/ga4-service";

export const DEFAULT_GA4_REALTIME_POLL_MS = 30_000;
export const MIN_GA4_REALTIME_POLL_MS = 15_000;
export const MAX_GA4_REALTIME_BACKOFF_MS = 120_000;

export function computeNextRealtimePollDelayMs(input: {
  baseIntervalMs: number;
  isHidden: boolean;
  isRateLimited: boolean;
  retryAfterSeconds?: number | null;
}): number | null {
  if (input.isHidden) {
    return null;
  }
  const safeBase = Math.max(MIN_GA4_REALTIME_POLL_MS, input.baseIntervalMs);
  if (!input.isRateLimited) {
    return safeBase;
  }
  const retryMs = (input.retryAfterSeconds ?? 45) * 1000;
  return Math.min(MAX_GA4_REALTIME_BACKOFF_MS, Math.max(safeBase * 2, retryMs));
}

export interface UseGa4RealtimeOptions {
  projectId: string | null;
  environmentId?: string | null;
  resourceId?: string | null;
  enabled?: boolean;
  pollIntervalMs?: number;
  initialData?: ProjectGa4RealtimeResponseDto | null;
}

export function useGa4Realtime(options: UseGa4RealtimeOptions) {
  const {
    projectId,
    environmentId,
    resourceId,
    enabled = true,
    pollIntervalMs = DEFAULT_GA4_REALTIME_POLL_MS,
    initialData = null,
  } = options;

  const [data, setData] = useState<ProjectGa4RealtimeResponseDto | null>(initialData);
  const [isLoading, setIsLoading] = useState<boolean>(
    !initialData && Boolean(projectId && enabled),
  );
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isPausedHidden, setIsPausedHidden] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastUpdatedIso, setLastUpdatedIso] = useState<string | null>(
    initialData?.realtime?.observedAtIso ?? null,
  );

  const inFlightRef = useRef<boolean>(false);
  const dataRef = useRef<ProjectGa4RealtimeResponseDto | null>(data);
  dataRef.current = data;

  const fetchRealtime = useCallback(
    async (manualRefresh = false) => {
      if (!projectId || !enabled || inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      setIsRefreshing(true);
      const currentData = dataRef.current;
      if (!currentData) {
        setIsLoading(true);
      }
      setErrorMessage(null);

      try {
        const params = new URLSearchParams();
        if (environmentId) params.set("environmentId", environmentId);
        if (resourceId) params.set("resourceId", resourceId);
        if (manualRefresh) params.set("refresh", "1");

        const query = params.toString();
        const url = `/api/projects/${encodeURIComponent(projectId)}/analytics/realtime${
          query ? `?${query}` : ""
        }`;
        const res = await fetch(url, {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });

        const payload = (await res.json()) as ProjectGa4RealtimeResponseDto & {
          error?: { message?: string };
        };

        if (!res.ok && res.status !== 429) {
          setErrorMessage(
            payload.error?.message ?? "Unable to load GA4 realtime activity right now.",
          );
          return;
        }

        if (res.status === 429 && payload.realtime === null && currentData?.realtime) {
          // Preserve visible last-known data cleanly flagged stale + rate-limited
          const retryAfter = Number.parseInt(res.headers.get("Retry-After") ?? "45", 10) || 45;
          setData({
            ...currentData,
            uxState: "rate_limited",
            message: `GA4 Realtime API quota limit reached; pausing polling for ${retryAfter}s while displaying stale cached reading.`,
            realtime: {
              ...currentData.realtime,
              rateLimited: true,
              retryAfterSeconds: retryAfter,
              stale: true,
            },
          });
          return;
        }

        setData(payload);
        if (payload.realtime?.observedAtIso) {
          setLastUpdatedIso(payload.realtime.observedAtIso);
        } else {
          setLastUpdatedIso(new Date().toISOString());
        }
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : "Network error reading GA4 realtime telemetry.",
        );
      } finally {
        inFlightRef.current = false;
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [enabled, environmentId, projectId, resourceId],
  );

  useEffect(() => {
    if (!projectId || !enabled) {
      return;
    }

    const handleVisibilityChange = () => {
      const hidden = typeof document !== "undefined" ? document.hidden : false;
      setIsPausedHidden(hidden);
      if (!hidden) {
        void fetchRealtime(false);
      }
    };

    const initiallyHidden = typeof document !== "undefined" ? document.hidden : false;
    setIsPausedHidden(initiallyHidden);

    if (!initiallyHidden) {
      void fetchRealtime(false);
    }

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [enabled, fetchRealtime, projectId]);

  useEffect(() => {
    if (!projectId || !enabled) {
      return;
    }

    const delayMs = computeNextRealtimePollDelayMs({
      baseIntervalMs: pollIntervalMs,
      isHidden: isPausedHidden,
      isRateLimited: Boolean(data?.realtime?.rateLimited || data?.uxState === "rate_limited"),
      retryAfterSeconds: data?.realtime?.retryAfterSeconds,
    });

    if (delayMs === null) {
      return;
    }

    const timer = setTimeout(() => {
      void fetchRealtime(false);
    }, delayMs);

    return () => clearTimeout(timer);
  }, [
    data?.realtime?.rateLimited,
    data?.realtime?.retryAfterSeconds,
    data?.uxState,
    enabled,
    fetchRealtime,
    isPausedHidden,
    pollIntervalMs,
    projectId,
  ]);

  return {
    data,
    isLoading,
    isRefreshing,
    isPausedHidden,
    isRateLimited: Boolean(data?.realtime?.rateLimited || data?.uxState === "rate_limited"),
    isStale: Boolean(data?.realtime?.stale || data?.uxState === "stale_cached"),
    retryAfterSeconds: data?.realtime?.retryAfterSeconds ?? null,
    errorMessage,
    lastUpdatedIso,
    refresh: () => fetchRealtime(true),
  };
}
