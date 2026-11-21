import { type EnvironmentType, toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import { syncBigQueryBillingCostLedger } from "@/lib/providers/google-cloud-billing";
import { buildAuthenticatedReportResponseHeaders } from "@/lib/reports/cache";
import { getProjectCostIntelligenceReport } from "@/lib/reports/cost-service";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const session = await getServerSession();
    const { projectId } = await context.params;
    const { searchParams } = new URL(request.url);

    const report = await getProjectCostIntelligenceReport(session, projectId, {
      environmentId: searchParams.get("environmentId"),
      environmentType: searchParams.get("environmentType") as EnvironmentType | null,
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

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const session = await getServerSession();
    const { projectId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      connectedResourceId: string;
      environmentId?: string | null;
      startDate: string;
      endDate: string;
      gcpProjectFilter?: string | null;
    };

    const syncResult = await syncBigQueryBillingCostLedger(session, {
      connectedResourceId: body.connectedResourceId,
      projectId,
      environmentId: body.environmentId ?? null,
      startDate: body.startDate,
      endDate: body.endDate,
      gcpProjectFilter: body.gcpProjectFilter ?? null,
    });

    const report = await getProjectCostIntelligenceReport(session, projectId, {
      environmentId: body.environmentId,
      preset: "custom",
      startDate: body.startDate,
      endDate: body.endDate,
      bypassCache: true,
    });

    return NextResponse.json({ syncResult, report }, { status: 200 });
  } catch (error) {
    const appErr = toAppError(error);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
