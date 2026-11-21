import { toAppError } from "@avenor/types";
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import {
  createDigestSchedule,
  listDigestSchedules,
  registerOutboundChannel,
  runDigestScheduleIdempotently,
} from "@/lib/alerts/digests";

export async function GET(request: Request) {
  try {
    const session = await getServerSession();
    const url = new URL(request.url);
    const schedules = await listDigestSchedules(
      session,
      url.searchParams.get("workspaceId") ?? undefined,
    );
    return NextResponse.json({ schedules }, { status: 200 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const body = (await request.json()) as Record<string, unknown>;
    if (body.action === "run" && typeof body.scheduleId === "string") {
      const result = await runDigestScheduleIdempotently(session, body.scheduleId);
      return NextResponse.json(result, { status: 200 });
    }
    if (body.action === "register_channel") {
      const channel = await registerOutboundChannel(
        session,
        body as Parameters<typeof registerOutboundChannel>[1],
      );
      return NextResponse.json({ channel }, { status: 201 });
    }
    const schedule = await createDigestSchedule(
      session,
      body as Parameters<typeof createDigestSchedule>[1],
    );
    return NextResponse.json({ schedule }, { status: 201 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}
