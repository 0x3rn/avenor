import { toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import { getNotificationPreferences, updateNotificationPreferences } from "@/lib/alerts/service";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    const { searchParams } = new URL(request.url);
    const prefs = await getNotificationPreferences(
      session,
      searchParams.get("workspaceId") ?? undefined,
    );
    return NextResponse.json(prefs, {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const appErr = toAppError(error);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession();
    const body = (await request.json().catch(() => ({}))) as Parameters<
      typeof updateNotificationPreferences
    >[1];
    const updated = await updateNotificationPreferences(session, body);
    return NextResponse.json(updated, { status: 200 });
  } catch (error) {
    const appErr = toAppError(error);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
