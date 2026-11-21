import { describe, expect, it } from "vitest";
import {
  assertSafeBackendCredential,
  BACKEND_CAPABILITY_DIMENSIONS,
  BACKEND_FEASIBILITY_MATRIX,
  BACKEND_FEASIBILITY_STATUSES,
  BACKEND_PILOT_ADR,
  BACKEND_PROVIDER_KEYS,
  evaluateBackendCredentialSafety,
  getBackendDimensionEvaluation,
  getBackendProviderFeasibilityMatrix,
} from "@/lib/providers/backend-feasibility";

describe("THE-138: Backend provider metric surface feasibility matrix and pilot ADR", () => {
  it("encodes all 15 feasibility dimensions across Neon, Supabase, and Firebase/GCP Cloud Monitoring (45 evaluations)", () => {
    expect(BACKEND_CAPABILITY_DIMENSIONS).toHaveLength(15);
    expect(BACKEND_PROVIDER_KEYS).toEqual(["neon", "supabase", "firebase-monitoring"]);
    expect(BACKEND_FEASIBILITY_MATRIX).toHaveLength(45);

    for (const providerKey of BACKEND_PROVIDER_KEYS) {
      const providerRows = getBackendProviderFeasibilityMatrix(providerKey);
      expect(providerRows).toHaveLength(15);
      for (const dimensionKey of BACKEND_CAPABILITY_DIMENSIONS) {
        const evaluation = getBackendDimensionEvaluation(providerKey, dimensionKey);
        expect(BACKEND_FEASIBILITY_STATUSES).toContain(evaluation.status);
        expect(evaluation.summary.length).toBeGreaterThan(20);
        expect(evaluation.securityGuardrail.length).toBeGreaterThan(15);
      }
    }
  });

  it("enforces honest user count and metric unit semantics across backend providers", () => {
    // 1. Neon user count is UNAVAILABLE (no control-plane user directory; never query customer SQL tables)
    const neonUserCount = getBackendDimensionEvaluation("neon", "user_count_auth_posture");
    expect(neonUserCount.status).toBe("UNAVAILABLE");
    expect(neonUserCount.allowsNumericMetric).toBe(false);

    // 2. Firebase Cloud Monitoring user count is UNAVAILABLE (Admin SDK user enumeration prohibited)
    const firebaseUserCount = getBackendDimensionEvaluation(
      "firebase-monitoring",
      "user_count_auth_posture",
    );
    expect(firebaseUserCount.status).toBe("UNAVAILABLE");
    expect(firebaseUserCount.allowsNumericMetric).toBe(false);

    // 3. Supabase user count is SUPPORTED_WITH_LIMITATIONS (aggregate counter only, never raw auth.users or auth_requests conflation)
    const supabaseUserCount = getBackendDimensionEvaluation("supabase", "user_count_auth_posture");
    expect(supabaseUserCount.status).toBe("SUPPORTED_WITH_LIMITATIONS");
    expect(supabaseUserCount.unitAndSemanticNotes).toContain(
      "strictly separate from supabase.auth_requests",
    );

    // 4. Neon storage distinguishes bytes_month consumption vs instantaneous bytes
    const neonStorage = getBackendDimensionEvaluation("neon", "db_storage_metrics");
    expect(neonStorage.unitAndSemanticNotes).toContain("neon.storage_consumption_bytes_month");
    expect(neonStorage.unitAndSemanticNotes).toContain("neon.instantaneous_storage_bytes");

    // 5. Neon compute distinguishes compute_unit_seconds vs CPU percentage
    const neonCompute = getBackendDimensionEvaluation("neon", "compute_connection_metrics");
    expect(neonCompute.unitAndSemanticNotes).toContain(
      "Never mislabel compute-unit seconds as CPU utilization percentage",
    );
  });

  it("flags Neon project-scoped keys as not intrinsically read-only upstream and requires Avenor GET-only adapter lock", () => {
    const unlockedNeonVerdict = evaluateBackendCredentialSafety({
      providerKey: "neon",
      credentialType: "neon_project_scoped_api_key",
      rawTokenPreview: "napi_proj_12345",
      methodAllowlistEnforced: false,
    });
    expect(unlockedNeonVerdict.accepted).toBe(false);
    expect(unlockedNeonVerdict.status).toBe("UNSAFE");
    expect(unlockedNeonVerdict.rejectionCode).toBe("NEON_KEY_REQUIRES_GET_ONLY_ADAPTER_LOCK");

    const lockedNeonVerdict = evaluateBackendCredentialSafety({
      providerKey: "neon",
      credentialType: "neon_project_scoped_api_key",
      rawTokenPreview: "napi_proj_12345",
      methodAllowlistEnforced: true,
    });
    expect(lockedNeonVerdict.accepted).toBe(true);
    expect(lockedNeonVerdict.status).toBe("SUPPORTED_WITH_LIMITATIONS");
    expect(lockedNeonVerdict.intrinsicProviderReadOnly).toBe(false);
    expect(lockedNeonVerdict.requiresAdapterMethodAllowlist).toBe(true);
  });

  it("unconditionally rejects Supabase service_role JWTs, sb_secret keys, and direct Postgres connection strings", () => {
    // service_role JWT payload: {"role":"service_role","iss":"supabase"}
    const fakeServiceRolePayload = Buffer.from(
      JSON.stringify({ role: "service_role", iss: "supabase" }),
    ).toString("base64url");
    const fakeJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${fakeServiceRolePayload}.sig`;

    const jwtVerdict = evaluateBackendCredentialSafety({
      providerKey: "supabase",
      credentialType: "supabase_pat",
      rawTokenPreview: fakeJwt,
    });
    expect(jwtVerdict.accepted).toBe(false);
    expect(jwtVerdict.status).toBe("UNSAFE");
    expect(jwtVerdict.rejectionCode).toBe("PROHIBITED_SUPABASE_SERVICE_ROLE_JWT_CLAIM");

    const secretKeyVerdict = evaluateBackendCredentialSafety({
      providerKey: "supabase",
      credentialType: "supabase_secret_key",
      rawTokenPreview: "sb_secret_987654321",
    });
    expect(secretKeyVerdict.accepted).toBe(false);
    expect(secretKeyVerdict.status).toBe("UNSAFE");
    expect(secretKeyVerdict.rejectionCode).toBe("PROHIBITED_SUPABASE_SERVICE_ROLE_OR_SECRET_KEY");

    expect(() =>
      assertSafeBackendCredential({
        providerKey: "neon",
        credentialType: "postgres_connection_string",
        rawTokenPreview:
          "postgresql://neondb_owner:secret@ep-cool-darkness.us-east-2.aws.neon.tech/neondb",
      }),
    ).toThrow(/never connects directly to customer PostgreSQL databases/i);

    const validSupabaseOAuth = evaluateBackendCredentialSafety({
      providerKey: "supabase",
      credentialType: "supabase_oauth_token",
      rawTokenPreview: "sbp_oauth_readonly_token",
      grantedScopes: ["projects:read", "analytics:read"],
    });
    expect(validSupabaseOAuth.accepted).toBe(true);
    expect(validSupabaseOAuth.status).toBe("SUPPORTED");
    expect(validSupabaseOAuth.intrinsicProviderReadOnly).toBe(true);
  });

  it("unconditionally rejects Firebase Admin SDK service accounts and broad cloud-platform scopes while accepting monitoring.read", () => {
    const adminSdkVerdict = evaluateBackendCredentialSafety({
      providerKey: "firebase-monitoring",
      credentialType: "firebase_admin_sdk_key",
      rawTokenPreview: '{"type":"service_account","private_key":"-----BEGIN PRIVATE KEY-----"}',
    });
    expect(adminSdkVerdict.accepted).toBe(false);
    expect(adminSdkVerdict.status).toBe("UNSAFE");
    expect(adminSdkVerdict.rejectionCode).toBe("PROHIBITED_FIREBASE_ADMIN_SDK_CREDENTIAL");

    const broadScopeVerdict = evaluateBackendCredentialSafety({
      providerKey: "firebase-monitoring",
      credentialType: "oauth2_access_token",
      grantedScopes: [
        "https://www.googleapis.com/auth/monitoring.read",
        "https://www.googleapis.com/auth/cloud-platform",
      ],
    });
    expect(broadScopeVerdict.accepted).toBe(false);
    expect(broadScopeVerdict.status).toBe("UNSAFE");
    expect(broadScopeVerdict.rejectionCode).toBe("PROHIBITED_BROAD_GCP_OR_FIREBASE_SCOPE");

    const validMonitoringRead = evaluateBackendCredentialSafety({
      providerKey: "firebase-monitoring",
      credentialType: "oauth2_access_token",
      grantedScopes: ["https://www.googleapis.com/auth/monitoring.read"],
    });
    expect(validMonitoringRead.accepted).toBe(true);
    expect(validMonitoringRead.status).toBe("SUPPORTED");
    expect(validMonitoringRead.intrinsicProviderReadOnly).toBe(true);
  });

  it("records the Milestone 06 Pilot ADR selecting firebase-monitoring as the primary cryptographic read-only telemetry pilot", () => {
    expect(BACKEND_PILOT_ADR.status).toBe("ACCEPTED");
    expect(BACKEND_PILOT_ADR.primaryPilotProviderKey).toBe("firebase-monitoring");
    expect(BACKEND_PILOT_ADR.candidates).toHaveLength(3);
    expect(BACKEND_PILOT_ADR.candidates[0]?.providerKey).toBe("firebase-monitoring");
    expect(BACKEND_PILOT_ADR.candidates[0]?.cryptographicReadOnlyScore).toBe(100);
    expect(BACKEND_PILOT_ADR.keyArchitecturalRules.length).toBeGreaterThanOrEqual(5);
  });
});
