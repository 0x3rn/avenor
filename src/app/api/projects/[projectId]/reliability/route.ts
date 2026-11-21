import { toAppError } from "@avenor/types";
import { NextResponse } from "next/server";
import {
  createUptimeMonitor,
  executeUptimeProbeAndRecord,
  listWorkspaceReliabilitySnapshot,
} from "@/lib/reliability/uptime";
import { getServerSession } from "@/lib/auth-server";

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await getServerSession();
    const { projectId } = await context.params;
    const snapshot = await listWorkspaceReliabilitySnapshot(session, { projectId });
    return NextResponse.json(snapshot, { status: 200 });
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
    if (body.action === "probe" && typeof body.monitorId === "string") {
      const probe = await executeUptimeProbeAndRecord(session, body.monitorId);
      return NextResponse.json({ probe }, { status: 200 });
    }
    const monitor = await createUptimeMonitor(session, {
      ...(body as Parameters<typeof createUptimeMonitor>[1]),
      projectId,
    });
    return NextResponse.json({ monitor }, { status: 201 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}
