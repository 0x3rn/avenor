import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SecurityPosturePanel } from "@/components/reports/security-posture-panel";
import {
  evaluateResourcePassiveSecurityPosture,
  PASSIVE_POSTURE_DISCLAIMER,
  sanitizePostureAuditText,
  sanitizePostureEvidenceRecord,
} from "@/lib/reports/security-posture";

describe("THE-143: Passive security posture indicators and read-only sanitized audit summaries", () => {
  it("redacts emails, IP addresses, JWTs, provider tokens, and Postgres connection URIs from audit summaries and evidence", () => {
    const rawAudit =
      "Operator alice@company.io from 203.0.113.42 used napi_proj_secret123 and postgresql://user:pass@ep-1.neon.tech/db with eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig1234";
    const sanitized = sanitizePostureAuditText(rawAudit);

    expect(sanitized).not.toContain("alice@company.io");
    expect(sanitized).not.toContain("203.0.113.42");
    expect(sanitized).not.toContain("napi_proj_secret123");
    expect(sanitized).not.toContain("postgresql://");
    expect(sanitized).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(sanitized).toContain("[REDACTED_EMAIL]");
    expect(sanitized).toContain("[REDACTED_IP]");
    expect(sanitized).toContain("[REDACTED_TOKEN]");
    expect(sanitized).toContain("[REDACTED_DB_URI]");
    expect(sanitized).toContain("[REDACTED_JWT]");

    const cleanEvidence = sanitizePostureEvidenceRecord({
      sslEnforced: true,
      email: "hidden@example.com",
      smtp_secret: "shhh",
      ipAddress: "10.0.0.1",
      safeCount: 5,
    });
    expect(cleanEvidence).toEqual({
      sslEnforced: true,
      safeCount: 5,
    });
  });

  it("evaluates Supabase RLS honestly as NOT_VERIFIED without SQL access, flags Firebase rules error spikes as WARNING, and surfaces INSUFFICIENT_PERMISSION on revoked connections", () => {
    const sbIndicators = evaluateResourcePassiveSecurityPosture({
      connectedResourceId: "res_sb",
      providerConnectionId: "conn_sb",
      providerKey: "supabase",
      displayName: "Supabase Prod",
      connectionStatus: "HEALTHY",
      environmentId: "env_prod",
      metadata: {
        sslEnforced: true,
        networkRestrictionsConfigured: false,
        mfaTotpEnabled: true,
        rlsVerificationStatus: "NOT_VERIFIED",
      },
    });
    const rlsInd = sbIndicators.find((i) => i.indicatorKey === "supabase.rls_table_posture");
    const netInd = sbIndicators.find((i) => i.indicatorKey === "supabase.network_restrictions");
    expect(rlsInd?.status).toBe("NOT_VERIFIED");
    expect(netInd?.status).toBe("NOT_CONFIGURED");

    const fbWarningIndicators = evaluateResourcePassiveSecurityPosture({
      connectedResourceId: "res_fb",
      providerConnectionId: "conn_fb",
      providerKey: "firebase-monitoring",
      displayName: "Firebase Prod",
      connectionStatus: "HEALTHY",
      environmentId: "env_prod",
      metadata: { securityRulesTelemetryActive: true },
      firebaseRulesCounts: { allowCount: 1000, denyCount: 400, errorCount: 5 },
    });
    const rulesInd = fbWarningIndicators.find(
      (i) => i.indicatorKey === "firebase.security_rules_telemetry",
    );
    expect(rulesInd?.status).toBe("WARNING");

    const revokedIndicators = evaluateResourcePassiveSecurityPosture({
      connectedResourceId: "res_neon",
      providerConnectionId: "conn_neon",
      providerKey: "neon",
      displayName: "Neon Prod",
      connectionStatus: "REVOKED",
      environmentId: "env_prod",
      metadata: { protectedBranchConfigured: true },
    });
    expect(revokedIndicators).toHaveLength(1);
    expect(revokedIndicators[0]?.status).toBe("INSUFFICIENT_PERMISSION");
  });

  it("renders passive security posture panel with non-certification disclaimer, sanitized audit summaries, and zero external mutation controls", () => {
    render(
      <SecurityPosturePanel
        report={{
          projectId: "proj_1",
          projectName: "Avenor Core",
          observedAtIso: "2026-11-21T16:30:00.000Z",
          disclaimer: PASSIVE_POSTURE_DISCLAIMER,
          countsByStatus: {
            CONFIGURED: 1,
            NOT_CONFIGURED: 0,
            WARNING: 0,
            UNKNOWN: 0,
            NOT_VERIFIED: 1,
            UNAVAILABLE: 0,
            INSUFFICIENT_PERMISSION: 0,
          },
          indicators: [
            {
              id: "bsp_1",
              providerKey: "supabase",
              connectedResourceId: "res_sb",
              resourceDisplayName: "Supabase Prod",
              indicatorKey: "supabase.rls_table_posture",
              category: "DATA_PROTECTION_AND_RLS",
              title: "Table-Level Row Level Security (RLS) Qualification",
              status: "NOT_VERIFIED",
              summary: "Table-level RLS cannot be directly verified without SQL execution.",
              qualificationNote: "Zero-SQL read-only boundary preserved.",
              sanitizedEvidence: { zeroSqlBoundaryMaintained: true },
              observedAtIso: "2026-11-21T16:30:00.000Z",
            },
          ],
          recentAuditSummaries: [
            {
              id: "aud_1",
              action: "connection.oauth_completed",
              resourceType: "provider_connection",
              summary: "Read-only connection verified by [REDACTED_EMAIL]",
              actorRole: "OWNER",
              createdAtIso: "2026-11-21T16:25:00.000Z",
            },
          ],
        }}
      />,
    );

    expect(screen.getByTestId("passive-security-posture-panel")).toHaveTextContent(
      /not a certified penetration test/i,
    );
    expect(screen.getByTestId("posture-indicator-supabase.rls_table_posture")).toHaveTextContent(
      "NOT_VERIFIED",
    );
    expect(screen.getByTestId("sanitized-audit-summaries-panel")).toHaveTextContent(
      "[REDACTED_EMAIL]",
    );
    // Ensure zero mutation buttons exist in the passive posture panel
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
