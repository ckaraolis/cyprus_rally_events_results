import type { Stage } from "@/lib/rally/types";

/** Maximum passes we store / support in the UI. */
export const SHAKEDOWN_PASS_COUNT_MAX = 3;
/** Default when unset (backwards compatible). */
export const SHAKEDOWN_PASS_COUNT_DEFAULT = 3 as const;
/** @deprecated Use getShakedownPassCount(stage) — kept for callers that still import the old name. */
export const SHAKEDOWN_PASS_COUNT = SHAKEDOWN_PASS_COUNT_DEFAULT;

export type ShakedownPass = {
  startTime?: string;
  finishTime?: string;
};

export type StageTimingBlobEntry = {
  startTime?: string;
  finishTime?: string;
  penalty?: string;
  penaltyNote?: string;
  /** Competitive SS only: crew runs under Rally2 rules (shown as * on results). */
  rally2?: boolean;
  passes?: ShakedownPass[];
};

export type ShakedownPassIndex = 1 | 2 | 3;
export type ShakedownPassCount = 2 | 3;

export function normalizeShakedownPassCount(raw: unknown): ShakedownPassCount {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseInt(raw, 10)
        : Number.NaN;
  return n === 2 ? 2 : 3;
}

export function getShakedownPassCount(
  stage?: Pick<Stage, "kind" | "shakedownPassCount"> | null,
): ShakedownPassCount {
  if (!stage || stage.kind !== "shakedown") return SHAKEDOWN_PASS_COUNT_DEFAULT;
  return normalizeShakedownPassCount(stage.shakedownPassCount);
}

export function isShakedownStage(
  stage: Pick<Stage, "kind"> | null | undefined,
): boolean {
  return stage?.kind === "shakedown";
}

/** Normalize a single stage timing object from JSON (preserves `passes`). */
export function parseStageTimingBlobEntry(
  item: Record<string, unknown>,
): StageTimingBlobEntry {
  const entry: StageTimingBlobEntry = {
    startTime: typeof item.startTime === "string" ? item.startTime : "",
    finishTime: typeof item.finishTime === "string" ? item.finishTime : "",
    penalty: typeof item.penalty === "string" ? item.penalty : "",
    penaltyNote: typeof item.penaltyNote === "string" ? item.penaltyNote : "",
  };
  if (item.rally2 === true) entry.rally2 = true;
  if (Array.isArray(item.passes)) {
    entry.passes = item.passes.slice(0, SHAKEDOWN_PASS_COUNT_MAX).map((p) => {
      if (!p || typeof p !== "object" || Array.isArray(p)) {
        return { startTime: "", finishTime: "" };
      }
      const rec = p as Record<string, unknown>;
      return {
        startTime: typeof rec.startTime === "string" ? rec.startTime : "",
        finishTime: typeof rec.finishTime === "string" ? rec.finishTime : "",
      };
    });
  }
  return entry;
}

/**
 * Returns `passCount` passes (default 3).
 * If `passes` is missing but top-level start/finish exist, treat those as pass 1.
 */
export function getShakedownPasses(
  blobEntry: StageTimingBlobEntry | null | undefined,
  passCount: ShakedownPassCount = SHAKEDOWN_PASS_COUNT_DEFAULT,
): Array<{ startTime: string; finishTime: string }> {
  const count = normalizeShakedownPassCount(passCount);
  const empty = (): Array<{ startTime: string; finishTime: string }> =>
    Array.from({ length: count }, () => ({
      startTime: "",
      finishTime: "",
    }));

  if (!blobEntry) return empty();

  const out = empty();
  if (Array.isArray(blobEntry.passes)) {
    for (let i = 0; i < count; i += 1) {
      const p = blobEntry.passes[i];
      out[i] = {
        startTime: typeof p?.startTime === "string" ? p.startTime : "",
        finishTime: typeof p?.finishTime === "string" ? p.finishTime : "",
      };
    }
    return out;
  }

  out[0] = {
    startTime: blobEntry.startTime ?? "",
    finishTime: blobEntry.finishTime ?? "",
  };
  return out;
}

