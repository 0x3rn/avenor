import { type AuthenticatedSessionContext, authorizeWorkspaceAccess } from "@avenor/auth";
import { dbQuery, generateId, withTransaction } from "@avenor/database";
import { AppError, ERROR_CODES } from "@avenor/types";
import { z } from "zod";
import { sharedReportCache } from "@/lib/reports/cache";

export type PrivacyConsentType =
  | "TERMS_OF_SERVICE"
  | "PRIVACY_POLICY"
  | "MARKETING_OPT_IN"
  | "AI_PROCESSING";

export interface PrivacyConsentRecord {
  id: string;
  userId: string;
  workspaceId: string | null;
  consentType: PrivacyConsentType;
  policyVersion: string;
  granted: boolean;
  recordedAtIso: string;
}

export interface PersonalDataPortabilityBundle {
  schemaVersion: "1.0";
  exportedAtIso: string;
  account: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    createdAtIso: string;
  };
  memberships: Array<{
    workspaceId: string;
    workspaceName: string;
    role: string;
  }>;
  consents: PrivacyConsentRecord[];
  excludedSecurityCategories: string[];
}

const ERASURE_DISCLOSURE_NOTE =
  "Active database rows, sessions, and encrypted provider credentials have been purged from the live Neon PostgreSQL database and caches invalidated. Historical Neon point-in-time recovery backups expire on schedule, and Lemon Squeezy retains merchant-of-record tax/accounting records where legally required.";

const consentSchema = z.object({
  workspaceId: z.string().min(1).nullable().optional(),
  consentType: z.enum(["TERMS_OF_SERVICE", "PRIVACY_POLICY", "MARKETING_OPT_IN", "AI_PROCESSING"]),
  policyVersion: z.string().trim().min(1).max(40).default("2026-11-v1"),
  granted: z.boolean(),
});

export async function recordPrivacyConsent(
  session: AuthenticatedSessionContext | null,
  rawInput: z.input<typeof consentSchema>,
): Promise<PrivacyConsentRecord> {
  if (!session) {
    throw new AppError({
      code: ERROR_CODES.UNAUTHENTICATED,
      message: "Authentication is required to record privacy consents.",
    });
  }
  const parsed = consentSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }
  const input = parsed.data;
  const id = generateId("pcon");
  const inserted = await dbQuery<Record<string, unknown>>(
    `INSERT INTO privacy_consents (id, user_id, workspace_id, consent_type, policy_version, granted)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      id,
      session.user.id,
      input.workspaceId ?? null,
      input.consentType,
      input.policyVersion,
      input.granted,
    ],
  );
  const row = inserted.rows[0] ?? {};
  return {
    id: String(row.id),
    userId: String(row.user_id),
    workspaceId: row.workspace_id ? String(row.workspace_id) : null,
    consentType: String(row.consent_type) as PrivacyConsentType,
    policyVersion: String(row.policy_version),
    granted: Boolean(row.granted),
    recordedAtIso: new Date(String(row.recorded_at)).toISOString(),
  };
}

export async function listUserPrivacyConsents(
  session: AuthenticatedSessionContext | null,
): Promise<PrivacyConsentRecord[]> {
  if (!session) {
    throw new AppError({
      code: ERROR_CODES.UNAUTHENTICATED,
      message: "Authentication is required to inspect privacy consents.",
    });
  }
  const res = await dbQuery<Record<string, unknown>>(
    `SELECT * FROM privacy_consents WHERE user_id = $1 ORDER BY recorded_at DESC LIMIT 100`,
    [session.user.id],
  );
  return res.rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    workspaceId: row.workspace_id ? String(row.workspace_id) : null,
    consentType: String(row.consent_type) as PrivacyConsentType,
    policyVersion: String(row.policy_version),
    granted: Boolean(row.granted),
    recordedAtIso: new Date(String(row.recorded_at)).toISOString(),
  }));
}

/**
 * Exports strictly the caller's own personal account data, membership metadata, and consents.
 * Never exposes password hashes, OAuth refresh tokens, encryption keys, or other tenants' metrics.
 */
export async function exportPersonalAccountData(
  session: AuthenticatedSessionContext | null,
): Promise<PersonalDataPortabilityBundle> {
  if (!session) {
    throw new AppError({
      code: ERROR_CODES.UNAUTHENTICATED,
      message: "Authentication is required to export personal account data.",
    });
  }

  const [userRes, memRes, consents] = await Promise.all([
    dbQuery<{ id: string; email: string; name: string; email_verified: boolean; created_at: Date }>(
      `SELECT id, email, name, email_verified, created_at FROM users WHERE id = $1`,
      [session.user.id],
    ),
    dbQuery<{ workspace_id: string; workspace_name: string; role: string }>(
      `SELECT wm.workspace_id, w.name AS workspace_name, wm.role
       FROM workspace_memberships wm
       JOIN workspaces w ON w.id = wm.workspace_id
       WHERE wm.user_id = $1
       ORDER BY w.created_at ASC`,
      [session.user.id],
    ),
    listUserPrivacyConsents(session),
  ]);

  const user = userRes.rows[0];
  if (!user) {
    throw new AppError({ code: ERROR_CODES.NOT_FOUND, message: "Account not found." });
  }

  return {
    schemaVersion: "1.0",
    exportedAtIso: new Date().toISOString(),
    account: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: Boolean(user.email_verified),
      createdAtIso: new Date(user.created_at).toISOString(),
    },
    memberships: memRes.rows.map((m) => ({
      workspaceId: m.workspace_id,
      workspaceName: m.workspace_name,
      role: m.role,
    })),
    consents,
    excludedSecurityCategories: [
      "password_hashes",
      "oauth_access_and_refresh_tokens",
      "credential_encryption_keys",
      "shared_workspace_metrics_and_other_members_pii",
    ],
  };
}

/**
 * OWNER-only confirmed workspace deletion cascade purging encrypted credentials,
 * invalidating caches, and transparently disclosing backup & merchant retention boundaries.
 */
export async function deleteWorkspaceCascade(
  session: AuthenticatedSessionContext | null,
  input: { workspaceId: string; confirmationSlug: string },
): Promise<{
  deleted: true;
  workspaceId: string;
  credentialsPurged: number;
  disclosureNote: string;
}> {
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId: input.workspaceId,
    requiredPermission: "workspace:update",
  });
  if (access.role !== "OWNER") {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "Only a workspace OWNER can delete a workspace.",
    });
  }

  const result = await withTransaction(async (client) => {
    const wsRes = await client.query<{ slug: string; organization_id: string }>(
      `SELECT slug, organization_id FROM workspaces WHERE id = $1 FOR UPDATE`,
      [input.workspaceId],
    );
    const ws = wsRes.rows[0];
    if (!ws) {
      throw new AppError({ code: ERROR_CODES.NOT_FOUND, message: "Workspace not found." });
    }
    if (input.confirmationSlug.trim() !== ws.slug) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Workspace deletion requires confirmationSlug matching "${ws.slug}".`,
      });
    }

    const credDel = await client.query(
      `DELETE FROM provider_credentials
       WHERE provider_connection_id IN (
         SELECT id FROM provider_connections WHERE workspace_id = $1
       )`,
      [input.workspaceId],
    );
    await client.query(`DELETE FROM workspaces WHERE id = $1`, [input.workspaceId]);

    return {
      organizationId: ws.organization_id,
      credentialsPurged: credDel.rowCount ?? 0,
    };
  });

  sharedReportCache.invalidateWorkspace(result.organizationId, input.workspaceId);

  return {
    deleted: true,
    workspaceId: input.workspaceId,
    credentialsPurged: result.credentialsPurged,
    disclosureNote: ERASURE_DISCLOSURE_NOTE,
  };
}

