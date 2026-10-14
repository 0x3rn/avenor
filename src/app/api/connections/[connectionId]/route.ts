import {
  authorizeWorkspaceAccess,
  defaultSandboxTokenRefreshHandler,
  disconnectProviderConnection,
  refreshConnectionOAuthToken,
} from "@avenor/auth";
import { AppError, ERROR_CODES, type ReadOnlyProviderContext, toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import {
  discoverAndPersistConnectionResources,
  getWorkspaceConnectionDetail,
  validateConnectionHealth,
} from "@/lib/connections";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ connectionId: string }> },
) {
  try {
    const session = await getServerSession();
    const { connectionId } = await context.params;
    const workspaceId =
      request.nextUrl.searchParams.get("workspaceId") ?? session?.activeWorkspace.id ?? "";

    const connection = await getWorkspaceConnectionDetail(session, workspaceId, connectionId);
    return NextResponse.json({ connection }, { status: 200 });
  } catch (err) {
    const appErr = toAppError(err);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ connectionId: string }> },
) {
  try {
    const session = await getServerSession();
    const { connectionId } = await context.params;
    const body = (await request.json()) as {
      workspaceId?: string;
      action?: "discover" | "validate" | "refresh_token" | "disconnect";
      simulationScenario?: ReadOnlyProviderContext["simulationScenario"];
      simulateInvalidGrant?: boolean;
    };

    const workspaceId = body.workspaceId ?? session?.activeWorkspace.id ?? "";

    switch (body.action) {
      case "discover": {
        const discoveredResources = await discoverAndPersistConnectionResources(
          session,
          workspaceId,
          connectionId,
        );
        const connection = await getWorkspaceConnectionDetail(session, workspaceId, connectionId);
        return NextResponse.json({ discoveredResources, connection }, { status: 200 });
      }
      case "validate": {
        const healthSnapshot = await validateConnectionHealth(session, workspaceId, connectionId, {
          simulationScenario: body.simulationScenario,
        });
        const connection = await getWorkspaceConnectionDetail(session, workspaceId, connectionId);
        return NextResponse.json({ healthSnapshot, connection }, { status: 200 });
      }
      case "refresh_token": {
        const access = await authorizeWorkspaceAccess({
          session,
          workspaceId,
          requiredPermission: "connection:manage",
        });
        const refreshResult = await refreshConnectionOAuthToken({
          organizationId: access.organizationId,
          workspaceId,
          connectionId,
          actorUserId: access.session.user.id,
          ...(body.simulateInvalidGrant
            ? {
                refreshFn: async (params) =>
                  defaultSandboxTokenRefreshHandler({
                    ...params,
                    refreshToken: "invalid_grant_revoked_token",
                  }),
              }
            : {}),
        });
        const connection = await getWorkspaceConnectionDetail(session, workspaceId, connectionId);
        return NextResponse.json({ refreshResult, connection }, { status: 200 });
      }
      case "disconnect": {
        const disconnectResult = await disconnectProviderConnection({
          session,
          workspaceId,
          connectionId,
        });
        const connection = await getWorkspaceConnectionDetail(session, workspaceId, connectionId);
        return NextResponse.json({ disconnectResult, connection }, { status: 200 });
      }
      default:
        throw new AppError({
          code: ERROR_CODES.VALIDATION_ERROR,
          message:
            'Unsupported connection action. Expected "discover", "validate", "refresh_token", or "disconnect".',
        });
    }
  } catch (err) {
    const appErr = toAppError(err);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
