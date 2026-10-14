import { createLogicalProject, listWorkspaceProjects } from "@avenor/auth";
import { toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    const searchParams = request.nextUrl.searchParams;
    const workspaceId = searchParams.get("workspaceId") ?? session?.activeWorkspace.id ?? "";
    const includeArchived = searchParams.get("includeArchived") === "true";
    const search = searchParams.get("search") ?? undefined;

    const projects = await listWorkspaceProjects(session, workspaceId, {
      includeArchived,
      search,
    });
    return NextResponse.json({ projects }, { status: 200 });
  } catch (err) {
    const appErr = toAppError(err);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    const body = (await request.json()) as { workspaceId?: string } & Record<string, unknown>;
    const workspaceId = body.workspaceId ?? session?.activeWorkspace.id ?? "";
    const project = await createLogicalProject(session, workspaceId, body);
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    const appErr = toAppError(err);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
