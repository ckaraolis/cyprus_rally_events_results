import type { Entry, Stage } from "@/lib/rally/types";
import { downloadExcelTable } from "@/lib/rally/download-excel";

type TimingBlob = Record<
  string,
  { startTime?: string; finishTime?: string; penalty?: string; penaltyNote?: string }
>;

const RALLY_EVENT_PENALTY_KEY = "__event_penalty__";
const RALLY_EVENT_PENALTY_LIST_KEY = "__event_penalties__";

function parseBlob(raw: string): TimingBlob {
  const trimmed = raw.trim();
  if (!trimmed || !trimmed.startsWith("{")) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: TimingBlob = {};
    for (const [stageId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const item = value as Record<string, unknown>;
      out[stageId] = {
        startTime: typeof item.startTime === "string" ? item.startTime : "",
        finishTime: typeof item.finishTime === "string" ? item.finishTime : "",
        penalty: typeof item.penalty === "string" ? item.penalty : "",
        penaltyNote: typeof item.penaltyNote === "string" ? item.penaltyNote : "",
      };
    }
    return out;
  } catch {
    return {};
  }
}

function parseClockToDayMs(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;
  const m = raw.match(
    /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:(?:[.,:])(\d{1,3}))?)?$/,
  );
  if (!m) return null;
  const h = Number.parseInt(m[1] ?? "0", 10);
  const min = Number.parseInt(m[2] ?? "0", 10);
  const sec = Number.parseInt(m[3] ?? "0", 10);
  const fracRaw = m[4] ?? "";
  const ms =
    fracRaw.length === 0
      ? 0
      : Number.parseInt(fracRaw.padEnd(3, "0").slice(0, 3), 10);
  return ((h * 60 + min) * 60 + sec) * 1000 + ms;
}

function parsePenaltyMs(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,3}):([0-5]?\d)$/);
  if (m) {
    const minutes = Number.parseInt(m[1] ?? "0", 10);
    const seconds = Number.parseInt(m[2] ?? "0", 10);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
    return (minutes * 60 + seconds) * 1000;
  }
  const secOnly = Number.parseInt(t, 10);
  return Number.isFinite(secOnly) && secOnly >= 0 ? secOnly * 1000 : null;
}

function formatDurationMs(ms: number | null): string {
  if (ms == null) return "—";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function formatDiffMs(ms: number): string {
  const base = formatDurationMs(ms);
  return base.startsWith("0:") ? base.slice(2) : base;
}

function stageValues(row: Entry, stageId: string) {
  const values = parseBlob(row.trialStartTime ?? "")[stageId] ?? {};
  return {
    start: values.startTime?.trim() ?? "",
    finish: values.finishTime?.trim() ?? "",
    penalty: values.penalty?.trim() ?? "",
  };
}

function classifyCell(startRaw: string, finishRaw: string): {
  outcome: string | null;
  durationMs: number | null;
} {
  const su = startRaw.trim().toUpperCase();
  const fu = finishRaw.trim().toUpperCase();
  if (su === "DNS" || fu === "DNS") return { outcome: "DNS", durationMs: null };
  if (su === "DNF" || fu === "DNF") return { outcome: "DNF", durationMs: null };
  if (su === "RET" || fu === "RET") return { outcome: "RET", durationMs: null };
  const startMs = parseClockToDayMs(startRaw);
  const finishMs = parseClockToDayMs(finishRaw);
  if (startMs == null || finishMs == null) return { outcome: null, durationMs: null };
  const d = finishMs - startMs;
  return d >= 0 ? { outcome: null, durationMs: d } : { outcome: null, durationMs: null };
}

type EventPen = { penalty: string; afterStageOrder: number };

function eventPenalties(row: Entry): EventPen[] {
  const blob = parseBlob(row.trialStartTime ?? "");
  const listRaw = blob[RALLY_EVENT_PENALTY_LIST_KEY]?.penalty?.trim() ?? "";
  if (listRaw.startsWith("[")) {
    try {
      const parsed = JSON.parse(listRaw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return null;
            const rec = item as Record<string, unknown>;
            const penalty = typeof rec.penalty === "string" ? rec.penalty.trim() : "";
            if (!penalty) return null;
            const n =
              typeof rec.afterStageOrder === "number"
                ? rec.afterStageOrder
                : Number.parseInt(String(rec.afterStageOrder ?? "1"), 10);
            return {
              penalty,
              afterStageOrder: Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1,
            };
          })
          .filter((x): x is EventPen => x != null);
      }
    } catch {
      /* legacy */
    }
  }
  const legacy = blob[RALLY_EVENT_PENALTY_KEY]?.penalty?.trim() ?? "";
  return legacy ? [{ penalty: legacy, afterStageOrder: 1 }] : [];
}

function eventPenaltyMs(row: Entry, throughOrder?: number, onlyOrders?: Set<number>): number {
  return eventPenalties(row)
    .filter((p) =>
      onlyOrders
        ? onlyOrders.has(p.afterStageOrder)
        : throughOrder == null || p.afterStageOrder <= throughOrder,
    )
    .reduce((sum, p) => sum + (parsePenaltyMs(p.penalty) ?? 0), 0);
}

