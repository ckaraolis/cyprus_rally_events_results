import {
  competitiveStageNumber,
  isPreEventStage,
} from "./stage-kind";
import {
  parseStageTimingBlobEntry,
  type StageTimingBlobEntry,
} from "./shakedown-passes";
import type { Entry, Stage } from "./types";

export function stageChipLabel(stage: Stage, allStages: Stage[]): string {
  if (stage.kind === "shakedown") return "Shakedown";
  if (stage.kind === "qualify") return "Qualify";
  const n = competitiveStageNumber(stage, allStages);
  return n != null ? `SS${n}` : `SS${stage.order}`;
}

/** Strip a leading "SS1" / "SS 1" from a stage name so titles don't double the number. */
export function stageNameWithoutSsPrefix(name: string): string {
  return name.trim().replace(/^SS\s*\d+\s*[-–:]?\s*/i, "").trim();
}

export function stageHeadingLabel(stage: Stage, allStages: Stage[]): string {
  if (isPreEventStage(stage)) return stage.name || stageChipLabel(stage, allStages);
  const n = competitiveStageNumber(stage, allStages);
  const ss = n != null ? `SS${n}` : `SS${stage.order}`;
  const name = stageNameWithoutSsPrefix(stage.name ?? "");
  return name ? `${ss} ${name}` : ss;
}

