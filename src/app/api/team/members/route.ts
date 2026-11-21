import { toAppError, type WorkspaceRole } from "@avenor/types";
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import {
  listProjectAccessGrants,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
} from "@/lib/team/memberships";

export async function GET(request: Request) {
  try {
    const session = await getServerSession();
    const url = new URL(request.url);
    const grants = await listProjectAccessGrants(
      session,
      url.searchParams.get("workspaceId") ?? undefined,
    );
    return NextResponse.json({ grants }, { status: 200 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getServerSession();
    const body = (await request.json()) as {
      workspaceId?: string;
      targetUserId?: string;
      newRole?: WorkspaceRole;
    };
    const updated = await updateWorkspaceMemberRole(session, {
      workspaceId: body.workspaceId,
      targetUserId: String(body.targetUserId ?? ""),
      newRole: (body.newRole ?? "VIEWER") as WorkspaceRole,
    });
    return NextResponse.json(updated, { status: 200 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getServerSession();
    const url = new URL(request.url);
    const targetUserId = url.searchParams.get("userId") ?? "";
    const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
    const result = await removeWorkspaceMember(session, { workspaceId, targetUserId });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}
