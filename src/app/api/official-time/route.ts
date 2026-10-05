import { NextResponse } from "next/server";

/**
 * Extra ms added on top of server wall clock to match ALGE GPS official time.
 * Positive = show later than server; negative = show earlier.
 * Override with env OFFICIAL_TIME_OFFSET_MS (e.g. "0" or "-500").
 */
function algeGpsOffsetMs(): number {
  const raw = process.env.OFFICIAL_TIME_OFFSET_MS?.trim();
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return n;
  }
  return 0;
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
