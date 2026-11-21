import { toAppError } from "@avenor/types";
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import { getWorkspaceUsageAndQuotaReport } from "@/lib/billing/quotas";

export async function GET(request: Request) {
  try {
    const session = await getServerSession();
    const url = new URL(request.url);
    const report = await getWorkspaceUsageAndQuotaReport(
      session,
      url.searchParams.get("workspaceId") ?? undefined,
    );
    return NextResponse.json(report, {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}
