import type { Entry } from "@/lib/rally/types";

export type SpeedImportRunId = "trial" | "run1" | "run2";

type ParsedRow = {
  startNumber: number;
  startTime: string;
  finishTime: string;
};

function parseStartNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === "string") {
    const n = Number.parseInt(v.trim(), 10);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function normalizeClock(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.trim();
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (k in obj) return obj[k];
  }
  return undefined;
}

function toRows(raw: unknown): ParsedRow[] {
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? ([
          (raw as Record<string, unknown>).rows,
          (raw as Record<string, unknown>).data,
          (raw as Record<string, unknown>).results,
          (raw as Record<string, unknown>).items,
        ].find(Array.isArray) as unknown[] | undefined) ?? []
      : [];

  const out: ParsedRow[] = [];
  for (const r of arr) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const startNumber = parseStartNumber(
      pick(o, ["startNumber", "start_no", "no", "carNo", "car", "bib"]),
    );
    if (startNumber == null) continue;
    const startTime = normalizeClock(
      pick(o, ["startTime", "timeStart", "start", "st"]),
    );
    const finishTime = normalizeClock(
      pick(o, ["finishTime", "timeFinish", "finish", "ft"]),
    );
    if (!startTime || !finishTime) continue;
    out.push({ startNumber, startTime, finishTime });
  }
  return out;
}

export function mergeImportedSpeedTimes(
  entries: Entry[],
  runId: SpeedImportRunId,
  payload: unknown,
): { nextEntries: Entry[]; updated: number; unmatchedRows: number } {
  const rows = toRows(payload);
  const byNumber = new Map<number, ParsedRow>();
  for (const r of rows) byNumber.set(r.startNumber, r);

  let updated = 0;
  let unmatchedRows = 0;
  const matched = new Set<number>();

  const nextEntries = entries.map((e) => {
    const row = byNumber.get(e.startNumber);
    if (!row) return e;
    matched.add(e.startNumber);
    updated += 1;
    if (runId === "trial") {
      return { ...e, trialStartTime: row.startTime, trialFinishTime: row.finishTime };
    }
    if (runId === "run1") {
      return { ...e, run1StartTime: row.startTime, run1FinishTime: row.finishTime };
    }
    return { ...e, run2StartTime: row.startTime, run2FinishTime: row.finishTime };
  });

  for (const r of rows) {
    if (!matched.has(r.startNumber)) unmatchedRows += 1;
  }

  return { nextEntries, updated, unmatchedRows };
}
