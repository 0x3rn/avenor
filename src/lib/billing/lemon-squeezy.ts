import crypto from "node:crypto";
import { type AuthenticatedSessionContext, authorizeWorkspaceAccess } from "@avenor/auth";
import { dbQuery, generateId, withTransaction } from "@avenor/database";
import { AppError, ERROR_CODES } from "@avenor/types";
import {
  AVENOR_BILLING_CATALOG_VERSION,
  AVENOR_PLAN_CATALOG,
  type AvenorBillingInterval,
  type AvenorPlanCode,
  type PlanEntitlementLimits,
  resolveLemonSqueezyVariantId,
  resolvePlanFromLemonSqueezyVariant,
} from "./plan-catalog";

export type LemonSqueezySubscriptionStatus =
  | "active"
  | "on_trial"
  | "paused"
  | "past_due"
  | "unpaid"
  | "cancelled"
  | "expired";

export const SUPPORTED_LEMON_SQUEEZY_EVENTS = new Set([
  "order_created",
  "order_refunded",
  "subscription_created",
  "subscription_updated",
  "subscription_cancelled",
  "subscription_resumed",
  "subscription_expired",
  "subscription_paused",
  "subscription_unpaused",
  "subscription_payment_success",
  "subscription_payment_failed",
  "subscription_payment_recovered",
]);

export interface WorkspaceEntitlementSnapshot {
  workspaceId: string;
  catalogVersion: string;
  configuredPlanCode: AvenorPlanCode;
  effectivePlanCode: AvenorPlanCode;
  billingInterval: AvenorBillingInterval;
  providerName: "LOCAL_FREE" | "LOCAL_TRIAL" | "LEMON_SQUEEZY";
  status: LemonSqueezySubscriptionStatus;
  isCardFreeTrial: boolean;
  isWithinPaidGracePeriod: boolean;
  trialEndsAtIso: string | null;
  currentPeriodEndsAtIso: string | null;
  endsAtIso: string | null;
  limits: PlanEntitlementLimits;
  billingBoundaryNote: string;
}

export interface SubscriptionInvoiceRecord {
  id: string;
  workspaceId: string;
  providerOrderId: string;
  providerSubscriptionId: string | null;
  amountMinor: number;
  taxMinor: number;
  currency: string;
  status: "paid" | "refunded" | "failed" | "pending";
  invoiceUrl: string | null;
  issuedAtIso: string;
}

const BILLING_BOUNDARY_NOTE =
  "Avenor subscription charges (managed via Lemon Squeezy as merchant of record) are completely separate from monitored cloud provider spending (Google Cloud, Vercel, Neon, etc.).";

/**
 * Constant-time HMAC-SHA256 verification of Lemon Squeezy's `X-Signature` header
 * computed over the exact raw HTTP request bytes.
 */
