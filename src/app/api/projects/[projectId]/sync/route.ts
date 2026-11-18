import { toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import { getProjectSyncStatusSummary, triggerProjectIngestionAction } from "@/lib/ingestion";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const session = await getServerSession();
    const { projectId } = await context.params;
    const summary = await getProjectSyncStatusSummary(session, projectId);
    return NextResponse.json(summary, { status: 200 });
  } catch (error) {
    const appErr = toAppError(error);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const session = await getServerSession();
    const { projectId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      action?: "sync" | "backfill" | "revision_lookback" | "pause" | "resume";
      connectedResourceId?: string | null;
      backfillDays?: number | null;
      idempotencyToken?: string | null;
    };

    const result = await triggerProjectIngestionAction(session, projectId, body);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const appErr = toAppError(error);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
