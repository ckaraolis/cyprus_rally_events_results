import { NextResponse } from "next/server";
import { loadRallyConfig } from "@/lib/rally/config-file";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Public JSON snapshot for client polling (avoids `router.refresh()` RSC storms / stuck “Rendering…”).
 */
export async function GET() {
  const config = await loadRallyConfig();
  return NextResponse.json(config, {
    headers: {
      "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      // Prevent Vercel/CDN from serving a stale config while admin is saving times.
      "CDN-Cache-Control": "no-store",
      "Vercel-CDN-Cache-Control": "no-store",
    },
  });
}
