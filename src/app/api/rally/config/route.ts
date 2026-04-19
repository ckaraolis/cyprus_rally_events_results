import { NextResponse } from "next/server";
import { loadRallyConfig } from "@/lib/rally/config-file";

export const dynamic = "force-dynamic";

/**
 * Public JSON snapshot for client polling (avoids `router.refresh()` RSC storms / stuck “Rendering…”).
 */
export async function GET() {
  const config = await loadRallyConfig();
  return NextResponse.json(config, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
