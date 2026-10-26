import type { Entry, Stage } from "@/lib/rally/types";
import { formatNameWithNationality } from "@/lib/flags";
import { downloadExcelTable } from "@/lib/rally/download-excel";
import { resolveStartingOrderTime, startingOrderScopeLabel } from "@/lib/rally/leg-starting-order";
import {
  isPreEventStage,
  stageControlLabel,
  stageLegNumber,
} from "@/lib/rally/stage-kind";
import {
  findShakedownBestDurationMs,
  getShakedownPassCount,
  getShakedownPassDurationsMs,
  getShakedownPasses,
  isShakedownStage,
  parseStageTimingBlobEntry,
  type StageTimingBlobEntry,
} from "@/lib/rally/shakedown-passes";
import {
  RALLY2_FOOTNOTE,
  buildRallyFinalRanking,
  buildRallyOverallRanking,
  formatDiffDurationMs,
  formatDurationMs as formatOverallDurationMs,
  isStageCancelled,
  isStageSettledForLeg,
  resolveRallyStageCell,
  stageAllowsRally2,
} from "@/lib/rally/results-timing";

type TimingBlob = Record<string, StageTimingBlobEntry>;

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
      out[stageId] = parseStageTimingBlobEntry(value as Record<string, unknown>);
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

function formatDurationMs(
  ms: number | null,
  fractionDigits: 2 | 3 = 2,
): string {
  if (ms == null) return "—";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const frac =
    fractionDigits === 3
      ? Math.floor(ms % 1000)
      : Math.floor((ms % 1000) / 10);
  const fracStr = String(frac).padStart(fractionDigits, "0");
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${fracStr}`;
  }
  return `${m}:${String(s).padStart(2, "0")}.${fracStr}`;
}

function formatDiffMs(ms: number, fractionDigits: 2 | 3 = 2): string {
  const base = formatDurationMs(ms, fractionDigits);
  return base.startsWith("0:") ? base.slice(2) : base;
}

function stageValues(row: Entry, stageId: string) {
  const values = parseBlob(row.trialStartTime ?? "")[stageId] ?? {};
  return {
    start: values.startTime?.trim() ?? "",
    finish: values.finishTime?.trim() ?? "",
    penalty: values.penalty?.trim() ?? "",
    rally2: values.rally2 === true,
  };
}

function formatCarNumber(startNumber: number, rally2: boolean): string {
  return rally2 ? `*${startNumber}` : String(startNumber);
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
  allStages: Stage[] = [stage],
): Promise<void> {
  const timeDigits: 2 | 3 = isPreEventStage(stage) ? 3 : 2;
  const chip = stageControlLabel(stage, allStages).replace(/\s+/g, "");
  const fileTag = isPreEventStage(stage)
    ? stage.kind === "qualify"
      ? "Qualify"
      : "Shakedown"
    : chip || `SS${stage.order}`;

  if (isShakedownStage(stage)) {
    const passCount = getShakedownPassCount(stage);
    const ranked = started(entries)
      .map((row) => {
        const blob = parseBlob(row.trialStartTime ?? "");
        const passes = getShakedownPasses(blob[stage.id], passCount);
        const durations = getShakedownPassDurationsMs(
          passes,
          parseClockToDayMs,
          passCount,
        );
        const bestMs = findShakedownBestDurationMs(durations);
        return { row, durations, bestMs };
      })
      .filter((x) => x.bestMs != null)
      .sort((a, b) =>
        (a.bestMs ?? 0) !== (b.bestMs ?? 0)
          ? (a.bestMs ?? 0) - (b.bestMs ?? 0)
          : a.row.startNumber - b.row.startNumber,
      );
    const leader = ranked[0]?.bestMs ?? null;
    const rows = ranked.map(({ row, durations, bestMs }, i) => [
      String(i + 1),
      String(row.startNumber),
      formatNameWithNationality(row.driver, row.driverCountryCode),
      formatNameWithNationality(row.coDriver, row.coDriverCountryCode),
      row.car || "—",
      row.class || "—",
      ...Array.from({ length: passCount }, (_, pi) => {
        const d = durations[pi];
        return d != null ? formatDurationMs(d, timeDigits) : "—";
      }),
      bestMs != null ? formatDurationMs(bestMs, timeDigits) : "—",
      bestMs == null || leader == null || bestMs <= leader
        ? "—"
        : `+${formatDiffMs(bestMs - leader, timeDigits)}`,
    ]);
    await downloadExcelTable({
      fileName: `${eventName}-${fileTag}`,
      sheetName: fileTag.slice(0, 31),
      columns: [
        "Pos",
        "#",
        "Driver",
        "Co-driver",
        "Car",
        "Class",
        ...Array.from({ length: passCount }, (_, i) => String(i + 1)),
        "Best",
        "Diff",
      ],
      rows,
    });
    return;
  }

  const showRally2 = stageAllowsRally2(stage);
  if (isStageCancelled(stage)) {
    await downloadExcelTable({
      fileName: `${eventName}-${fileTag}`,
      sheetName: fileTag.slice(0, 31),
      columns: [
        "Pos",
        "#",
        "Driver",
        "Co-driver",
        "Car",
        "Class",
        isPreEventStage(stage) ? "Time" : "SS Time",
        "Penalty",
        "Total time",
        "Diff",
      ],
      rows: [["—", "—", "Stage cancelled — no times.", "", "", "", "", "", "", ""]],
    });
    return;
  }
  // SS stage export: timed crews only. DNF/DNS/RET appear on After-SS overall.
  const ranked = started(entries)
    .map((row) => {
      const v = stageValues(row, stage.id);
      const cell = resolveRallyStageCell(row, stage);
      const penaltyMs = parsePenaltyMs(v.penalty) ?? 0;
      const ssTimeMs = cell.durationMs;
      const totalMs =
        ssTimeMs != null ? ssTimeMs + penaltyMs : null;
      return {
        row,
        ssTimeMs,
        penaltyMs,
        totalMs,
        rally2: showRally2 && cell.rally2,
      };
    })
    .filter(
      (x): x is {
        row: Entry;
        ssTimeMs: number;
        penaltyMs: number;
        totalMs: number;
        rally2: boolean;
      } => x.totalMs != null,
    )
    .sort((a, b) =>
      a.totalMs !== b.totalMs
        ? a.totalMs - b.totalMs
        : a.row.startNumber - b.row.startNumber,
    );
  const leader = ranked[0]?.totalMs ?? null;
  const rows = ranked.map(
    ({ row, ssTimeMs, penaltyMs, totalMs, rally2 }, i) => [
      String(i + 1),
      formatCarNumber(row.startNumber, rally2),
      formatNameWithNationality(row.driver, row.driverCountryCode),
      formatNameWithNationality(row.coDriver, row.coDriverCountryCode),
      row.car || "—",
      row.class || "—",
      formatDurationMs(ssTimeMs, timeDigits),
      penaltyMs > 0 ? formatDurationMs(penaltyMs) : "—",
      formatDurationMs(totalMs, timeDigits),
      leader == null || totalMs <= leader
        ? "—"
        : `+${formatDiffMs(totalMs - leader, timeDigits)}`,
    ],
  );
  if (ranked.some((x) => x.rally2)) {
    rows.push([
      "",
      "",
      RALLY2_FOOTNOTE,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
  }
  await downloadExcelTable({
    fileName: `${eventName}-${fileTag}`,
    sheetName: fileTag.slice(0, 31),
    columns: [
      "Pos",
      "#",
      "Driver",
      "Co-driver",
      "Car",
      "Class",
      isPreEventStage(stage) ? "Time" : "SS Time",
      "Penalty",
      "Total time",
      "Diff",
    ],
    rows,
  });
}

export async function exportRallyAfterSsExcel(
  eventName: string,
  entries: Entry[],
  stages: Stage[],
): Promise<void> {
  const ranked = buildRallyOverallRanking(started(entries), stages);
  const leader = ranked.find((x) => x.tier === 0)?.totalMs ?? null;
  const last = stages[stages.length - 1];
  const lastLabel = last
    ? stageControlLabel(last, stages).replace(/\s+/g, "")
    : "";
  let classifiedPos = 0;
  const rows = ranked.map(
    ({ row, ssTimesMs, totalMs, penaltyMs, tier, statusLabel }) => {
      const pos = tier === 0 ? String(++classifiedPos) : "—";
      return [
        pos,
        String(row.startNumber),
        formatNameWithNationality(row.driver, row.driverCountryCode),
        formatNameWithNationality(row.coDriver, row.coDriverCountryCode),
        row.car || "—",
        row.class || "—",
        tier === 0
          ? formatOverallDurationMs(ssTimesMs)
          : (statusLabel ?? "—"),
        tier === 0 && penaltyMs > 0
          ? formatOverallDurationMs(penaltyMs)
          : "—",
        tier === 0
          ? formatOverallDurationMs(totalMs)
          : (statusLabel ?? "—"),
        tier === 0 &&
        leader != null &&
        totalMs != null &&
        totalMs > leader
          ? `+${formatDiffDurationMs(totalMs - leader)}`
          : "—",
      ];
    },
  );
  await downloadExcelTable({
    fileName: `${eventName}-After-${lastLabel || "SS"}`,
    sheetName: `After ${lastLabel || "SS"}`.slice(0, 31),
    columns: [
      "Pos",
      "#",
      "Driver",
      "Co-driver",
      "Car",
      "Class",
      "SS Times",
      "Penalty",
      "Total time",
      "Diff",
    ],
    rows,
  });
}

export async function exportRallyLegExcel(
  eventName: string,
  entries: Entry[],
  stagesInLeg: Stage[],
  leg: number,
  allStages: Stage[] = stagesInLeg,
): Promise<void> {
  const resultLeg =
    Number.isFinite(leg) && leg >= 1 ? Math.floor(leg) : 1;
  const laterLegStagesSettled = stagesInLeg
    .filter((st) => stageLegNumber(st) >= 2 && !isStageCancelled(st))
    .every((st) => isStageSettledForLeg(st));
  const totalsReady = resultLeg === 1 || laterLegStagesSettled;
  const legOrders = new Set(stagesInLeg.map((s) => s.order));
  const ranked = started(entries).map((row) => {
    let jumpMs = 0;
    const stageTexts: string[] = [];
    const ssDurations: Array<number | null> = [];
    let outcome: string | null = null;
    for (const st of stagesInLeg) {
      if (isStageCancelled(st)) {
        stageTexts.push("—");
        continue;
      }
      const stLeg = stageLegNumber(st);
      if (
        stLeg >= 2 &&
        st.progressStatus !== "completed" &&
        st.progressStatus !== "stopped"
      ) {
        stageTexts.push("—");
        ssDurations.push(null);
        continue;
      }
      const v = stageValues(row, st.id);
      const cell = resolveRallyStageCell(row, st);
      const pen = parsePenaltyMs(v.penalty) ?? 0;
      jumpMs += pen;
      if (cell.outcome) {
        stageTexts.push(cell.outcome);
        ssDurations.push(null);
        if (!outcome) outcome = cell.outcome;
        else if (cell.outcome === "DNS") outcome = "DNS";
        else if (cell.outcome === "RET" && outcome !== "DNS") outcome = "RET";
        else if (cell.outcome === "DNF" && outcome !== "DNS" && outcome !== "RET") {
          outcome = "DNF";
        }
      } else {
        stageTexts.push(formatDurationMs(cell.durationMs));
        ssDurations.push(cell.durationMs);
      }
    }
    const allTimed =
      totalsReady &&
      ssDurations.length > 0 &&
      ssDurations.every((d) => d != null);
    const eventMs = totalsReady ? eventPenaltyMs(row, undefined, legOrders) : 0;
    const ssTimesMs = allTimed
      ? ssDurations.reduce((sum, d) => sum + (d ?? 0), 0)
      : null;
    const penaltyMs = jumpMs + eventMs;
    const totalMs = ssTimesMs != null ? ssTimesMs + penaltyMs : null;
    const sortTier =
      totalsReady && outcome ? 2 : totalMs != null ? 0 : 1;
    return {
      row,
      stageTexts,
      ssTimesMs,
      penaltyMs,
      totalMs,
      sortTier,
      outcome: totalsReady ? outcome : null,
    };
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
    formatNameWithNationality(r.row.driver, r.row.driverCountryCode),
    formatNameWithNationality(r.row.coDriver, r.row.coDriverCountryCode),
    r.row.car || "—",
    r.row.class || "—",
    ...r.stageTexts,
    r.outcome ?? formatDurationMs(r.ssTimesMs),
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
      "Class",
      ...stagesInLeg.map((st) =>
        stageControlLabel(st, allStages).replace(/\s+/g, ""),
      ),
      "SS Times",
      "Penalty",
      "Total",
      "Diff",
    ],
    rows,
  });
}

/** Table rows for Official Final Results (PDF / Excel). */
export function buildOfficialFinalResultRows(
  entries: Entry[],
  stages: Stage[],
  eventPenaltyMode: "through-max" | "in-stages-only" = "through-max",
): string[][] {
  const ranked = buildRallyFinalRanking(entries, stages, eventPenaltyMode);
  const leader = ranked.find((x) => x.tier === 0)?.totalMs ?? null;
  let classifiedPos = 0;
  return ranked.map(
    ({ row, timeMs, penaltyMs, totalMs, tier, statusLabel }) => [
      tier === 0 ? String(++classifiedPos) : "—",
      String(row.startNumber),
      formatNameWithNationality(row.driver, row.driverCountryCode),
      formatNameWithNationality(row.coDriver, row.coDriverCountryCode),
      row.car || "—",
      row.class || "—",
      tier === 0 ? formatDurationMs(timeMs) : "—",
      tier === 0 && penaltyMs > 0 ? formatDurationMs(penaltyMs) : "—",
      tier === 0 ? formatDurationMs(totalMs) : statusLabel ?? "—",
      tier === 0 &&
      leader != null &&
      totalMs != null &&
      totalMs > leader
        ? `+${formatDiffMs(totalMs - leader)}`
        : "—",
    ],
  );
}

export async function exportRallyFinalExcel(
  eventName: string,
  entries: Entry[],
  stages: Stage[],
  options?: {
    sheetName?: string;
    eventPenaltyMode?: "through-max" | "in-stages-only";
  },
): Promise<void> {
  const rows = buildOfficialFinalResultRows(
    entries,
    stages,
    options?.eventPenaltyMode ?? "through-max",
  );
  await downloadExcelTable({
    fileName: `${eventName}-Final-Results`,
    sheetName: (options?.sheetName ?? "Final Results").slice(0, 31),
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

export async function exportRallyStartingOrderExcel(input: {
  eventName: string;
  leg: number;
  rows: Entry[];
  firstCarStartTime: string;
  intervalMinutes: number;
  startTimeByEntryId?: Record<string, string>;
}): Promise<void> {
  const order = {
    firstCarStartTime: input.firstCarStartTime,
    intervalMinutes: input.intervalMinutes,
    startTimeByEntryId: input.startTimeByEntryId ?? {},
  };
  const rows = input.rows.map((row, i) => [
    String(i + 1),
    String(row.startNumber),
    formatNameWithNationality(row.driver, row.driverCountryCode),
    formatNameWithNationality(row.coDriver, row.coDriverCountryCode),
    row.car || "—",
    row.class || "—",
    resolveStartingOrderTime(order, row.id, i),
  ]);
  await downloadExcelTable({
    fileName: `${input.eventName}-${startingOrderScopeLabel(input.leg).replace(/\s+/g, "")}-Starting-Order`,
    sheetName: `${startingOrderScopeLabel(input.leg)} Start`.slice(0, 31),
    columns: ["Pos", "#", "Driver", "Co-driver", "Car", "Class", "Start time"],
    rows,
  });
}