export function verifyLemonSqueezySignature(options: {
  rawBody: string | Buffer;
  signatureHeader: string | null | undefined;
  webhookSecret: string;
}): boolean {
  const secret = options.webhookSecret.trim();
  const provided = (options.signatureHeader ?? "").trim();
  if (!secret || !/^[0-9a-f]{64}$/i.test(provided)) {
    return false;
  }
  const expected = crypto.createHmac("sha256", secret).update(options.rawBody).digest("hex");
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Pure entitlement resolver honoring:
 * - Local 14-day card-free Pro trial (auto-reverts to FREE on expiry with zero charge)
 * - Lemon Squeezy `cancelled` paid-through grace (`endsAt > now` preserves paid tier until `endsAt`)
 * - Lemon Squeezy `expired`, `paused`, `unpaid` -> reverts effective tier to `FREE`
 */
export function resolveEffectivePlanCode(input: {
  configuredPlanCode: AvenorPlanCode;
  providerName: "LOCAL_FREE" | "LOCAL_TRIAL" | "LEMON_SQUEEZY";
  status: LemonSqueezySubscriptionStatus;
  trialEndsAtIso: string | null;
  endsAtIso: string | null;
  nowMs?: number;
}): { effectivePlanCode: AvenorPlanCode; isWithinPaidGracePeriod: boolean } {
  const nowMs = input.nowMs ?? Date.now();
  if (input.configuredPlanCode === "FREE") {
    return { effectivePlanCode: "FREE", isWithinPaidGracePeriod: false };
  }

  if (input.providerName === "LOCAL_TRIAL") {
    const trialEnd = input.trialEndsAtIso ? Date.parse(input.trialEndsAtIso) : 0;
    if (input.status === "on_trial" && trialEnd > nowMs) {
      return { effectivePlanCode: input.configuredPlanCode, isWithinPaidGracePeriod: false };
    }
    return { effectivePlanCode: "FREE", isWithinPaidGracePeriod: false };
  }

  if (input.status === "active" || input.status === "on_trial") {
    return { effectivePlanCode: input.configuredPlanCode, isWithinPaidGracePeriod: false };
  }

  // Lemon Squeezy `cancelled` remains valid during paid-through grace period until `ends_at`
  if (input.status === "cancelled" && input.endsAtIso && Date.parse(input.endsAtIso) > nowMs) {
    return { effectivePlanCode: input.configuredPlanCode, isWithinPaidGracePeriod: true };
  }

  // `past_due` keeps brief grace if `ends_at` or renewal window hasn't expired; `expired`/`unpaid`/`paused` revert to FREE
  if (input.status === "past_due" && input.endsAtIso && Date.parse(input.endsAtIso) > nowMs) {
    return { effectivePlanCode: input.configuredPlanCode, isWithinPaidGracePeriod: true };
  }

  return { effectivePlanCode: "FREE", isWithinPaidGracePeriod: false };
}

export async function getWorkspaceEffectiveEntitlements(
  session: AuthenticatedSessionContext | null,
  workspaceId?: string,
  options?: { nowMs?: number; skipAuth?: boolean },
): Promise<WorkspaceEntitlementSnapshot> {
  const targetWs = workspaceId ?? session?.activeWorkspace.id ?? "";
  if (!options?.skipAuth) {
    await authorizeWorkspaceAccess({
      session,
      workspaceId: targetWs,
      requiredPermission: "workspace:read",
    });
  }

  const res = await dbQuery<Record<string, unknown>>(
    `SELECT * FROM workspace_subscriptions WHERE workspace_id = $1`,
    [targetWs],
  );
  const row = res.rows[0];
  if (!row) {
    return {
      workspaceId: targetWs,
      catalogVersion: AVENOR_BILLING_CATALOG_VERSION,
      configuredPlanCode: "FREE",
      effectivePlanCode: "FREE",
      billingInterval: "MONTHLY",
      providerName: "LOCAL_FREE",
      status: "active",
      isCardFreeTrial: false,
      isWithinPaidGracePeriod: false,
      trialEndsAtIso: null,
      currentPeriodEndsAtIso: null,
      endsAtIso: null,
      limits: AVENOR_PLAN_CATALOG.FREE.limits,
      billingBoundaryNote: BILLING_BOUNDARY_NOTE,
    };
  }

  const configuredPlanCode = String(row.plan_code) as AvenorPlanCode;
  const billingInterval = String(row.billing_interval) as AvenorBillingInterval;
  const providerName = String(row.provider_name) as "LOCAL_FREE" | "LOCAL_TRIAL" | "LEMON_SQUEEZY";
  const status = String(row.status) as LemonSqueezySubscriptionStatus;
  const trialEndsAtIso = row.trial_ends_at
    ? new Date(String(row.trial_ends_at)).toISOString()
    : null;
  const currentPeriodEndsAtIso = row.current_period_ends_at
    ? new Date(String(row.current_period_ends_at)).toISOString()
    : null;
  const endsAtIso = row.ends_at ? new Date(String(row.ends_at)).toISOString() : null;

  const { effectivePlanCode, isWithinPaidGracePeriod } = resolveEffectivePlanCode({
    configuredPlanCode,
    providerName,
    status,
    trialEndsAtIso,
    endsAtIso,
    nowMs: options?.nowMs,
  });

  return {
    workspaceId: targetWs,
    catalogVersion: AVENOR_BILLING_CATALOG_VERSION,
    configuredPlanCode,
    effectivePlanCode,
    billingInterval,
    providerName,
    status,
    isCardFreeTrial: providerName === "LOCAL_TRIAL",
    isWithinPaidGracePeriod,
    trialEndsAtIso,
    currentPeriodEndsAtIso,
    endsAtIso,
    limits: AVENOR_PLAN_CATALOG[effectivePlanCode].limits,
    billingBoundaryNote: BILLING_BOUNDARY_NOTE,
  };
}

/**
 * Activates a one-time 14-day card-free local Pro trial with zero automatic charge.
 */
export async function activateCardFreeProTrial(
  session: AuthenticatedSessionContext | null,
  workspaceId?: string,
): Promise<WorkspaceEntitlementSnapshot> {
  const targetWs = workspaceId ?? session?.activeWorkspace.id ?? "";
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId: targetWs,
    requiredPermission: "workspace:update",
  });

  await withTransaction(async (client) => {
    const existing = await client.query<{
      trial_started_at: Date | null;
      provider_name: string;
      status: string;
    }>(
      `SELECT trial_started_at, provider_name, status FROM workspace_subscriptions WHERE workspace_id = $1 FOR UPDATE`,
      [targetWs],
    );
    const row = existing.rows[0];
    if (row?.trial_started_at) {
      throw new AppError({
        code: ERROR_CODES.CONFLICT,
        message: "This workspace has already used its one-time 14-day card-free Pro trial.",
      });
    }
    if (row?.provider_name === "LEMON_SQUEEZY" && row.status === "active") {
      throw new AppError({
        code: ERROR_CODES.CONFLICT,
        message: "Active paid subscriptions are not eligible for a local trial.",
      });
    }

    const now = new Date();
    const trialEnds = new Date(now.getTime() + 14 * 86_400_000);

    await client.query(
      `INSERT INTO workspace_subscriptions (
        id, organization_id, workspace_id, plan_code, billing_interval, provider_name,
        status, trial_started_at, trial_ends_at, ends_at
      ) VALUES ($1, $2, $3, 'PRO', 'MONTHLY', 'LOCAL_TRIAL', 'on_trial', $4, $5, $5)
      ON CONFLICT (workspace_id) DO UPDATE SET
        plan_code = 'PRO',
        provider_name = 'LOCAL_TRIAL',
        status = 'on_trial',
        trial_started_at = EXCLUDED.trial_started_at,
        trial_ends_at = EXCLUDED.trial_ends_at,
        ends_at = EXCLUDED.ends_at,
        updated_at = now()`,
      [
        generateId("wsub"),
        access.organizationId,
        targetWs,
        now.toISOString(),
        trialEnds.toISOString(),
      ],
    );
  });

  return getWorkspaceEffectiveEntitlements(session, targetWs, { skipAuth: true });
}

