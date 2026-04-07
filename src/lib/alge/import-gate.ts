import type { RallyEvent } from "@/lib/rally/types";

export type SpeedRunIdForImport = "trial" | "run1" | "run2";

/** Only live runs should accept incoming ALGE times. */
export function canImportAlgeTimesForRun(
  event: RallyEvent,
  runId: SpeedRunIdForImport,
): boolean {
  if (event.type !== "speed") return false;
  return event.speedRunImportStatus?.[runId] === "live";
}
