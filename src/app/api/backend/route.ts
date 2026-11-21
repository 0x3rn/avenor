import { toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import { getWorkspaceBackendIntelligenceReport } from "@/lib/reports/backend-service";
import { buildAuthenticatedReportResponseHeaders } from "@/lib/reports/cache";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    const { searchParams } = new URL(request.url);

    const report = await getWorkspaceBackendIntelligenceReport(session, {
      preset: searchParams.get("preset"),
      startDate: searchParams.get("startDate"),
      endDate: searchParams.get("endDate"),
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