export function parseClockToDayMs(value: string): number | null {
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

export function parseRallyStageTimingBlob(raw: string): Record<string, StageTimingBlobEntry> {
  const trimmed = raw.trim();
  if (!trimmed || !trimmed.startsWith("{")) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, StageTimingBlobEntry> = {};
    for (const [stageId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      out[stageId] = parseStageTimingBlobEntry(value as Record<string, unknown>);
    }
    return out;
  } catch {
    return {};
  }
}

export const RALLY_EVENT_PENALTY_KEY = "__event_penalty__";
export const RALLY_EVENT_PENALTY_LIST_KEY = "__event_penalties__";

export type RallyEventPenaltyItem = {
  id: string;
  penalty: string;
  note: string;
  /** Applies from After SSx (and later / Final) onward. */
  afterStageOrder: number;
};

/** Parse admin penalty strings like `00:10` / `0:10` (mm:ss) into milliseconds. */
export function parsePenaltyDurationMs(raw: string): number | null {
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
  if (Number.isFinite(secOnly) && secOnly >= 0) return secOnly * 1000;
  return null;
}

export function getRallyStageTimingValues(
  row: Entry,
  stageId: string,
): {
  startValue: string;
  finishValue: string;
  penaltyValue: string;
  penaltyNoteValue: string;
  rally2: boolean;
} {
  const blob = parseRallyStageTimingBlob(row.trialStartTime ?? "");
  const values = blob[stageId] ?? {};
  return {
    startValue: values.startTime?.trim() ?? "",
    finishValue: values.finishTime?.trim() ?? "",
    penaltyValue: values.penalty?.trim() ?? "",
    penaltyNoteValue: values.penaltyNote?.trim() ?? "",
    rally2: values.rally2 === true,
  };
}

export const RALLY2_FOOTNOTE = "* Cars under Rally2 rules.";

export function parseEventPenaltyAfterOrder(raw: unknown, fallback = 1): number {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseInt(raw, 10)
        : Number.NaN;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

export function getRallyEventPenaltyItems(row: Entry): RallyEventPenaltyItem[] {
  const blob = parseRallyStageTimingBlob(row.trialStartTime ?? "");
  const listRaw = blob[RALLY_EVENT_PENALTY_LIST_KEY]?.penalty?.trim() ?? "";
  if (listRaw.startsWith("[")) {
    try {
      const parsed = JSON.parse(listRaw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((item, idx) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return null;
            const rec = item as Record<string, unknown>;
            const penalty = typeof rec.penalty === "string" ? rec.penalty.trim() : "";
            if (!penalty) return null;
            return {
              id:
                typeof rec.id === "string" && rec.id
                  ? rec.id
                  : `${row.id}-ev-${idx}`,
              penalty,
              note: typeof rec.note === "string" ? rec.note : "",
              afterStageOrder: parseEventPenaltyAfterOrder(rec.afterStageOrder, 1),
            };
          })
          .filter((x): x is RallyEventPenaltyItem => x != null);
      }
    } catch {
      /* legacy below */
    }
  }
  const legacy = blob[RALLY_EVENT_PENALTY_KEY] ?? {};
  const legacyPenalty = legacy.penalty?.trim() ?? "";
  if (!legacyPenalty) return [];
  return [
    {
      id: `${row.id}-event-legacy`,
      penalty: legacyPenalty,
      note: legacy.penaltyNote?.trim() ?? "",
      afterStageOrder: 1,
    },
  ];
}

/** Event penalties that apply at/after a given stage order (After SSx / Final). */
export function getRallyEventPenaltyItemsThroughOrder(
  row: Entry,
  throughStageOrder: number,
): RallyEventPenaltyItem[] {
  return getRallyEventPenaltyItems(row).filter(
    (item) => item.afterStageOrder <= throughStageOrder,
  );
}

export function getRallyEventPenaltyTotalMs(
  row: Entry,
  throughStageOrder?: number,
): number {
  const items =
    throughStageOrder == null
      ? getRallyEventPenaltyItems(row)
      : getRallyEventPenaltyItemsThroughOrder(row, throughStageOrder);
  return items.reduce(
    (sum, item) => sum + (parsePenaltyDurationMs(item.penalty) ?? 0),
    0,
  );
}

export type RallyFinalRankRow = {
  row: Entry;
  timeMs: number | null;
  penaltyMs: number;
  totalMs: number | null;
  /** 0 = classified, 1 = retired (RET/DNF), 2 = did not start */
  tier: 0 | 1 | 2;
  statusLabel: string | null;
};

export type RallyOverallRankRow = {
  row: Entry;
  ssTimesMs: number | null;
  penaltyMs: number;
  totalMs: number | null;
  /** 0 = classified, 1 = retired (RET/DNF), 2 = did not start */
  tier: 0 | 1 | 2;
  statusLabel: string | null;
};

/**
 * Overall classification after a set of stages (After SSx):
 * (0) crews timed on every stage, by total,
 * (1) RET / DNF on any stage in the set,
 * (2) DNS on any stage in the set.
 * Incomplete (no times and no outcome) crews are omitted.
 */
export function buildRallyOverallRanking(
  entries: Entry[],
  stages: Stage[],
  eventPenaltyMode: "through-max" | "in-stages-only" = "through-max",
): RallyOverallRankRow[] {
  if (stages.length === 0) return [];
  const stageOrders = new Set(stages.map((s) => s.order));
  const throughOrder = Math.max(...stages.map((s) => s.order));

  return entries
    .map((row) => {
      const stageCells = stages.map((st) => {
        const values = getRallyStageTimingValues(row, st.id);
        const cell = classifyRallyStageLegCell(
          values.startValue,
          values.finishValue,
        );
        const jumpMs = parsePenaltyDurationMs(values.penaltyValue) ?? 0;
        return { cell, jumpMs, ssMs: cell.durationMs };
      });
      const rowOutcome = worstLegRowOutcome(stageCells.map((c) => c.cell));
      const allTimed =
        stageCells.every((c) => c.cell.outcome == null && c.ssMs != null);
      const ssTimesMs = allTimed
        ? stageCells.reduce((sum, c) => sum + (c.ssMs ?? 0), 0)
        : null;
      const jumpPenaltyMs = stageCells.reduce((sum, c) => sum + c.jumpMs, 0);
      const eventPenaltyMs =
        eventPenaltyMode === "in-stages-only"
          ? getRallyEventPenaltyItems(row)
              .filter((item) => stageOrders.has(item.afterStageOrder))
              .reduce(
                (sum, item) =>
                  sum + (parsePenaltyDurationMs(item.penalty) ?? 0),
                0,
              )
          : throughOrder > 0
            ? getRallyEventPenaltyTotalMs(row, throughOrder)
            : 0;
      const penaltyMs = jumpPenaltyMs + eventPenaltyMs;
      const totalMs =
        ssTimesMs != null ? ssTimesMs + penaltyMs : null;

      let tier: 0 | 1 | 2 | null = null;
      let statusLabel: string | null = null;
      if (totalMs != null) {
        tier = 0;
      } else if (rowOutcome === "RET" || rowOutcome === "DNF") {
        tier = 1;
        statusLabel = rowOutcome;
      } else if (rowOutcome === "DNS") {
        tier = 2;
        statusLabel = "DNS";
      }

      return { row, ssTimesMs, penaltyMs, totalMs, tier, statusLabel };
    })
    .filter((x): x is RallyOverallRankRow => x.tier != null)
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.tier === 0 && b.tier === 0) {
        const at = a.totalMs ?? 0;
        const bt = b.totalMs ?? 0;
        return at !== bt
          ? at - bt
          : a.row.startNumber - b.row.startNumber;
      }
      if (a.tier === 1 && b.tier === 1) {
        const ao = a.statusLabel === "RET" ? 0 : 1;
        const bo = b.statusLabel === "RET" ? 0 : 1;
        if (ao !== bo) return ao - bo;
      }
      return a.row.startNumber - b.row.startNumber;
    });
}

