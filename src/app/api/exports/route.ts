import { toAppError } from "@avenor/types";
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import {
  createHistoricalDataExportJob,
  downloadExportArtifactWithToken,
  executeWorkspaceRetentionCleanup,
  getWorkspaceRetentionPolicy,
  listWorkspaceExportJobs,
  updateWorkspaceRetentionPolicy,
} from "@/lib/exports/service";

export async function GET(request: Request) {
  try {
    const session = await getServerSession();
    const url = new URL(request.url);
    const downloadId = url.searchParams.get("downloadId");
    const token = url.searchParams.get("token");

    if (downloadId && token) {
      const artifact = await downloadExportArtifactWithToken(session, downloadId, token);
      return new NextResponse(artifact.content, {
        status: 200,
        headers: {
          "Content-Type": artifact.contentType,
          "Content-Disposition": `attachment; filename="${artifact.filename}"`,
          "X-Content-SHA256": artifact.checksumSha256,
          "Cache-Control": "private, no-store",
        },
      });
    }

    const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
    const [jobs, retentionPolicy] = await Promise.all([
      listWorkspaceExportJobs(session, workspaceId),
      getWorkspaceRetentionPolicy(session, workspaceId),
    ]);
    return NextResponse.json({ jobs, retentionPolicy }, { status: 200 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const body = (await request.json()) as Record<string, unknown>;
    if (body.action === "run_retention_cleanup") {
      const result = await executeWorkspaceRetentionCleanup(
        session,
        typeof body.workspaceId === "string" ? body.workspaceId : undefined,
      );
      return NextResponse.json(result, { status: 200 });
    }
    const created = await createHistoricalDataExportJob(
      session,
      body as Parameters<typeof createHistoricalDataExportJob>[1],
    );
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getServerSession();
    const body = (await request.json()) as Parameters<typeof updateWorkspaceRetentionPolicy>[1];
    const policy = await updateWorkspaceRetentionPolicy(session, body);
    return NextResponse.json({ retentionPolicy: policy }, { status: 200 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}
