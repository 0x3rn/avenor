import { toAppError } from "@avenor/types";
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import {
  getProjectOperationalTimeline,
  recordOperationalEvent,
} from "@/lib/reliability/correlation";

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await getServerSession();
    const { projectId } = await context.params;
    const url = new URL(request.url);
    const timeline = await getProjectOperationalTimeline(session, projectId, {
      environmentName: url.searchParams.get("environment") ?? undefined,
      bypassCache: url.searchParams.get("refresh") === "1",
    });
    return NextResponse.json(timeline, {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await getServerSession();
    const { projectId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const event = await recordOperationalEvent(session, {
      ...(body as Parameters<typeof recordOperationalEvent>[1]),
      projectId,
    });
    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}
