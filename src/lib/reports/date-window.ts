export type ReportDatePreset = "7d" | "28d" | "90d" | "custom";

export interface ResolvedReportDateWindow {
  preset: ReportDatePreset;
  timeZone: string;
  startDate: string;
  endDate: string;
  compareEnabled: boolean;
  compareStartDate: string | null;
  compareEndDate: string | null;
  dayCount: number;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Formats a `Date` shifted by `daysOffset` into `YYYY-MM-DD` within an IANA timezone.
 */
export function formatDateInTimeZone(date: Date, timeZone: string, daysOffset = 0): string {
  const shifted = new Date(date.getTime() + daysOffset * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted);
}

/**
 * Adds signed calendar days to a validated `YYYY-MM-DD` UTC calendar date.
 */
export function addCalendarDays(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split("-").map((v) => Number.parseInt(v, 10));
  const utc = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return utc.toISOString().slice(0, 10);
}

/**
 * Counts inclusive days between ordered `YYYY-MM-DD` dates.
 */
export function countInclusiveDays(startDate: string, endDate: string): number {
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return 1;
  }
  return Math.round((endMs - startMs) / 86_400_000) + 1;
}

export function normalizeReportPreset(rawPreset: string | null | undefined): ReportDatePreset {
  if (rawPreset === "7d" || rawPreset === "28d" || rawPreset === "90d" || rawPreset === "custom") {
    return rawPreset;
  }
  return "28d";
}

/**
 * Resolves a preset or custom date range + optional equal-length preceding comparison window.
 */
export function resolveReportDateWindow(input?: {
  preset?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  compare?: boolean;
  timeZone?: string;
  endLagDays?: number;
  now?: Date;
}): ResolvedReportDateWindow {
  const now = input?.now ?? new Date();
  const timeZone = input?.timeZone || "UTC";
  const lagDays = Math.max(0, input?.endLagDays ?? 0);
  const compareEnabled = input?.compare ?? true;
  const preset = normalizeReportPreset(input?.preset);

  let resolvedPreset = preset;
  let startDate: string;
  let endDate: string;

  const customStart = input?.startDate?.trim() ?? "";
  const customEnd = input?.endDate?.trim() ?? "";

  if (
    (preset === "custom" || (customStart && customEnd)) &&
    ISO_DATE_RE.test(customStart) &&
    ISO_DATE_RE.test(customEnd) &&
    customStart <= customEnd
  ) {
    resolvedPreset =
      preset === "custom" ? "custom" : normalizeReportPreset(input?.preset ?? "custom");
    startDate = customStart;
    endDate = customEnd;
  } else {
    const windowDays = preset === "7d" ? 7 : preset === "90d" ? 90 : 28;
    endDate = formatDateInTimeZone(now, timeZone, -lagDays);
    startDate = addCalendarDays(endDate, -(windowDays - 1));
    resolvedPreset = preset === "custom" ? "28d" : preset;
  }

  const dayCount = countInclusiveDays(startDate, endDate);
  const compareEndDate = compareEnabled ? addCalendarDays(startDate, -1) : null;
  const compareStartDate = compareEnabled ? addCalendarDays(startDate, -dayCount) : null;

  return {
    preset: resolvedPreset,
    timeZone,
    startDate,
    endDate,
    compareEnabled,
    compareStartDate,
    compareEndDate,
    dayCount,
  };
}

export function formatIntegerCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return Math.round(value).toLocaleString("en-US");
}

export function formatRatioPercent(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) {
    return "—";
  }
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatPositionRank(position: number | null | undefined): string {
  if (position === null || position === undefined || !Number.isFinite(position)) {
    return "—";
  }
  return position.toFixed(1);
}

export function formatDurationSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return "—";
  }
  const rounded = Math.max(0, Math.round(seconds));
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

/**
 * Formats honest relative percentage delta (`+12.4% vs prior` or `−4.1% vs prior`), returning
 * `undefined` when either current or comparison period is null or prior baseline is 0.
 */
export function formatComparisonDelta(
  current: number | null | undefined,
  prior: number | null | undefined,
  options?: { invertGoodBad?: boolean; isRatioPoints?: boolean },
): string | undefined {
  if (
    current === null ||
    current === undefined ||
    prior === null ||
    prior === undefined ||
    !Number.isFinite(current) ||
    !Number.isFinite(prior)
  ) {
    return undefined;
  }

  if (options?.isRatioPoints) {
    const ppDelta = (current - prior) * 100;
    const sign = ppDelta > 0 ? "+" : "";
    return `${sign}${ppDelta.toFixed(1)} pp vs prior window`;
  }

  if (prior === 0) {
    return undefined;
  }

  const pct = ((current - prior) / Math.abs(prior)) * 100;
  const sign = pct > 0 ? "+" : "";
  const suffix = options?.invertGoodBad ? " rank delta" : " vs prior";
  return `${sign}${pct.toFixed(1)}%${suffix}`;
}
