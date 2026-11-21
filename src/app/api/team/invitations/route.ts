import { toAppError } from "@avenor/types";
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import {
  acceptWorkspaceInvitation,
  createWorkspaceInvitation,
  listWorkspaceInvitations,
  revokeWorkspaceInvitation,
} from "@/lib/team/memberships";

export async function GET(request: Request) {
  try {
    const session = await getServerSession();
    const url = new URL(request.url);
    const invitations = await listWorkspaceInvitations(
      session,
      url.searchParams.get("workspaceId") ?? undefined,
    );
    return NextResponse.json({ invitations }, { status: 200 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const body = (await request.json()) as Record<string, unknown>;
    if (body.action === "accept" && typeof body.token === "string") {
      const accepted = await acceptWorkspaceInvitation(session, body.token);
      return NextResponse.json(accepted, { status: 200 });
    }
    const created = await createWorkspaceInvitation(
      session,
      body as Parameters<typeof createWorkspaceInvitation>[1],
    );
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getServerSession();
    const url = new URL(request.url);
    const invitationId = url.searchParams.get("invitationId") ?? "";
    const result = await revokeWorkspaceInvitation(session, invitationId);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}
