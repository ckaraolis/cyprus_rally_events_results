import { NextResponse } from "next/server";
import { loadEventLiveSnapshot } from "@/lib/rally/config-file";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
} as const;

/**
 * One-event live snapshot for public Results polling (faster than full /api/rally/config).
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await context.params;
  const id = typeof eventId === "string" ? eventId.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "Missing eventId" }, { status: 400, headers: NO_STORE });
  }
  const snap = await loadEventLiveSnapshot(id);
  if (!snap) {
    return NextResponse.json({ error: "Event not found" }, { status: 404, headers: NO_STORE });
  }
  return NextResponse.json(snap, { headers: NO_STORE });
}
