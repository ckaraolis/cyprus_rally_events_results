import type { RallyEvent } from "@/lib/rally/types";

export type SpeedRunIdForImport = "trial" | "run1" | "run2";

/** Only runs in `live` import status accept ALGE pulls; `completed` / `scheduled` are manual-only. */
export function canImportAlgeTimesForRun(
  event: RallyEvent,
  runId: SpeedRunIdForImport,
): boolean {
  if (event.type !== "speed") return false;
  return event.speedRunImportStatus?.[runId] === "live";
}
