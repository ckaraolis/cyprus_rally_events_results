import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/db — checks Prisma → Postgres (DATABASE_URL).
 * Use when the public site looks stale or admin saves don’t appear.
 */
export async function GET() {
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - t0;
    return NextResponse.json({
      ok: true,
      latencyMs,
      rallyDbReads: process.env.RALLY_DB_READS === "1",
      rallyDbWrites: process.env.RALLY_DB_WRITES === "1",
      rallyFileWrites: process.env.RALLY_FILE_WRITES !== "0",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        ok: false,
        latencyMs: Date.now() - t0,
        error: message,
        rallyDbReads: process.env.RALLY_DB_READS === "1",
        rallyDbWrites: process.env.RALLY_DB_WRITES === "1",
        rallyFileWrites: process.env.RALLY_FILE_WRITES !== "0",
      },
      { status: 503 },
    );
  }
}
