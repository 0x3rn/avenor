import { type EnvironmentType, toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import {
  generateProjectReconciliationReport,
  type ProviderExpectedMetricBenchmark,
} from "@/lib/reports/reconciliation";

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
    const includeToday = searchParams.get("includeToday") === "true";
    const metricsParam = searchParams.get("metrics");
    const canonicalMetricKeys = metricsParam
      ? metricsParam.split(",").map((m) => m.trim()).filter(Boolean)
      : undefined;

    const dimensionFilters: Record<string, string> = {};
    for (const dimKey of [
      "country",
      "device",
      "sessionDefaultChannelGroup",
      "pagePath",
      "query",
      "page",
      "searchType",
    ]) {
      const val = searchParams.get(`filter.${dimKey}`) ?? searchParams.get(dimKey);
      if (val) {
        dimensionFilters[dimKey] = val;
      }
    }

    const report = await generateProjectReconciliationReport(session, projectId, {
      environmentId,
      environmentType,
      preset,
      startDate,
      endDate,
      includeToday,
      canonicalMetricKeys,
      dimensionFilters,
    });
    return NextResponse.json(report, { status: 200 });
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
      environmentId?: string | null;
      environmentType?: EnvironmentType | null;
      preset?: string | null;
      startDate?: string | null;
      endDate?: string | null;
      includeToday?: boolean;
      canonicalMetricKeys?: string[];
      dimensionFilters?: Record<string, string | null | undefined>;
      benchmarks?: ProviderExpectedMetricBenchmark[];
    };

    const report = await generateProjectReconciliationReport(session, projectId, body);
    return NextResponse.json(report, { status: 200 });
  } catch (error) {
    const appErr = toAppError(error);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
