import { toAppError } from "@avenor/types";
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import {
  createOutgoingWebhookSubscription,
  createWorkspaceApiToken,
  listWorkspaceApiTokens,
  revokeWorkspaceApiToken,
} from "@/lib/public-api/tokens";

export async function GET(request: Request) {
  try {
    const session = await getServerSession();
    const url = new URL(request.url);
    const tokens = await listWorkspaceApiTokens(
      session,
      url.searchParams.get("workspaceId") ?? undefined,
    );
    return NextResponse.json({ tokens }, { status: 200 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const body = (await request.json()) as Record<string, unknown>;
    if (body.action === "create_webhook") {
      const created = await createOutgoingWebhookSubscription(
        session,
        body as unknown as Parameters<typeof createOutgoingWebhookSubscription>[1],
      );
      return NextResponse.json(created, { status: 201 });
    }
    const created = await createWorkspaceApiToken(
      session,
      body as unknown as Parameters<typeof createWorkspaceApiToken>[1],
    );
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getServerSession();
    const url = new URL(request.url);
    const tokenId = url.searchParams.get("tokenId") ?? "";
    const result = await revokeWorkspaceApiToken(
      session,
      tokenId,
      url.searchParams.get("workspaceId") ?? undefined,
    );
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}
