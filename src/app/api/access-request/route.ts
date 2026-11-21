import { toAppError } from "@avenor/types";
import { type NextRequest, NextResponse } from "next/server";
import { submitPrivateAccessRequest } from "@/lib/onboarding/private-access";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      email?: string;
      productCountHint?: string | null;
      notes?: string | null;
    };

    const forwardedFor = request.headers.get("x-forwarded-for");
    const sourceIp = forwardedFor ? forwardedFor.split(",")[0]?.trim() : null;

    const result = await submitPrivateAccessRequest({
      name: body.name ?? "",
      email: body.email ?? "",
      productCountHint: body.productCountHint ?? null,
      notes: body.notes ?? null,
      sourceIp,
    });

    return NextResponse.json(result, {
      status: result.alreadyRequested ? 200 : 201,
    });
  } catch (error) {
    const appErr = toAppError(error);
    return NextResponse.json(appErr.toPublicJson(), { status: appErr.statusCode });
  }
}
