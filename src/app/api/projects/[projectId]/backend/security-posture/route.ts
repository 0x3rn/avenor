import { toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import { getAndPersistProjectSecurityPosture } from "@/lib/reports/security-posture";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const session = await getServerSession();
    const { projectId } = await context.params;

    const posture = await getAndPersistProjectSecurityPosture(session, projectId);
    return NextResponse.json(posture, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const appErr = toAppError(error);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
