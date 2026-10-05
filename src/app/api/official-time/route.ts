import { NextResponse } from "next/server";

/**
 * ALGE GPS official clock vs wall/server clock.
 * Positive = ALGE is ahead; negative = ALGE is behind (display must lag).
 * Override with env OFFICIAL_TIME_OFFSET_MS (e.g. "-21000").
 */
function algeGpsOffsetMs(): number {
  const raw = process.env.OFFICIAL_TIME_OFFSET_MS?.trim();
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return n;
  }
  // Observed: website/browser was ~21s ahead of ALGE GPS official time.
  return -21_000;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const nowMs = Date.now();
  const offsetMs = algeGpsOffsetMs();
  return NextResponse.json(
    {
      serverNowMs: nowMs,
      /** Add to client Date.now() after aligning to serverNowMs. */
      algeOffsetMs: offsetMs,
      /** Authoritative official instant at response time. */
      officialNowMs: nowMs + offsetMs,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
