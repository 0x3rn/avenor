import { AppError, ERROR_CODES, toAppError } from "@avenor/types";
import { NextResponse } from "next/server";
import { sharedGitHubWebhookDedupe, verifyAndMinimizeGitHubWebhook } from "@/lib/providers/github";

export async function POST(request: Request) {
  try {
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
    if (!webhookSecret) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: "GITHUB_WEBHOOK_SECRET is not configured on this server.",
      });
    }

    const rawBody = await request.text();
    const event = verifyAndMinimizeGitHubWebhook({
      rawBody,
      eventHeader: request.headers.get("x-github-event"),
      deliveryIdHeader: request.headers.get("x-github-delivery"),
      signatureHeader: request.headers.get("x-hub-signature-256"),
      webhookSecret,
    });

    const isNewDelivery = sharedGitHubWebhookDedupe.recordIfNew(event.deliveryId);
    return NextResponse.json(
      {
        accepted: true,
        deduplicated: !isNewDelivery,
        deliveryId: event.deliveryId,
        event,
      },
      { status: 200 },
    );
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}
