import { toAppError } from "@avenor/types";
import { NextResponse } from "next/server";
import { authenticatePublicApiToken, queryPublicProjects } from "@/lib/public-api/tokens";

export async function GET(request: Request) {
  try {
    const principal = await authenticatePublicApiToken({
      authorizationHeader: request.headers.get("authorization"),
      requiredScope: "projects:read",
    });
    const url = new URL(request.url);
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
    const cursor = url.searchParams.get("cursor");
    const result = await queryPublicProjects(principal, { limit, cursor });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toPublicJson(), { status: appError.statusCode });
  }
}
