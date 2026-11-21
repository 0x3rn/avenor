import { toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import {
  createAlertRule,
  evaluateAndDispatchWorkspaceAlerts,
  listWorkspaceAlertsAndNotifications,
} from "@/lib/alerts/service";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    const { searchParams } = new URL(request.url);
    const data = await listWorkspaceAlertsAndNotifications(
      session,
      searchParams.get("workspaceId") ?? undefined,
    );
    return NextResponse.json(data, {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const appErr = toAppError(error);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    if (body.action === "evaluate") {
      const outcome = await evaluateAndDispatchWorkspaceAlerts(session, {
        workspaceId: typeof body.workspaceId === "string" ? body.workspaceId : undefined,
      });
      const updated = await listWorkspaceAlertsAndNotifications(
        session,
        typeof body.workspaceId === "string" ? body.workspaceId : undefined,
      );
      return NextResponse.json({ outcome, ...updated }, { status: 200 });
    }

    const rule = await createAlertRule(session, body as Parameters<typeof createAlertRule>[1]);
    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    const appErr = toAppError(error);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
