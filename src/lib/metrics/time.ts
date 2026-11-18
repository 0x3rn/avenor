import { AppError, ERROR_CODES } from "@avenor/types";
import {
  addCalendarDays,
  countInclusiveDays,
  formatDateInTimeZone,
} from "@/lib/reports/date-window";
import type { HalfOpenPeriodBounds } from "./types";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates that an IANA timezone string is supported by `Intl.DateTimeFormat`.
 */
export function assertValidIanaTimezone(timeZone: string): string {
  const trimmed = timeZone.trim();
  if (!trimmed) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "Reporting timezone cannot be empty.",
    });
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return trimmed;
  } catch {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Invalid IANA timezone "${trimmed}".`,
    });
  }
}

function getTimeZoneOffsetMillisecondsAtInstant(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = dtf.formatToParts(new Date(utcMs));
  let year = 1970;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;

  for (const part of parts) {
    const num = Number.parseInt(part.value, 10);
    if (part.type === "year") year = num;
    else if (part.type === "month") month = num;
    else if (part.type === "day") day = num;
    else if (part.type === "hour") hour = num === 24 ? 0 : num;
    else if (part.type === "minute") minute = num;
    else if (part.type === "second") second = num;
  }

  const zonedAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const roundedUtcMs = Math.floor(utcMs / 1000) * 1000;
  return zonedAsUtcMs - roundedUtcMs;
}

/**
 * Computes the exact UTC epoch millisecond corresponding to local `00:00:00` on `isoDate`
 * in the specified IANA `timeZone`, accounting for Daylight Saving Time (DST) transitions.
 */
export function getLocalMidnightUtcEpochMs(isoDate: string, timeZone: string): number {
  if (!ISO_DATE_RE.test(isoDate)) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Invalid calendar date "${isoDate}". Expected YYYY-MM-DD.`,
    });
  }
  const validTz = assertValidIanaTimezone(timeZone);
  const [y, m, d] = isoDate.split("-").map((v) => Number.parseInt(v, 10));

  // Verify calendar date doesn't roll over (e.g. 2026-02-30)
  const checkUtc = new Date(Date.UTC(y, m - 1, d));
  if (checkUtc.toISOString().slice(0, 10) !== isoDate) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Non-existent calendar date "${isoDate}".`,
    });
  }

  const nominalUtcMidnightMs = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offsetFirstPass = getTimeZoneOffsetMillisecondsAtInstant(nominalUtcMidnightMs, validTz);
  const candidateMs = nominalUtcMidnightMs - offsetFirstPass;
  const offsetSecondPass = getTimeZoneOffsetMillisecondsAtInstant(candidateMs, validTz);
  return nominalUtcMidnightMs - offsetSecondPass;
}

/**
 * Computes half-open `[periodStartUtc, periodEndUtc)` UTC instants for inclusive source-local
 * calendar dates `[periodStartDate, periodEndDate]` in `reportingTimezone`.
 * Correctly yields 23h on spring-forward DST days and 25h on fall-back DST days.
 */
export function computeSourcePeriodUtcBounds(input: {
  periodStartDate: string;
  periodEndDate: string;
  reportingTimezone: string;
}): HalfOpenPeriodBounds {
  const { periodStartDate, periodEndDate, reportingTimezone } = input;
  const validTz = assertValidIanaTimezone(reportingTimezone);

  if (!ISO_DATE_RE.test(periodStartDate) || !ISO_DATE_RE.test(periodEndDate)) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Invalid period dates "${periodStartDate}" .. "${periodEndDate}". Expected YYYY-MM-DD.`,
    });
  }
  if (periodEndDate < periodStartDate) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `periodEndDate "${periodEndDate}" cannot precede periodStartDate "${periodStartDate}".`,
    });
  }

  const nextCalendarDateAfterEnd = addCalendarDays(periodEndDate, 1);
  const startUtcMs = getLocalMidnightUtcEpochMs(periodStartDate, validTz);
  const endUtcMs = getLocalMidnightUtcEpochMs(nextCalendarDateAfterEnd, validTz);

  const dayCount = countInclusiveDays(periodStartDate, periodEndDate);
  const elapsedHours = (endUtcMs - startUtcMs) / 3_600_000;
  const hasDstTransition = Math.abs(elapsedHours - dayCount * 24) > 0.01;

  return {
    periodStartDate,
    periodEndDate,
    reportingTimezone: validTz,
    periodStartUtc: new Date(startUtcMs),
    periodEndUtc: new Date(endUtcMs),
    elapsedHours,
    dayCount,
    hasDstTransition,
  };
}

/**
 * Checks whether `periodEndDate` falls within the trailing provider processing lag window
 * relative to `referenceNow` in `reportingTimezone`.
 */
export function isDateWithinRecentLagWindow(input: {
  periodEndDate: string;
  reportingTimezone: string;
  lagDays: number;
  referenceNow?: Date;
}): boolean {
  const now = input.referenceNow ?? new Date();
  const cutoffDate = formatDateInTimeZone(
    now,
    input.reportingTimezone,
    -Math.max(0, input.lagDays),
  );
  return input.periodEndDate > cutoffDate;
}
