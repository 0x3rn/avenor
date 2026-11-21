import { toAppError } from "@avenor/types";
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-server";
import {
  deletePersonalAccountSafely,
  deleteWorkspaceCascade,
  exportPersonalAccountData,
  listUserPrivacyConsents,
  recordPrivacyConsent,
} from "@/lib/privacy/compliance";

export async function GET(request: Request) {
  try {
    const session = await getServerSession();
    const url = new URL(request.url);
    if (url.searchParams.get("action") === "export_account") {
      const bundle = await exportPersonalAccountData(session);
      return NextResponse.json(bundle, {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    const consents = await listUserPrivacyConsents(session);
    return NextResponse.json({ consents }, { status: 200 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const body = (await request.json()) as Parameters<typeof recordPrivacyConsent>[1];
    const consent = await recordPrivacyConsent(session, body);
    return NextResponse.json({ consent }, { status: 201 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getServerSession();
    const body = (await request.json()) as {
      scope?: "workspace" | "account";
      workspaceId?: string;
      confirmationSlug?: string;
      confirmationEmail?: string;
      deleteSoleOwnedEmptyWorkspaces?: boolean;
    };

    if (body.scope === "workspace") {
      const res = await deleteWorkspaceCascade(session, {
        workspaceId: String(body.workspaceId ?? ""),
        confirmationSlug: String(body.confirmationSlug ?? ""),
      });
      return NextResponse.json(res, { status: 200 });
    }

    const res = await deletePersonalAccountSafely(session, {
      confirmationEmail: String(body.confirmationEmail ?? ""),
      deleteSoleOwnedEmptyWorkspaces: Boolean(body.deleteSoleOwnedEmptyWorkspaces),
    });
    return NextResponse.json(res, { status: 200 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}
