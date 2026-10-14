import { listWorkspaceProjects } from "@avenor/auth";
import { toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import { listWorkspaceConnections } from "@/lib/connections";
import { PROVIDER_CATALOG } from "@/lib/providers";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    const searchParams = request.nextUrl.searchParams;
    const workspaceId = searchParams.get("workspaceId") ?? session?.activeWorkspace.id ?? "";

    const [{ connections, canManageConnections }, projects] = await Promise.all([
      listWorkspaceConnections(session, workspaceId),
      listWorkspaceProjects(session, workspaceId, { includeArchived: false }),
    ]);

    return NextResponse.json(
      {
        catalog: PROVIDER_CATALOG,
        connections,
        projects,
        canManageConnections,
      },
      { status: 200 },
    );
  } catch (err) {
    const appErr = toAppError(err);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
