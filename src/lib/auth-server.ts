import {
  type AuthenticatedSessionContext,
  resolveSessionByToken,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from "@avenor/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextResponse } from "next/server";

export async function getServerSession(): Promise<AuthenticatedSessionContext | null> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!rawToken) {
    return null;
  }
  return resolveSessionByToken(rawToken);
}

export async function requireServerSession(
  redirectTo = "/login",
): Promise<AuthenticatedSessionContext> {
  const session = await getServerSession();
  if (!session) {
    redirect(redirectTo);
  }
  return session;
}

export function attachSessionCookie(response: NextResponse, rawToken: string): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: rawToken,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
