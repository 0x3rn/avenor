import { NextResponse } from "next/server";
import { buildPublicApiOpenApiSpec } from "@/lib/public-api/tokens";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `${url.protocol}//${url.host}`;
  return NextResponse.json(buildPublicApiOpenApiSpec(baseUrl), {
    status: 200,
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
