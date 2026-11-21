import { type AuthenticatedSessionContext, authorizeWorkspaceAccess } from "@avenor/auth";
import { dbQuery, generateId } from "@avenor/database";
import { AppError, ERROR_CODES, redactSensitiveText } from "@avenor/types";
import { z } from "zod";

export type SupportCategory =
  | "BUG"
  | "BILLING"
  | "INTEGRATION"
  | "SECURITY"
  | "FEEDBACK"
  | "GENERAL";

export interface SupportRequestRecord {
  id: string;
  workspaceId: string | null;
  contactEmail: string;
  category: SupportCategory;
  subject: string;
  description: string;
  status: "OPEN" | "IN_REVIEW" | "RESOLVED";
  createdAtIso: string;
}

const submitSupportSchema = z.object({
  contactEmail: z.string().email(),
  category: z
    .enum(["BUG", "BILLING", "INTEGRATION", "SECURITY", "FEEDBACK", "GENERAL"])
    .default("GENERAL"),
  subject: z.string().trim().min(4).max(160),
  description: z.string().trim().min(10).max(2500),
  workspaceId: z.string().min(1).nullable().optional(),
});

/**
 * Persists a sanitized support/feedback request, scrubbing any accidentally pasted
 * secrets, Bearer tokens, or database URIs before storage.
 */
export async function submitSupportRequest(
  session: AuthenticatedSessionContext | null,
  rawInput: z.input<typeof submitSupportSchema>,
): Promise<SupportRequestRecord> {
  const parsed = submitSupportSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }
  const input = parsed.data;
  const sanitizedSubject = redactSensitiveText(
    input.subject.replace(/(?:postgres(?:ql)?|mysql|mongodb):\/\/[^\s"']+/gi, "[REDACTED_DB_URI]"),
  );
  const sanitizedDescription = redactSensitiveText(
    input.description.replace(
      /(?:postgres(?:ql)?|mysql|mongodb):\/\/[^\s"']+/gi,
      "[REDACTED_DB_URI]",
    ),
  );

  const id = generateId("sup");
  const inserted = await dbQuery<Record<string, unknown>>(
    `INSERT INTO support_requests (
      id, organization_id, workspace_id, user_id, contact_email, category,
      subject, description, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'OPEN') RETURNING *`,
    [
      id,
      session?.activeOrganizationId ?? null,
      input.workspaceId ?? session?.activeWorkspace.id ?? null,
      session?.user.id ?? null,
      input.contactEmail.trim().toLowerCase(),
      input.category,
      sanitizedSubject,
      sanitizedDescription,
    ],
  );
  const row = inserted.rows[0] ?? {};
  return {
    id: String(row.id),
    workspaceId: row.workspace_id ? String(row.workspace_id) : null,
    contactEmail: String(row.contact_email),
    category: String(row.category) as SupportCategory,
    subject: String(row.subject),
    description: String(row.description),
    status: String(row.status) as SupportRequestRecord["status"],
    createdAtIso: new Date(String(row.created_at)).toISOString(),
  };
}

export async function listWorkspaceSupportRequests(
  session: AuthenticatedSessionContext | null,
  workspaceId?: string,
): Promise<SupportRequestRecord[]> {
  const targetWs = workspaceId ?? session?.activeWorkspace.id ?? "";
  await authorizeWorkspaceAccess({
    session,
    workspaceId: targetWs,
    requiredPermission: "workspace:read",
  });
  const res = await dbQuery<Record<string, unknown>>(
    `SELECT * FROM support_requests WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [targetWs],
  );
  return res.rows.map((row) => ({
    id: String(row.id),
    workspaceId: row.workspace_id ? String(row.workspace_id) : null,
    contactEmail: String(row.contact_email),
    category: String(row.category) as SupportCategory,
    subject: String(row.subject),
    description: String(row.description),
    status: String(row.status) as SupportRequestRecord["status"],
    createdAtIso: new Date(String(row.created_at)).toISOString(),
  }));
}