/**
 * Generates a server-validated Lemon Squeezy hosted checkout session bound to workspace metadata.
 * Refuses to invent merchant IDs or fake live payment success when merchant env vars are absent.
 */
export async function createLemonSqueezyCheckoutSession(
  session: AuthenticatedSessionContext | null,
  input: {
    workspaceId?: string;
    planCode: Exclude<AvenorPlanCode, "FREE">;
    interval: AvenorBillingInterval;
    fetchFn?: typeof fetch;
  },
): Promise<{ checkoutUrl: string; variantId: string; testMode: boolean }> {
  const workspaceId = input.workspaceId ?? session?.activeWorkspace.id ?? "";
  const access = await authorizeWorkspaceAccess({
    session,
    workspaceId,
    requiredPermission: "workspace:update",
  });
  if (access.role !== "OWNER") {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "Only the workspace OWNER may initiate Avenor subscription checkout.",
    });
  }

  const apiKey = process.env.LEMON_SQUEEZY_API_KEY?.trim();
  const storeId = process.env.LEMON_SQUEEZY_STORE_ID?.trim();
  const variantId = resolveLemonSqueezyVariantId(input.planCode, input.interval);

  if (!apiKey || !storeId || !variantId) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message:
        "Live Lemon Squeezy checkout is disabled until store ID, API key, and approved variant IDs are configured in server environment variables.",
    });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const fetchImpl = input.fetchFn ?? globalThis.fetch;
  const res = await fetchImpl("https://api.lemonsqueezy.com/v1/checkouts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
    },
    body: JSON.stringify({
      data: {
        type: "checkouts",
        attributes: {
          product_options: {
            redirect_url: `${appUrl}/billing?checkout=confirming`,
          },
          checkout_data: {
            email: session?.user.email,
            custom: {
              workspace_id: workspaceId,
              organization_id: access.organizationId,
              plan_code: input.planCode,
              billing_interval: input.interval,
            },
          },
        },
        relationships: {
          store: { data: { type: "stores", id: storeId } },
          variant: { data: { type: "variants", id: variantId } },
        },
      },
    }),
  });

  if (!res.ok) {
    throw new AppError({
      code: ERROR_CODES.EXTERNAL_PROVIDER_ERROR,
      message: `Lemon Squeezy checkout API returned HTTP ${res.status}.`,
    });
  }

  const json = (await res.json()) as {
    data?: { attributes?: { url?: string; test_mode?: boolean } };
  };
  const checkoutUrl = json.data?.attributes?.url;
  if (!checkoutUrl) {
    throw new AppError({
      code: ERROR_CODES.EXTERNAL_PROVIDER_ERROR,
      message: "Lemon Squeezy checkout response did not include a hosted checkout URL.",
    });
  }

  return {
    checkoutUrl,
    variantId,
    testMode: Boolean(json.data?.attributes?.test_mode),
  };
}

