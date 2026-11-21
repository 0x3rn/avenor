import { describe, expect, it, vi } from "vitest";
import {
  isDisallowedIpAddress,
  resolveAndPinSafePublicAddress,
  validatePublicTargetUrl,
} from "@/lib/reliability/ssrf";
import { evaluateMonitorTransition, runSafePublicProbe } from "@/lib/reliability/uptime";

describe("THE-152: SSRF, DNS-rebinding, redirect safety, and noise-resistant incident state machine", () => {
  it("blocks all private, loopback, link-local, cloud metadata, IPv6-mapped, obfuscated IP, scheme, and port SSRF vectors", () => {
    const disallowedIps = [
      "127.0.0.1",
      "127.255.255.254",
      "10.0.0.1",
      "172.16.0.5",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "::",
      "fc00::1",
      "fd12:3456:789a::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:169.254.169.254",
      "::ffff:10.0.0.5",
    ];
    for (const ip of disallowedIps) {
      expect(isDisallowedIpAddress(ip), `Expected ${ip} to be disallowed`).toBe(true);
    }

    expect(isDisallowedIpAddress("93.184.216.34")).toBe(false);
    expect(isDisallowedIpAddress("1.1.1.1")).toBe(false);
    expect(isDisallowedIpAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);

    const blockedUrls = [
      "file:///etc/passwd",
      "ftp://example.com/file",
      "gopher://127.0.0.1:70/",
      "https://localhost/health",
      "https://metadata.google.internal/computeMetadata/v1/",
      "https://169.254.169.254/latest/meta-data/",
      "https://127.0.0.1/health",
      "https://[::1]/health",
      "https://[::ffff:127.0.0.1]/health",
      "https://2130706433/health",
      "https://0x7f000001/health",
      "https://0177.0.0.1/health",
      "https://user:pass@example.com/health",
      "https://example.com:8443/health",
      "https://internal-db.local/health",
    ];
    for (const url of blockedUrls) {
      expect(() => validatePublicTargetUrl(url), `Expected ${url} to be rejected`).toThrow();
    }

    expect(validatePublicTargetUrl("https://status.avenor.dev/health").hostname).toBe(
      "status.avenor.dev",
    );
  });

  it("defeats DNS rebinding and redirects to localhost/private IPs BEFORE outbound network access", async () => {
    // 1. DNS rebinding: hostname resolves to a private IP at connection time -> transport NEVER called
    const rebindTransport = vi.fn();
    const rebindResult = await runSafePublicProbe({
      targetUrl: "https://rebind.attacker.example/health",
      httpMethod: "HEAD",
      expectedStatusMin: 200,
      expectedStatusMax: 399,
      timeoutMs: 3000,
      dnsLookupFn: async () => [{ address: "10.0.0.42", family: 4 }],
      transportFn: rebindTransport,
    });
    expect(rebindResult.outcome).toBe("SSRF_BLOCKED");
    expect(rebindTransport).not.toHaveBeenCalled();

    // 2. Redirect to localhost -> second hop blocked BEFORE transport call to localhost
    const redirectTransport = vi.fn(async (target) => {
      if (target.hostname === "public.example.com") {
        return { status: 302, locationHeader: "https://127.0.0.1/admin" };
      }
      throw new Error("Should never reach localhost transport!");
    });
    const redirectResult = await runSafePublicProbe({
      targetUrl: "https://public.example.com/health",
      httpMethod: "HEAD",
      expectedStatusMin: 200,
      expectedStatusMax: 399,
      timeoutMs: 3000,
      dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      transportFn: redirectTransport,
    });
    expect(redirectResult.outcome).toBe("SSRF_BLOCKED");
    expect(redirectTransport).toHaveBeenCalledTimes(1);

    // 3. Valid public endpoint with controlled DNS pinning
    const pinned = await resolveAndPinSafePublicAddress("https://public.example.com/health", {
      dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    expect(pinned.pinnedIp).toBe("93.184.216.34");
  });

  it("prevents single-probe outage spam and noisy recovery flip-flopping", () => {
    // Single failure -> SUSPECTED_OUTAGE (no incident opened)
    const state = {
      status: "HEALTHY" as const,
      consecutiveFailures: 0,
      consecutiveSuccesses: 5,
      failureThreshold: 3,
      recoveryThreshold: 2,
    };

    const fail1 = evaluateMonitorTransition(state, false);
    expect(fail1.nextStatus).toBe("SUSPECTED_OUTAGE");
    expect(fail1.incidentAction).toBe("NONE");

    const fail2 = evaluateMonitorTransition(
      {
        ...state,
        status: fail1.nextStatus,
        consecutiveFailures: fail1.nextConsecutiveFailures,
        consecutiveSuccesses: 0,
      },
      false,
    );
    expect(fail2.nextStatus).toBe("SUSPECTED_OUTAGE");
    expect(fail2.incidentAction).toBe("NONE");

    const fail3 = evaluateMonitorTransition(
      {
        ...state,
        status: fail2.nextStatus,
        consecutiveFailures: fail2.nextConsecutiveFailures,
        consecutiveSuccesses: 0,
      },
      false,
    );
    expect(fail3.nextStatus).toBe("CONFIRMED_OUTAGE");
    expect(fail3.incidentAction).toBe("OPENED");

    // Noisy single success during outage -> RECOVERING (does NOT resolve yet)
    const ok1 = evaluateMonitorTransition(
      {
        ...state,
        status: fail3.nextStatus,
        consecutiveFailures: fail3.nextConsecutiveFailures,
        consecutiveSuccesses: 0,
      },
      true,
    );
    expect(ok1.nextStatus).toBe("RECOVERING");
    expect(ok1.incidentAction).toBe("NONE");

    // Another failure resets recovery -> stays CONFIRMED_OUTAGE (UPDATED, not duplicate OPENED)
    const relapse = evaluateMonitorTransition(
      {
        ...state,
        status: ok1.nextStatus,
        consecutiveFailures: 0,
        consecutiveSuccesses: ok1.nextConsecutiveSuccesses,
      },
      false,
    );
    expect(relapse.nextStatus).toBe("CONFIRMED_OUTAGE");
    expect(relapse.incidentAction).toBe("UPDATED");

    // Two consecutive successes -> HEALTHY & RESOLVED
    const rec1 = evaluateMonitorTransition(
      { ...state, status: relapse.nextStatus, consecutiveFailures: 1, consecutiveSuccesses: 0 },
      true,
    );
    const rec2 = evaluateMonitorTransition(
      {
        ...state,
        status: rec1.nextStatus,
        consecutiveFailures: 0,
        consecutiveSuccesses: rec1.nextConsecutiveSuccesses,
      },
      true,
    );
    expect(rec2.nextStatus).toBe("HEALTHY");
    expect(rec2.incidentAction).toBe("RESOLVED");
  });
});
