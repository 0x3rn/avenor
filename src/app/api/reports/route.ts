import { toAppError } from "@avenor/types";
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import {
  createSavedReport,
  deleteSavedReport,
  executeSavedReportBenchmark,
  listSavedReports,
  renderReportToPrintableHtml,
  serializeReportToSafeCsv,
} from "@/lib/reports/custom-reports";

export async function GET(request: Request) {
  try {
    const session = await getServerSession();
    const url = new URL(request.url);
    const executeId = url.searchParams.get("executeId");
    if (executeId) {
      const executed = await executeSavedReportBenchmark(session, executeId);
      const format = url.searchParams.get("format");
      if (format === "csv") {
        const csv = serializeReportToSafeCsv(executed);
        return new NextResponse(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="avenor-report-${executeId}.csv"`,
            "Cache-Control": "private, no-store",
          },
        });
      }
      if (format === "html") {
        const html = renderReportToPrintableHtml(executed);
        return new NextResponse(html, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "private, no-store",
          },
        });
      }
      return NextResponse.json(executed, {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      });
    }

    const reports = await listSavedReports(
      session,
      url.searchParams.get("workspaceId") ?? undefined,
    );
    return NextResponse.json(
      { reports },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const body = (await request.json()) as Parameters<typeof createSavedReport>[1];
    const report = await createSavedReport(session, body);
    return NextResponse.json({ report }, { status: 201 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getServerSession();
    const url = new URL(request.url);
    const reportId = url.searchParams.get("reportId") ?? "";
    const result = await deleteSavedReport(session, reportId);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}
