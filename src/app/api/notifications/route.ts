import { toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import {
  listWorkspaceAlertsAndNotifications,
  markInAppNotificationRead,
} from "@/lib/alerts/service";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    const { searchParams } = new URL(request.url);
    const data = await listWorkspaceAlertsAndNotifications(
      session,
      searchParams.get("workspaceId") ?? undefined,
    );
    return NextResponse.json(
      {
        notifications: data.notifications,
        deliveries: data.deliveries,
      },
      {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    const appErr = toAppError(error);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession();
    const body = (await request.json().catch(() => ({}))) as {
      notificationId?: string;
      workspaceId?: string;
    };
    const res = await markInAppNotificationRead(
      session,
      body.notificationId ?? "",
      body.workspaceId,
    );
    return NextResponse.json(res, { status: 200 });
  } catch (error) {
    const appErr = toAppError(error);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
