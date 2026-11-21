import { toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import {
  type CreateCostSpendingThresholdInput,
  createCostSpendingThreshold,
  evaluateCostSpendingThresholds,
  listCostSpendingThresholds,
} from "@/lib/billing/thresholds";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const session = await getServerSession();
    const { projectId } = await context.params;
    const data = await listCostSpendingThresholds(session, { projectId });
    return NextResponse.json(data, { status: 200 });
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
    const body = (await request.json().catch(() => ({}))) as CreateCostSpendingThresholdInput & {
      action?: "create" | "evaluate";
      referenceDate?: string;
    };

    if (body.action === "evaluate") {
      const evaluations = await evaluateCostSpendingThresholds(session, {
        projectId,
        referenceDate: body.referenceDate,
      });
      const updated = await listCostSpendingThresholds(session, { projectId });
      return NextResponse.json({ latestEvaluations: evaluations, ...updated }, { status: 200 });
    }

    const threshold = await createCostSpendingThreshold(session, {
      ...body,
      projectId,
    });
    const evaluations = await evaluateCostSpendingThresholds(session, {
      projectId,
      referenceDate: body.referenceDate,
    });
    const updated = await listCostSpendingThresholds(session, { projectId });

    return NextResponse.json(
      {
        threshold,
        latestEvaluations: evaluations,
        ...updated,
      },
      { status: 201 },
    );
  } catch (error) {
    const appErr = toAppError(error);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
