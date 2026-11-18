import type { Ga4StandardReportBundle } from "@/lib/providers/google-analytics/types";
import {
  GSC_MAX_FINAL_LAG_HOURS,
  GSC_MIN_FINAL_LAG_HOURS,
  GSC_REPORTING_TIMEZONE,
  type GscSearchAnalyticsBundle,
} from "@/lib/providers/google-search-console/types";
import {
  computeDimensionIdentity,
  computeQueryFingerprint,
  DEFAULT_MAX_CARDINALITY_ROWS_PER_SYNC,
  enforceDimensionCardinalityLimit,
} from "./dimensions";
import { getCanonicalMetricDefinition } from "./registry";
import { isDateWithinRecentLagWindow } from "./time";
import type {
  CanonicalDataQualityFlags,
  CanonicalMetricObservationInput,
  MetricCompletenessState,
} from "./types";

export interface ObservationNormalizationScope {
  organizationId: string;
  workspaceId: string;
  projectId: string | null;
  environmentId: string | null;
  providerConnectionId: string;
  connectedResourceId: string;
  ingestionRunId?: string | null;
  collectedAt?: Date;
  referenceNow?: Date;
  maxBreakdownRows?: number;
}

function resolveGa4CompletenessState(
  bundle: Ga4StandardReportBundle,
  periodEndDate: string,
  referenceNow?: Date,
): MetricCompletenessState {
  if (bundle.dataQuality.isSampled) {
    return "SAMPLED";
  }
  if (bundle.dataQuality.isThresholded) {
    return "THRESHOLDED";
  }
  if (bundle.dataQuality.hasOtherRowTruncation) {
    return "TRUNCATED";
  }
  const isProvisional = isDateWithinRecentLagWindow({
    periodEndDate,
    reportingTimezone: bundle.reportingTimeZone,
    lagDays: 1,
    referenceNow,
  });
  return isProvisional ? "PROVISIONAL" : "COMPLETE";
}

function resolveGscCompletenessState(
  bundle: GscSearchAnalyticsBundle,
  periodEndDate: string,
): MetricCompletenessState {
  if (bundle.dataState === "all" || bundle.coverage.hasPreliminaryDatesInWindow) {
    return "PROVISIONAL";
  }
  if (bundle.coverage.privacyAnonymizedPossible || bundle.coverage.isTopRowLimited) {
    return "PARTIAL";
  }
  if (periodEndDate > bundle.coverage.finalDataCutoffDate) {
    return "PROVISIONAL";
  }
  return "COMPLETE";
}

/**
 * Converts a normalized GA4 standard report bundle into canonical time-series and window-total
 * observation inputs with explicit numerator/denominator weights and data-quality provenance.
 */