/**
 * Official Final Results order:
 * (0) classified finishers by total time,
 * (1) retirements (RET then DNF),
 * (2) did not start (DNS, including Start=No).
 */
export function buildRallyFinalRanking(
  entries: Entry[],
  stages: Stage[],
): RallyFinalRankRow[] {
  if (stages.length === 0) return [];

  return entries
    .map((row) => {
      const stageCells = stages.map((st) => {
        const values = getRallyStageTimingValues(row, st.id);
        const cell = classifyRallyStageLegCell(
          values.startValue,
          values.finishValue,
        );
        const jumpMs = parsePenaltyDurationMs(values.penaltyValue) ?? 0;
        const timeMs =
          cell.durationMs != null ? cell.durationMs + jumpMs : null;
        return { cell, timeMs };
      });
      const allTimed = stageCells.every(
        (c) => c.cell.outcome == null && c.timeMs != null,
      );
      const timeMs = allTimed
        ? stageCells.reduce((sum, c) => sum + (c.timeMs ?? 0), 0)
        : null;
      const penaltyMs = getRallyEventPenaltyTotalMs(row);
      const totalMs = timeMs != null ? timeMs + penaltyMs : null;
      const rowOutcome = worstLegRowOutcome(stageCells.map((c) => c.cell));
      const nonStarter = row.start === false;

      let tier: 0 | 1 | 2 | null = null;
      let statusLabel: string | null = null;
      if (totalMs != null) {
        tier = 0;
      } else if (nonStarter) {
        tier = 2;
        statusLabel = "DNS";
      } else if (rowOutcome === "RET" || rowOutcome === "DNF") {
        tier = 1;
        statusLabel = rowOutcome;
      } else if (rowOutcome === "DNS") {
        tier = 2;
        statusLabel = "DNS";
      }

      return { row, timeMs, penaltyMs, totalMs, tier, statusLabel };
    })
    .filter((x): x is RallyFinalRankRow => x.tier != null)
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.tier === 0 && b.tier === 0) {
        const at = a.totalMs ?? 0;
        const bt = b.totalMs ?? 0;
        return at !== bt
          ? at - bt
          : a.row.startNumber - b.row.startNumber;
      }
      if (a.tier === 1 && b.tier === 1) {
        const ao = a.statusLabel === "RET" ? 0 : 1;
        const bo = b.statusLabel === "RET" ? 0 : 1;
        if (ao !== bo) return ao - bo;
      }
      if (a.tier === 2 && b.tier === 2) {
        const ao = a.statusLabel === "DNS" ? 0 : 1;
        const bo = b.statusLabel === "DNS" ? 0 : 1;
        if (ao !== bo) return ao - bo;
      }
      return a.row.startNumber - b.row.startNumber;
    });
}

/** Per-stage cell for leg classification: outcome markers vs clocked stage time. */
export function classifyRallyStageLegCell(startRaw: string, finishRaw: string): {
  outcome: "DNS" | "DNF" | "RET" | null;
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
  if (d < 0) return { outcome: null, durationMs: null };
  return { outcome: null, durationMs: d };
}

export function worstLegRowOutcome(
  stages: Array<{ outcome: "DNS" | "DNF" | "RET" | null }>,
): "DNS" | "DNF" | "RET" | null {
  let hasDns = false;
  let hasDnf = false;
  let hasRet = false;
  for (const s of stages) {
    if (s.outcome === "DNS") hasDns = true;
    else if (s.outcome === "DNF") hasDnf = true;
    else if (s.outcome === "RET") hasRet = true;
  }
  if (hasDns) return "DNS";
  if (hasDnf) return "DNF";
  if (hasRet) return "RET";
  return null;
}

export function legOutcomeSortKey(o: "DNS" | "DNF" | "RET"): number {
  if (o === "DNS") return 0;
  if (o === "DNF") return 1;
  return 2;
}

export function getSpeedRunDurationMs(
  row: Entry,
  runId: "trial" | "run1" | "run2",
): number | null {
  if (getSpeedRunOutcomeLabel(row, runId)) return null;
  const startMs = getSpeedRunStartMs(row, runId);
  const finishMs = getSpeedRunFinishMs(row, runId);
  if (startMs == null || finishMs == null) return null;
  const diff = finishMs - startMs;
  if (diff < 0) return null;
  return diff;
}

export function getSpeedRunStartMs(row: Entry, runId: "trial" | "run1" | "run2"): number | null {
  const startRaw =
    runId === "trial"
      ? row.trialStartTime
      : runId === "run1"
        ? row.run1StartTime
        : row.run2StartTime;
  return parseClockToDayMs(startRaw ?? "");
}

