import { initiateOAuthAuthorization } from "@avenor/auth";
import { toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import { getProviderCatalogEntry } from "@/lib/providers";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    const body = (await request.json()) as {
      workspaceId?: string;
      providerKey?: string;
      displayName?: string;
      requestedScopes?: string[];
      redirectUri?: string;
      reconnectConnectionId?: string;
    };

    const workspaceId = body.workspaceId ?? session?.activeWorkspace.id ?? "";
    const providerKey = (body.providerKey ?? "").trim();
    const catalogEntry = getProviderCatalogEntry(providerKey);

    const defaultRedirectUri = `${request.nextUrl.origin}/api/connections/oauth/callback`;
    const redirectUri = body.redirectUri ?? defaultRedirectUri;
    const requestedScopes =
      Array.isArray(body.requestedScopes) && body.requestedScopes.length > 0
        ? body.requestedScopes
        : [...(catalogEntry?.defaultScopes ?? [])];

    const authorization = await initiateOAuthAuthorization({
      session,
      workspaceId,
      providerKey,
      authorizeEndpointUrl:
        catalogEntry?.oauthAuthorizeUrl ?? "/api/connections/oauth/sandbox-authorize",
      requestedScopes,
      redirectUri,
      operation: body.reconnectConnectionId ? "reconsent" : "connect",
      targetConnectionId: body.reconnectConnectionId,
    });

    return NextResponse.json({ authorization }, { status: 201 });
  } catch (err) {
    const appErr = toAppError(err);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