export function normalizeGa4ReportBundleToObservations(
  bundle: Ga4StandardReportBundle,
  scope: ObservationNormalizationScope,
): CanonicalMetricObservationInput[] {
  const observations: CanonicalMetricObservationInput[] = [];
  const collectedAt = scope.collectedAt ?? new Date();
  const maxRows = scope.maxBreakdownRows ?? DEFAULT_MAX_CARDINALITY_ROWS_PER_SYNC;

  const baseQualityFlags: CanonicalDataQualityFlags = {
    isSampled: bundle.dataQuality.isSampled,
    samplingReadPercent: bundle.dataQuality.samplingRatePct,
    isThresholded: bundle.dataQuality.isThresholded,
    hasOtherRowTruncation: bundle.dataQuality.hasOtherRowTruncation,
    notes: bundle.dataQuality.notices,
  };

  const windowCompleteness = resolveGa4CompletenessState(
    bundle,
    bundle.endDate,
    scope.referenceNow,
  );
  const windowFingerprint = computeQueryFingerprint({
    providerKey: "ga4",
    externalResourceId: bundle.propertyName,
    queryScope: "standard_window_totals",
  });

  const pushMetric = (params: {
    canonicalMetricKey: string;
    granularity: "DAILY" | "WINDOW_TOTAL";
    periodStartDate: string;
    periodEndDate: string;
    dimensions?: Record<string, string>;
    queryFingerprint: string;
    numericValue: number | null;
    numeratorValue?: number | null;
    denominatorValue?: number | null;
    completenessState: MetricCompletenessState;
  }) => {
    const def = getCanonicalMetricDefinition(params.canonicalMetricKey);
    const dimIdentity = computeDimensionIdentity(params.dimensions, {
      allowedDimensions: def.supportedDimensions,
    });

    observations.push({
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      environmentId: scope.environmentId,
      providerConnectionId: scope.providerConnectionId,
      connectedResourceId: scope.connectedResourceId,
      providerKey: "ga4",
      externalResourceId: bundle.propertyName,
      canonicalMetricKey: def.canonicalKey,
      providerMetricName: def.providerMetricName,
      metricDefinitionVersion: def.schemaVersion,
      granularity: params.granularity,
      periodStartDate: params.periodStartDate,
      periodEndDate: params.periodEndDate,
      reportingTimezone: bundle.reportingTimeZone,
      dimensions: dimIdentity.dimensions,
      queryFingerprint: params.queryFingerprint,
      unit: def.unit,
      currency: bundle.currencyCode ?? null,
      numericValue: params.numericValue,
      numeratorValue: params.numeratorValue ?? null,
      denominatorValue: params.denominatorValue ?? null,
      completenessState: params.completenessState,
      dataQualityFlags: baseQualityFlags,
      collectedAt,
      ingestionRunId: scope.ingestionRunId ?? null,
    });
  };

  // 1. Property-wide WINDOW_TOTAL observations (preserving RESERVED_TOTAL deduplicated users)
  const totals = bundle.totals;
  const totalSessions = totals.sessions;
  const totalEngaged = totals.engagedSessions;
  const totalDurationWeighted =
    totals.averageSessionDuration !== null && totalSessions !== null
      ? totals.averageSessionDuration * totalSessions
      : null;

  pushMetric({
    canonicalMetricKey: "ga4.active_users",
    granularity: "WINDOW_TOTAL",
    periodStartDate: bundle.startDate,
    periodEndDate: bundle.endDate,
    queryFingerprint: windowFingerprint,
    numericValue: totals.activeUsers,
    completenessState: windowCompleteness,
  });
  pushMetric({
    canonicalMetricKey: "ga4.total_users",
    granularity: "WINDOW_TOTAL",
    periodStartDate: bundle.startDate,
    periodEndDate: bundle.endDate,
    queryFingerprint: windowFingerprint,
    numericValue: totals.totalUsers,
    completenessState: windowCompleteness,
  });
  pushMetric({
    canonicalMetricKey: "ga4.new_users",
    granularity: "WINDOW_TOTAL",
    periodStartDate: bundle.startDate,
    periodEndDate: bundle.endDate,
    queryFingerprint: windowFingerprint,
    numericValue: totals.newUsers,
    completenessState: windowCompleteness,
  });
  pushMetric({
    canonicalMetricKey: "ga4.sessions",
    granularity: "WINDOW_TOTAL",
    periodStartDate: bundle.startDate,
    periodEndDate: bundle.endDate,
    queryFingerprint: windowFingerprint,
    numericValue: totals.sessions,
    completenessState: windowCompleteness,
  });
  pushMetric({
    canonicalMetricKey: "ga4.engaged_sessions",
    granularity: "WINDOW_TOTAL",
    periodStartDate: bundle.startDate,
    periodEndDate: bundle.endDate,
    queryFingerprint: windowFingerprint,
    numericValue: totals.engagedSessions,
    completenessState: windowCompleteness,
  });
  pushMetric({
    canonicalMetricKey: "ga4.engagement_rate",
    granularity: "WINDOW_TOTAL",
    periodStartDate: bundle.startDate,
    periodEndDate: bundle.endDate,
    queryFingerprint: windowFingerprint,
    numericValue: totals.engagementRate,
    numeratorValue: totalEngaged,
    denominatorValue: totalSessions,
    completenessState: windowCompleteness,
  });
  pushMetric({
    canonicalMetricKey: "ga4.screen_page_views",
    granularity: "WINDOW_TOTAL",
    periodStartDate: bundle.startDate,
    periodEndDate: bundle.endDate,
    queryFingerprint: windowFingerprint,
    numericValue: totals.screenPageViews,
    completenessState: windowCompleteness,
  });
  pushMetric({
    canonicalMetricKey: "ga4.event_count",
    granularity: "WINDOW_TOTAL",
    periodStartDate: bundle.startDate,
    periodEndDate: bundle.endDate,
    queryFingerprint: windowFingerprint,
    numericValue: totals.eventCount,
    completenessState: windowCompleteness,
  });
  pushMetric({
    canonicalMetricKey: "ga4.average_session_duration",
    granularity: "WINDOW_TOTAL",
    periodStartDate: bundle.startDate,
    periodEndDate: bundle.endDate,
    queryFingerprint: windowFingerprint,
    numericValue: totals.averageSessionDuration,
    numeratorValue: totalDurationWeighted,
    denominatorValue: totalSessions,
    completenessState: windowCompleteness,
  });
  pushMetric({
    canonicalMetricKey: "ga4.key_events",
    granularity: "WINDOW_TOTAL",
    periodStartDate: bundle.startDate,
    periodEndDate: bundle.endDate,
    queryFingerprint: windowFingerprint,
    numericValue: totals.keyEvents,
    completenessState: windowCompleteness,
  });

  // 2. Daily series observations (DAILY granularity)
  const dailyFingerprint = computeQueryFingerprint({
    providerKey: "ga4",
    externalResourceId: bundle.propertyName,
    queryScope: "standard_daily_series",
  });

  for (const point of bundle.dailySeries) {
    const dayCompleteness = resolveGa4CompletenessState(bundle, point.date, scope.referenceNow);
    const daySessions = point.sessions;
    const dayEngaged = point.engagedSessions;
    const dayDurationNumerator =
      point.averageSessionDuration !== null && daySessions !== null
        ? point.averageSessionDuration * daySessions
        : null;

    pushMetric({
      canonicalMetricKey: "ga4.active_users",
      granularity: "DAILY",
      periodStartDate: point.date,
      periodEndDate: point.date,
      queryFingerprint: dailyFingerprint,
      numericValue: point.activeUsers,
      completenessState: dayCompleteness,
    });
    pushMetric({
      canonicalMetricKey: "ga4.total_users",
      granularity: "DAILY",
      periodStartDate: point.date,
      periodEndDate: point.date,
      queryFingerprint: dailyFingerprint,
      numericValue: point.totalUsers,
      completenessState: dayCompleteness,
    });
    pushMetric({
      canonicalMetricKey: "ga4.new_users",
      granularity: "DAILY",
      periodStartDate: point.date,
      periodEndDate: point.date,
      queryFingerprint: dailyFingerprint,
      numericValue: point.newUsers,
      completenessState: dayCompleteness,
    });
    pushMetric({
      canonicalMetricKey: "ga4.sessions",
      granularity: "DAILY",
      periodStartDate: point.date,
      periodEndDate: point.date,
      queryFingerprint: dailyFingerprint,
      numericValue: point.sessions,
      completenessState: dayCompleteness,
    });
    pushMetric({
      canonicalMetricKey: "ga4.engaged_sessions",
      granularity: "DAILY",
      periodStartDate: point.date,
      periodEndDate: point.date,
      queryFingerprint: dailyFingerprint,
      numericValue: point.engagedSessions,
      completenessState: dayCompleteness,
    });
    pushMetric({
      canonicalMetricKey: "ga4.engagement_rate",
      granularity: "DAILY",
      periodStartDate: point.date,
      periodEndDate: point.date,
      queryFingerprint: dailyFingerprint,
      numericValue: point.engagementRate,
      numeratorValue: dayEngaged,
      denominatorValue: daySessions,
      completenessState: dayCompleteness,
    });
    pushMetric({
      canonicalMetricKey: "ga4.screen_page_views",
      granularity: "DAILY",
      periodStartDate: point.date,
      periodEndDate: point.date,
      queryFingerprint: dailyFingerprint,
      numericValue: point.screenPageViews,
      completenessState: dayCompleteness,
    });
    pushMetric({
      canonicalMetricKey: "ga4.event_count",
      granularity: "DAILY",
      periodStartDate: point.date,
      periodEndDate: point.date,
      queryFingerprint: dailyFingerprint,
      numericValue: point.eventCount,
      completenessState: dayCompleteness,
    });
    pushMetric({
      canonicalMetricKey: "ga4.average_session_duration",
      granularity: "DAILY",
      periodStartDate: point.date,
      periodEndDate: point.date,
      queryFingerprint: dailyFingerprint,
      numericValue: point.averageSessionDuration,
      numeratorValue: dayDurationNumerator,
      denominatorValue: daySessions,
      completenessState: dayCompleteness,
    });
    pushMetric({
      canonicalMetricKey: "ga4.key_events",
      granularity: "DAILY",
      periodStartDate: point.date,
      periodEndDate: point.date,
      queryFingerprint: dailyFingerprint,
      numericValue: point.keyEvents,
      completenessState: dayCompleteness,
    });
  }

  // 3. Dimension breakdown observations (bounded by maxRows cardinality policy)
  const breakdownGroups = [
    {
      rows: bundle.channels,
      dimKey: "sessionDefaultChannelGroup",
      scopeKey: "breakdown_channel",
    },
    { rows: bundle.devices, dimKey: "deviceCategory", scopeKey: "breakdown_device" },
    { rows: bundle.countries, dimKey: "country", scopeKey: "breakdown_country" },
    {
      rows: bundle.landingPages,
      dimKey: "landingPagePlusQueryString",
      scopeKey: "breakdown_landing_page",
    },
  ] as const;

  for (const group of breakdownGroups) {
    const { keptRows } = enforceDimensionCardinalityLimit(
      group.rows,
      (row) => row.sessions ?? row.activeUsers ?? 0,
      maxRows,
    );
    const groupFingerprint = computeQueryFingerprint({
      providerKey: "ga4",
      externalResourceId: bundle.propertyName,
      queryScope: group.scopeKey,
    });

    for (const row of keptRows) {
      const dims: Record<string, string> = {
        [group.dimKey]: row.dimensionValue,
      };
      if (row.sessions !== null) {
        pushMetric({
          canonicalMetricKey: "ga4.sessions",
          granularity: "WINDOW_TOTAL",
          periodStartDate: bundle.startDate,
          periodEndDate: bundle.endDate,
          dimensions: dims,
          queryFingerprint: groupFingerprint,
          numericValue: row.sessions,
          completenessState: windowCompleteness,
        });
      }
      if (row.activeUsers !== null) {
        pushMetric({
          canonicalMetricKey: "ga4.active_users",
          granularity: "WINDOW_TOTAL",
          periodStartDate: bundle.startDate,
          periodEndDate: bundle.endDate,
          dimensions: dims,
          queryFingerprint: groupFingerprint,
          numericValue: row.activeUsers,
          completenessState: windowCompleteness,
        });
      }
    }
  }

  return observations;
}

