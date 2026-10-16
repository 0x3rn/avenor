import { toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import { mapResourceToProjectEnvironment, unmapResourceFromProject } from "@/lib/connections";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    const body = (await request.json()) as {
      workspaceId?: string;
      connectedResourceId?: string;
      projectId?: string;
      environmentId?: string | null;
      mappingRole?: "PRIMARY" | "SECONDARY";
    };

    const workspaceId = body.workspaceId ?? session?.activeWorkspace.id ?? "";
    const mapping = await mapResourceToProjectEnvironment(session, workspaceId, body);
    return NextResponse.json({ mapping }, { status: 201 });
  } catch (err) {
    const appErr = toAppError(err);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession();
    const searchParams = request.nextUrl.searchParams;
    let workspaceId = searchParams.get("workspaceId") ?? "";
    let mappingId = searchParams.get("mappingId") ?? "";

    if (!mappingId) {
      const body = (await request.json().catch(() => ({}))) as {
        workspaceId?: string;
        mappingId?: string;
      };
      workspaceId = workspaceId || body.workspaceId || "";
      mappingId = mappingId || body.mappingId || "";
    }

    workspaceId = workspaceId || session?.activeWorkspace.id || "";

    const result = await unmapResourceFromProject(session, workspaceId, mappingId);
    return NextResponse.json({ result }, { status: 200 });
  } catch (err) {
    const appErr = toAppError(err);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
