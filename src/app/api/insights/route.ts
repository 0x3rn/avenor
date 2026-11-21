import { toAppError } from "@avenor/types";
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import {
  generateAndPersistInsightSummary,
  type InsightEvidenceItem,
  listWorkspaceInsights,
} from "@/lib/intelligence/insights";

export async function GET(request: Request) {
  try {
    const session = await getServerSession();
    const url = new URL(request.url);
    const insights = await listWorkspaceInsights(
      session,
      url.searchParams.get("workspaceId") ?? undefined,
    );
    return NextResponse.json({ insights }, { status: 200 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const body = (await request.json()) as {
      workspaceId?: string;
      projectId?: string | null;
      evidence?: InsightEvidenceItem[];
      preferAi?: boolean;
    };
    const insight = await generateAndPersistInsightSummary(session, {
      workspaceId: body.workspaceId,
      projectId: body.projectId,
      evidence: Array.isArray(body.evidence) ? body.evidence : [],
      preferAi: Boolean(body.preferAi),
    });
    return NextResponse.json({ insight }, { status: 201 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}
