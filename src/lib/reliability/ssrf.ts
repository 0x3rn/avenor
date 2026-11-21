import dns from "node:dns/promises";
import net from "node:net";
import { AppError, ERROR_CODES } from "@avenor/types";

export interface DnsLookupAddress {
  address: string;
  family: 4 | 6;
}

export type ControlledDnsResolver = (hostname: string) => Promise<readonly DnsLookupAddress[]>;

export interface ValidatedPublicTarget {
  readonly normalizedUrl: string;
  readonly protocol: "https:" | "http:";
  readonly hostname: string;
  readonly port: number;
  readonly pathname: string;
}

export interface PinnedPublicTarget extends ValidatedPublicTarget {
  readonly pinnedIp: string;
  readonly pinnedFamily: 4 | 6;
  readonly allResolvedIps: readonly string[];
}

const DISALLOWED_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".localdomain",
  ".home.arpa",
  ".corp",
  ".lan",
] as const;

const DISALLOWED_EXACT_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata.goog",
  "metadata",
  "instance-data",
]);

function parseIpv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0, nums[3] ?? 0];
}

function isDisallowedIpv4(ip: string): boolean {
  const octets = parseIpv4Octets(ip);
  if (!octets) return true;
  const [a, b, c] = octets;

  // 0.0.0.0/8 (this network)
  if (a === 0) return true;
  // 10.0.0.0/8 (RFC1918 private)
  if (a === 10) return true;
  // 100.64.0.0/10 (CGNAT / shared address space)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (link-local & AWS/GCP/Azure cloud metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 (RFC1918 private)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24 (IETF protocol assignments)
  if (a === 192 && b === 0 && c === 0) return true;
  // 192.0.2.0/24 (TEST-NET-1) - block non-global documentation range? Allow only public; block 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 (benchmarking)
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 224.0.0.0/4 (multicast) & 240.0.0.0/4 (reserved/broadcast)
  if (a >= 224) return true;

  return false;
}

function expandIpv6ToGroups(rawIp: string): number[] | null {
  const cleaned = rawIp.toLowerCase().split("%")[0] ?? "";
  // Handle IPv4-embedded IPv6 such as ::ffff:127.0.0.1 or ::ffff:169.254.169.254
  const lastColon = cleaned.lastIndexOf(":");
  let ipStr = cleaned;
  if (cleaned.includes(".") && lastColon !== -1) {
    const ipv4Part = cleaned.slice(lastColon + 1);
    const octets = parseIpv4Octets(ipv4Part);
    if (!octets) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    ipStr = `${cleaned.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = ipStr.split("::");
  if (halves.length > 2) return null;

  const left = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const right = halves[1] ? halves[1].split(":").filter(Boolean) : [];

  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 0) return null;

  const fullHex = [
    ...left,
    ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => "0"),
    ...right,
  ];
  if (fullHex.length !== 8) return null;

  const groups: number[] = [];
  for (const hex of fullHex) {
    if (!/^[0-9a-f]{1,4}$/.test(hex)) return null;
    groups.push(Number.parseInt(hex, 16));
  }
  return groups;
}

/**
 * Robust IPv4 & IPv6 SSRF classifier rejecting loopback, RFC1918 private,
 * link-local/cloud metadata, CGNAT, multicast, reserved, unique-local IPv6,
 * and IPv4-mapped/compatible IPv6 bypasses (e.g. `::ffff:127.0.0.1`, `::ffff:7f00:1`).
 */
export function isDisallowedIpAddress(ip: string): boolean {
  const trimmed = ip.trim().replace(/^\[|\]$/g, "");
  const version = net.isIP(trimmed);
  if (version === 4) {
    return isDisallowedIpv4(trimmed);
  }
  if (version === 6) {
    const groups = expandIpv6ToGroups(trimmed);
    if (!groups) return true;
    const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;

    // Unspecified ::/128
    if (groups.every((g) => g === 0)) return true;
    // Loopback ::1/128
    if (
      g0 === 0 &&
      g1 === 0 &&
      g2 === 0 &&
      g3 === 0 &&
      g4 === 0 &&
      g5 === 0 &&
      g6 === 0 &&
      g7 === 1
    ) {
      return true;
    }
    // IPv4-mapped IPv6 ::ffff:0:0/96 or IPv4-compatible ::/96
    if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
      const embeddedIpv4 = `${(g6 >> 8) & 0xff}.${g6 & 0xff}.${(g7 >> 8) & 0xff}.${g7 & 0xff}`;
      return isDisallowedIpv4(embeddedIpv4);
    }
    // 6to4 2002::/16 (embeds IPv4 in g1..g2)
    if (g0 === 0x2002) {
      const embeddedIpv4 = `${(g1 >> 8) & 0xff}.${g1 & 0xff}.${(g2 >> 8) & 0xff}.${g2 & 0xff}`;
      return isDisallowedIpv4(embeddedIpv4);
    }
    // Unique local fc00::/7
    if ((g0 & 0xfe00) === 0xfc00) return true;
    // Link-local fe80::/10
    if ((g0 & 0xffc0) === 0xfe80) return true;
    // Multicast ff00::/8
    if ((g0 & 0xff00) === 0xff00) return true;
    // Discard 100::/64
    if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true;

    return false;
  }
  // Any non-valid IP string fails closed
  return true;
}

/**
 * Detects obfuscated numeric IPv4 encodings (single integer `2130706433`, hex `0x7f000001`,
 * octal `0177.0.0.1`, or short dotted forms like `127.1`).
 */
function looksLikeNumericOrObfuscatedIp(hostname: string): boolean {
  const bare = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (net.isIP(bare) !== 0) return true;
  if (/^\d+$/.test(bare) || /^0x[0-9a-f]+$/i.test(bare)) return true;
  if (/^(?:0x[0-9a-f]+|0[0-7]+|\d+)(?:\.(?:0x[0-9a-f]+|0[0-7]+|\d+)){1,3}$/i.test(bare)) {
    return true;
  }
  return false;
}

/**
 * Strict server-side URL validation for public uptime monitors and outbound webhooks.
 */
export function validatePublicTargetUrl(
  rawUrl: string,
  options?: { allowHttp?: boolean },
): ValidatedPublicTarget {
  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "Invalid target URL format.",
    });
  }

  const allowHttp = options?.allowHttp === true;
  if (parsed.protocol !== "https:" && !(allowHttp && parsed.protocol === "http:")) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Disallowed URL protocol "${parsed.protocol}". Only ${allowHttp ? "https: or http:" : "https:"} targets are permitted.`,
    });
  }

  if (parsed.username || parsed.password) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "Embedded URL credentials (userinfo) are not permitted.",
    });
  }

  const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
  const allowedPort = parsed.protocol === "https:" ? 443 : 80;
  if (port !== allowedPort) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Arbitrary custom port ${port} is not permitted. Only standard port ${allowedPort} is allowed.`,
    });
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || DISALLOWED_EXACT_HOSTNAMES.has(hostname)) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Internal or loopback hostname "${hostname || "empty"}" is blocked by SSRF policy.`,
    });
  }

  for (const suffix of DISALLOWED_HOSTNAME_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Internal network domain "${hostname}" is blocked by SSRF policy.`,
      });
    }
  }

  const bareHost = hostname.replace(/^\[|\]$/g, "");
  if (looksLikeNumericOrObfuscatedIp(bareHost)) {
    if (net.isIP(bareHost) === 0 || isDisallowedIpAddress(bareHost)) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `IP literal or obfuscated numeric host "${hostname}" is blocked by SSRF policy.`,
      });
    }
  }

  if (!hostname.includes(".") && net.isIP(bareHost) === 0) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Single-label internal hostname "${hostname}" is not permitted.`,
    });
  }

  return {
    normalizedUrl: parsed.toString(),
    protocol: parsed.protocol as "https:" | "http:",
    hostname: bareHost,
    port,
    pathname: parsed.pathname || "/",
  };
}

