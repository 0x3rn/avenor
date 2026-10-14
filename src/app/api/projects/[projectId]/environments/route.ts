import { createProjectEnvironment, updateProjectEnvironment } from "@avenor/auth";
import { AppError, ERROR_CODES, toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const session = await getServerSession();
    const { projectId } = await context.params;
    const body = await request.json();
    const environment = await createProjectEnvironment(session, projectId, body, {
      expectedWorkspaceId: session?.activeWorkspace.id,
    });
    return NextResponse.json({ environment }, { status: 201 });
  } catch (err) {
    const appErr = toAppError(err);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const session = await getServerSession();
    const { projectId } = await context.params;
    const body = (await request.json()) as { environmentId?: string } & Record<string, unknown>;
    if (!body.environmentId) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "environmentId is required.",
      });
    }
    const environment = await updateProjectEnvironment(
      session,
      projectId,
      body.environmentId,
      body,
      { expectedWorkspaceId: session?.activeWorkspace.id },
    );
    return NextResponse.json({ environment }, { status: 200 });
  } catch (err) {
    const appErr = toAppError(err);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
