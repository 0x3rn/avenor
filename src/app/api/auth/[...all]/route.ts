import {
  authenticateUser,
  createPasswordResetRequest,
  registerUserWithDefaultOwnership,
  resolveSessionByToken,
  revokeSessionByToken,
  SESSION_COOKIE_NAME,
  switchSessionActiveWorkspace,
  verifyEmailToken,
} from "@avenor/auth";
import { AppError, ERROR_CODES, toAppError } from "@avenor/types";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { attachSessionCookie, clearSessionCookie } from "@/lib/auth-server";

export async function GET(_request: NextRequest, context: { params: Promise<{ all: string[] }> }) {
  try {
    const { all } = await context.params;
    const action = all.join("/");

    if (action === "session") {
      const cookieStore = await cookies();
      const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
      const session = await resolveSessionByToken(rawToken);
      if (!session) {
        return NextResponse.json({ authenticated: false, session: null }, { status: 401 });
      }
      return NextResponse.json({ authenticated: true, session }, { status: 200 });
    }

    return NextResponse.json(
      { error: { code: ERROR_CODES.NOT_FOUND, message: `Unknown auth route: ${action}` } },
      { status: 404 },
    );
  } catch (err) {
    const appErr = toAppError(err);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ all: string[] }> }) {
  try {
    const { all } = await context.params;
    const action = all.join("/");
    const ipAddress = request.headers.get("x-forwarded-for") ?? null;
    const userAgent = request.headers.get("user-agent") ?? null;

    if (action === "signup") {
      const body = await request.json();
      const result = await registerUserWithDefaultOwnership(body, { ipAddress, userAgent });
      const response = NextResponse.json(
        {
          authenticated: true,
          session: result.context,
          verificationToken: result.verificationToken,
        },
        { status: 201 },
      );
      attachSessionCookie(response, result.rawSessionToken);
      return response;
    }

    if (action === "signin") {
      const body = await request.json();
      const result = await authenticateUser(body, { ipAddress, userAgent });
      const response = NextResponse.json(
        {
          authenticated: true,
          session: result.context,
        },
        { status: 200 },
      );
      attachSessionCookie(response, result.rawSessionToken);
      return response;
    }

    if (action === "signout") {
      const cookieStore = await cookies();
      const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
      await revokeSessionByToken(rawToken);
      const response = NextResponse.json({ authenticated: false }, { status: 200 });
      clearSessionCookie(response);
      return response;
    }

    if (action === "switch-workspace") {
      const cookieStore = await cookies();
      const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
      const session = await resolveSessionByToken(rawToken);
      if (!session) {
        throw new AppError({
          code: ERROR_CODES.UNAUTHENTICATED,
          message: "Authentication required to switch workspaces.",
        });
      }
      const body = (await request.json()) as { workspaceId?: string };
      if (!body.workspaceId) {
        throw new AppError({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: "workspaceId is required.",
        });
      }
      const activeWorkspace = await switchSessionActiveWorkspace(session, body.workspaceId);
      return NextResponse.json({ ok: true, activeWorkspace }, { status: 200 });
    }

    if (action === "verify-email") {
      const body = (await request.json()) as { email?: string; token?: string };
      if (!body.email || !body.token) {
        throw new AppError({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: "Email and verification token are required.",
        });
      }
      const verified = await verifyEmailToken(body.email, body.token);
      if (!verified) {
        throw new AppError({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: "Verification token is invalid or has expired.",
        });
      }
      return NextResponse.json({ ok: true, verified: true }, { status: 200 });
    }

    if (action === "forgot-password") {
      const body = (await request.json()) as { email?: string };
      if (!body.email) {
        throw new AppError({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: "Email address is required.",
        });
      }
      await createPasswordResetRequest(body.email);
      return NextResponse.json({ ok: true, requested: true }, { status: 200 });
    }

    return NextResponse.json(
      { error: { code: ERROR_CODES.NOT_FOUND, message: `Unknown auth route: ${action}` } },
      { status: 404 },
    );
  } catch (err) {
    const appErr = toAppError(err);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
