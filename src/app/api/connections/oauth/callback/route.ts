import { completeOAuthCallback, defaultSandboxTokenExchangeHandler } from "@avenor/auth";
import { toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import { discoverAndPersistConnectionResources } from "@/lib/connections";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    const body = (await request.json()) as {
      workspaceId?: string;
      providerKey?: string;
      displayName?: string;
      stateToken?: string;
      rawStateToken?: string;
      redirectUri?: string;
      authorizationCode?: string;
      grantedScopes?: string[];
      error?: string;
      errorDescription?: string;
      externalAccountId?: string;
      externalAccountLabel?: string;
    };

    const workspaceId = body.workspaceId ?? session?.activeWorkspace.id ?? "";
    const rawStateToken = body.rawStateToken ?? body.stateToken ?? "";
    const providerKey = body.providerKey ?? "avenor-sandbox";
    const redirectUri =
      body.redirectUri ?? `${request.nextUrl.origin}/api/connections/oauth/callback`;

    const callbackResult = await completeOAuthCallback({
      session,
      workspaceId,
      providerKey,
      displayName: body.displayName,
      rawStateToken,
      redirectUri,
      authorizationCode: body.authorizationCode ?? "sandbox_auth_code_verified",
      oauthError: body.error,
      oauthErrorDescription: body.errorDescription,
      exchangeTokenFn: async (params) => {
        const base = await defaultSandboxTokenExchangeHandler(params);
        return {
          ...base,
          grantedScopes:
            Array.isArray(body.grantedScopes) && body.grantedScopes.length > 0
              ? body.grantedScopes
              : base.grantedScopes,
          externalAccountId: body.externalAccountId ?? base.externalAccountId,
          externalAccountLabel: body.externalAccountLabel ?? base.externalAccountLabel,
        };
      },
    });

    let discoveredResources: Awaited<ReturnType<typeof discoverAndPersistConnectionResources>> = [];
    try {
      discoveredResources = await discoverAndPersistConnectionResources(
        session,
        workspaceId,
        callbackResult.connectionId,
      );
    } catch {
      discoveredResources = [];
    }

    return NextResponse.json(
      {
        callbackResult,
        discoveredResources,
      },
      { status: 200 },
    );
  } catch (err) {
    const appErr = toAppError(err);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    const searchParams = request.nextUrl.searchParams;
    const workspaceId = searchParams.get("workspaceId") ?? session?.activeWorkspace.id ?? "";
    const providerKey = searchParams.get("providerKey") ?? "avenor-sandbox";
    const rawStateToken = searchParams.get("state") ?? "";
    const authorizationCode = searchParams.get("code") ?? undefined;
    const oauthError = searchParams.get("error") ?? undefined;
    const oauthErrorDescription = searchParams.get("error_description") ?? undefined;
    const redirectUri = `${request.nextUrl.origin}/api/connections/oauth/callback`;

    const callbackResult = await completeOAuthCallback({
      session,
      workspaceId,
      providerKey,
      rawStateToken,
      redirectUri,
      authorizationCode,
      oauthError,
      oauthErrorDescription,
    });

    try {
      await discoverAndPersistConnectionResources(
        session,
        workspaceId,
        callbackResult.connectionId,
      );
    } catch {
      // Non-fatal if discovery scope missing
    }

    const redirectUrl = new URL("/connections", request.nextUrl.origin);
    redirectUrl.searchParams.set("connectedId", callbackResult.connectionId);
    return NextResponse.redirect(redirectUrl);
  } catch (err) {
    const appErr = toAppError(err);
    const redirectUrl = new URL("/connections", request.nextUrl.origin);
    redirectUrl.searchParams.set("oauthError", appErr.message);
    return NextResponse.redirect(redirectUrl);
  }
}
