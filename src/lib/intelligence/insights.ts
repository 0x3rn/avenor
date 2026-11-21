import {
  type AuthenticatedSessionContext,
  authorizeProjectAccess,
  authorizeWorkspaceAccess,
} from "@avenor/auth";
import { dbQuery, generateId } from "@avenor/database";
import { redactSensitiveText } from "@avenor/types";
import { z } from "zod";

export interface InsightEvidenceItem {
  readonly evidenceId: string;
  readonly providerKey: string;
  readonly metricKey: string;
  readonly label: string;
  readonly currentValue: number;
  readonly priorValue: number | null;
  readonly unit: string;
  readonly currency?: string | null;
  readonly periodLabel: string;
  readonly freshnessNote?: string;
}

export interface GeneratedInsightRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly mode: "DETERMINISTIC" | "AI_ASSISTED";
  readonly headline: string;
  readonly summary: string;
  readonly evidenceIds: readonly string[];
  readonly caveats: readonly string[];
  readonly suggestedChecks: readonly string[];
  readonly verifiedNumericClaims: boolean;
  readonly providerModel: string | null;
  readonly fallbackReason: string | null;
  readonly createdAtIso: string;
}

export const guardedAiNarrativeSchema = z.object({
  headline: z.string().trim().min(5).max(180),
  summary: z.string().trim().min(10).max(1200),
  evidenceIds: z.array(z.string().min(1)).min(1).max(20),
  caveats: z.array(z.string().trim().min(2).max(240)).max(10).default([]),
  suggestedChecks: z.array(z.string().trim().min(2).max(240)).max(10).default([]),
});

export type GuardedAiNarrativeCandidate = z.infer<typeof guardedAiNarrativeSchema>;

const PROMPT_INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(?:all\s+|previous\s+|prior\s+)?instructions/gi,
  /reveal\s+(?:all\s+)?(?:tokens|secrets|credentials|passwords|keys)/gi,
  /\bsystem\s*:\s*/gi,
  /disregard\s+(?:safety|guardrails|rules)/gi,
];

const PROHIBITED_AI_ACTION_CLAIMS: readonly RegExp[] = [
  /\b(?:i\s+have\s+)?(?:redeployed|rolled\s+back|resolved\s+the\s+sentry\s+issue|modified\s+your\s+dns|deleted\s+your\s+database|updated\s+your\s+cloud\s+budget)\b/i,
  /\b(?:definitely|conclusively|100%\s+proven)\s+(?:caused\s+by|root\s+cause)\b/i,
];

/**
 * Scrubs PII/tokens and neutralizes untrusted prompt-injection directives before any
 * external string enters a model prompt context.
 */
export function sanitizeUntrustedEvidenceText(raw: string): string {
  let clean = redactSensitiveText(raw)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[REDACTED_JWT]");

  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    clean = clean.replace(pattern, "[NEUTRALIZED_UNTRUSTED_TEXT]");
  }
  return clean.slice(0, 240);
}

/**
 * Computes all mathematically valid numbers derivable from an authorized evidence bundle
 * (current, prior, absolute delta, percentage change) so AI output can be verified against them.
 */
function buildAllowedNumericSet(evidence: readonly InsightEvidenceItem[]): number[] {
  const allowed: number[] = [];
  for (const item of evidence) {
    allowed.push(item.currentValue);
    if (item.priorValue !== null) {
      allowed.push(item.priorValue);
      const absDelta = Math.abs(item.currentValue - item.priorValue);
      allowed.push(absDelta);
      if (item.priorValue !== 0) {
        const pct = Math.abs(((item.currentValue - item.priorValue) / item.priorValue) * 100);
        allowed.push(pct);
        allowed.push(Math.round(pct));
        allowed.push(Math.round(pct * 10) / 10);
      }
    }
  }
  return allowed;
}

function extractNumbersFromText(text: string): number[] {
  // Ignore ISO dates (YYYY-MM-DD) and alphanumeric identifiers like GA4, v2, 5xx
  const withoutDates = text.replace(/\b20\d{2}-\d{2}-\d{2}\b/g, " ");
  const matches = withoutDates.match(/(?<![A-Za-z])(?:-?\d+(?:,\d{3})*(?:\.\d+)?)(?![A-Za-z])/g) ?? [];
  return matches
    .map((m) => Math.abs(Number(m.replace(/,/g, ""))))
    .filter((n) => Number.isFinite(n));
}

/**
 * Independently verifies an AI-generated narrative candidate against the authorized evidence
 * bundle: checks schema, evidenceId membership, prohibited action claims, and EVERY numeric claim.
 */
