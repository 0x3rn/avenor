import { toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import { buildAuthenticatedReportResponseHeaders } from "@/lib/reports/cache";
import { getWorkspaceCostIntelligenceReport } from "@/lib/reports/cost-service";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    const { searchParams } = new URL(request.url);

    const report = await getWorkspaceCostIntelligenceReport(session, {
      preset: searchParams.get("preset"),
      startDate: searchParams.get("startDate"),
      endDate: searchParams.get("endDate"),
      compare: searchParams.get("compare") !== "false",
      currencyFilter: searchParams.get("currency"),
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