/**
 * Verifies raw-body `X-Signature`, durably deduplicates delivery fingerprints,
 * rejects unauthorized test-mode webhooks in production, and transactionally reconciles
 * `workspace_subscriptions` and `subscription_invoices`.
 */
export async function processLemonSqueezyWebhookEvent(options: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  webhookSecret: string;
  env?: Record<string, string | undefined>;
}): Promise<{
  accepted: true;
  deduplicated: boolean;
  eventName: string;
  workspaceId: string | null;
}> {
  if (
    !verifyLemonSqueezySignature({
      rawBody: options.rawBody,
      signatureHeader: options.signatureHeader,
      webhookSecret: options.webhookSecret,
    })
  ) {
    throw new AppError({
      code: ERROR_CODES.UNAUTHENTICATED,
      message: "Lemon Squeezy webhook X-Signature verification failed.",
    });
  }

  let payload: {
    meta?: {
      event_name?: string;
      test_mode?: boolean;
      custom_data?: {
        workspace_id?: string;
        organization_id?: string;
        plan_code?: string;
        billing_interval?: string;
      };
    };
    data?: {
      id?: string;
      type?: string;
      attributes?: Record<string, unknown>;
    };
  };

  try {
    payload = JSON.parse(options.rawBody) as typeof payload;
  } catch {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "Malformed JSON in Lemon Squeezy webhook payload.",
    });
  }

  const eventName = String(payload.meta?.event_name ?? "");
  if (!SUPPORTED_LEMON_SQUEEZY_EVENTS.has(eventName)) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Unsupported Lemon Squeezy webhook event "${eventName}".`,
    });
  }

  const env = options.env ?? process.env;
  const isTestMode = Boolean(payload.meta?.test_mode);
  if (isTestMode && env.NODE_ENV === "production" && env.LEMON_SQUEEZY_ALLOW_TEST_MODE !== "true") {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: "Test-mode Lemon Squeezy webhooks cannot grant production entitlements.",
    });
  }

  const objectId = String(payload.data?.id ?? "");
  const attrs = payload.data?.attributes ?? {};
  const workspaceId = payload.meta?.custom_data?.workspace_id ?? null;
  const fingerprint = crypto
    .createHash("sha256")
    .update(
      `${eventName}:${objectId}:${String(attrs.updated_at ?? attrs.created_at ?? "")}:${String(attrs.status ?? "")}`,
    )
    .digest("hex");

  return withTransaction(async (client) => {
    const insertedEvent = await client.query(
      `INSERT INTO subscription_webhook_events (
        id, provider_name, delivery_fingerprint, event_name, provider_object_id,
        workspace_id, is_test_mode, status, sanitized_payload
      ) VALUES ($1, 'LEMON_SQUEEZY', $2, $3, $4, $5, $6, 'RECEIVED', $7::jsonb)
      ON CONFLICT (delivery_fingerprint) DO NOTHING
      RETURNING id`,
      [
        generateId("swev"),
        fingerprint,
        eventName,
        objectId,
        workspaceId,
        isTestMode,
        JSON.stringify({
          eventName,
          objectId,
          status: attrs.status ?? null,
          variantId: attrs.variant_id ?? null,
          testMode: isTestMode,
        }),
      ],
    );

    if (insertedEvent.rowCount === 0) {
      return { accepted: true, deduplicated: true, eventName, workspaceId };
    }

    if (workspaceId) {
      const wsRes = await client.query<{ organization_id: string }>(
        `SELECT organization_id FROM workspaces WHERE id = $1`,
        [workspaceId],
      );
      const organizationId = wsRes.rows[0]?.organization_id;

      if (organizationId) {
        if (eventName === "order_created" || eventName === "order_refunded") {
          const totalMinor = Number(attrs.total ?? 0);
          const taxMinor = Number(attrs.tax ?? 0);
          const currency = String(attrs.currency ?? "USD").toUpperCase();
          const invStatus = eventName === "order_refunded" ? "refunded" : "paid";
          await client.query(
            `INSERT INTO subscription_invoices (
              id, organization_id, workspace_id, provider_order_id, provider_subscription_id,
              amount_minor, tax_minor, currency, status, invoice_url, issued_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (provider_order_id) DO UPDATE SET status = EXCLUDED.status`,
            [
              generateId("sinv"),
              organizationId,
              workspaceId,
              objectId,
              attrs.subscription_id ? String(attrs.subscription_id) : null,
              Number.isFinite(totalMinor) ? Math.max(0, Math.round(totalMinor)) : 0,
              Number.isFinite(taxMinor) ? Math.max(0, Math.round(taxMinor)) : 0,
              currency,
              invStatus,
              typeof (attrs.urls as { receipt?: string } | undefined)?.receipt === "string"
                ? (attrs.urls as { receipt: string }).receipt
                : null,
              typeof attrs.created_at === "string" ? attrs.created_at : new Date().toISOString(),
            ],
          );
        }

        if (eventName.startsWith("subscription_")) {
          const variantId = attrs.variant_id ? String(attrs.variant_id) : "";
          const mappedVariant = resolvePlanFromLemonSqueezyVariant(variantId, env);
          const customPlan = payload.meta?.custom_data?.plan_code;
          const planCode: AvenorPlanCode =
            mappedVariant?.planCode ??
            (customPlan === "PRO" || customPlan === "TEAM" ? customPlan : "PRO");
          const billingInterval: AvenorBillingInterval =
            mappedVariant?.interval ??
            (payload.meta?.custom_data?.billing_interval === "ANNUAL" ? "ANNUAL" : "MONTHLY");

          const rawStatus = String(attrs.status ?? "active");
          const validStatus: LemonSqueezySubscriptionStatus =
            rawStatus === "on_trial" ||
            rawStatus === "paused" ||
            rawStatus === "past_due" ||
            rawStatus === "unpaid" ||
            rawStatus === "cancelled" ||
            rawStatus === "expired"
              ? rawStatus
              : "active";

          await client.query(
            `INSERT INTO workspace_subscriptions (
              id, organization_id, workspace_id, plan_code, billing_interval, provider_name,
              provider_store_id, provider_customer_id, provider_subscription_id, provider_variant_id,
              status, current_period_ends_at, ends_at
            ) VALUES ($1, $2, $3, $4, $5, 'LEMON_SQUEEZY', $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (workspace_id) DO UPDATE SET
              plan_code = EXCLUDED.plan_code,
              billing_interval = EXCLUDED.billing_interval,
              provider_name = 'LEMON_SQUEEZY',
              provider_store_id = COALESCE(EXCLUDED.provider_store_id, workspace_subscriptions.provider_store_id),
              provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, workspace_subscriptions.provider_customer_id),
              provider_subscription_id = COALESCE(EXCLUDED.provider_subscription_id, workspace_subscriptions.provider_subscription_id),
              provider_variant_id = COALESCE(EXCLUDED.provider_variant_id, workspace_subscriptions.provider_variant_id),
              status = EXCLUDED.status,
              current_period_ends_at = EXCLUDED.current_period_ends_at,
              ends_at = EXCLUDED.ends_at,
              updated_at = now()`,
            [
              generateId("wsub"),
              organizationId,
              workspaceId,
              planCode,
              billingInterval,
              attrs.store_id ? String(attrs.store_id) : null,
              attrs.customer_id ? String(attrs.customer_id) : null,
              objectId,
              variantId || null,
              validStatus,
              typeof attrs.renews_at === "string" ? attrs.renews_at : null,
              typeof attrs.ends_at === "string" ? attrs.ends_at : null,
            ],
          );
        }
      }
    }

    await client.query(
      `UPDATE subscription_webhook_events SET status = 'PROCESSED', processed_at = now() WHERE delivery_fingerprint = $1`,
      [fingerprint],
    );

    return { accepted: true, deduplicated: false, eventName, workspaceId };
  });
}

export async function listWorkspaceSubscriptionInvoices(
  session: AuthenticatedSessionContext | null,
  workspaceId?: string,
): Promise<SubscriptionInvoiceRecord[]> {
  const targetWs = workspaceId ?? session?.activeWorkspace.id ?? "";
  await authorizeWorkspaceAccess({
    session,
    workspaceId: targetWs,
    requiredPermission: "workspace:read",
  });
  const res = await dbQuery<Record<string, unknown>>(
    `SELECT * FROM subscription_invoices WHERE workspace_id = $1 ORDER BY issued_at DESC LIMIT 50`,
    [targetWs],
  );
  return res.rows.map((r) => ({
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    providerOrderId: String(r.provider_order_id),
    providerSubscriptionId: r.provider_subscription_id ? String(r.provider_subscription_id) : null,
    amountMinor: Number(r.amount_minor),
    taxMinor: Number(r.tax_minor),
    currency: String(r.currency),
    status: String(r.status) as SubscriptionInvoiceRecord["status"],
    invoiceUrl: r.invoice_url ? String(r.invoice_url) : null,
    issuedAtIso: new Date(String(r.issued_at)).toISOString(),
  }));
}