function started(entries: Entry[]): Entry[] {
  return entries.filter((e) => e.start !== false);
}

export async function exportRallyStageExcel(
  eventName: string,
  entries: Entry[],
  stage: Stage,
): Promise<void> {
  const ranked = started(entries)
    .map((row) => {
      const v = stageValues(row, stage.id);
      const cell = classifyCell(v.start, v.finish);
      const jump = parsePenaltyMs(v.penalty) ?? 0;
      const timeMs = cell.durationMs != null ? cell.durationMs + jump : null;
      return { row, cell, timeMs, penaltyRaw: v.penalty };
    })
    .filter((x) => x.timeMs != null || x.cell.outcome != null || x.penaltyRaw)
    .sort((a, b) => {
      if (a.timeMs != null && b.timeMs != null && a.timeMs !== b.timeMs) {
        return a.timeMs - b.timeMs;
      }
      if (a.timeMs != null && b.timeMs == null) return -1;
      if (a.timeMs == null && b.timeMs != null) return 1;
      return a.row.startNumber - b.row.startNumber;
    });
  const leader = ranked.find((x) => x.timeMs != null)?.timeMs ?? null;
  const rows = ranked.map(({ row, cell, timeMs, penaltyRaw }, i) => [
    String(i + 1),
    String(row.startNumber),
    row.driver || "—",
    row.coDriver || "—",
    row.car || "—",
    row.class || "—",
    cell.outcome ?? formatDurationMs(timeMs),
    penaltyRaw.trim() || "—",
    timeMs == null || leader == null || timeMs <= leader
      ? "—"
      : `+${formatDiffMs(timeMs - leader)}`,
  ]);
  await downloadExcelTable({
    fileName: `${eventName}-SS${stage.order}`,
    sheetName: `SS${stage.order}`,
    columns: ["Pos", "#", "Driver", "Co-driver", "Car", "Class", "Time", "Penalty", "Diff"],
    rows,
  });
}

export async function exportRallyAfterSsExcel(
  eventName: string,
  entries: Entry[],
  stages: Stage[],
): Promise<void> {
  const throughOrder =
    stages.length > 0 ? Math.max(...stages.map((s) => s.order)) : 0;
  const ranked = started(entries)
    .map((row) => {
      const cells = stages.map((st) => {
        const v = stageValues(row, st.id);
        const cell = classifyCell(v.start, v.finish);
        const jump = parsePenaltyMs(v.penalty) ?? 0;
        const timeMs = cell.durationMs != null ? cell.durationMs + jump : null;
        return { jump, timeMs };
      });
      const allTimed = cells.length > 0 && cells.every((c) => c.timeMs != null);
      const stageTimeMs = allTimed
        ? cells.reduce((sum, c) => sum + (c.timeMs ?? 0), 0)
        : null;
      const jumpMs = cells.reduce((sum, c) => sum + c.jump, 0);
      const eventMs = throughOrder > 0 ? eventPenaltyMs(row, throughOrder) : 0;
      const totalMs =
        stageTimeMs != null ? stageTimeMs + eventMs : null;
      return {
        row,
        totalMs,
        penaltyMs: jumpMs + eventMs,
      };
    })
    .filter((x): x is { row: Entry; totalMs: number; penaltyMs: number } => x.totalMs != null)
    .sort((a, b) =>
      a.totalMs !== b.totalMs
        ? a.totalMs - b.totalMs
        : a.row.startNumber - b.row.startNumber,
    );
  const leader = ranked[0]?.totalMs ?? null;
  const last = stages[stages.length - 1];
  const rows = ranked.map(({ row, totalMs, penaltyMs }, i) => [
    String(i + 1),
    String(row.startNumber),
    row.driver || "—",
    row.coDriver || "—",
    row.car || "—",
    row.class || "—",
    formatDurationMs(totalMs),
    penaltyMs > 0 ? formatDurationMs(penaltyMs) : "—",
    leader == null || totalMs <= leader ? "—" : `+${formatDiffMs(totalMs - leader)}`,
  ]);
  await downloadExcelTable({
    fileName: `${eventName}-After-SS${last?.order ?? ""}`,
    sheetName: `After SS${last?.order ?? ""}`,
    columns: ["Pos", "#", "Driver", "Co-driver", "Car", "Class", "Total", "Penalty", "Diff"],
    rows,
  });
}

