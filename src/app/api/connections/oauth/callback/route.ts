import {
  completeOAuthCallback,
  createGoogleOAuthTokenExchangeHandler,
  defaultSandboxTokenExchangeHandler,
  isGoogleProviderKey,
  resolvePendingOAuthStateDetails,
} from "@avenor/auth";
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

    const googleExchange = isGoogleProviderKey(providerKey)
      ? createGoogleOAuthTokenExchangeHandler()
      : null;

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
        const base = googleExchange
          ? await googleExchange(params)
          : await defaultSandboxTokenExchangeHandler(params);
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
  const url = request.nextUrl;
  const redirectUrl = new URL("/connections", url.origin);

  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.redirect(new URL("/login", url.origin));
    }

    const searchParams = url.searchParams;
    const rawStateToken = searchParams.get("state") ?? "";
    const authorizationCode = searchParams.get("code") ?? undefined;
    const oauthError = searchParams.get("error") ?? undefined;
    const oauthErrorDescription = searchParams.get("error_description") ?? undefined;

    if (!rawStateToken) {
      const msg = "Missing OAuth state parameter in callback.";
      redirectUrl.searchParams.set("oauthError", msg);
      redirectUrl.searchParams.set("oauth", "error");
      redirectUrl.searchParams.set("message", msg);
      return NextResponse.redirect(redirectUrl);
    }

    const pending = await resolvePendingOAuthStateDetails(rawStateToken);
    const workspaceId =
      pending?.workspaceId ?? searchParams.get("workspaceId") ?? session.activeWorkspace.id;
    const providerKey = pending?.providerKey ?? searchParams.get("providerKey") ?? "avenor-sandbox";
    const redirectUri = pending?.redirectUri ?? `${url.origin}/api/connections/oauth/callback`;

    const callbackResult = await completeOAuthCallback({
      session,
      workspaceId,
      providerKey,
      rawStateToken,
      redirectUri,
      authorizationCode,
      oauthError,
      oauthErrorDescription,
      exchangeTokenFn: isGoogleProviderKey(providerKey)
        ? createGoogleOAuthTokenExchangeHandler()
        : undefined,
    });

    try {
      await discoverAndPersistConnectionResources(
        session,
        workspaceId,
        callbackResult.connectionId,
      );
    } catch {
      // Resource discovery failure during callback still preserves the connection;
      // the user can inspect capability/health state in the console.
    }

    redirectUrl.searchParams.set("connectedId", callbackResult.connectionId);
    redirectUrl.searchParams.set("oauth", "connected");
    redirectUrl.searchParams.set("connectionId", callbackResult.connectionId);
    redirectUrl.searchParams.set("provider", providerKey);
    return NextResponse.redirect(redirectUrl);
  } catch (err) {
    const appErr = toAppError(err);
    redirectUrl.searchParams.set("oauthError", appErr.message);
    redirectUrl.searchParams.set("oauth", "error");
    redirectUrl.searchParams.set("message", appErr.message);
    return NextResponse.redirect(redirectUrl);
  }
}
