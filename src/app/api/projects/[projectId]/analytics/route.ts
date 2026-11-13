import { toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import {
  getProjectGa4StandardTelemetry,
  parseGa4ReportSearchParams,
} from "@/lib/reports/ga4-service";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const session = await getServerSession();
    const { projectId } = await context.params;
    const { searchParams } = new URL(request.url);
    const parsed = parseGa4ReportSearchParams(searchParams);

    const result = await getProjectGa4StandardTelemetry(session, projectId, parsed);

    return NextResponse.json(result.payload, { status: result.statusCode });
  } catch (error) {
    const appErr = toAppError(error);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
