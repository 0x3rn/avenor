import { toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import {
  getOnboardingProgress,
  type OnboardingStepKey,
  upsertOnboardingProgress,
} from "@/lib/onboarding/private-access";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    const { searchParams } = new URL(request.url);
    const progress = await getOnboardingProgress(
      session,
      searchParams.get("workspaceId") ?? undefined,
    );
    return NextResponse.json(progress, {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const appErr = toAppError(error);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession();
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      currentStep: OnboardingStepKey;
      completedSteps?: OnboardingStepKey[];
      draftProjectId?: string | null;
      metadata?: Record<string, unknown>;
      markCompleted?: boolean;
    };

    const progress = await upsertOnboardingProgress(session, body);
    return NextResponse.json(progress, { status: 200 });
  } catch (error) {
    const appErr = toAppError(error);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
