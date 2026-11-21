import { toAppError } from "@avenor/types";
import { NextResponse } from "next/server";
import {
  createUptimeMonitor,
  deleteUptimeMonitor,
  executeUptimeProbeAndRecord,
  listWorkspaceReliabilitySnapshot,
  toggleUptimeMonitor,
} from "@/lib/reliability/uptime";
import { getServerSession } from "@/lib/auth-server";

export async function GET(request: Request) {
  try {
    const session = await getServerSession();
    const url = new URL(request.url);
    const snapshot = await listWorkspaceReliabilitySnapshot(session, {
      workspaceId: url.searchParams.get("workspaceId") ?? undefined,
      projectId: url.searchParams.get("projectId") ?? undefined,
    });
    return NextResponse.json(snapshot, { status: 200 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const body = (await request.json()) as Record<string, unknown>;
    if (body.action === "probe" && typeof body.monitorId === "string") {
      const result = await executeUptimeProbeAndRecord(session, body.monitorId);
      return NextResponse.json({ probe: result }, { status: 200 });
    }
    const monitor = await createUptimeMonitor(
      session,
      body as Parameters<typeof createUptimeMonitor>[1],
    );
    return NextResponse.json({ monitor }, { status: 201 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getServerSession();
    const body = (await request.json()) as { monitorId?: string; isEnabled?: boolean };
    const monitor = await toggleUptimeMonitor(
      session,
      String(body.monitorId ?? ""),
      Boolean(body.isEnabled),
    );
    return NextResponse.json({ monitor }, { status: 200 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getServerSession();
    const url = new URL(request.url);
    const monitorId = url.searchParams.get("monitorId") ?? "";
    const result = await deleteUptimeMonitor(session, monitorId);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}
