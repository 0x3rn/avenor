import { AppError, ERROR_CODES, toAppError } from "@avenor/types";
import { NextResponse } from "next/server";
import { processLemonSqueezyWebhookEvent } from "@/lib/billing/lemon-squeezy";

export async function POST(request: Request) {
  try {
    const webhookSecret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET ?? "";
    if (!webhookSecret) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: "LEMON_SQUEEZY_WEBHOOK_SECRET is not configured on this server.",
      });
    }
    const rawBody = await request.text();
    const result = await processLemonSqueezyWebhookEvent({
      rawBody,
      signatureHeader: request.headers.get("x-signature"),
      webhookSecret,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}
