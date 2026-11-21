import { type EnvironmentType, toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import { buildAuthenticatedReportResponseHeaders } from "@/lib/reports/cache";
import { getProjectControlCenterOverview } from "@/lib/reports/portfolio-service";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const session = await getServerSession();
    const { projectId } = await context.params;
    const { searchParams } = new URL(request.url);

    const environmentId = searchParams.get("environmentId");
    const environmentType = searchParams.get("environmentType") as EnvironmentType | null;
    const preset = searchParams.get("preset");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const compare = searchParams.get("compare") !== "false";

    const overview = await getProjectControlCenterOverview(session, projectId, {
      environmentId,
      environmentType,
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