export function validateGuardedAiNarrativeOutput(
  rawCandidate: unknown,
  evidence: readonly InsightEvidenceItem[],
):
  | { valid: true; narrative: GuardedAiNarrativeCandidate }
  | { valid: false; reason: string; unverifiedNumbers?: number[] } {
  const parsed = guardedAiNarrativeSchema.safeParse(rawCandidate);
  if (!parsed.success) {
    return {
      valid: false,
      reason: `Schema validation failed: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    };
  }
  const candidate = parsed.data;
  const allowedEvidenceIds = new Set(evidence.map((e) => e.evidenceId));
  const invalidIds = candidate.evidenceIds.filter((id) => !allowedEvidenceIds.has(id));
  if (invalidIds.length > 0) {
    return {
      valid: false,
      reason: `Unverified evidence references cited: ${invalidIds.join(", ")}`,
    };
  }

  const combinedText = `${candidate.headline} ${candidate.summary}`;
  for (const pattern of PROHIBITED_AI_ACTION_CLAIMS) {
    if (pattern.test(combinedText)) {
      return {
        valid: false,
        reason: "Rejected prohibited autonomous-action or unproven-causation claim in AI output.",
      };
    }
  }

  const allowedNumbers = buildAllowedNumericSet(evidence);
  const claimedNumbers = extractNumbersFromText(combinedText);
  const unverified: number[] = [];

  for (const claimed of claimedNumbers) {
    const matched = allowedNumbers.some(
      (allowed) => Math.abs(allowed - claimed) <= Math.max(0.15, Math.abs(allowed) * 0.005),
    );
    if (!matched) {
      unverified.push(claimed);
    }
  }

  if (unverified.length > 0) {
    return {
      valid: false,
      reason: `Rejected hallucinated/unverified numeric claim(s) not backed by evidence bundle: ${unverified.join(", ")}`,
      unverifiedNumbers: unverified,
    };
  }

  return { valid: true, narrative: candidate };
}

/**
 * Generates a 100% deterministic, evidence-linked summary directly from verified observations.
 * Operates with zero external AI dependency.
 */
export function buildDeterministicEvidenceInsight(
  evidence: readonly InsightEvidenceItem[],
): Omit<
  GeneratedInsightRecord,
  "id" | "workspaceId" | "projectId" | "createdAtIso" | "fallbackReason"
> {
  if (evidence.length === 0) {
    return {
      mode: "DETERMINISTIC",
      headline: "No verified metric observations available in the selected window",
      summary:
        "Connect an authorized provider and complete an ingestion sync to generate evidence-linked summaries.",
      evidenceIds: [],
      caveats: ["Missing observations are never treated as zero."],
      suggestedChecks: ["Verify provider connection health and ingestion watermarks."],
      verifiedNumericClaims: true,
      providerModel: null,
    };
  }

  const sentences: string[] = [];
  const caveats: string[] = [
    "Deterministic summary generated directly from stored Avenor observations; correlation is not proven causation.",
  ];
  const checks: string[] = [];

  for (const item of evidence) {
    const cleanLabel = sanitizeUntrustedEvidenceText(item.label);
    const formattedVal = item.currency
      ? `${item.currency} ${item.currentValue.toFixed(2)}`
      : `${item.currentValue} ${item.unit}`;

    if (item.priorValue !== null && item.priorValue !== 0) {
      const deltaPct = ((item.currentValue - item.priorValue) / item.priorValue) * 100;
      const dir = deltaPct >= 0 ? "increased" : "decreased";
      sentences.push(
        `${cleanLabel} (${item.providerKey}) ${dir} by ${Math.abs(deltaPct).toFixed(1)}% to ${formattedVal} compared with ${item.priorValue} in the prior period (${item.periodLabel}).`,
      );
      if (Math.abs(deltaPct) >= 15) {
        checks.push(
          `Inspect ${cleanLabel} breakdowns in ${item.providerKey} for ${item.periodLabel}.`,
        );
      }
    } else {
      sentences.push(
        `${cleanLabel} (${item.providerKey}) recorded ${formattedVal} for ${item.periodLabel}.`,
      );
    }
    if (item.freshnessNote) {
      caveats.push(`${cleanLabel}: ${sanitizeUntrustedEvidenceText(item.freshnessNote)}`);
    }
  }

  const lead = evidence[0];
  return {
    mode: "DETERMINISTIC",
    headline: lead
      ? `${sanitizeUntrustedEvidenceText(lead.label)} summary (${lead.periodLabel})`
      : "Verified Product Intelligence Summary",
    summary: sentences.join(" "),
    evidenceIds: evidence.map((e) => e.evidenceId),
    caveats,
    suggestedChecks:
      checks.length > 0
        ? checks
        : ["Review source freshness and operational timeline for context."],
    verifiedNumericClaims: true,
    providerModel: null,
  };
}

export type OptionalAiNarrativeGenerator = (
  sanitizedEvidence: readonly InsightEvidenceItem[],
) => Promise<{ model: string; candidate: unknown }>;

export async function generateAndPersistInsightSummary(
  session: AuthenticatedSessionContext | null,
  options: {
    workspaceId?: string;
    projectId?: string | null;
    evidence: readonly InsightEvidenceItem[];
    preferAi?: boolean;
    aiGenerator?: OptionalAiNarrativeGenerator;
  },
): Promise<GeneratedInsightRecord> {
  const workspaceId = options.workspaceId ?? session?.activeWorkspace.id ?? "";
  let organizationId: string;

  if (options.projectId) {
    const access = await authorizeProjectAccess({
      session,
      projectId: options.projectId,
      requiredPermission: "project:read",
    });
    organizationId = access.organizationId;
  } else {
    const access = await authorizeWorkspaceAccess({
      session,
      workspaceId,
      requiredPermission: "project:read",
    });
    organizationId = access.organizationId;
  }

  const sanitizedEvidence = options.evidence.map((e) => ({
    ...e,
    label: sanitizeUntrustedEvidenceText(e.label),
    freshnessNote: e.freshnessNote ? sanitizeUntrustedEvidenceText(e.freshnessNote) : undefined,
  }));

  const deterministic = buildDeterministicEvidenceInsight(sanitizedEvidence);
  let finalResult = deterministic;
  let fallbackReason: string | null = null;

  if (options.preferAi) {
    if (!options.aiGenerator) {
      fallbackReason =
        "AI narrative provider is not configured (OPENAI_API_KEY / AI_GATEWAY_API_KEY absent); rendered deterministic verified summary.";
    } else {
      try {
        const generated = await options.aiGenerator(sanitizedEvidence);
        const verification = validateGuardedAiNarrativeOutput(
          generated.candidate,
          sanitizedEvidence,
        );
        if (verification.valid) {
          finalResult = {
            mode: "AI_ASSISTED",
            headline: verification.narrative.headline,
            summary: verification.narrative.summary,
            evidenceIds: verification.narrative.evidenceIds,
            caveats:
              verification.narrative.caveats.length > 0
                ? verification.narrative.caveats
                : deterministic.caveats,
            suggestedChecks:
              verification.narrative.suggestedChecks.length > 0
                ? verification.narrative.suggestedChecks
                : deterministic.suggestedChecks,
            verifiedNumericClaims: true,
            providerModel: generated.model,
          };
        } else {
          fallbackReason = `${verification.reason} — fell back to verified deterministic summary.`;
        }
      } catch (err) {
        fallbackReason = `AI provider unavailable (${err instanceof Error ? err.message : "unknown error"}) — fell back to verified deterministic summary.`;
      }
    }
  }

  const id = generateId("insg");
  const inserted = await dbQuery<{ created_at: Date }>(
    `INSERT INTO insight_summaries (
      id, organization_id, workspace_id, project_id, mode, headline, summary,
      evidence_ids, caveats, suggested_checks, verified_numeric_claims,
      provider_model, created_by_user_id
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8::text[], $9::text[], $10::text[], $11, $12, $13
    ) RETURNING created_at`,
    [
      id,
      organizationId,
      workspaceId,
      options.projectId ?? null,
      finalResult.mode,
      finalResult.headline,
      finalResult.summary,
      [...finalResult.evidenceIds],
      [...finalResult.caveats],
      [...finalResult.suggestedChecks],
      finalResult.verifiedNumericClaims,
      finalResult.providerModel,
      session?.user.id ?? null,
    ],
  );

  return {
    id,
    workspaceId,
    projectId: options.projectId ?? null,
    ...finalResult,
    fallbackReason,
    createdAtIso: new Date(inserted.rows[0]?.created_at ?? Date.now()).toISOString(),
  };
}

export async function listWorkspaceInsights(
  session: AuthenticatedSessionContext | null,
  workspaceId?: string,
): Promise<GeneratedInsightRecord[]> {
  const targetWs = workspaceId ?? session?.activeWorkspace.id ?? "";
  await authorizeWorkspaceAccess({
    session,
    workspaceId: targetWs,
    requiredPermission: "project:read",
  });
  const res = await dbQuery<Record<string, unknown>>(
    `SELECT * FROM insight_summaries WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [targetWs],
  );
  return res.rows.map((r) => ({
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    projectId: r.project_id ? String(r.project_id) : null,
    mode: String(r.mode) === "AI_ASSISTED" ? "AI_ASSISTED" : "DETERMINISTIC",
    headline: String(r.headline),
    summary: String(r.summary),
    evidenceIds: Array.isArray(r.evidence_ids) ? r.evidence_ids.map(String) : [],
    caveats: Array.isArray(r.caveats) ? r.caveats.map(String) : [],
    suggestedChecks: Array.isArray(r.suggested_checks) ? r.suggested_checks.map(String) : [],
    verifiedNumericClaims: Boolean(r.verified_numeric_claims),
    providerModel: r.provider_model ? String(r.provider_model) : null,
    fallbackReason: null,
    createdAtIso: new Date(String(r.created_at)).toISOString(),
  }));
}
