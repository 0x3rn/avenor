import { AppError, ERROR_CODES } from "@avenor/types";

const MICRO_SCALE = 1_000_000n;

const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "CLP", "ISK"]);

export interface MoneyRecord {
  readonly amount: string | number;
  readonly currency: string;
  readonly label?: string;
}

export interface ExplicitFxConversionConfig {
  readonly targetCurrency: string;
  readonly ratesToTarget: Readonly<Record<string, number>>; // 1 unit of source currency = rate * targetCurrency
  readonly fxSource: string;
  readonly fxAsOfIso: string;
}

export interface SafeMoneyTotalResult {
  readonly currency: string;
  readonly decimalString: string;
  readonly numericValue: number;
  readonly microUnits: bigint;
  readonly itemCount: number;
  readonly converted: boolean;
  readonly fxMetadata: {
    readonly source: string;
    readonly asOfIso: string;
    readonly originalCurrencies: readonly string[];
    readonly disclosure: string;
  } | null;
}

/**
 * Parses a decimal string or number into exact integer micro-units (10^-6)
 * without binary floating-point rounding drift.
 */
export function parseDecimalToMicroUnits(raw: string | number): bigint {
  const str = typeof raw === "number" ? raw.toFixed(6) : raw.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(str)) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Invalid monetary decimal amount "${String(raw)}".`,
    });
  }
  const negative = str.startsWith("-");
  const unsigned = negative ? str.slice(1) : str;
  const [wholePart = "0", fracPart = ""] = unsigned.split(".");
  const paddedFrac = `${fracPart}000000`.slice(0, 6);
  const roundedCarry = fracPart.length > 6 && Number(fracPart.charAt(6)) >= 5 ? 1n : 0n;
  const micro = BigInt(wholePart) * MICRO_SCALE + BigInt(paddedFrac) + roundedCarry;
  return negative ? -micro : micro;
}

export function formatMicroUnitsToDecimal(microUnits: bigint, currency: string): string {
  const decimals = ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
  const negative = microUnits < 0n;
  const absMicro = negative ? -microUnits : microUnits;

  const divisor = decimals === 0 ? MICRO_SCALE : 10_000n; // 10^6 vs 10^4 (cents)
  const half = divisor / 2n;
  const scaled = (absMicro + half) / divisor;

  if (decimals === 0) {
    return `${negative ? "-" : ""}${scaled.toString()}`;
  }

  const whole = scaled / 100n;
  const frac = (scaled % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${frac}`;
}

/**
 * Sums monetary amounts using exact integer micro-units.
 * Refuses to combine mixed currencies unless an explicit FX table with provenance metadata is provided.
 */
export function sumMoneyRecordsSafely(
  records: readonly MoneyRecord[],
  fxConfig?: ExplicitFxConversionConfig,
): SafeMoneyTotalResult {
  if (records.length === 0) {
    const currency = fxConfig?.targetCurrency.toUpperCase() ?? "USD";
    return {
      currency,
      decimalString: formatMicroUnitsToDecimal(0n, currency),
      numericValue: 0,
      microUnits: 0n,
      itemCount: 0,
      converted: false,
      fxMetadata: null,
    };
  }

  const currencies = Array.from(new Set(records.map((r) => r.currency.trim().toUpperCase())));
  if (currencies.length > 1 && !fxConfig) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Refusing to sum heterogeneous currencies (${currencies.join(", ")}) without an explicit FX conversion table.`,
    });
  }

  if (!fxConfig) {
    const currency = currencies[0] ?? "USD";
    let totalMicro = 0n;
    for (const rec of records) {
      totalMicro += parseDecimalToMicroUnits(rec.amount);
    }
    const decimalString = formatMicroUnitsToDecimal(totalMicro, currency);
    return {
      currency,
      decimalString,
      numericValue: Number(decimalString),
      microUnits: totalMicro,
      itemCount: records.length,
      converted: false,
      fxMetadata: null,
    };
  }

  const targetCurrency = fxConfig.targetCurrency.trim().toUpperCase();
  let totalMicro = 0n;
  for (const rec of records) {
    const srcCurrency = rec.currency.trim().toUpperCase();
    const srcMicro = parseDecimalToMicroUnits(rec.amount);
    if (srcCurrency === targetCurrency) {
      totalMicro += srcMicro;
      continue;
    }
    const rate = fxConfig.ratesToTarget[srcCurrency];
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Missing positive FX rate for ${srcCurrency} -> ${targetCurrency}.`,
      });
    }
    const rateMicro = parseDecimalToMicroUnits(rate);
    const convertedMicro = (srcMicro * rateMicro + MICRO_SCALE / 2n) / MICRO_SCALE;
    totalMicro += convertedMicro;
  }

  const decimalString = formatMicroUnitsToDecimal(totalMicro, targetCurrency);
  return {
    currency: targetCurrency,
    decimalString,
    numericValue: Number(decimalString),
    microUnits: totalMicro,
    itemCount: records.length,
    converted: currencies.some((c) => c !== targetCurrency),
    fxMetadata: {
      source: fxConfig.fxSource,
      asOfIso: fxConfig.fxAsOfIso,
      originalCurrencies: currencies,
      disclosure: `Converted from ${currencies.join(", ")} to ${targetCurrency} using ${fxConfig.fxSource} rates as of ${fxConfig.fxAsOfIso}. Original provider billing currencies remain authoritative.`,
    },
  };
}