/**
 * Safe personal account deletion refusing to orphan multi-member workspaces where the user
 * is the sole remaining OWNER, revoking active sessions, and cascading personal records.
 */
export async function deletePersonalAccountSafely(
  session: AuthenticatedSessionContext | null,
  input: { confirmationEmail: string; deleteSoleOwnedEmptyWorkspaces?: boolean },
): Promise<{
  deleted: true;
  userId: string;
  deletedSoleWorkspaces: number;
  disclosureNote: string;
}> {
  if (!session) {
    throw new AppError({
      code: ERROR_CODES.UNAUTHENTICATED,
      message: "Authentication is required to delete your account.",
    });
  }
  if (input.confirmationEmail.trim().toLowerCase() !== session.user.email.trim().toLowerCase()) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "Account deletion confirmation email does not match your signed-in account.",
    });
  }

  return withTransaction(async (client) => {
    // Check all workspaces where this user is the sole OWNER
    const soleOwnerWs = await client.query<{ workspace_id: string; member_count: string }>(
      `SELECT wm.workspace_id,
              (SELECT COUNT(*)::text FROM workspace_memberships m2 WHERE m2.workspace_id = wm.workspace_id) AS member_count
       FROM workspace_memberships wm
       WHERE wm.user_id = $1 AND wm.role = 'OWNER'
         AND (SELECT COUNT(*) FROM workspace_memberships m3 WHERE m3.workspace_id = wm.workspace_id AND m3.role = 'OWNER') = 1`,
      [session.user.id],
    );

    const sharedOrphanRisks = soleOwnerWs.rows.filter((r) => Number(r.member_count) > 1);
    if (sharedOrphanRisks.length > 0) {
      throw new AppError({
        code: ERROR_CODES.CONFLICT,
        message:
          "You are the sole OWNER of one or more shared workspaces with other members. Transfer workspace ownership or delete those workspaces before deleting your account.",
      });
    }

    let deletedSoleWorkspaces = 0;
    if (input.deleteSoleOwnedEmptyWorkspaces && soleOwnerWs.rows.length > 0) {
      for (const ws of soleOwnerWs.rows) {
        await client.query(`DELETE FROM workspaces WHERE id = $1`, [ws.workspace_id]);
        deletedSoleWorkspaces++;
      }
    }

    await client.query(`DELETE FROM sessions WHERE user_id = $1`, [session.user.id]);
    await client.query(`DELETE FROM users WHERE id = $1`, [session.user.id]);

    return {
      deleted: true,
      userId: session.user.id,
      deletedSoleWorkspaces,
      disclosureNote: ERASURE_DISCLOSURE_NOTE,
    };
  });
}