export function getSpeedRunFinishMs(row: Entry, runId: "trial" | "run1" | "run2"): number | null {
  const finishRaw =
    runId === "trial"
      ? row.trialFinishTime
      : runId === "run1"
        ? row.run1FinishTime
        : row.run2FinishTime;
  return parseClockToDayMs(finishRaw ?? "");
}

export function getSpeedRunOutcomeLabel(
  row: Entry,
  runId: "trial" | "run1" | "run2",
): "DNS" | "DNF" | null {
  const startRaw =
    runId === "trial"
      ? row.trialStartTime
      : runId === "run1"
        ? row.run1StartTime
        : row.run2StartTime;
  const finishRaw =
    runId === "trial"
      ? row.trialFinishTime
      : runId === "run1"
        ? row.run1FinishTime
        : row.run2FinishTime;
  const start = (startRaw ?? "").trim().toUpperCase();
  const finish = (finishRaw ?? "").trim().toUpperCase();
  if (start === "DNS" || finish === "DNS") return "DNS";
  if (start === "DNF" || finish === "DNF") return "DNF";
  return null;
}

/** Faster of 1st / 2nd run when timed; one run if the other has no duration; null if neither has a time. */
export function getSpeedBestFromRunsMs(row: Entry): number | null {
  const r1 = getSpeedRunDurationMs(row, "run1");
  const r2 = getSpeedRunDurationMs(row, "run2");
  if (r1 == null && r2 == null) return null;
  if (r1 == null) return r2;
  if (r2 == null) return r1;
  return Math.min(r1, r2);
}

export type SpeedFinalRankRow = {
  row: Entry;
  trial: number | null;
  run1: number | null;
  run2: number | null;
  bestFromRuns: number | null;
  /** Final Best/Total shown in the table (runs only; trial excluded). */
  bestDisplay: number | null;
  tier: 0 | 1 | 2 | 3;
  hasResult: boolean;
  nonStarter: boolean;
};

/**
 * Final order: (0) classified by faster of 1st/2nd run, (1) started but no run time
 * (including DNF/DNS or blank on both runs), (3) non-starters last.
 * Trial is displayed for reference only and never used for Best/Total ranking.
 */
export function buildSpeedFinalRanking(rows: Entry[]): SpeedFinalRankRow[] {
  return rows
    .map((row) => {
      const nonStarter = row.start === false;
      const trial = getSpeedRunDurationMs(row, "trial");
      const run1 = getSpeedRunDurationMs(row, "run1");
      const run2 = getSpeedRunDurationMs(row, "run2");
      const hasResult =
        trial != null ||
        run1 != null ||
        run2 != null ||
        getSpeedRunOutcomeLabel(row, "trial") != null ||
        getSpeedRunOutcomeLabel(row, "run1") != null ||
        getSpeedRunOutcomeLabel(row, "run2") != null;
      const bestFromRuns = getSpeedBestFromRunsMs(row);
      let tier: 0 | 1 | 2 | 3;
      if (nonStarter) tier = 3;
      else if (bestFromRuns != null) tier = 0;
      else tier = 1;
      const bestDisplay =
        nonStarter ? null : bestFromRuns != null ? bestFromRuns : null;

      return {
        row,
        trial,
        run1,
        run2,
        bestFromRuns,
        bestDisplay,
        tier,
        hasResult,
        nonStarter,
      };
    })
    .filter((x) => x.hasResult || x.nonStarter)
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.tier === 0 && b.tier === 0) {
        const d = (a.bestFromRuns ?? 0) - (b.bestFromRuns ?? 0);
        return d !== 0 ? d : a.row.startNumber - b.row.startNumber;
      }
      return a.row.startNumber - b.row.startNumber;
    });
}

/**
 * Format a stage/run duration.
 * `fractionDigits`: 2 = hundredths (0.01s), 3 = thousandths (0.001s).
 * Competitive SS use hundredths; Shakedown / Qualify use thousandths.
 */
export function formatDurationMs(
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

export function formatStageDurationMs(
  ms: number | null,
  stage?: Pick<Stage, "kind"> | null,
): string {
  const digits: 2 | 3 =
    stage && isPreEventStage(stage) ? 3 : 2;
  return formatDurationMs(ms, digits);
}

export function formatDiffDurationMs(
  ms: number | null,
  fractionDigits: 2 | 3 = 2,
): string {
  const base = formatDurationMs(ms, fractionDigits);
  if (base.startsWith("0:")) return base.slice(2);
  return base;
}
