import { assertReadOnlyAdapterContract, PROVIDER_ERROR_CODES } from "@avenor/types";
import { describe, expect, it, vi } from "vitest";
import {
  assertAllowedGoogleReadEndpoint,
  createFirebaseMonitoringReadOnlyAdapter,
  FIREBASE_CANONICAL_METRIC_KEYS,
  GOOGLE_MONITORING_READ_SCOPE,
  getProviderCatalogEntry,
  normalizeCloudMonitoringPoints,
} from "@/lib/providers";

describe("THE-141: Firebase / Google Cloud Monitoring read-only backend usage connector", () => {
  const firebaseCatalog = getProviderCatalogEntry("firebase-monitoring");
  if (!firebaseCatalog) {
    throw new Error("Expected firebase-monitoring provider catalog entry");
  }

  it("satisfies Avenor's strict read-only adapter contract and locks Cloud Monitoring v3 to GET-only descriptor and timeSeries endpoints", () => {
    const adapter = createFirebaseMonitoringReadOnlyAdapter(firebaseCatalog);
    expect(() => assertReadOnlyAdapterContract(adapter)).not.toThrow();

    expect(() =>
      assertAllowedGoogleReadEndpoint(
        "https://monitoring.googleapis.com/v3/projects/my-proj/timeSeries?filter=metric.type%3D%22firestore.googleapis.com%2Fdocument%2Fread_count%22",
        "GET",
      ),
    ).not.toThrow();

    expect(() =>
      assertAllowedGoogleReadEndpoint(
        "https://monitoring.googleapis.com/v3/projects/my-proj/metricDescriptors",
        "GET",
      ),
    ).not.toThrow();

    // POST to Cloud Monitoring is strictly prohibited (blocks custom timeSeries writes & alertPolicy creation)
    expect(() =>
      assertAllowedGoogleReadEndpoint(
        "https://monitoring.googleapis.com/v3/projects/my-proj/timeSeries",
        "POST",
      ),
    ).toThrow(/Cloud Monitoring telemetry access is strictly GET-only/i);

    // Unapproved Cloud Monitoring GET paths (e.g., alertPolicies or notificationChannels) are blocked
    expect(() =>
      assertAllowedGoogleReadEndpoint(
        "https://monitoring.googleapis.com/v3/projects/my-proj/notificationChannels",
        "GET",
      ),
    ).toThrow(/Blocked unapproved Cloud Monitoring GET path/i);
  });

  it("unconditionally rejects Firebase Admin SDK service accounts and broad cloud-platform scopes", async () => {
    const adapter = createFirebaseMonitoringReadOnlyAdapter(firebaseCatalog);

    await expect(
      adapter.validateCredentials({
        organizationId: "org_1",
        workspaceId: "ws_1",
        accessToken:
          '{"type":"service_account","client_email":"firebase-adminsdk@proj.iam.gserviceaccount.com","private_key":"-----BEGIN PRIVATE KEY-----"}',
        grantedScopes: [GOOGLE_MONITORING_READ_SCOPE],
      }),
    ).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
    });

    await expect(
      adapter.validateCredentials({
        organizationId: "org_1",
        workspaceId: "ws_1",
        accessToken: "ya29.valid_token",
        grantedScopes: [
          GOOGLE_MONITORING_READ_SCOPE,
          "https://www.googleapis.com/auth/cloud-platform",
        ],
      }),
    ).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.PERMISSION_DENIED,
    });
  });

  it("properly handles GAUGE (never summing sampled points), DELTA (summed intervals), and CUMULATIVE (reset-safe non-negative deltas without negative spikes)", () => {
    // 1. GAUGE: active listeners across 3 samples [120, 180, 150] -> latest=150, mean=150, max=180 (NEVER 450!)
    const gaugeResult = normalizeCloudMonitoringPoints(
      [
        { interval: { endTime: "2026-11-21T02:00:00Z" }, value: { int64Value: "150" } },
        { interval: { endTime: "2026-11-21T00:00:00Z" }, value: { int64Value: "120" } },
        { interval: { endTime: "2026-11-21T01:00:00Z" }, value: { int64Value: "180" } },
      ],
      "GAUGE",
      { gaugeRollup: "GAUGE_LATEST" },
    );
    expect(gaugeResult.rollupStrategy).toBe("GAUGE_LATEST");
    expect(gaugeResult.summaryValue).toBe(150);
    expect(gaugeResult.latestValue).toBe(150);
    expect(gaugeResult.meanValue).toBe(150);
    expect(gaugeResult.maxValue).toBe(180);
    expect(gaugeResult.summaryValue).not.toBe(450);

    // 2. DELTA: Firestore document reads across 2 intervals -> summed cleanly
    const deltaResult = normalizeCloudMonitoringPoints(
      [
        {
          interval: { startTime: "2026-11-20T00:00:00Z", endTime: "2026-11-21T00:00:00Z" },
          value: { int64Value: "312900" },
        },
        {
          interval: { startTime: "2026-11-19T00:00:00Z", endTime: "2026-11-20T00:00:00Z" },
          value: { int64Value: "284500" },
        },
      ],
      "DELTA",
    );
    expect(deltaResult.rollupStrategy).toBe("DELTA_SUM");
    expect(deltaResult.summaryValue).toBe(597_400);

    // 3. CUMULATIVE with counter reset: 100 -> 260 (+160) -> RESET to 45 (+45) -> 95 (+50)
    // Total delta = 100 + 160 + 45 + 50 = 355, zero negative points!
    const cumulativeResult = normalizeCloudMonitoringPoints(
      [
        {
          interval: { startTime: "2026-11-20T00:00:00Z", endTime: "2026-11-20T01:00:00Z" },
          value: { int64Value: "100" },
        },
        {
          interval: { startTime: "2026-11-20T00:00:00Z", endTime: "2026-11-20T02:00:00Z" },
          value: { int64Value: "260" },
        },
        {
          interval: { startTime: "2026-11-20T02:30:00Z", endTime: "2026-11-20T03:00:00Z" },
          value: { int64Value: "45" },
        },
        {
          interval: { startTime: "2026-11-20T02:30:00Z", endTime: "2026-11-20T04:00:00Z" },
          value: { int64Value: "95" },
        },
      ],
      "CUMULATIVE",
    );
    expect(cumulativeResult.counterResetsDetected).toBe(1);
    expect(cumulativeResult.points.map((p) => p.value)).toEqual([100, 160, 45, 50]);
    expect(cumulativeResult.points.every((p) => p.value >= 0)).toBe(true);
    expect(cumulativeResult.summaryValue).toBe(355);
  });

  it("reads mocked Cloud Monitoring v3 timeSeries for Firestore, Functions, and Storage and explicitly classifies user count as UNSUPPORTED_BY_PROVIDER", async () => {
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/monitoredResourceDescriptors")) {
        return new Response(
          JSON.stringify({
            resourceDescriptors: [
              { type: "firestore_instance" },
              { type: "cloud_function" },
              { type: "gcs_bucket" },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/metricDescriptors")) {
        return new Response(
          JSON.stringify({
            metricDescriptors: [
              { type: "firestore.googleapis.com/document/read_count" },
              { type: "firestore.googleapis.com/rules/evaluation_count" },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/timeSeries")) {
        return new Response(
          JSON.stringify({
            timeSeries: [
              {
                metricKind: "GAUGE",
                valueType: "DISTRIBUTION",
                points: [
                  {
                    interval: { endTime: "2026-11-21T00:00:00Z" },
                    value: { distributionValue: { count: 1200, mean: 185_400_000 } }, // 185.4 ms
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("Not Found", { status: 404 });
    }) as unknown as typeof fetch;

    const adapter = createFirebaseMonitoringReadOnlyAdapter(firebaseCatalog, {
      fetchFn: mockFetch,
    });
    const context = {
      organizationId: "org_1",
      workspaceId: "ws_1",
      accessToken: "ya29.monitoring_read_only",
      grantedScopes: [GOOGLE_MONITORING_READ_SCOPE],
    };

    const resources = await adapter.discoverResources(context);
    expect(resources).toHaveLength(1);
    expect(resources[0]?.metadata.adminSdkRejectedByDefault).toBe(true);
    expect(resources[0]?.metadata.firestoreEnabled).toBe(true);

    const fnExecTime = await adapter.readMetrics(context, {
      externalResourceId: "firebase-project:avenor-cloud-prod",
      capabilityKey: "firebase_telemetry",
      metricKey: FIREBASE_CANONICAL_METRIC_KEYS.FUNCTION_EXECUTION_TIME_MS,
      granularity: "daily",
      startDateIso: "2026-11-20T00:00:00.000Z",
      endDateIso: "2026-11-21T00:00:00.000Z",
    });
    expect(fnExecTime.capabilityStatus).toBe("SUPPORTED");
    expect(fnExecTime.points[0]?.unit).toBe("ms");
    expect(fnExecTime.points[0]?.value).toBe(185.4);
    expect(fnExecTime.statusExplanation).toContain("sampled gauge points are never summed");

    // Registered user count must never use Admin SDK or fabricate 0
    const userCount = await adapter.readMetrics(context, {
      externalResourceId: "firebase-project:avenor-cloud-prod",
      capabilityKey: "user_count_posture",
      metricKey: "firebase.registered_users",
      granularity: "daily",
      startDateIso: "2026-11-20T00:00:00.000Z",
      endDateIso: "2026-11-21T00:00:00.000Z",
    });
    expect(userCount.capabilityStatus).toBe("UNSUPPORTED_BY_PROVIDER");
    expect(userCount.points[0]?.value).toBeNull();
    expect(userCount.points[0]?.value).not.toBe(0);
  });
});