/**
 * Converts a normalized Google Search Console Search Analytics bundle into canonical
 * time-series and window-total observation inputs in fixed `America/Los_Angeles` time.
 */
export function normalizeGscReportBundleToObservations(
  bundle: GscSearchAnalyticsBundle,
  scope: ObservationNormalizationScope,
): CanonicalMetricObservationInput[] {
  const observations: CanonicalMetricObservationInput[] = [];
  const collectedAt = scope.collectedAt ?? new Date();
  const maxRows = scope.maxBreakdownRows ?? DEFAULT_MAX_CARDINALITY_ROWS_PER_SYNC;

  const gscQualityFlags: CanonicalDataQualityFlags = {
    hasPrivacyAnonymizationGap: bundle.coverage.privacyAnonymizedPossible,
    anonymizedClicksDelta:
      bundle.coverage.queryClicksVsTotalClicksGap?.omittedClicksEstimate ?? null,
    isWithinLagWindow: bundle.coverage.hasPreliminaryDatesInWindow,
    lagWindowHours: `${GSC_MIN_FINAL_LAG_HOURS}–${GSC_MAX_FINAL_LAG_HOURS}h`,
    notes: bundle.coverage.notices,
  };

  const windowCompleteness = resolveGscCompletenessState(bundle, bundle.endDate);
  const windowFingerprint = computeQueryFingerprint({
    providerKey: "gsc",
    externalResourceId: bundle.siteUrl,
    queryScope: "search_analytics_window_totals",
    searchType: bundle.searchType,
    dataState: bundle.dataState,
  });

  const pushGscMetric = (params: {
    canonicalMetricKey: string;
    granularity: "DAILY" | "WINDOW_TOTAL";
    periodStartDate: string;
    periodEndDate: string;
    dimensions?: Record<string, string>;
    queryFingerprint: string;
    numericValue: number | null;
    numeratorValue?: number | null;
    denominatorValue?: number | null;
    completenessState: MetricCompletenessState;
  }) => {
    const def = getCanonicalMetricDefinition(params.canonicalMetricKey);
    const mergedDimensions: Record<string, string> = {
      searchType: bundle.searchType,
      ...(params.dimensions ?? {}),
    };
    const dimIdentity = computeDimensionIdentity(mergedDimensions, {
      allowedDimensions: def.supportedDimensions,
    });

    observations.push({
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      environmentId: scope.environmentId,
      providerConnectionId: scope.providerConnectionId,
      connectedResourceId: scope.connectedResourceId,
      providerKey: "gsc",
      externalResourceId: bundle.siteUrl,
      canonicalMetricKey: def.canonicalKey,
      providerMetricName: def.providerMetricName,
      metricDefinitionVersion: def.schemaVersion,
      granularity: params.granularity,
      periodStartDate: params.periodStartDate,
      periodEndDate: params.periodEndDate,
      reportingTimezone: bundle.coverage.reportingTimeZone ?? GSC_REPORTING_TIMEZONE,
      dimensions: dimIdentity.dimensions,
      queryFingerprint: params.queryFingerprint,
      unit: def.unit,
      currency: null,
      numericValue: params.numericValue,
      numeratorValue: params.numeratorValue ?? null,
      denominatorValue: params.denominatorValue ?? null,
      completenessState: params.completenessState,
      dataQualityFlags: gscQualityFlags,
      collectedAt,
      ingestionRunId: scope.ingestionRunId ?? null,
    });
  };

  const totals = bundle.totals;
  const totalClicks = totals.clicks;
  const totalImpressions = totals.impressions;
  const totalPositionNumerator =
    totals.position !== null && totalImpressions !== null
      ? totals.position * totalImpressions
      : null;

  pushGscMetric({
    canonicalMetricKey: "gsc.clicks",
    granularity: "WINDOW_TOTAL",
    periodStartDate: bundle.startDate,
    periodEndDate: bundle.endDate,
    queryFingerprint: windowFingerprint,
    numericValue: totalClicks,
    completenessState: windowCompleteness,
  });
  pushGscMetric({
    canonicalMetricKey: "gsc.impressions",
    granularity: "WINDOW_TOTAL",
    periodStartDate: bundle.startDate,
    periodEndDate: bundle.endDate,
    queryFingerprint: windowFingerprint,
    numericValue: totalImpressions,
    completenessState: windowCompleteness,
  });
  pushGscMetric({
    canonicalMetricKey: "gsc.ctr",
    granularity: "WINDOW_TOTAL",
    periodStartDate: bundle.startDate,
    periodEndDate: bundle.endDate,
    queryFingerprint: windowFingerprint,
    numericValue: totals.ctr,
    numeratorValue: totalClicks,
    denominatorValue: totalImpressions,
    completenessState: windowCompleteness,
  });
  pushGscMetric({
    canonicalMetricKey: "gsc.average_position",
    granularity: "WINDOW_TOTAL",
    periodStartDate: bundle.startDate,
    periodEndDate: bundle.endDate,
    queryFingerprint: windowFingerprint,
    numericValue: totals.position,
    numeratorValue: totalPositionNumerator,
    denominatorValue: totalImpressions,
    completenessState: windowCompleteness,
  });

  // Daily series observations
  const dailyFingerprint = computeQueryFingerprint({
    providerKey: "gsc",
    externalResourceId: bundle.siteUrl,
    queryScope: "search_analytics_daily_series",
    searchType: bundle.searchType,
    dataState: bundle.dataState,
  });

  for (const point of bundle.dailySeries) {
    const dayDate = point.date ?? point.keys[0] ?? bundle.startDate;
    const dayCompleteness = resolveGscCompletenessState(bundle, dayDate);
    const posNumerator = point.position !== null ? point.position * point.impressions : null;

    pushGscMetric({
      canonicalMetricKey: "gsc.clicks",
      granularity: "DAILY",
      periodStartDate: dayDate,
      periodEndDate: dayDate,
      queryFingerprint: dailyFingerprint,
      numericValue: point.clicks,
      completenessState: dayCompleteness,
    });
    pushGscMetric({
      canonicalMetricKey: "gsc.impressions",
      granularity: "DAILY",
      periodStartDate: dayDate,
      periodEndDate: dayDate,
      queryFingerprint: dailyFingerprint,
      numericValue: point.impressions,
      completenessState: dayCompleteness,
    });
    pushGscMetric({
      canonicalMetricKey: "gsc.ctr",
      granularity: "DAILY",
      periodStartDate: dayDate,
      periodEndDate: dayDate,
      queryFingerprint: dailyFingerprint,
      numericValue: point.ctr,
      numeratorValue: point.clicks,
      denominatorValue: point.impressions,
      completenessState: dayCompleteness,
    });
    pushGscMetric({
      canonicalMetricKey: "gsc.average_position",
      granularity: "DAILY",
      periodStartDate: dayDate,
      periodEndDate: dayDate,
      queryFingerprint: dailyFingerprint,
      numericValue: point.position,
      numeratorValue: posNumerator,
      denominatorValue: point.impressions,
      completenessState: dayCompleteness,
    });
  }

  // Bounded query & page breakdowns
  const breakdownGroups = [
    { rows: bundle.topQueries, dimName: "query", scopeKey: "breakdown_query" },
    { rows: bundle.topPages, dimName: "page", scopeKey: "breakdown_page" },
    { rows: bundle.byCountry, dimName: "country", scopeKey: "breakdown_country" },
    { rows: bundle.byDevice, dimName: "device", scopeKey: "breakdown_device" },
  ] as const;

  for (const group of breakdownGroups) {
    const { keptRows } = enforceDimensionCardinalityLimit(group.rows, (row) => row.clicks, maxRows);
    const groupFingerprint = computeQueryFingerprint({
      providerKey: "gsc",
      externalResourceId: bundle.siteUrl,
      queryScope: group.scopeKey,
      searchType: bundle.searchType,
      dataState: bundle.dataState,
    });

    for (const row of keptRows) {
      const keyVal = row.keys[0];
      if (!keyVal) continue;
      const dims = { [group.dimName]: keyVal };
      pushGscMetric({
        canonicalMetricKey: "gsc.clicks",
        granularity: "WINDOW_TOTAL",
        periodStartDate: bundle.startDate,
        periodEndDate: bundle.endDate,
        dimensions: dims,
        queryFingerprint: groupFingerprint,
        numericValue: row.clicks,
        completenessState: windowCompleteness,
      });
      pushGscMetric({
        canonicalMetricKey: "gsc.impressions",
        granularity: "WINDOW_TOTAL",
        periodStartDate: bundle.startDate,
        periodEndDate: bundle.endDate,
        dimensions: dims,
        queryFingerprint: groupFingerprint,
        numericValue: row.impressions,
        completenessState: windowCompleteness,
      });
    }
  }

  return observations;
}
