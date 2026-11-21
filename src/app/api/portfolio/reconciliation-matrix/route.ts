import { toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import {
  buildPortfolioReconciliationMatrix,
  type SourceConsoleBenchmarkEntry,
} from "@/lib/reports/mvp-reconciliation";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      startDate?: string;
      endDate?: string;
      executionMode?: "LIVE_PROVIDER_CREDENTIALS" | "DETERMINISTIC_FIXTURE_VERIFICATION";
      benchmarks?: SourceConsoleBenchmarkEntry[];
    };

    const today = new Date().toISOString().slice(0, 10);
    const matrix = await buildPortfolioReconciliationMatrix(session, {
      workspaceId: body.workspaceId,
      startDate: body.startDate ?? today,
      endDate: body.endDate ?? today,
      executionMode: body.executionMode,
      benchmarks: body.benchmarks ?? [],
    });

    return NextResponse.json(matrix, {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const appErr = toAppError(error);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
