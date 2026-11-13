import type { Ga4StandardReportBundle } from "../google-analytics/types";
import {
  type Ga4VsGscReconciliationNote,
  type Ga4VsGscReconciliationSummary,
  GSC_REPORTING_TIMEZONE,
  type GscSearchAnalyticsBundle,
} from "./types";

function extractHost(rawUrlOrDomain: string | null | undefined): string | null {
  if (!rawUrlOrDomain) return null;
  const trimmed = rawUrlOrDomain.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.startsWith("sc-domain:")) {
    return trimmed.slice("sc-domain:".length).replace(/^www\./, "");
  }
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withProto).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Produces an explicit, non-misleading reconciliation summary comparing GA4 site telemetry
 * with Google Search Console search performance. Never sums or equates clicks and sessions.
 */
export function buildGa4VsGscReconciliation(input: {
  ga4Bundle: Ga4StandardReportBundle | null;
  gscBundle: GscSearchAnalyticsBundle | null;
  projectPrimaryDomain?: string | null;
}): Ga4VsGscReconciliationSummary {
  const { ga4Bundle, gscBundle, projectPrimaryDomain } = input;
  const ga4Tz = ga4Bundle?.reportingTimeZone ?? null;
  const timezoneOffsetMismatch = Boolean(ga4Tz && ga4Tz !== GSC_REPORTING_TIMEZONE);

  const organicChannel = ga4Bundle?.channels.find((c) =>
    c.dimensionValue.toLowerCase().includes("organic search"),
  );
  const ga4OrganicSessions = organicChannel?.sessions ?? null;
  const ga4TotalSessions = ga4Bundle?.totals.sessions ?? null;
  const ga4ActiveUsers = ga4Bundle?.totals.activeUsers ?? null;

  const gscClicks = gscBundle?.totals.clicks ?? null;
  const gscImpressions = gscBundle?.totals.impressions ?? null;
  const gscCtr = gscBundle?.totals.ctr ?? null;
  const gscPosition = gscBundle?.totals.position ?? null;

  const clickToOrganicSessionRatio =
    gscClicks !== null && ga4OrganicSessions !== null && ga4OrganicSessions > 0
      ? Math.round((gscClicks / ga4OrganicSessions) * 100) / 100
      : null;

  let scopeAlignmentStatus: Ga4VsGscReconciliationSummary["scopeAlignmentStatus"] = "INCOMPLETE";
  const notes: Ga4VsGscReconciliationNote[] = [
    {
      topic: "clicks_vs_sessions",
      title: "GSC Clicks and GA4 Sessions measure different funnel events",
      summary:
        "Search Console Clicks record taps on Google search listings before landing page scripts execute; GA4 Sessions start only after analytics tracking loads with consent and can split or repeat within a 30-minute idle window. Clicks must never be summed with or treated as equal to GA4 Users or Sessions.",
      severity: "info",
    },
  ];

  if (ga4Tz) {
    notes.push({
      topic: "timezone_alignment",
      title: timezoneOffsetMismatch
        ? `Timezone difference detected: GA4 uses ${ga4Tz} while GSC uses ${GSC_REPORTING_TIMEZONE}`
        : `Reporting timezone aligned (${GSC_REPORTING_TIMEZONE})`,
      summary: timezoneOffsetMismatch
        ? `Daily buckets in GA4 (${ga4Tz}) and Search Console (${GSC_REPORTING_TIMEZONE}, fixed Pacific Time) cut over at different UTC boundaries, shifting end-of-day traffic across adjacent dates.`
        : `Both GA4 and Search Console cut over on ${GSC_REPORTING_TIMEZONE} daily boundaries.`,
      severity: timezoneOffsetMismatch ? "warning" : "info",
    });
  }

  notes.push({
    topic: "freshness_lag",
    title: "Asymmetric indexing and processing freshness windows",
    summary:
      "Search Console final search metrics lag 48-72 hours while GA4 standard metrics update more frequently throughout the day, causing trailing days to diverge until Search Console settles.",
    severity: gscBundle?.coverage.hasPreliminaryDatesInWindow ? "warning" : "info",
  });

  if (gscBundle) {
    const projectHost = extractHost(projectPrimaryDomain);
    const gscHost = extractHost(gscBundle.siteUrl);

    if (projectHost && gscHost) {
      if (gscHost === projectHost) {
        scopeAlignmentStatus = gscBundle.propertyKind === "DOMAIN" ? "PARTIAL_SUBSET" : "ALIGNED";
      } else if (projectHost.endsWith(`.${gscHost}`) && gscBundle.propertyKind === "DOMAIN") {
        scopeAlignmentStatus = "PARTIAL_SUBSET";
      } else {
        scopeAlignmentStatus = "MISMATCHED_CANONICAL";
      }
    } else {
      scopeAlignmentStatus = gscBundle.propertyKind === "DOMAIN" ? "PARTIAL_SUBSET" : "ALIGNED";
    }

    if (scopeAlignmentStatus === "PARTIAL_SUBSET") {
      notes.push({
        topic: "property_scope",
        title: `Canonical property scope: ${gscBundle.propertyKind === "DOMAIN" ? "Domain (`sc-domain:`)" : "URL-Prefix"}`,
        summary:
          gscBundle.propertyKind === "DOMAIN"
            ? `Domain property "${gscBundle.siteUrl}" aggregates http, https, www, and all subdomains, which can exceed a single GA4 Web Stream's host filter.`
            : `URL-prefix property "${gscBundle.siteUrl}" matches exact protocol/host/path boundaries.`,
        severity: "info",
      });
    } else if (scopeAlignmentStatus === "MISMATCHED_CANONICAL") {
      notes.push({
        topic: "property_scope",
        title: "Mapped Search Console property host differs from project primary domain",
        summary: `Project domain "${projectHost ?? "unknown"}" differs from mapped Search Console property "${gscBundle.siteUrl}". Verify property mapping before attributing differences to organic rank changes.`,
        severity: "warning",
      });
    }
  }

  const omittedClicks =
    gscBundle?.coverage.queryClicksVsTotalClicksGap?.omittedClicksEstimate ?? null;
  if (
    ga4Bundle?.dataQuality.isSampled ||
    ga4Bundle?.dataQuality.isThresholded ||
    (omittedClicks !== null && omittedClicks > 0)
  ) {
    notes.push({
      topic: "privacy_and_sampling",
      title: "Privacy anonymization, thresholding, and sampling notices apply",
      summary: [
        ga4Bundle?.dataQuality.isSampled ? "GA4 window experienced sampling." : null,
        ga4Bundle?.dataQuality.isThresholded ? "GA4 applied Google Signals thresholding." : null,
        omittedClicks && omittedClicks > 0
          ? `Search Console omitted ~${omittedClicks.toLocaleString()} anonymized/long-tail query clicks from the Query table.`
          : null,
      ]
        .filter(Boolean)
        .join(" "),
      severity: "warning",
    });
  }

  return {
    ga4PropertyName: ga4Bundle?.propertyName ?? null,
    ga4ReportingTimeZone: ga4Tz,
    gscSiteUrl: gscBundle?.siteUrl ?? null,
    gscPropertyKind: gscBundle?.propertyKind ?? null,
    gscReportingTimeZone: GSC_REPORTING_TIMEZONE,
    timezoneOffsetMismatch,
    ga4TotalSessions,
    ga4OrganicSessions,
    ga4ActiveUsers,
    gscClicks,
    gscImpressions,
    gscCtr,
    gscPosition,
    clickToOrganicSessionRatio,
    scopeAlignmentStatus,
    notes,
  };
}