export async function exportRallyLegExcel(
  eventName: string,
  entries: Entry[],
  stagesInLeg: Stage[],
  leg: number,
): Promise<void> {
  const allCompleted =
    stagesInLeg.length > 0 &&
    stagesInLeg.every((st) => st.progressStatus === "completed");
  const legOrders = new Set(stagesInLeg.map((s) => s.order));
  const ranked = started(entries).map((row) => {
    let jumpMs = 0;
    const stageTexts: string[] = [];
    const durations: Array<number | null> = [];
    let outcome: string | null = null;
    for (const st of stagesInLeg) {
      if (!allCompleted) {
        stageTexts.push("—");
        durations.push(null);
        continue;
      }
      const v = stageValues(row, st.id);
      const cell = classifyCell(v.start, v.finish);
      const pen = parsePenaltyMs(v.penalty) ?? 0;
      jumpMs += pen;
      if (cell.outcome) {
        stageTexts.push(cell.outcome);
        durations.push(null);
        if (!outcome) outcome = cell.outcome;
        else if (cell.outcome === "DNS") outcome = "DNS";
        else if (cell.outcome === "RET" && outcome !== "DNS") outcome = "RET";
        else if (cell.outcome === "DNF" && outcome !== "DNS" && outcome !== "RET") {
          outcome = "DNF";
        }
      } else {
        const d = cell.durationMs != null ? cell.durationMs + pen : null;
        stageTexts.push(formatDurationMs(d));
        durations.push(d);
      }
    }
    const allTimed =
      allCompleted && durations.length > 0 && durations.every((d) => d != null);
    const eventMs = allCompleted ? eventPenaltyMs(row, undefined, legOrders) : 0;
    const stageTimeMs = allTimed
      ? durations.reduce((sum, d) => sum + (d ?? 0), 0)
      : null;
    const totalMs = stageTimeMs != null ? stageTimeMs + eventMs : null;
    const penaltyMs = jumpMs + eventMs;
    const sortTier = outcome ? 2 : totalMs != null ? 0 : 1;
    return { row, stageTexts, penaltyMs, totalMs, sortTier, outcome };
  });
  ranked.sort((a, b) => {
    if (a.sortTier !== b.sortTier) return a.sortTier - b.sortTier;
    if (a.sortTier === 0) {
      return (a.totalMs ?? 0) - (b.totalMs ?? 0) || a.row.startNumber - b.row.startNumber;
    }
    return a.row.startNumber - b.row.startNumber;
  });
  const leader = ranked.find((x) => x.sortTier === 0)?.totalMs ?? null;
  const rows = ranked.map((r, i) => [
    String(i + 1),
    String(r.row.startNumber),
    r.row.driver || "—",
    r.row.coDriver || "—",
    r.row.car || "—",
    ...r.stageTexts,
    r.penaltyMs > 0 ? formatDurationMs(r.penaltyMs) : "—",
    r.outcome ?? formatDurationMs(r.totalMs),
    r.sortTier !== 0 || leader == null || r.totalMs == null || r.totalMs <= leader
      ? "—"
      : `+${formatDiffMs(r.totalMs - leader)}`,
  ]);
  await downloadExcelTable({
    fileName: `${eventName}-LEG${leg}`,
    sheetName: `LEG${leg}`,
    columns: [
      "Pos",
      "#",
      "Driver",
      "Co-driver",
      "Car",
      ...stagesInLeg.map((st) => `SS${st.order}`),
      "Penalty",
      "Total",
      "Diff",
    ],
    rows,
  });
}

export async function exportRallyFinalExcel(
  eventName: string,
  entries: Entry[],
  stages: Stage[],
): Promise<void> {
  const ranked = started(entries)
    .map((row) => {
      const cells = stages.map((st) => {
        const v = stageValues(row, st.id);
        const cell = classifyCell(v.start, v.finish);
        const jump = parsePenaltyMs(v.penalty) ?? 0;
        return cell.durationMs != null ? cell.durationMs + jump : null;
      });
      const allTimed = cells.length > 0 && cells.every((c) => c != null);
      const timeMs = allTimed ? cells.reduce((sum, c) => sum + (c ?? 0), 0) : null;
      const penaltyMs = eventPenaltyMs(row);
      const totalMs = timeMs != null ? timeMs + penaltyMs : null;
      return { row, timeMs, penaltyMs, totalMs };
    })
    .filter((x): x is { row: Entry; timeMs: number; penaltyMs: number; totalMs: number } =>
      x.totalMs != null,
    )
    .sort((a, b) =>
      a.totalMs !== b.totalMs
        ? a.totalMs - b.totalMs
        : a.row.startNumber - b.row.startNumber,
    );
  const leader = ranked[0]?.totalMs ?? null;
  const rows = ranked.map(({ row, timeMs, penaltyMs, totalMs }, i) => [
    String(i + 1),
    String(row.startNumber),
    row.driver || "—",
    row.coDriver || "—",
    row.car || "—",
    row.class || "—",
    formatDurationMs(timeMs),
    penaltyMs > 0 ? formatDurationMs(penaltyMs) : "—",
    formatDurationMs(totalMs),
    leader == null || totalMs <= leader ? "—" : `+${formatDiffMs(totalMs - leader)}`,
  ]);
  await downloadExcelTable({
    fileName: `${eventName}-Final-Results`,
    sheetName: "Final Results",
    columns: [
      "Pos",
      "#",
      "Driver",
      "Co-driver",
      "Car",
      "Class",
      "Time",
      "Penalty",
      "Total time",
      "Diff",
    ],
    rows,
  });
}
