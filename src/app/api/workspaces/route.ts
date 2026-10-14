import {
  createWorkspaceInOrganization,
  getWorkspaceGovernanceDetails,
  updateWorkspaceSettings,
} from "@avenor/auth";
import { toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";

export async function GET() {
  try {
    const session = await getServerSession();
    const details = await getWorkspaceGovernanceDetails(session, session?.activeWorkspace.id ?? "");
    return NextResponse.json({
      activeWorkspace: details.workspace,
      organization: details.organization,
      workspaces: session?.workspaces ?? [],
      members: details.members,
      auditLogs: details.auditLogs,
    });
  } catch (err) {
    const appErr = toAppError(err);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    const body = await request.json();
    const created = await createWorkspaceInOrganization(
      session,
      session?.activeWorkspace.id ?? "",
      body,
    );
    return NextResponse.json({ workspace: created }, { status: 201 });
  } catch (err) {
    const appErr = toAppError(err);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession();
    const body = (await request.json()) as { workspaceId?: string } & Record<string, unknown>;
    const targetWorkspaceId = body.workspaceId ?? session?.activeWorkspace.id ?? "";
    const updated = await updateWorkspaceSettings(session, targetWorkspaceId, body);
    return NextResponse.json({ workspace: updated }, { status: 200 });
  } catch (err) {
    const appErr = toAppError(err);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
