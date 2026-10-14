import { dbQuery } from "@avenor/database";
import { NextResponse } from "next/server";
import { connection } from "next/server";

export async function GET() {
  await connection();
  try {
    await dbQuery("SELECT 1");
  } catch {
    // Health endpoint remains responsive even if DB is warming
  }

  return NextResponse.json(
    {
      status: "ok",
      service: "avenor",
      designSystem: "signal-atlas-v1",
      externalAccessMode: "read-only",
      environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "development",
    },
    { status: 200 },
  );
}