/** Write one pass; keeps `passes[0]` synced to top-level startTime/finishTime. */
export function setShakedownPass(
  blobEntry: StageTimingBlobEntry | null | undefined,
  passIndex: ShakedownPassIndex,
  values: { start?: string; finish?: string },
  passCount: ShakedownPassCount = SHAKEDOWN_PASS_COUNT_DEFAULT,
): StageTimingBlobEntry {
  const base = blobEntry ?? {};
  const count = normalizeShakedownPassCount(passCount);
  // Preserve any stored passes beyond the active count (e.g. switching 3→2→3).
  const stored = Array.isArray(base.passes)
    ? base.passes.slice(0, SHAKEDOWN_PASS_COUNT_MAX).map((p) => ({
        startTime: typeof p?.startTime === "string" ? p.startTime : "",
        finishTime: typeof p?.finishTime === "string" ? p.finishTime : "",
      }))
    : [];
  while (stored.length < SHAKEDOWN_PASS_COUNT_MAX) {
    stored.push({ startTime: "", finishTime: "" });
  }
  const active = getShakedownPasses(base, count);
  for (let i = 0; i < count; i += 1) {
    stored[i] = { ...active[i]! };
  }
  const idx = passIndex - 1;
  if (idx < 0 || idx >= count) {
    const pass1 = stored[0] ?? { startTime: "", finishTime: "" };
    return {
      startTime: pass1.startTime,
      finishTime: pass1.finishTime,
      penalty: base.penalty ?? "",
      penaltyNote: base.penaltyNote ?? "",
      passes: stored,
    };
  }
  const current = stored[idx] ?? { startTime: "", finishTime: "" };
  stored[idx] = {
    startTime: values.start !== undefined ? values.start : current.startTime,
    finishTime:
      values.finish !== undefined ? values.finish : current.finishTime,
  };
  const pass1 = stored[0] ?? { startTime: "", finishTime: "" };
  return {
    startTime: pass1.startTime,
    finishTime: pass1.finishTime,
    penalty: base.penalty ?? "",
    penaltyNote: base.penaltyNote ?? "",
    passes: stored,
  };
}

export function getShakedownPassDurationMs(
  pass: { startTime?: string; finishTime?: string },
  parseClock: (value: string) => number | null,
): number | null {
  const start = (pass.startTime ?? "").trim();
  const finish = (pass.finishTime ?? "").trim();
  if (!start || !finish) return null;
  const su = start.toUpperCase();
  const fu = finish.toUpperCase();
  if (
    su === "DNF" ||
    fu === "DNF" ||
    su === "RET" ||
    fu === "RET" ||
    su === "DNS" ||
    fu === "DNS"
  ) {
    return null;
  }
  const startMs = parseClock(start);
  const finishMs = parseClock(finish);
  if (startMs == null || finishMs == null) return null;
  const d = finishMs - startMs;
  return d >= 0 ? d : null;
}

export function getShakedownPassDurationsMs(
  passes: Array<{ startTime?: string; finishTime?: string }>,
  parseClock: (value: string) => number | null,
  passCount?: ShakedownPassCount,
): Array<number | null> {
  const count =
    passCount != null
      ? normalizeShakedownPassCount(passCount)
      : Math.min(Math.max(passes.length, 1), SHAKEDOWN_PASS_COUNT_MAX);
  return Array.from({ length: count }, (_, i) =>
    getShakedownPassDurationMs(passes[i] ?? {}, parseClock),
  );
}

export function findShakedownBestDurationMs(
  durations: Array<number | null>,
): number | null {
  let best: number | null = null;
  for (const d of durations) {
    if (d == null) continue;
    if (best == null || d < best) best = d;
  }
  return best;
}

/** 0-based index of the best completed pass, or null. */
export function findShakedownBestPassIndex(
  durations: Array<number | null>,
): number | null {
  let bestIdx: number | null = null;
  let best: number | null = null;
  for (let i = 0; i < durations.length; i += 1) {
    const d = durations[i];
    if (d == null) continue;
    if (best == null || d < best) {
      best = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * ALGE auto-fill target:
 * - start → first pass with no start
 * - finish → first pass with start but no finish
 */
export function findShakedownPassForTrigger(
  passes: Array<{ startTime?: string; finishTime?: string }>,
  trigger: "start" | "finish",
  passCount: ShakedownPassCount = SHAKEDOWN_PASS_COUNT_DEFAULT,
): ShakedownPassIndex | null {
  const count = normalizeShakedownPassCount(passCount);
  const list = Array.from({ length: count }, (_, i) => ({
    startTime: passes[i]?.startTime ?? "",
    finishTime: passes[i]?.finishTime ?? "",
  }));

  if (trigger === "start") {
    for (let i = 0; i < count; i += 1) {
      if (!(list[i]?.startTime ?? "").trim()) {
        return (i + 1) as ShakedownPassIndex;
      }
    }
    return null;
  }

  for (let i = 0; i < count; i += 1) {
    const start = (list[i]?.startTime ?? "").trim();
    const finish = (list[i]?.finishTime ?? "").trim();
    if (start && !finish) return (i + 1) as ShakedownPassIndex;
  }
  return null;
}

/** 1-based pass indexes for the active shakedown pass count. */
export function shakedownPassIndexes(
  passCount: ShakedownPassCount = SHAKEDOWN_PASS_COUNT_DEFAULT,
): ShakedownPassIndex[] {
  const count = normalizeShakedownPassCount(passCount);
  return Array.from({ length: count }, (_, i) => (i + 1) as ShakedownPassIndex);
}
