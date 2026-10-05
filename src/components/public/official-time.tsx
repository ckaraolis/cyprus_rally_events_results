"use client";

import { useEffect, useState } from "react";

/** Cyprus event timezone for the public “Official Time” clock. */
const OFFICIAL_TIME_ZONE = "Asia/Nicosia";

function formatOfficialHms(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: OFFICIAL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function OfficialTime() {
  const [clock, setClock] = useState(() => formatOfficialHms(new Date()));

  useEffect(() => {
    const tick = () => setClock(formatOfficialHms(new Date()));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      className="flex flex-col items-end leading-tight"
      title="Official time (Cyprus)"
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