const defaultDnsResolver: ControlledDnsResolver = async (hostname: string) => {
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

/**
 * Resolves DNS via a controlled resolver, validates EVERY returned IP address against
 * the SSRF policy (failing closed on any private/loopback/metadata candidate), and pins
 * an approved public IP for connection-time enforcement (defeating DNS rebinding).
 */
export async function resolveAndPinSafePublicAddress(
  rawUrl: string,
  options?: { allowHttp?: boolean; dnsLookupFn?: ControlledDnsResolver },
): Promise<PinnedPublicTarget> {
  const validated = validatePublicTargetUrl(rawUrl, { allowHttp: options?.allowHttp });
  const resolver = options?.dnsLookupFn ?? defaultDnsResolver;

  if (net.isIP(validated.hostname) !== 0) {
    if (isDisallowedIpAddress(validated.hostname)) {
      throw new AppError({
        code: ERROR_CODES.FORBIDDEN,
        message: `SSRF guard blocked disallowed IP "${validated.hostname}" before outbound network access.`,
      });
    }
    return {
      ...validated,
      pinnedIp: validated.hostname,
      pinnedFamily: net.isIP(validated.hostname) === 6 ? 6 : 4,
      allResolvedIps: [validated.hostname],
    };
  }

  let resolved: readonly DnsLookupAddress[];
  try {
    resolved = await resolver(validated.hostname);
  } catch (err) {
    throw new AppError({
      code: ERROR_CODES.EXTERNAL_PROVIDER_ERROR,
      message: `DNS resolution failed for "${validated.hostname}": ${err instanceof Error ? err.message : "unknown error"}`,
    });
  }

  if (resolved.length === 0) {
    throw new AppError({
      code: ERROR_CODES.EXTERNAL_PROVIDER_ERROR,
      message: `DNS returned no addresses for "${validated.hostname}".`,
    });
  }

  for (const record of resolved) {
    if (isDisallowedIpAddress(record.address)) {
      throw new AppError({
        code: ERROR_CODES.FORBIDDEN,
        message: `SSRF/DNS-rebinding guard blocked "${validated.hostname}" because it resolved to non-public IP ${record.address}.`,
      });
    }
  }

  const primary = resolved[0];
  if (!primary) {
    throw new AppError({
      code: ERROR_CODES.EXTERNAL_PROVIDER_ERROR,
      message: `No valid public address resolved for "${validated.hostname}".`,
    });
  }

  return {
    ...validated,
    pinnedIp: primary.address,
    pinnedFamily: primary.family,
    allResolvedIps: resolved.map((r) => r.address),
  };
}
