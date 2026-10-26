import type { Stage, StageKind } from "./types";
import {
  normalizeShakedownPassCount,
  type ShakedownPassCount,
} from "./shakedown-passes";

export function normalizeStageKind(raw: unknown): StageKind {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return normalizeStageKind((raw as Record<string, unknown>).kind);
  }
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (v === "shakedown" || v === "qualify") return v;
  return "ss";
}

/** Parse `__stageKinds` value (plain kind string or `{ kind, shakedownPassCount }`). */
export function parseStageKindMeta(raw: unknown): {
  kind: StageKind;
  shakedownPassCount: ShakedownPassCount;
} {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    return {
      kind: normalizeStageKind(o.kind),
      shakedownPassCount: normalizeShakedownPassCount(o.shakedownPassCount),
    };
  }
  return {
    kind: normalizeStageKind(raw),
    shakedownPassCount: 3,
  };
}

export function serializeStageKindMeta(stage: Stage): string | {
  kind: StageKind;
  shakedownPassCount: ShakedownPassCount;
} {
  const kind = stage.kind ?? "ss";
  if (kind === "shakedown") {
    return {
      kind: "shakedown",
      shakedownPassCount: normalizeShakedownPassCount(stage.shakedownPassCount),
    };
  }
  return kind;
}

export function isCompetitiveStage(stage: Pick<Stage, "kind">): boolean {
  return (stage.kind ?? "ss") === "ss";
}

export function isPreEventStage(stage: Pick<Stage, "kind">): boolean {
  const k = stage.kind ?? "ss";
  return k === "shakedown" || k === "qualify";
}

/** Sort: Shakedown → Qualify → competitive SS (by order). */
export function sortStagesByKindThenOrder(stages: Stage[]): Stage[] {
  const rank = (k: StageKind | undefined) =>
    k === "shakedown" ? 0 : k === "qualify" ? 1 : 2;
  return [...stages].sort((a, b) => {
    const ra = rank(a.kind);
    const rb = rank(b.kind);
    if (ra !== rb) return ra - rb;
    return a.order - b.order;
  });
}

export function competitiveStages(stages: Stage[]): Stage[] {
  return sortStagesByKindThenOrder(stages).filter(isCompetitiveStage);
}

/** Competitive stages grouped by itinerary leg (leg 1, 2, …), in leg order. */
export function competitiveStagesByLeg(
  stages: Stage[],
): Array<{ leg: number; stages: Stage[] }> {
  const byLeg = new Map<number, Stage[]>();
  const legOrder: number[] = [];
  for (const s of competitiveStages(stages)) {
    const leg =
      typeof s.leg === "number" && Number.isFinite(s.leg) && s.leg >= 1
        ? Math.floor(s.leg)
        : 1;
    if (!byLeg.has(leg)) {
      byLeg.set(leg, []);
      legOrder.push(leg);
    }
    byLeg.get(leg)!.push(s);
  }
  return legOrder.map((leg) => ({ leg, stages: byLeg.get(leg)! }));
}

export function stageLegNumber(stage: Pick<Stage, "leg">): number {
  return typeof stage.leg === "number" &&
    Number.isFinite(stage.leg) &&
    stage.leg >= 1
    ? Math.floor(stage.leg)
    : 1;
}

/**
 * Competitive stages for a LEG results sheet.
 * Normal events: LEG 2+ includes all prior legs (cumulative).
 * Pass `cumulative: false` for Cyprus Challenge (each leg is its own rally).
 */
export function competitiveStagesForLegResults(
  stages: Stage[],
  leg: number,
  options?: { cumulative?: boolean },
): Stage[] {
  const target =
    Number.isFinite(leg) && leg >= 1 ? Math.floor(leg) : 1;
  const cumulative = options?.cumulative !== false;
  return competitiveStagesByLeg(stages)
    .filter((g) => (cumulative ? g.leg <= target : g.leg === target))
    .flatMap((g) => g.stages);
}

/** 1-based SS number among competitive stages only (Shakedown/Qualify ignored). */
export function competitiveStageNumber(
  stage: Stage,
  allStages: Stage[],
): number | null {
  if (!isCompetitiveStage(stage)) return null;
  const list = competitiveStages(allStages);
  const idx = list.findIndex((s) => s.id === stage.id);
  return idx >= 0 ? idx + 1 : null;
}

export function stageControlLabel(stage: Stage, allStages: Stage[]): string {
  if (stage.kind === "shakedown") return "Shakedown";
  if (stage.kind === "qualify") return "Qualify";
  const n = competitiveStageNumber(stage, allStages);
  return n != null ? `SS ${n}` : `SS ${stage.order}`;
}

export function stageHasKind(stages: Stage[], kind: StageKind): boolean {
  return stages.some((s) => (s.kind ?? "ss") === kind);
}

/** Reindex `order` 1..n after kind-aware sort (keeps Shakedown/Qualify on top). */
export function reindexStagesInKindOrder(stages: Stage[]): Stage[] {
  return sortStagesByKindThenOrder(stages).map((s, i) => ({
    ...s,
    order: i + 1,
  }));
}

export function createPreEventStage(kind: "shakedown" | "qualify"): Stage {
  return {
    id: crypto.randomUUID(),
    name: kind === "shakedown" ? "Shakedown" : "Qualify",
    order: kind === "shakedown" ? 0 : 1,
    leg: 0,
    kind,
    ...(kind === "shakedown" ? { shakedownPassCount: 3 as const } : {}),
    distanceKm: null,
    firstCarStartTime: null,
    progressStatus: "pending",
  };
}
