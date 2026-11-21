import { toAppError } from "@avenor/types";
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import {
  evaluateAndPersistProjectAnomaly,
  listWorkspaceAnomalies,
  type StatisticalAnomalyInput,
  updateAnomalyStatus,
} from "@/lib/intelligence/anomalies";

export async function GET(request: Request) {
  try {
    const session = await getServerSession();
    const url = new URL(request.url);
    const anomalies = await listWorkspaceAnomalies(
      session,
      url.searchParams.get("workspaceId") ?? undefined,
    );
    return NextResponse.json({ anomalies }, { status: 200 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const body = (await request.json()) as {
      projectId: string;
      evaluation: StatisticalAnomalyInput;
    };
    const result = await evaluateAndPersistProjectAnomaly(
      session,
      String(body.projectId ?? ""),
      body.evaluation,
    );
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getServerSession();
    const body = (await request.json()) as {
      anomalyId?: string;
      status?: "ACKNOWLEDGED" | "RESOLVED";
    };
    const anomaly = await updateAnomalyStatus(
      session,
      String(body.anomalyId ?? ""),
      body.status === "RESOLVED" ? "RESOLVED" : "ACKNOWLEDGED",
    );
    return NextResponse.json({ anomaly }, { status: 200 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}
