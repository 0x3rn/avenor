import { toAppError } from "@avenor/types";
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import {
  activateCardFreeProTrial,
  createLemonSqueezyCheckoutSession,
  getWorkspaceEffectiveEntitlements,
  listWorkspaceSubscriptionInvoices,
} from "@/lib/billing/lemon-squeezy";
import { AVENOR_PLAN_CATALOG, type AvenorBillingInterval } from "@/lib/billing/plan-catalog";

export async function GET(request: Request) {
  try {
    const session = await getServerSession();
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
    const [entitlements, invoices] = await Promise.all([
      getWorkspaceEffectiveEntitlements(session, workspaceId),
      listWorkspaceSubscriptionInvoices(session, workspaceId),
    ]);
    return NextResponse.json(
      { entitlements, invoices, catalog: AVENOR_PLAN_CATALOG },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const body = (await request.json()) as {
      action?: string;
      workspaceId?: string;
      planCode?: "PRO" | "TEAM";
      interval?: AvenorBillingInterval;
    };

    if (body.action === "start_trial") {
      const entitlements = await activateCardFreeProTrial(session, body.workspaceId);
      return NextResponse.json({ entitlements }, { status: 200 });
    }

    if (body.action === "checkout") {
      const checkout = await createLemonSqueezyCheckoutSession(session, {
        workspaceId: body.workspaceId,
        planCode: body.planCode === "TEAM" ? "TEAM" : "PRO",
        interval: body.interval === "ANNUAL" ? "ANNUAL" : "MONTHLY",
      });
      return NextResponse.json(checkout, { status: 200 });
    }

    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: 'Expected action "start_trial" or "checkout".',
        },
      },
      { status: 400 },
    );
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}