export interface LocalDayBoundaryResult {
  readonly dateIso: string;
  readonly timeZone: string;
  readonly startUtcIso: string;
  readonly endUtcIso: string;
  readonly durationHours: number;
  readonly isDstTransitionDay: boolean;
}

function getTimeZoneOffsetMinutesAtInstant(utcMs: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(new Date(utcMs));
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const localAsUtcMs = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    Number(lookup.hour),
    Number(lookup.minute),
    Number(lookup.second),
  );
  return Math.round((localAsUtcMs - utcMs) / 60_000);
}

function resolveLocalMidnightUtcMs(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): number {
  const naiveUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0);
  // Two-pass fixed-point offset resolution handles DST transitions accurately
  const firstOffset = getTimeZoneOffsetMinutesAtInstant(naiveUtcMs, timeZone);
  const candidate1 = naiveUtcMs - firstOffset * 60_000;
  const secondOffset = getTimeZoneOffsetMinutesAtInstant(candidate1, timeZone);
  return naiveUtcMs - secondOffset * 60_000;
}

/**
 * Computes exact UTC start/end timestamps for a local calendar day in any valid IANA timezone,
 * accurately capturing 23-hour spring-forward and 25-hour fall-back DST days.
 */
export function resolveLocalDayBoundariesUtc(
  dateIso: string,
  timeZone: string,
): LocalDayBoundaryResult {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso.trim());
  if (!match) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Invalid ISO calendar date "${dateIso}". Expected YYYY-MM-DD.`,
    });
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
  } catch {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Invalid IANA timezone "${timeZone}".`,
    });
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Calendar date "${dateIso}" does not exist.`,
    });
  }

  const nextDayDate = new Date(Date.UTC(year, month - 1, day + 1));
  const startUtcMs = resolveLocalMidnightUtcMs(year, month, day, timeZone);
  const endUtcMs = resolveLocalMidnightUtcMs(
    nextDayDate.getUTCFullYear(),
    nextDayDate.getUTCMonth() + 1,
    nextDayDate.getUTCDate(),
    timeZone,
  );

  const durationHours = Number(((endUtcMs - startUtcMs) / 3_600_000).toFixed(2));
  return {
    dateIso,
    timeZone,
    startUtcIso: new Date(startUtcMs).toISOString(),
    endUtcIso: new Date(endUtcMs).toISOString(),
    durationHours,
    isDstTransitionDay: durationHours !== 24,
  };
}

/**
 * Steps backward cleanly across leap years, month-end lengths (Jan 31 / Mar 31 -> Feb 28/29),
 * and year boundaries without JS Date overflow quirks.
 */
export function resolvePreviousCalendarDate(dateIso: string, unit: "day" | "month"): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso.trim());
  if (!match) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Invalid ISO date "${dateIso}".`,
    });
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (unit === "day") {
    const prev = new Date(Date.UTC(year, month - 1, day - 1));
    return prev.toISOString().slice(0, 10);
  }

  const targetMonthZeroIndexed = month - 2; // month-1 is current; -1 more is previous
  const targetYear = targetMonthZeroIndexed < 0 ? year - 1 : year;
  const normalizedMonth = targetMonthZeroIndexed < 0 ? 11 : targetMonthZeroIndexed;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);
  const result = new Date(Date.UTC(targetYear, normalizedMonth, clampedDay));
  return result.toISOString().slice(0, 10);
}

