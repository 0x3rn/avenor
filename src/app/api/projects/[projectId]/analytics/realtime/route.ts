import { toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import { getProjectGa4RealtimeTelemetry } from "@/lib/reports/ga4-service";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const session = await getServerSession();
    const { projectId } = await context.params;
    const { searchParams } = new URL(request.url);
    const environmentId = searchParams.get("environmentId");
    const resourceId = searchParams.get("resourceId");
    const bypassCache = searchParams.get("refresh") === "1";

    const result = await getProjectGa4RealtimeTelemetry(session, projectId, {
      environmentId,
      resourceId,
      bypassCache,
    });

    const headers: Record<string, string> = {};
    if (result.payload.realtime?.rateLimited && result.payload.realtime.retryAfterSeconds) {
      headers["Retry-After"] = String(result.payload.realtime.retryAfterSeconds);
    }

    return NextResponse.json(result.payload, {
      status: result.statusCode,
      headers,
    });
  } catch (error) {
    const appErr = toAppError(error);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
