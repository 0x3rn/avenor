import { toAppError } from "@avenor/types";
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import { listWorkspaceSupportRequests, submitSupportRequest } from "@/lib/support/service";

export async function GET(request: Request) {
  try {
    const session = await getServerSession();
    const url = new URL(request.url);
    const requests = await listWorkspaceSupportRequests(
      session,
      url.searchParams.get("workspaceId") ?? undefined,
    );
    return NextResponse.json({ requests }, { status: 200 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const body = (await request.json()) as Parameters<typeof submitSupportRequest>[1];
    const ticket = await submitSupportRequest(session, body);
    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}
