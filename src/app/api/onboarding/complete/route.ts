import { completeUserOnboarding } from "@avenor/auth";
import { toAppError } from "@avenor/types";
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";

export async function POST() {
  try {
    const session = await getServerSession();
    const result = await completeUserOnboarding(session, session?.activeWorkspace.id ?? "");
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (err) {
    const appErr = toAppError(err);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
