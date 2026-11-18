import crypto from "node:crypto";
import { AppError, ERROR_CODES } from "@avenor/types";
import type { NormalizedDimensionIdentity } from "./types";

export const MAX_DIMENSION_KEYS_PER_OBSERVATION = 8;
export const MAX_DIMENSION_KEY_LENGTH = 64;
export const MAX_DIMENSION_VALUE_LENGTH = 512;
export const DEFAULT_MAX_CARDINALITY_ROWS_PER_SYNC = 250;

const DIMENSION_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const EMAIL_PII_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const SENSITIVE_QUERY_PARAM_RE =
  /([?&](?:token|access_token|id_token|refresh_token|code|secret|password|key|email|session_id)=)[^&#]*/gi;

/**
 * Redacts PII (emails, sensitive query tokens) and bounds length on dimension values.
 */
export function sanitizeDimensionValueForPrivacy(dimensionKey: string, rawValue: string): string {
  let cleaned = rawValue.trim();
  if (!cleaned) {
    return "(not set)";
  }

  cleaned = cleaned.replace(EMAIL_PII_RE, "[redacted-email]");
  if (
    dimensionKey === "page" ||
    dimensionKey === "pagePath" ||
    dimensionKey === "landingPage" ||
    dimensionKey === "landingPagePlusQueryString"
  ) {
    cleaned = cleaned.replace(SENSITIVE_QUERY_PARAM_RE, "$1[redacted]");
  }

  if (cleaned.length > MAX_DIMENSION_VALUE_LENGTH) {
    cleaned = cleaned.slice(0, MAX_DIMENSION_VALUE_LENGTH);
  }
  return cleaned;
}

/**
 * Deterministically canonicalizes and hashes a dimension map using length-prefixed framing
 * (`<keyLen>:<key>=<valLen>:<val>;...`) so distinct key/value pairs containing delimiters
 * (`=`, `;`, `|`, `:`) can NEVER collide.
 */
export function computeDimensionIdentity(
  rawDimensions?: Record<string, string | undefined | null> | null,
  options?: { allowedDimensions?: readonly string[] },
): NormalizedDimensionIdentity {
  if (!rawDimensions) {
    const emptyCanonical = "0:";
    const emptyHash = crypto.createHash("sha256").update(emptyCanonical, "utf8").digest("hex");
    return {
      dimensions: {},
      canonicalKey: emptyCanonical,
      hash: emptyHash,
    };
  }

  const allowedSet = options?.allowedDimensions ? new Set(options.allowedDimensions) : null;
  const normalizedEntries: Array<[string, string]> = [];

  for (const [rawKey, rawVal] of Object.entries(rawDimensions)) {
    if (rawVal === undefined || rawVal === null) {
      continue;
    }
    const key = rawKey.trim();
    if (!key) {
      continue;
    }
    if (!DIMENSION_KEY_RE.test(key) || key.length > MAX_DIMENSION_KEY_LENGTH) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Invalid dimension key "${key}".`,
      });
    }
    if (allowedSet && !allowedSet.has(key)) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Dimension "${key}" is not supported for this canonical metric.`,
      });
    }

    const sanitizedValue = sanitizeDimensionValueForPrivacy(key, String(rawVal));
    normalizedEntries.push([key, sanitizedValue]);
  }

  if (normalizedEntries.length > MAX_DIMENSION_KEYS_PER_OBSERVATION) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Observation exceeds maximum of ${MAX_DIMENSION_KEYS_PER_OBSERVATION} dimensions.`,
    });
  }

  normalizedEntries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const dimensions: Record<string, string> = {};
  const parts: string[] = [`${normalizedEntries.length}:`];

  for (const [k, v] of normalizedEntries) {
    dimensions[k] = v;
    const keyByteLen = Buffer.byteLength(k, "utf8");
    const valByteLen = Buffer.byteLength(v, "utf8");
    parts.push(`${keyByteLen}:${k}=${valByteLen}:${v};`);
  }

  const canonicalKey = parts.join("");
  const hash = crypto.createHash("sha256").update(canonicalKey, "utf8").digest("hex");

  return {
    dimensions,
    canonicalKey,
    hash,
  };
}

/**
 * Builds a deterministic query fingerprint for a provider report configuration.
 */
export function computeQueryFingerprint(input: {
  providerKey: string;
  externalResourceId: string;
  queryScope: string;
  searchType?: string | null;
  dataState?: string | null;
  filterKey?: string | null;
}): string {
  const identity = computeDimensionIdentity({
    providerKey: input.providerKey,
    externalResourceId: input.externalResourceId,
    queryScope: input.queryScope,
    ...(input.searchType ? { searchType: input.searchType } : {}),
    ...(input.dataState ? { dataState: input.dataState } : {}),
    ...(input.filterKey ? { filterKey: input.filterKey } : {}),
  });
  return `qfp_${identity.hash.slice(0, 24)}`;
}

/**
 * Bounds high-cardinality breakdown rows to the top `maxRows` sorted by primary metric weight.
 */
export function enforceDimensionCardinalityLimit<T>(
  rows: readonly T[],
  getWeight: (row: T) => number,
  maxRows = DEFAULT_MAX_CARDINALITY_ROWS_PER_SYNC,
): { keptRows: T[]; truncatedCount: number } {
  const safeMax = Math.max(1, Math.min(1000, maxRows));
  if (rows.length <= safeMax) {
    return { keptRows: [...rows], truncatedCount: 0 };
  }
  const sorted = [...rows].sort((a, b) => getWeight(b) - getWeight(a));
  return {
    keptRows: sorted.slice(0, safeMax),
    truncatedCount: sorted.length - safeMax,
  };
}
