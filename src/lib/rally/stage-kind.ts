import type { Stage, StageKind } from "./types";

export function normalizeStageKind(raw: unknown): StageKind {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (v === "shakedown" || v === "qualify") return v;
  return "ss";
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
    distanceKm: null,
    firstCarStartTime: null,
    progressStatus: "pending",
  };
}
