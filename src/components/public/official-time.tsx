"use client";

import { useEffect, useRef, useState } from "react";

/** Cyprus event timezone for the public “Official Time” clock. */
const OFFICIAL_TIME_ZONE = "Asia/Nicosia";

function formatOfficialHms(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: OFFICIAL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

/**
 * Keep a running estimate of ALGE GPS official time:
 * clientNow + (serverNow - clientNowAtFetch) + algeOffsetMs
 */
export function OfficialTime() {
  const [clock, setClock] = useState("--:--:--");
  /** officialMs ≈ Date.now() + correctionRef */
  const correctionRef = useRef(-21_000);

  useEffect(() => {
    let cancelled = false;

    async function syncFromServer() {
      try {
        const clientBefore = Date.now();
        const res = await fetch("/api/official-time", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          serverNowMs?: number;
          algeOffsetMs?: number;
          officialNowMs?: number;
        };
        const clientAfter = Date.now();
        const rtt = clientAfter - clientBefore;
        const serverNow =
          typeof data.serverNowMs === "number" && Number.isFinite(data.serverNowMs)
            ? data.serverNowMs
            : null;
        const algeOffset =
          typeof data.algeOffsetMs === "number" && Number.isFinite(data.algeOffsetMs)
            ? data.algeOffsetMs
            : -21_000;
        if (serverNow == null || cancelled) return;
        // Assume response midpoint ≈ server sample time.
        const clientMid = clientBefore + rtt / 2;
        correctionRef.current = serverNow + algeOffset - clientMid;
      } catch {
        /* keep last correction */
      }
    }

    const tick = () => {
      setClock(formatOfficialHms(Date.now() + correctionRef.current));
    };

    void syncFromServer().then(tick);
    const tickId = window.setInterval(tick, 250);
    const syncId = window.setInterval(() => {
      void syncFromServer();
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(tickId);
      window.clearInterval(syncId);
    };
  }, []);

  return (
    <div
      className="flex flex-col items-end leading-tight"
      title="Official time (ALGE GPS / Cyprus)"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--ewrc-muted-3)]">
        Official Time
      </span>
      <span className="font-mono text-sm font-bold tabular-nums text-[var(--ewrc-heading)] sm:text-base">
        {clock}
      </span>
    </div>
  );
}