export interface WorkspaceUnitCostInput {
  readonly planCode: "FREE" | "PRO" | "TEAM";
  readonly monthlyPriceUsd: number;
  readonly connectedSources: number;
  readonly dailyIngestionRuns: number;
  readonly storedMetricRows: number;
  readonly monthlyBigQueryScanGiB: number;
  readonly monthlyEmailsSent: number;
}

export interface WorkspaceUnitCostEstimate {
  readonly estimatedMonthlyInfraCostUsd: number;
  readonly estimatedGrossMarginRatio: number | null;
  readonly withinTargetUnitEconomics: boolean;
  readonly costBreakdownUsd: {
    readonly databaseStorage: number;
    readonly computeAndIngestion: number;
    readonly bigQueryQueries: number;
    readonly emailAndDelivery: number;
  };
  readonly warnings: readonly string[];
}

/**
 * Estimates per-workspace monthly cost-to-serve so pricing tiers and query/retention caps
 * maintain sustainable SaaS unit economics.
 */
export function estimateWorkspaceMonthlyUnitCost(
  input: WorkspaceUnitCostInput,
): WorkspaceUnitCostEstimate {
  // Conservative unit rates: Postgres storage ~$0.35/GB-mo (~400 bytes/row), Worker/compute ~$0.000015/run,
  // BigQuery on-demand ~$6.25/TiB (~$0.0061/GiB), transactional email ~$0.001/email
  const storageGb = (input.storedMetricRows * 400) / 1_000_000_000;
  const databaseStorage = Number((storageGb * 0.35).toFixed(4));
  const computeAndIngestion = Number((input.dailyIngestionRuns * 30 * 0.00005).toFixed(4));
  const bigQueryQueries = Number((input.monthlyBigQueryScanGiB * 0.0061).toFixed(4));
  const emailAndDelivery = Number((input.monthlyEmailsSent * 0.001).toFixed(4));

  const estimatedMonthlyInfraCostUsd = Number(
    (databaseStorage + computeAndIngestion + bigQueryQueries + emailAndDelivery).toFixed(4),
  );

  const warnings: string[] = [];
  if (input.monthlyBigQueryScanGiB > 100) {
    warnings.push(
      "BigQuery monthly scan exceeds 100 GiB; tighten partition date window or dry-run byte cap.",
    );
  }
  if (input.storedMetricRows > 2_000_000) {
    warnings.push(
      "Stored metric rows exceed 2M; verify workspace retention compaction policy is active.",
    );
  }

  if (input.monthlyPriceUsd <= 0) {
    return {
      estimatedMonthlyInfraCostUsd,
      estimatedGrossMarginRatio: null,
      withinTargetUnitEconomics: estimatedMonthlyInfraCostUsd <= 1.5,
      costBreakdownUsd: {
        databaseStorage,
        computeAndIngestion,
        bigQueryQueries,
        emailAndDelivery,
      },
      warnings,
    };
  }

  const margin = Number(
    ((input.monthlyPriceUsd - estimatedMonthlyInfraCostUsd) / input.monthlyPriceUsd).toFixed(4),
  );
  if (margin < 0.75) {
    warnings.push(`Estimated gross margin (${(margin * 100).toFixed(1)}%) fell below 75% target.`);
  }

  return {
    estimatedMonthlyInfraCostUsd,
    estimatedGrossMarginRatio: margin,
    withinTargetUnitEconomics: margin >= 0.75,
    costBreakdownUsd: {
      databaseStorage,
      computeAndIngestion,
      bigQueryQueries,
      emailAndDelivery,
    },
    warnings,
  };
}
