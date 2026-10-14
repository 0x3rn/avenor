import { getLogicalProjectById, updateLogicalProject } from "@avenor/auth";
import { toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const session = await getServerSession();
    const { projectId } = await context.params;
    const project = await getLogicalProjectById(session, projectId, session?.activeWorkspace.id);
    return NextResponse.json({ project }, { status: 200 });
  } catch (err) {
    const appErr = toAppError(err);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const session = await getServerSession();
    const { projectId } = await context.params;
    const body = await request.json();
    const project = await updateLogicalProject(session, projectId, body, {
      expectedWorkspaceId: session?.activeWorkspace.id,
    });
    return NextResponse.json({ project }, { status: 200 });
  } catch (err) {
    const appErr = toAppError(err);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
