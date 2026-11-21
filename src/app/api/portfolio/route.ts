import { toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import { buildAuthenticatedReportResponseHeaders } from "@/lib/reports/cache";
import { getWorkspacePortfolioOverview } from "@/lib/reports/portfolio-service";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    const { searchParams } = new URL(request.url);
    const preset = searchParams.get("preset");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const compare = searchParams.get("compare") !== "false";

    const overview = await getWorkspacePortfolioOverview(session, {
      preset,
      startDate,
      endDate,
      compare,
    });
    return NextResponse.json(overview, {
      status: 200,
      headers: buildAuthenticatedReportResponseHeaders(overview.cacheMetadata),
    });
  } catch (error) {
    const appErr = toAppError(error);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
