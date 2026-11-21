import { toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import { getProjectBackendIntelligenceReport } from "@/lib/reports/backend-service";
import { buildAuthenticatedReportResponseHeaders } from "@/lib/reports/cache";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const session = await getServerSession();
    const { projectId } = await context.params;
    const { searchParams } = new URL(request.url);

    const report = await getProjectBackendIntelligenceReport(session, projectId, {
      preset: searchParams.get("preset"),
      startDate: searchParams.get("startDate"),
      endDate: searchParams.get("endDate"),
      environmentId: searchParams.get("environmentId"),
      compare: searchParams.get("compare") !== "false",
    });

    return NextResponse.json(report, {
      status: 200,
      headers: buildAuthenticatedReportResponseHeaders(report.cacheMetadata),
    });
  } catch (error) {
    const appErr = toAppError(error);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
