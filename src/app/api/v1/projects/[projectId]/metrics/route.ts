import { toAppError } from "@avenor/types";
import { NextResponse } from "next/server";
import { authenticatePublicApiToken, queryPublicProjectMetrics } from "@/lib/public-api/tokens";

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const principal = await authenticatePublicApiToken({
      authorizationHeader: request.headers.get("authorization"),
      requiredScope: "metrics:read",
      targetProjectId: projectId,
    });
    const url = new URL(request.url);
    const result = await queryPublicProjectMetrics(principal, projectId, {
      metricKey: url.searchParams.get("metricKey") ?? undefined,
      startDate: url.searchParams.get("startDate") ?? undefined,
      endDate: url.searchParams.get("endDate") ?? undefined,
      limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      cursor: url.searchParams.get("cursor"),
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}
