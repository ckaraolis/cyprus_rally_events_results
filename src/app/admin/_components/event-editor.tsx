"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  deleteEvent,
  replaceEntries,
  replaceStages,
  updateEventMeta,
} from "../actions";
import type {
  Entry,
  EventStatus,
  EventType,
  LegStartingOrder,
  RallyEvent,
  SpeedRunImportStatus,
  Stage,
  StageProgressStatus,
} from "@/lib/rally/types";
import {
  emptyLegStartingOrder,
  resolveStartingOrderTime,
} from "@/lib/rally/leg-starting-order";
import { printStartingOrderPdf } from "@/lib/rally/starting-order-print";
import { AdminCountrySelect } from "./admin-country-select";
import {
  exportRallyAfterSsExcel,
  exportRallyFinalExcel,
  exportRallyLegExcel,
  exportRallyStageExcel,
} from "@/lib/rally/admin-excel-export";

type Props = { event: RallyEvent };
type AdminTab =
  | "details"
  | "stages"
  | "entries"
  | "starting-order"
  | "timing"
  | "penalties"
  | "notice-board";
type SpeedTimingRun = "trial" | "run1" | "run2";
type SpeedTimingOutcome = "ret" | "dnf" | null;
type RallyStageTimingBlob = Record<
  string,
  { startTime?: string; finishTime?: string; penalty?: string; penaltyNote?: string }
>;
const RALLY_PENALTY_KEY = "__event_penalty__";
/** Multiple event-level penalties (admin Penalties tab); JSON array in `.penalty`. */
const RALLY_PENALTY_LIST_KEY = "__event_penalties__";

type EventPenaltyItem = {
  id: string;
  penalty: string;
  note: string;
  /** Stage order: penalty applies from "After SSx" (and Final) onward. */
  afterStageOrder: number;
};
type EventPenaltyLine = {
  id: string;
  carNumber: string;
  penalty: string;
  note: string;
  afterStageOrder: number;
};

function newPenaltyLineId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `pen-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function parseAfterStageOrder(raw: unknown, fallback = 1): number {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseInt(raw, 10)
        : Number.NaN;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

function parseEventPenaltyItemsFromBlob(
  blob: RallyStageTimingBlob,
): EventPenaltyItem[] {
  const listRaw = blob[RALLY_PENALTY_LIST_KEY]?.penalty?.trim() ?? "";
  if (listRaw.startsWith("[")) {
    try {
      const parsed = JSON.parse(listRaw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return null;
            const row = item as Record<string, unknown>;
            const penalty = typeof row.penalty === "string" ? row.penalty.trim() : "";
            if (!penalty) return null;
            return {
              id:
                typeof row.id === "string" && row.id
                  ? row.id
                  : newPenaltyLineId(),
              penalty,
              note: typeof row.note === "string" ? row.note : "",
              afterStageOrder: parseAfterStageOrder(row.afterStageOrder, 1),
            };
          })
          .filter((x): x is EventPenaltyItem => x != null);
      }
    } catch {
      /* fall through to legacy */
    }
  }
  const legacy = blob[RALLY_PENALTY_KEY];
  const legacyPenalty = legacy?.penalty?.trim() ?? "";
  if (!legacyPenalty) return [];
  return [
    {
      id: newPenaltyLineId(),
      penalty: legacyPenalty,
      note: legacy?.penaltyNote?.trim() ?? "",
      afterStageOrder: 1,
    },
  ];
}

function loadEventPenaltyLinesFromEntries(entries: Entry[]): EventPenaltyLine[] {
  const lines: EventPenaltyLine[] = [];
  for (const row of entries) {
    const blob = parseRallyStageTimingBlob(row.trialStartTime ?? "");
    for (const item of parseEventPenaltyItemsFromBlob(blob)) {
      lines.push({
        id: item.id,
        carNumber: String(row.startNumber),
        penalty: item.penalty,
        note: item.note,
        afterStageOrder: item.afterStageOrder,
      });
    }
  }
  return lines;
}

function writeEventPenaltyItemsToEntry(
  row: Entry,
  items: EventPenaltyItem[],
): Entry {
  const blob = parseRallyStageTimingBlob(row.trialStartTime ?? "");
  delete blob[RALLY_PENALTY_KEY];
  if (items.length === 0) {
    delete blob[RALLY_PENALTY_LIST_KEY];
  } else {
    blob[RALLY_PENALTY_LIST_KEY] = {
      startTime: "",
      finishTime: "",
      penalty: JSON.stringify(items),
      penaltyNote: "",
    };
  }
  return {
    ...row,
    trialStartTime: Object.keys(blob).length > 0 ? JSON.stringify(blob) : "",
  };
}
const NOTICE_BOARD_DEFAULT_CATEGORIES = [
  "Supplementary Regulations",
  "Bulletins",
  "Steward Decisions",
  "Other",
] as const;
const MAX_INLINE_NOTICE_URL_LENGTH = 100_000;
const DEFAULT_RALLY_STAGE_ALGE_CONFIG: {
  finishDeviceId: string;
  finishChannelId: string;
} = {
  finishDeviceId: "",
  finishChannelId: "1",
};

function normalizeInitialRallyStageAlgeConfig(
  raw: RallyEvent["rallyStageAlgeConfig"] | undefined,
): RallyEvent["rallyStageAlgeConfig"] {
  if (!raw) return {};
  const out: RallyEvent["rallyStageAlgeConfig"] = {};
  for (const [stageId, cfg] of Object.entries(raw)) {
    if (!cfg || typeof cfg !== "object") continue;
    const c = cfg as Record<string, unknown>;
    out[stageId] = {
      finishDeviceId:
        typeof c.finishDeviceId === "string" ? c.finishDeviceId.trim() : "",
      finishChannelId:
        typeof c.finishChannelId === "string" ? c.finishChannelId.trim() : "1",
    };
  }
  return out;
}

function timingSignature(meta: {
  speedRunImportStatus: {
    trial: SpeedRunImportStatus;
    run1: SpeedRunImportStatus;
    run2: SpeedRunImportStatus;
  };
}, entries: Entry[]): string {
  return JSON.stringify({
    speedRunImportStatus: meta.speedRunImportStatus,
    times: entries.map((e) => ({
      id: e.id,
      trialStartTime: e.trialStartTime ?? "",
      trialFinishTime: e.trialFinishTime ?? "",
      run1StartTime: e.run1StartTime ?? "",
      run1FinishTime: e.run1FinishTime ?? "",
      run2StartTime: e.run2StartTime ?? "",
      run2FinishTime: e.run2FinishTime ?? "",
    })),
  });
}

function parseTimingOutcome(startValue: string, finishValue: string): SpeedTimingOutcome {
  const start = startValue.trim().toUpperCase();
  const finish = finishValue.trim().toUpperCase();
  if (start === "RET" || finish === "RET") return "ret";
  if (start === "DNF" || finish === "DNF") return "dnf";
  return null;
}

function formatTimingOutcomeLabel(outcome: SpeedTimingOutcome): string | null {
  if (outcome === "ret") return "Retired";
  if (outcome === "dnf") return "Do Not Finish";
  return null;
}

function normalizePenaltyInput(raw: string): string {
  return raw.replace(/[^0-9:]/g, "").slice(0, 6);
}

function speedRunIdLabel(run: SpeedTimingRun): string {
  if (run === "trial") return "Trial";
  if (run === "run1") return "1st Run";
  return "2nd Run";
}

function parseRallyStageTimingBlob(raw: string): RallyStageTimingBlob {
  const trimmed = raw.trim();
  if (!trimmed || !trimmed.startsWith("{")) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: RallyStageTimingBlob = {};
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

export function EventEditor({ event: initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);
  const [docUploading, setDocUploading] = useState(false);
  const [docUploadError, setDocUploadError] = useState<string | null>(null);
  const [newDocTitle, setNewDocTitle] = useState("");
  const [newDocCategory, setNewDocCategory] = useState<string>(
    NOTICE_BOARD_DEFAULT_CATEGORIES[0],
  );
  const [newDocUrl, setNewDocUrl] = useState("");
  const [editingNoticeDocId, setEditingNoticeDocId] = useState<string | null>(null);
  const [newCustomCategory, setNewCustomCategory] = useState("");
  const [meta, setMeta] = useState({
    name: initial.name,
    logoUrl: initial.logoUrl ?? "",
    type: initial.type ?? "rally",
    dateStart: initial.dateStart,
    dateEnd: initial.dateEnd ?? initial.dateStart,
    location: initial.location,
    status: initial.status,
    speedRunImportStatus: initial.speedRunImportStatus ?? {
      trial: "scheduled",
      run1: "scheduled",
      run2: "scheduled",
    },
    algeTriggerCountByKey: initial.algeTriggerCountByKey ?? {},
    rallyStageAlgeConfig: normalizeInitialRallyStageAlgeConfig(
      initial.rallyStageAlgeConfig,
    ),
    officialNoticeCustomCategories: initial.officialNoticeCustomCategories ?? [],
    officialNoticeDocuments: initial.officialNoticeDocuments ?? [],
    legStartingOrders: initial.legStartingOrders ?? {},
  });
  const [stages, setStages] = useState<Stage[]>(() =>
    [...initial.stages]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        ...s,
        progressStatus: s.progressStatus ?? "pending",
        firstCarStartTime: s.firstCarStartTime ?? null,
        leg:
          typeof s.leg === "number" && Number.isFinite(s.leg) && Math.floor(s.leg) >= 1
            ? Math.floor(s.leg)
            : 1,
      })),
  );
  const [entries, setEntries] = useState<Entry[]>(() =>
    [...initial.entries].map((e) => ({
      ...e,
      entrance: e.entrance ?? "",
      start: e.start !== false,
      trialStartTime: e.trialStartTime ?? "",
      trialFinishTime: e.trialFinishTime ?? "",
      run1StartTime: e.run1StartTime ?? "",
      run1FinishTime: e.run1FinishTime ?? "",
      run2StartTime: e.run2StartTime ?? "",
      run2FinishTime: e.run2FinishTime ?? "",
      driverCountryCode: e.driverCountryCode ?? "",
      coDriverCountryCode: e.coDriverCountryCode ?? "",
    })),
  );
  const [penaltyLines, setPenaltyLines] = useState<EventPenaltyLine[]>(() =>
    loadEventPenaltyLinesFromEntries(initial.entries),
  );
  const [flash, setFlash] = useState<string | null>(null);
  const [algeStartDeviceId, setAlgeStartDeviceId] = useState("");
  const [algeStartChannelId, setAlgeStartChannelId] = useState("0");
  const [algeFinishDeviceId, setAlgeFinishDeviceId] = useState("");
  const [algeFinishChannelId, setAlgeFinishChannelId] = useState("1");
  const [algeWsEndpoint, setAlgeWsEndpoint] = useState(
    "https://www.alge-results.com/devices",
  );
  const [algeWsToken, setAlgeWsToken] = useState("");
  const [algeWsTopic, setAlgeWsTopic] = useState("");
  const [streamConnected, setStreamConnected] = useState(false);
  const [streamInfo, setStreamInfo] = useState<string>("Disconnected");
  const [streamLastPayload, setStreamLastPayload] = useState<string>("");
  const stompRef = useRef<{
    deactivate: () => Promise<void> | void;
  } | null>(null);
  const liveSaveInFlightRef = useRef(false);
  const liveSaveQueuedRef = useRef<Entry[] | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>("details");
  const [startingOrderLeg, setStartingOrderLeg] = useState<number>(1);
  const [timingRun, setTimingRun] = useState<SpeedTimingRun>("trial");
  const timingRunRef = useRef<SpeedTimingRun>("trial");
  const [rallyTimingStageId, setRallyTimingStageId] = useState<string>("");
  const rallyTimingStageIdRef = useRef<string>("");
  const [showAssignStartModal, setShowAssignStartModal] = useState(false);
  const [assignStartFromCar, setAssignStartFromCar] = useState("1");
  const [assignStartToCar, setAssignStartToCar] = useState("1");
  const [assignStartFirstTime, setAssignStartFirstTime] = useState("10:00");
  const [assignStartIntervalMin, setAssignStartIntervalMin] = useState("2");
  const metaRef = useRef(meta);
  const entriesRef = useRef(entries);
  const stagesRef = useRef(stages);
  const timingAutosaveInFlightRef = useRef(false);
  const timingAutosaveQueuedRef = useRef(false);
  const lastTimingSavedSigRef = useRef(timingSignature(meta, entries));
  const [savedRallyStageAlgeSig, setSavedRallyStageAlgeSig] = useState<string>(() =>
    JSON.stringify(
      normalizeInitialRallyStageAlgeConfig(initial.rallyStageAlgeConfig),
    ),
  );
  const rallyStageAlgeConfigDirty =
    JSON.stringify(meta.rallyStageAlgeConfig) !== savedRallyStageAlgeSig;

  const eventId = initial.id;

  useEffect(() => {
    timingRunRef.current = timingRun;
  }, [timingRun]);

  useEffect(() => {
    rallyTimingStageIdRef.current = rallyTimingStageId;
  }, [rallyTimingStageId]);

  useEffect(() => {
    metaRef.current = meta;
  }, [meta]);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    stagesRef.current = stages;
  }, [stages]);

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.order - b.order),
    [stages],
  );

  const availableLegs = useMemo(() => {
    const set = new Set<number>();
    for (const s of stages) {
      if (typeof s.leg === "number" && s.leg >= 1) set.add(Math.floor(s.leg));
    }
    const list = [...set].sort((a, b) => a - b);
    return list.length > 0 ? list : [1];
  }, [stages]);

  useEffect(() => {
    if (!availableLegs.includes(startingOrderLeg)) {
      setStartingOrderLeg(availableLegs[0] ?? 1);
    }
  }, [availableLegs, startingOrderLeg]);

  const currentLegStartingOrder: LegStartingOrder = useMemo(() => {
    const key = String(startingOrderLeg);
    const existing = meta.legStartingOrders[key];
    if (existing) {
      return {
        ...emptyLegStartingOrder(startingOrderLeg),
        ...existing,
        startTimeByEntryId: existing.startTimeByEntryId ?? {},
      };
    }
    return emptyLegStartingOrder(startingOrderLeg);
  }, [meta.legStartingOrders, startingOrderLeg]);

  const startingOrderRows = useMemo(() => {
    const byId = new Map(entries.map((e) => [e.id, e]));
    return currentLegStartingOrder.entryIds
      .map((id) => byId.get(id))
      .filter((e): e is Entry => Boolean(e));
  }, [currentLegStartingOrder.entryIds, entries]);

  function patchCurrentLegStartingOrder(
    patch: Partial<LegStartingOrder> | ((prev: LegStartingOrder) => LegStartingOrder),
  ) {
    setMeta((m) => {
      const key = String(startingOrderLeg);
      const prev = {
        ...emptyLegStartingOrder(startingOrderLeg),
        ...(m.legStartingOrders[key] ?? {}),
        startTimeByEntryId: m.legStartingOrders[key]?.startTimeByEntryId ?? {},
      };
      const next =
        typeof patch === "function" ? patch(prev) : { ...prev, ...patch, leg: startingOrderLeg };
      return {
        ...m,
        legStartingOrders: {
          ...m.legStartingOrders,
          [key]: next,
        },
      };
    });
  }

  function loadStartingOrderFromEntries() {
    const starters = entries
      .filter((e) => e.start !== false)
      .slice()
      .sort((a, b) => a.startNumber - b.startNumber);
    if (starters.length === 0) {
      setFlash("No entries with Start = Yes. Mark crews as Start Yes in Entries first.");
      return;
    }
    const starterIds = new Set(starters.map((e) => e.id));
    const prevIds = currentLegStartingOrder.entryIds.filter((id) => starterIds.has(id));
    const prevSet = new Set(prevIds);
    const appended = starters.filter((e) => !prevSet.has(e.id)).map((e) => e.id);
    const entryIds = [...prevIds, ...appended];
    const idSet = new Set(entryIds);
    const startTimeByEntryId: Record<string, string> = {};
    for (const [id, clock] of Object.entries(
      currentLegStartingOrder.startTimeByEntryId ?? {},
    )) {
      if (idSet.has(id)) startTimeByEntryId[id] = clock;
    }
    patchCurrentLegStartingOrder({
      entryIds,
      firstCarStartTime: currentLegStartingOrder.firstCarStartTime || "09:00",
      intervalMinutes:
        currentLegStartingOrder.intervalMinutes >= 0
          ? currentLegStartingOrder.intervalMinutes
          : 1,
      startTimeByEntryId,
    });
    setFlash(
      `Loaded ${entryIds.length} starter(s) for LEG ${startingOrderLeg} (Start = Yes).`,
    );
  }

  function moveStartingOrderEntry(entryId: string, direction: -1 | 1) {
    patchCurrentLegStartingOrder((prev) => {
      const ids = [...prev.entryIds];
      const idx = ids.indexOf(entryId);
      if (idx < 0) return prev;
      const nextIdx = idx + direction;
      if (nextIdx < 0 || nextIdx >= ids.length) return prev;
      const tmp = ids[idx]!;
      ids[idx] = ids[nextIdx]!;
      ids[nextIdx] = tmp;
      return { ...prev, entryIds: ids };
    });
  }

  function setStartingOrderFirst(entryId: string) {
    patchCurrentLegStartingOrder((prev) => {
      if (!prev.entryIds.includes(entryId)) return prev;
      return {
        ...prev,
        entryIds: [entryId, ...prev.entryIds.filter((id) => id !== entryId)],
      };
    });
  }

  function removeFromStartingOrder(entryId: string) {
    patchCurrentLegStartingOrder((prev) => {
      const startTimeByEntryId = { ...(prev.startTimeByEntryId ?? {}) };
      delete startTimeByEntryId[entryId];
      return {
        ...prev,
        entryIds: prev.entryIds.filter((id) => id !== entryId),
        startTimeByEntryId,
      };
    });
  }

  function setManualStartingOrderTime(entryId: string, value: string) {
    patchCurrentLegStartingOrder((prev) => {
      const startTimeByEntryId = { ...(prev.startTimeByEntryId ?? {}) };
      const trimmed = value.trim();
      if (!trimmed) {
        delete startTimeByEntryId[entryId];
      } else {
        startTimeByEntryId[entryId] = trimmed;
      }
      return { ...prev, startTimeByEntryId };
    });
  }

  /** Re-apply first-car + interval to every row (clears manual time overrides). */
  function applyIntervalToAllStartTimes() {
    patchCurrentLegStartingOrder({ startTimeByEntryId: {} });
    setFlash(
      `Applied ${currentLegStartingOrder.intervalMinutes} min interval from ${currentLegStartingOrder.firstCarStartTime || "09:00"} to all cars.`,
    );
  }

  function saveStartingOrder() {
    setFlash(null);
    startTransition(async () => {
      const { payload, removedInlineDocs } = sanitizeMetaForSave(meta);
      const res = await updateEventMeta(eventId, payload);
      if (!res.ok) {
        setFlash(`Save failed: ${res.error}`);
        return;
      }
      if (removedInlineDocs > 0) setMeta(payload);
      setFlash(`Starting order for LEG ${startingOrderLeg} saved.`);
      router.refresh();
    });
  }

  function printCurrentStartingOrder() {
    if (startingOrderRows.length === 0) {
      setFlash("Load starters before printing the starting order.");
      return;
    }
    printStartingOrderPdf({
      eventName: meta.name || "Event",
      leg: startingOrderLeg,
      logoUrl: meta.logoUrl ?? "",
      rows: startingOrderRows,
      firstCarStartTime: currentLegStartingOrder.firstCarStartTime || "09:00",
      intervalMinutes: currentLegStartingOrder.intervalMinutes,
      startTimeByEntryId: currentLegStartingOrder.startTimeByEntryId ?? {},
    });
  }

  useEffect(() => {
    if (meta.type !== "rally") return;
    if (sortedStages.length === 0) {
      setRallyTimingStageId("");
      return;
    }
    if (sortedStages.some((s) => s.id === rallyTimingStageId)) return;
    setRallyTimingStageId(sortedStages[0]?.id ?? "");
  }, [meta.type, rallyTimingStageId, sortedStages]);

  function getRallyStageAlgeConfig(stageId: string) {
    return (
      meta.rallyStageAlgeConfig[stageId] ?? {
        ...DEFAULT_RALLY_STAGE_ALGE_CONFIG,
      }
    );
  }

  function updateRallyStageAlgeConfig(
    stageId: string,
    patch: Partial<(typeof DEFAULT_RALLY_STAGE_ALGE_CONFIG)>,
  ) {
    setMeta((m) => ({
      ...m,
      rallyStageAlgeConfig: {
        ...m.rallyStageAlgeConfig,
        [stageId]: {
          ...(m.rallyStageAlgeConfig[stageId] ?? DEFAULT_RALLY_STAGE_ALGE_CONFIG),
          ...patch,
        },
      },
    }));
  }

  function sanitizeMetaForSave<
    T extends { officialNoticeDocuments: RallyEvent["officialNoticeDocuments"] },
  >(input: T): {
    payload: T;
    removedInlineDocs: number;
  } {
    let removedInlineDocs = 0;
    const officialNoticeDocuments = input.officialNoticeDocuments.filter((doc) => {
      const url = (doc.url ?? "").trim();
      const isOversizedDataUrl =
        url.startsWith("data:") && url.length > MAX_INLINE_NOTICE_URL_LENGTH;
      if (isOversizedDataUrl) removedInlineDocs += 1;
      return !isOversizedDataUrl;
    });
    if (removedInlineDocs === 0) return { payload: input, removedInlineDocs: 0 };
    return {
      payload: { ...input, officialNoticeDocuments },
      removedInlineDocs,
    };
  }

  function saveMeta() {
    setFlash(null);
    startTransition(async () => {
      const { payload, removedInlineDocs } = sanitizeMetaForSave(meta);
      const res = await updateEventMeta(eventId, payload);
      if (!res.ok) {
        setFlash(`Save failed: ${res.error}`);
        return;
      }
      if (removedInlineDocs > 0) {
        setMeta(payload);
        setFlash(
          `Event saved. Removed ${removedInlineDocs} oversized inline notice document(s) to avoid request-size errors.`,
        );
      } else {
        setFlash("Event details saved.");
      }
      setSavedRallyStageAlgeSig(JSON.stringify(payload.rallyStageAlgeConfig));
      router.refresh();
    });
  }

  function saveStages() {
    setFlash(null);
    const ordered = sortedStages.map((s, i) => ({ ...s, order: i + 1 }));
    startTransition(async () => {
      await replaceStages(eventId, ordered);
      setStages(ordered);
      setFlash("Stages saved.");
      router.refresh();
    });
  }

  function saveEntries() {
    setFlash(null);
    startTransition(async () => {
      await replaceEntries(eventId, entries);
      setFlash("Entries saved.");
      router.refresh();
    });
  }

  function savePenalties() {
    setFlash(null);
    const byCar = new Map<number, EventPenaltyItem[]>();
    const unknownCars: string[] = [];
    const entryByCar = new Map(entries.map((e) => [e.startNumber, e]));
    const validOrders = new Set(stages.map((s) => s.order));
    for (const line of penaltyLines) {
      const carRaw = line.carNumber.trim();
      const penalty = normalizePenaltyInput(line.penalty).trim();
      if (!carRaw && !penalty && !line.note.trim()) continue;
      if (!carRaw || !penalty) {
        setFlash("Each penalty line needs a car number and penalty time (mm:ss).");
        return;
      }
      if (!validOrders.has(line.afterStageOrder)) {
        setFlash("Each penalty needs a valid After SS stage.");
        return;
      }
      const carNo = Number.parseInt(carRaw, 10);
      if (!Number.isFinite(carNo) || !entryByCar.has(carNo)) {
        unknownCars.push(carRaw);
        continue;
      }
      const list = byCar.get(carNo) ?? [];
      list.push({
        id: line.id || newPenaltyLineId(),
        penalty,
        note: line.note.trim(),
        afterStageOrder: line.afterStageOrder,
      });
      byCar.set(carNo, list);
    }
    if (unknownCars.length > 0) {
      setFlash(
        `Unknown car number(s): ${[...new Set(unknownCars)].join(", ")}. Add the crew in Entries first.`,
      );
      return;
    }
    const nextEntries = entries.map((row) =>
      writeEventPenaltyItemsToEntry(row, byCar.get(row.startNumber) ?? []),
    );
    setEntries(nextEntries);
    entriesRef.current = nextEntries;
    setPenaltyLines(loadEventPenaltyLinesFromEntries(nextEntries));
    startTransition(async () => {
      await replaceEntries(eventId, nextEntries);
      setFlash("Penalties saved.");
      router.refresh();
    });
  }

  function saveTiming() {
    setFlash(null);
    startTransition(async () => {
      const { payload, removedInlineDocs } = sanitizeMetaForSave(meta);
      const metaRes = await updateEventMeta(eventId, payload);
      if (!metaRes.ok) {
        setFlash(`Timing save failed: ${metaRes.error}`);
        return;
      }
      await replaceEntries(eventId, entries);
      if (removedInlineDocs > 0) {
        setMeta(payload);
      }
      lastTimingSavedSigRef.current = timingSignature(payload, entries);
      setSavedRallyStageAlgeSig(JSON.stringify(payload.rallyStageAlgeConfig));
      setFlash(
        removedInlineDocs > 0
          ? "Timing control saved. Oversized inline notice documents were removed."
          : "Timing control saved.",
      );
      router.refresh();
    });
  }

  function queueTimingAutosave() {
    if (timingAutosaveInFlightRef.current) {
      timingAutosaveQueuedRef.current = true;
      return;
    }
    timingAutosaveInFlightRef.current = true;
    void (async () => {
      try {
        do {
          timingAutosaveQueuedRef.current = false;
          const m = metaRef.current;
          const en = entriesRef.current;
          const sig = timingSignature(m, en);
          if (sig === lastTimingSavedSigRef.current) continue;
          const { payload } = sanitizeMetaForSave(m);
          const metaRes = await updateEventMeta(eventId, payload);
          if (!metaRes.ok) {
            console.error("Timing autosave: updateEventMeta failed:", metaRes.error);
            break;
          }
          const entRes = await replaceEntries(eventId, en);
          if (!entRes.ok) {
            console.error("Timing autosave: replaceEntries failed:", entRes.error);
            break;
          }
          lastTimingSavedSigRef.current = timingSignature(payload, en);
          setSavedRallyStageAlgeSig(JSON.stringify(payload.rallyStageAlgeConfig));
          router.refresh();
        } while (timingAutosaveQueuedRef.current);
      } catch (e) {
        console.error("Timing autosave failed:", e);
      } finally {
        timingAutosaveInFlightRef.current = false;
      }
    })();
  }

  /** Keep `entriesRef` in sync with state (avoids skipped saves when the 2s poll runs before useEffect). */
  function applyTimingEntryUpdate(reducer: (prev: Entry[]) => Entry[]) {
    setEntries((prev) => {
      const next = reducer(prev);
      entriesRef.current = next;
      return next;
    });
    queueTimingAutosave();
  }

  function formatTriggerClock(timestamp100ns: number, timeOffsetMin: number): string {
    const adjusted100ns = timestamp100ns + timeOffsetMin * 60 * 10_000_000;
    const ms = Math.floor(adjusted100ns / 10_000);
    const d = new Date(ms);
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    const ss = String(d.getUTCSeconds()).padStart(2, "0");
    const cs = String(Math.floor((d.getUTCMilliseconds() % 1000) / 10)).padStart(
      2,
      "0",
    );
    return `${hh}:${mm}:${ss}.${cs}`;
  }

  async function disconnectStompStream() {
    const c = stompRef.current;
    stompRef.current = null;
    setStreamConnected(false);
    setStreamInfo("Disconnected");
    if (c) await c.deactivate();
  }

  function queueLiveEntriesSave(nextEntries: Entry[]) {
    liveSaveQueuedRef.current = nextEntries;
    if (liveSaveInFlightRef.current) return;
    liveSaveInFlightRef.current = true;
    void (async () => {
      try {
        while (liveSaveQueuedRef.current) {
          const batch = liveSaveQueuedRef.current;
          liveSaveQueuedRef.current = null;
          await replaceEntries(eventId, batch);
        }
      } finally {
        liveSaveInFlightRef.current = false;
      }
    })();
  }

  function applyTriggerTimingValue(
    row: Entry,
    trigger: "start" | "finish",
    triggerTime: string,
    rallyStageId?: string,
  ): Entry {
    if (metaRef.current.type === "rally") {
      const stageId = (rallyStageId ?? rallyTimingStageIdRef.current).trim();
      if (!stageId) return row;
      const blob = parseRallyStageTimingBlob(row.trialStartTime ?? "");
      const current = blob[stageId] ?? {};
      blob[stageId] =
        trigger === "start"
          ? { ...current, startTime: triggerTime }
          : { ...current, finishTime: triggerTime };
      return {
        ...row,
        trialStartTime: JSON.stringify(blob),
        trialFinishTime: "",
        run1StartTime: "",
        run1FinishTime: "",
        run2StartTime: "",
        run2FinishTime: "",
      };
    }

    const activeRun = timingRunRef.current;
    if (activeRun === "trial") {
      return trigger === "start"
        ? { ...row, trialStartTime: triggerTime }
        : { ...row, trialFinishTime: triggerTime };
    }
    if (activeRun === "run1") {
      return trigger === "start"
        ? { ...row, run1StartTime: triggerTime }
        : { ...row, run1FinishTime: triggerTime };
    }
    return trigger === "start"
      ? { ...row, run2StartTime: triggerTime }
      : { ...row, run2FinishTime: triggerTime };
  }

  async function connectStompStream() {
    const currentMeta = metaRef.current;
    if (currentMeta.type === "rally") {
      const hasAnyRallyDevice = stagesRef.current.some((st) => {
        const cfg = currentMeta.rallyStageAlgeConfig[st.id];
        return Boolean(cfg?.finishDeviceId?.trim());
      });
      if (!hasAnyRallyDevice) {
        const msg =
          "Set a Finish Device ID on at least one stage (and click Save device) before connecting.";
        setFlash(msg);
        setStreamInfo(msg);
        return;
      }
    } else {
      if (!algeStartDeviceId.trim()) {
        const msg = "Set Start Device ID first.";
        setFlash(msg);
        setStreamInfo(msg);
        return;
      }
      if (!algeFinishDeviceId.trim()) {
        const msg = "Set Finish Device ID first.";
        setFlash(msg);
        setStreamInfo(msg);
        return;
      }
    }
    setFlash(null);
    if (stompRef.current) await disconnectStompStream();
    try {
      const [{ Client }, sockJsMod] = await Promise.all([
        import("@stomp/stompjs"),
        import("sockjs-client"),
      ]);
      const SockJS =
        (sockJsMod as unknown as { default?: new (url: string) => WebSocket })
          .default ??
        (sockJsMod as unknown as new (url: string) => WebSocket);
      const customTopic = algeWsTopic.trim();
      const subscriptions: Array<{
        topic: string;
        forcedTrigger: "start" | "finish" | null;
        stageId?: string;
      }> = [];
      if (customTopic) {
        subscriptions.push({
          topic: customTopic,
          forcedTrigger: currentMeta.type === "rally" ? "finish" : null,
        });
      } else if (currentMeta.type === "rally") {
        for (const stage of stagesRef.current) {
          const cfg = currentMeta.rallyStageAlgeConfig[stage.id];
          if (!cfg) continue;
          const finishDeviceId = cfg.finishDeviceId.trim();
          if (finishDeviceId) {
            subscriptions.push({
              topic: `/topic/device/${finishDeviceId}/trigger`,
              forcedTrigger: "finish",
              stageId: stage.id,
            });
          }
        }
      } else {
        subscriptions.push({
          topic: `/topic/device/${algeStartDeviceId.trim()}/trigger`,
          forcedTrigger: "start",
        });
        subscriptions.push({
          topic: `/topic/device/${algeFinishDeviceId.trim()}/trigger`,
          forcedTrigger: "finish",
        });
      }
      const uniqueSubscriptions = subscriptions.filter(
        (s, i, arr) =>
          arr.findIndex(
            (x) =>
              x.topic === s.topic &&
              x.forcedTrigger === s.forcedTrigger &&
              x.stageId === s.stageId,
          ) === i,
      );
      if (uniqueSubscriptions.length === 0) {
        const msg = "No ALGE subscriptions configured. Check device IDs.";
        setFlash(msg);
        setStreamInfo(msg);
        return;
      }
      const topicLabel = uniqueSubscriptions.map((x) => x.topic).join(", ");
      const client = new Client({
        webSocketFactory: () => new SockJS(algeWsEndpoint.trim()),
        connectHeaders: algeWsToken.trim()
          ? { authorization: algeWsToken.trim() }
          : {},
        reconnectDelay: 5000,
      });
      client.onConnect = () => {
        setStreamConnected(true);
        setStreamInfo(`Connected (${topicLabel})`);
        for (const sub of uniqueSubscriptions) {
          client.subscribe(sub.topic, (message) => {
            try {
              setStreamLastPayload(message.body.slice(0, 1000));
              const payload = JSON.parse(message.body) as {
                dto?: {
                  timestamp?: number | string;
                  timeOffset?: number | string;
                  startNumber?:
                    | { startNumber?: number | string }
                    | number
                    | string;
                };
              };
              const dto = payload?.dto;
              const startNumberRaw =
                typeof dto?.startNumber === "object"
                  ? dto.startNumber?.startNumber
                  : dto?.startNumber;
              const startNumber =
                typeof startNumberRaw === "number"
                  ? Math.floor(startNumberRaw)
                  : Number.parseInt(String(startNumberRaw ?? ""), 10);
              const timestampNum =
                typeof dto?.timestamp === "number"
                  ? dto.timestamp
                  : Number.parseInt(String(dto?.timestamp ?? ""), 10);
              const timeOffsetNum =
                typeof dto?.timeOffset === "number"
                  ? dto.timeOffset
                  : Number.parseInt(String(dto?.timeOffset ?? ""), 10);
              const timingChannelRaw =
                payload?.dto && typeof payload.dto === "object"
                  ? String((payload.dto as Record<string, unknown>).timingChannel ?? "")
                  : "";
              const timingChannelNum = Number.parseInt(
                timingChannelRaw.replace(/^[^0-9]*/, ""),
                10,
              );
              if (Number.isNaN(timestampNum) || Number.isNaN(startNumber)) {
                setStreamInfo(
                  `Connected (${topicLabel}) · ${sub.topic} trigger received but could not parse start/timestamp`,
                );
                return;
              }
              const mNow = metaRef.current;
              let algeTriggersAllowed = false;
              if (mNow.type === "speed") {
                algeTriggersAllowed =
                  mNow.speedRunImportStatus[timingRunRef.current] === "live";
              } else if (mNow.type === "rally") {
                const sid = (sub.stageId ?? rallyTimingStageIdRef.current).trim();
                const st = sid
                  ? stagesRef.current.find((s) => s.id === sid)
                  : undefined;
                algeTriggersAllowed = st?.progressStatus === "live";
              }
              if (!algeTriggersAllowed) {
                const runOrStageHint =
                  mNow.type === "speed"
                    ? `${speedRunIdLabel(timingRunRef.current)} import status is not Live (ALGE only when Live; use manual entry when Completed or Scheduled)`
                    : (() => {
                        const sid = (sub.stageId ?? rallyTimingStageIdRef.current).trim();
                        const st = sid
                          ? stagesRef.current.find((s) => s.id === sid)
                          : undefined;
                        const label = st ? `SS ${st.order} (${st.progressStatus})` : "selected stage";
                        return `${label} is not Live — set the stage to Live on the Stages tab for ALGE (Completed = manual only)`;
                      })();
                setStreamInfo(
                  `Connected (${topicLabel}) · trigger ignored: ${runOrStageHint} · car #${startNumber} (${sub.topic})`,
                );
                return;
              }
              const triggerTime = formatTriggerClock(
                timestampNum,
                Number.isNaN(timeOffsetNum) ? 0 : timeOffsetNum,
              );
              let matched = false;
              const finishChannelNum = Number.parseInt(algeFinishChannelId, 10);
              const activeTrigger: "start" | "finish" =
                sub.forcedTrigger ??
                (metaRef.current.type === "rally"
                  ? "finish"
                  : !Number.isNaN(timingChannelNum) &&
                      !Number.isNaN(finishChannelNum) &&
                      timingChannelNum === finishChannelNum
                    ? "finish"
                    : !Number.isNaN(timingChannelNum) &&
                        !Number.isNaN(Number.parseInt(algeStartChannelId, 10)) &&
                        timingChannelNum === Number.parseInt(algeStartChannelId, 10)
                      ? "start"
                      : "start");
              const activeRallyStageId =
                metaRef.current.type === "rally"
                  ? (sub.stageId ?? rallyTimingStageIdRef.current)
                  : undefined;
              let nextEntriesSnapshot: Entry[] | null = null;
              setEntries((prev) => {
                const next = prev.map((x) => {
                  if (Math.floor(Number(x.startNumber)) !== startNumber) return x;
                  matched = true;
                  return applyTriggerTimingValue(
                    x,
                    activeTrigger,
                    triggerTime,
                    activeRallyStageId,
                  );
                });
                nextEntriesSnapshot = next;
                return next;
              });
              if (matched && nextEntriesSnapshot) {
                queueLiveEntriesSave(nextEntriesSnapshot);
                // Keep autosave path active too, so trigger-applied times are always persisted.
                queueTimingAutosave();
              }
              setStreamInfo(
                matched
                  ? `Connected (${topicLabel}) · #${startNumber} ${activeTrigger}=${triggerTime} (${sub.topic})`
                  : `Connected (${topicLabel}) · trigger for #${startNumber} received, but no matching entry (${sub.topic})`,
              );
            } catch (e) {
              setStreamInfo(
                `Connected (${topicLabel}) · could not parse trigger from ${sub.topic}: ${e instanceof Error ? e.message : "unknown error"}`,
              );
            }
          });
        }
      };
      client.onStompError = (frame) => {
        setStreamInfo(`STOMP error: ${frame.headers.message ?? "Unknown error"}`);
      };
      client.onWebSocketClose = () => {
        setStreamConnected(false);
      };
      stompRef.current = client;
      client.activate();
    } catch (e) {
      setFlash(
        `Failed to connect STOMP: ${e instanceof Error ? e.message : "Unknown error"}`,
      );
    }
  }

  useEffect(() => {
    return () => {
      void disconnectStompStream();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (activeTab !== "timing") return;
      if (metaRef.current.type !== "speed" && metaRef.current.type !== "rally") return;
      queueTimingAutosave();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [activeTab]);

  function confirmDelete() {
    if (
      !window.confirm(
        "Delete this event and all its stages and entries? This cannot be undone.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      await deleteEvent(eventId);
      router.push("/admin/events");
      router.refresh();
    });
  }

  function addStage() {
    const nextOrder =
      sortedStages.length === 0
        ? 1
        : Math.max(...sortedStages.map((s) => s.order)) + 1;
    const last = sortedStages[sortedStages.length - 1];
    const defaultLeg = last?.leg ?? 1;
    setStages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: `Stage ${nextOrder}`,
        order: nextOrder,
        leg: defaultLeg,
        distanceKm: null,
        firstCarStartTime: null,
        progressStatus: "pending",
      },
    ]);
  }

  function moveStage(id: string, dir: -1 | 1) {
    const list = [...sortedStages];
    const i = list.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const t = list[i];
    list[i] = list[j];
    list[j] = t;
    setStages(
      list.map((s, idx) => ({ ...s, order: idx + 1 })),
    );
  }

  function removeStage(id: string) {
    setStages((prev) => prev.filter((s) => s.id !== id));
  }

  function addEntry() {
    setEntries((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        startNumber:
          prev.length === 0
            ? 1
            : Math.max(...prev.map((e) => e.startNumber)) + 1,
        entrance: "",
        start: true,
        trialStartTime: "",
        trialFinishTime: "",
        run1StartTime: "",
        run1FinishTime: "",
        run2StartTime: "",
        run2FinishTime: "",
        driver: "",
        coDriver: "",
        car: "",
        class: "",
        driverCountryCode: "",
        coDriverCountryCode: "",
      },
    ]);
  }

  function removeEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  async function importEntriesFromExcel(file: File) {
    setFlash(null);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const firstSheetName = wb.SheetNames[0];
      if (!firstSheetName) {
        setFlash("Excel import failed: no sheet found.");
        return;
      }
      const ws = wb.Sheets[firstSheetName];
      const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        defval: "",
        blankrows: false,
      });
      if (!Array.isArray(grid) || grid.length === 0) {
        setFlash("Excel import failed: no rows found.");
        return;
      }

      const norm = (v: unknown) =>
        String(v ?? "")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "");
      const toStringValue = (v: unknown) => String(v ?? "").trim();
      const parseStart = (v: unknown) => {
        const s = toStringValue(v).toLowerCase();
        if (!s) return true;
        if (["no", "n", "false", "0"].includes(s)) return false;
        return true;
      };

      const headerRow = (grid[0] ?? []) as unknown[];
      const dataRows = grid.slice(1).filter((row) => {
        if (!Array.isArray(row)) return false;
        return row.some((cell) => toStringValue(cell) !== "");
      });
      if (dataRows.length === 0) {
        setFlash("Excel import failed: no data rows found.");
        return;
      }

      const headerIndexMap = new Map<string, number>();
      headerRow.forEach((header, idx) => {
        const key = norm(header);
        if (!key) return;
        if (!headerIndexMap.has(key)) headerIndexMap.set(key, idx);
      });
      const aliasesToIndexes = (aliases: string[]): number[] => {
        return aliases
          .map((a) => headerIndexMap.get(norm(a)))
          .filter((idx): idx is number => typeof idx === "number");
      };
      const readCell = (row: unknown[], aliases: string[]) => {
        const indexes = aliasesToIndexes(aliases);
        for (const idx of indexes) {
          const v = row[idx];
          if (toStringValue(v) !== "") return v;
        }
        return "";
      };

      const importedRows: Array<Omit<Entry, "id">> = dataRows.map((rowRaw, idx) => {
        const row = Array.isArray(rowRaw) ? rowRaw : [];
        const startNumberRaw = readCell(row, [
          "#",
          "No",
          "Number",
          "Start Number",
          "StartNumber",
        ]);
        const startNumberParsed = Number.parseInt(
          toStringValue(startNumberRaw),
          10,
        );
        const startNumber = Number.isNaN(startNumberParsed)
          ? idx + 1
          : startNumberParsed;
        return {
          startNumber,
          entrance: toStringValue(readCell(row, ["Entrance"])),
          start: parseStart(readCell(row, ["Start"])),
          trialStartTime: "",
          trialFinishTime: "",
          run1StartTime: "",
          run1FinishTime: "",
          run2StartTime: "",
          run2FinishTime: "",
          driver: toStringValue(readCell(row, ["Driver", "Driver Name"])),
          coDriver: toStringValue(
            readCell(row, ["Co-driver", "Codriver", "Co Driver", "Navigator"]),
          ),
          car: toStringValue(readCell(row, ["Car", "Vehicle"])),
          class: toStringValue(readCell(row, ["Class", "Category"])),
          driverCountryCode: toStringValue(
            readCell(row, ["Drv", "Driver Country", "Driver Country Code"]),
          ),
          coDriverCountryCode: toStringValue(
            readCell(row, ["Co", "Co-driver Country", "Co-driver Country Code"]),
          ),
        };
      });

      setEntries((prev) => {
        const byStartNo = new Map<number, Entry>();
        for (const existing of prev) {
          byStartNo.set(existing.startNumber, existing);
        }
        for (const row of importedRows) {
          const existing = byStartNo.get(row.startNumber);
          byStartNo.set(row.startNumber, {
            id: existing?.id ?? crypto.randomUUID(),
            ...row,
          });
        }
        return [...byStartNo.values()].sort((a, b) => a.startNumber - b.startNumber);
      });
      setFlash(
        `Imported ${importedRows.length} rows from "${file.name}". Click Save entries to publish.`,
      );
    } catch (e) {
      setFlash(
        `Excel import failed: ${e instanceof Error ? e.message : "Unknown error"}`,
      );
    }
  }

  async function uploadLogoFile(file: File) {
    setLogoUploadError(null);
    setLogoUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/uploads/rally-logo", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setLogoUploadError(data.error ?? "Upload failed.");
        return;
      }
      setMeta((m) => ({ ...m, logoUrl: data.url! }));
      setFlash("Logo uploaded. Click Save details to publish it.");
    } catch {
      setLogoUploadError("Upload failed. Please try again.");
    } finally {
      setLogoUploading(false);
    }
  }

  const officialNoticeCategoryOptions = useMemo(() => {
    const fromDocs = meta.officialNoticeDocuments
      .map((x) => x.category?.trim() ?? "")
      .filter(Boolean);
    const merged = new Set<string>([
      ...NOTICE_BOARD_DEFAULT_CATEGORIES,
      ...meta.officialNoticeCustomCategories,
      ...fromDocs,
    ]);
    return [...merged];
  }, [meta.officialNoticeCustomCategories, meta.officialNoticeDocuments]);

  function addOfficialNoticeCustomCategory() {
    const value = newCustomCategory.trim();
    if (!value) return;
    if (
      NOTICE_BOARD_DEFAULT_CATEGORIES.includes(
        value as (typeof NOTICE_BOARD_DEFAULT_CATEGORIES)[number],
      )
    ) {
      setFlash(`"${value}" is a built-in category and cannot be added again.`);
      setNewCustomCategory("");
      return;
    }
    setMeta((m) => {
      if (m.officialNoticeCustomCategories.includes(value)) return m;
      return {
        ...m,
        officialNoticeCustomCategories: [...m.officialNoticeCustomCategories, value],
      };
    });
    setNewDocCategory(value);
    setNewCustomCategory("");
  }

  /** Remove a custom (or document-only) category; built-in categories stay. Docs move to Other. */
  function removeOfficialNoticeCategory(category: string) {
    const value = category.trim();
    if (!value) return;
    if (
      NOTICE_BOARD_DEFAULT_CATEGORIES.includes(
        value as (typeof NOTICE_BOARD_DEFAULT_CATEGORIES)[number],
      )
    ) {
      setFlash(`"${value}" is a built-in category and cannot be deleted.`);
      return;
    }
    const usedCount = meta.officialNoticeDocuments.filter(
      (d) => (d.category ?? "").trim() === value,
    ).length;
    if (
      usedCount > 0 &&
      !window.confirm(
        `"${value}" is used by ${usedCount} document(s). Delete it and move those to "Other"?`,
      )
    ) {
      return;
    }
    setMeta((m) => ({
      ...m,
      officialNoticeCustomCategories: m.officialNoticeCustomCategories.filter(
        (c) => c !== value,
      ),
      officialNoticeDocuments: m.officialNoticeDocuments.map((doc) =>
        (doc.category ?? "").trim() === value ? { ...doc, category: "Other" } : doc,
      ),
    }));
    if (newDocCategory === value) {
      setNewDocCategory("Other");
    }
    setFlash(
      usedCount > 0
        ? `Category "${value}" deleted. ${usedCount} document(s) moved to Other. Save notice board to publish.`
        : `Category "${value}" deleted. Save notice board to publish.`,
    );
  }

  const removableNoticeCategories = useMemo(() => {
    const defaults = new Set<string>(NOTICE_BOARD_DEFAULT_CATEGORIES);
    return officialNoticeCategoryOptions.filter((c) => !defaults.has(c));
  }, [officialNoticeCategoryOptions]);

  function removeOfficialNoticeDocument(id: string) {
    setMeta((m) => ({
      ...m,
      officialNoticeDocuments: m.officialNoticeDocuments.filter((x) => x.id !== id),
    }));
    if (editingNoticeDocId === id) {
      cancelEditOfficialNoticeDocument();
    }
  }

  function cancelEditOfficialNoticeDocument() {
    setEditingNoticeDocId(null);
    setNewDocTitle("");
    setNewDocUrl("");
    setNewDocCategory(NOTICE_BOARD_DEFAULT_CATEGORIES[0]);
    setDocUploadError(null);
  }

  function startEditOfficialNoticeDocument(
    doc: RallyEvent["officialNoticeDocuments"][number],
  ) {
    setDocUploadError(null);
    setEditingNoticeDocId(doc.id);
    setNewDocTitle(doc.title);
    setNewDocCategory(doc.category || NOTICE_BOARD_DEFAULT_CATEGORIES[0]);
    setNewDocUrl(doc.url);
  }

  function parseOfficialNoticeHttpUrl(rawUrl: string): URL | null {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
      setDocUploadError("Enter a document URL.");
      return null;
    }
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      setDocUploadError("Invalid URL. Use full link, e.g. https://example.com/doc.pdf");
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      setDocUploadError("Only http/https links are allowed.");
      return null;
    }
    return parsed;
  }

  function ensureNoticeCategoryInMeta(
    m: typeof meta,
    category: string,
  ): string[] {
    if (
      NOTICE_BOARD_DEFAULT_CATEGORIES.includes(
        category as (typeof NOTICE_BOARD_DEFAULT_CATEGORIES)[number],
      ) ||
      m.officialNoticeCustomCategories.includes(category)
    ) {
      return m.officialNoticeCustomCategories;
    }
    return [...m.officialNoticeCustomCategories, category];
  }

  function addOfficialNoticeLink() {
    setDocUploadError(null);
    const parsed = parseOfficialNoticeHttpUrl(newDocUrl);
    if (!parsed) return;
    const title = newDocTitle.trim() || parsed.pathname.split("/").pop() || parsed.hostname;
    const category = newDocCategory.trim() || "Other";
    const fromPath = decodeURIComponent(parsed.pathname.split("/").pop() || "").trim();
    const fileName = fromPath || parsed.hostname;
    setMeta((m) => ({
      ...m,
      officialNoticeDocuments: [
        {
          id: crypto.randomUUID(),
          title,
          category,
          url: parsed.toString(),
          fileName,
          uploadedAt: new Date().toISOString(),
        },
        ...m.officialNoticeDocuments,
      ],
      officialNoticeCustomCategories: ensureNoticeCategoryInMeta(m, category),
    }));
    setNewDocTitle("");
    setNewDocUrl("");
    setFlash("Link added. Click Save notice board to publish it.");
  }

  function updateOfficialNoticeLink() {
    setDocUploadError(null);
    if (!editingNoticeDocId) return;
    const parsed = parseOfficialNoticeHttpUrl(newDocUrl);
    if (!parsed) return;
    const title = newDocTitle.trim() || parsed.pathname.split("/").pop() || parsed.hostname;
    const category = newDocCategory.trim() || "Other";
    const fromPath = decodeURIComponent(parsed.pathname.split("/").pop() || "").trim();
    const fileName = fromPath || parsed.hostname;
    const id = editingNoticeDocId;
    setMeta((m) => ({
      ...m,
      officialNoticeDocuments: m.officialNoticeDocuments.map((doc) =>
        doc.id === id
          ? {
              ...doc,
              title,
              category,
              url: parsed.toString(),
              fileName,
            }
          : doc,
      ),
      officialNoticeCustomCategories: ensureNoticeCategoryInMeta(m, category),
    }));
    cancelEditOfficialNoticeDocument();
    setFlash("Entry updated. Click Save notice board to publish it.");
  }

  async function uploadOfficialNoticeDocument(file: File) {
    setDocUploadError(null);
    if (editingNoticeDocId) {
      setDocUploadError("Finish or cancel the current edit before uploading a new file.");
      return;
    }
    const title = newDocTitle.trim() || file.name;
    const category = newDocCategory.trim() || "Other";
    setDocUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("title", title);
      fd.set("category", category);
      const res = await fetch("/api/uploads/official-notice-document", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as { url?: string; fileName?: string; error?: string };
      if (!res.ok || !data.url) {
        setDocUploadError(data.error ?? "Document upload failed.");
        return;
      }
      setMeta((m) => ({
        ...m,
        officialNoticeDocuments: [
          {
            id: crypto.randomUUID(),
            title,
            category,
            url: data.url!,
            fileName: data.fileName?.trim() || file.name,
            uploadedAt: new Date().toISOString(),
          },
          ...m.officialNoticeDocuments,
        ],
        officialNoticeCustomCategories: ensureNoticeCategoryInMeta(m, category),
      }));
      setNewDocTitle("");
      setFlash("Document uploaded. Click Save notice board to publish it.");
    } catch {
      setDocUploadError("Document upload failed. Please try again.");
    } finally {
      setDocUploading(false);
    }
  }

  const timingRunLabel =
    timingRun === "trial"
      ? "Trial"
      : timingRun === "run1"
        ? "1st Run"
        : "2nd Run";
  const selectedRallyTimingStage =
    meta.type === "rally"
      ? sortedStages.find((s) => s.id === rallyTimingStageId) ?? sortedStages[0] ?? null
      : null;
  const selectedRallyStageAlgeConfig =
    meta.type === "rally" && selectedRallyTimingStage
      ? getRallyStageAlgeConfig(selectedRallyTimingStage.id)
      : DEFAULT_RALLY_STAGE_ALGE_CONFIG;
  const timingStartField: keyof Entry =
    timingRun === "trial"
      ? "trialStartTime"
      : timingRun === "run1"
        ? "run1StartTime"
        : "run2StartTime";
  const timingFinishField: keyof Entry =
    timingRun === "trial"
      ? "trialFinishTime"
      : timingRun === "run1"
        ? "run1FinishTime"
        : "run2FinishTime";
  const timingRunStatus = meta.speedRunImportStatus[timingRun];
  const getTimingValuesForEntry = (
    row: Entry,
  ): {
    startValue: string;
    finishValue: string;
    penaltyValue: string;
    penaltyNoteValue: string;
  } => {
    if (meta.type !== "rally") {
      return {
        startValue: (row[timingStartField] as string) ?? "",
        finishValue: (row[timingFinishField] as string) ?? "",
        penaltyValue: "",
        penaltyNoteValue: "",
      };
    }
    if (!selectedRallyTimingStage) {
      return {
        startValue: "",
        finishValue: "",
        penaltyValue: "",
        penaltyNoteValue: "",
      };
    }
    const blob = parseRallyStageTimingBlob(row.trialStartTime ?? "");
    const current = blob[selectedRallyTimingStage.id] ?? {};
    return {
      startValue: current.startTime?.trim() ?? "",
      finishValue: current.finishTime?.trim() ?? "",
      penaltyValue: current.penalty?.trim() ?? "",
      penaltyNoteValue: current.penaltyNote?.trim() ?? "",
    };
  };
  const updateEntryTimingValues = (
    row: Entry,
    startValue: string,
    finishValue: string,
  ): Entry => {
    if (meta.type !== "rally") {
      return {
        ...row,
        [timingStartField]: startValue,
        [timingFinishField]: finishValue,
      };
    }
    if (!selectedRallyTimingStage) return row;
    const blob = parseRallyStageTimingBlob(row.trialStartTime ?? "");
    const current = blob[selectedRallyTimingStage.id] ?? {};
    blob[selectedRallyTimingStage.id] = {
      startTime: startValue,
      finishTime: finishValue,
      penalty: current.penalty ?? "",
      penaltyNote: current.penaltyNote ?? "",
    };
    return {
      ...row,
      trialStartTime: JSON.stringify(blob),
      trialFinishTime: "",
      run1StartTime: "",
      run1FinishTime: "",
      run2StartTime: "",
      run2FinishTime: "",
    };
  };
  const updateEntryTimingPenaltyValues = (
    row: Entry,
    penaltyValue: string,
    penaltyNoteValue: string,
  ): Entry => {
    if (meta.type !== "rally" || !selectedRallyTimingStage) return row;
    const blob = parseRallyStageTimingBlob(row.trialStartTime ?? "");
    const current = blob[selectedRallyTimingStage.id] ?? {};
    const jumpStartReason = `Jump Start SS${selectedRallyTimingStage.order}`;
    const trimmedNote = penaltyNoteValue.trim();
    const isDefaultJumpStart =
      !trimmedNote ||
      /^Jump Start SS\d+$/i.test(trimmedNote);
    const nextNote = !penaltyValue.trim()
      ? isDefaultJumpStart
        ? ""
        : trimmedNote
      : trimmedNote && !isDefaultJumpStart
        ? trimmedNote
        : jumpStartReason;
    blob[selectedRallyTimingStage.id] = {
      startTime: current.startTime ?? "",
      finishTime: current.finishTime ?? "",
      penalty: penaltyValue,
      penaltyNote: nextNote,
    };
    return {
      ...row,
      trialStartTime: JSON.stringify(blob),
      trialFinishTime: "",
      run1StartTime: "",
      run1FinishTime: "",
      run2StartTime: "",
      run2FinishTime: "",
    };
  };
  const parseTimeToMs = (value: string): number | null => {
    const raw = value.trim();
    if (!raw) return null;
    const m = raw.match(
      /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:[.,](\d{1,3}))?)?$/,
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
  };
  const formatDuration = (totalMs: number): string => {
    const msSafe = Math.max(0, totalMs);
    const h = Math.floor(msSafe / 3_600_000);
    const m = Math.floor((msSafe % 3_600_000) / 60_000);
    const s = Math.floor((msSafe % 60_000) / 1000);
    const cs = Math.floor((msSafe % 1000) / 10);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(
      s,
    ).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  };
  const parsePenaltyToMs = (value: string): number => {
    const t = value.trim();
    if (!t) return 0;
    const m = t.match(/^(\d{1,3}):([0-5]?\d)$/);
    if (m) {
      const minutes = Number.parseInt(m[1] ?? "0", 10);
      const seconds = Number.parseInt(m[2] ?? "0", 10);
      if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return 0;
      return (minutes * 60 + seconds) * 1000;
    }
    const secOnly = Number.parseInt(t, 10);
    return Number.isFinite(secOnly) && secOnly >= 0 ? secOnly * 1000 : 0;
  };
  const computeTotalTime = (
    startValue: string,
    finishValue: string,
    penaltyValue = "",
  ): string => {
    const outcome = parseTimingOutcome(startValue, finishValue);
    const outcomeLabel = formatTimingOutcomeLabel(outcome);
    if (outcomeLabel) return outcomeLabel;
    const startMs = parseTimeToMs(startValue);
    const finishMs = parseTimeToMs(finishValue);
    if (startMs == null || finishMs == null) return "—";
    const diff = finishMs - startMs;
    if (diff < 0) return "—";
    return formatDuration(diff + parsePenaltyToMs(penaltyValue));
  };
  const setTimingOutcomeForEntry = (
    entryId: string,
    nextOutcome: "ret" | "dnf",
    currentOutcome: SpeedTimingOutcome,
  ) => {
    const marker = nextOutcome === "ret" ? "RET" : "DNF";
    const clear = currentOutcome === nextOutcome;
    setEntries((prev) => {
      const next = prev.map((x) =>
        x.id === entryId
          ? updateEntryTimingValues(x, clear ? "" : marker, clear ? "" : marker)
          : x,
      );
      entriesRef.current = next;
      return next;
    });
    queueTimingAutosave();
  };
  const formatClockFromMs = (totalMs: number): string => {
    const safeMs = ((totalMs % 86_400_000) + 86_400_000) % 86_400_000;
    const h = Math.floor(safeMs / 3_600_000);
    const m = Math.floor((safeMs % 3_600_000) / 60_000);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };
  const openAssignStartTimesModal = () => {
    const sorted = entries
      .filter((e) => e.start !== false)
      .map((e) => e.startNumber)
      .sort((a, b) => a - b);
    const first = sorted[0] ?? 1;
    const last = sorted[sorted.length - 1] ?? first;
    setAssignStartFromCar(String(first));
    setAssignStartToCar(String(last));
    setAssignStartFirstTime("10:00");
    setAssignStartIntervalMin("2");
    setShowAssignStartModal(true);
  };
  const applyBulkStartTimes = () => {
    if (meta.type !== "rally" || !selectedRallyTimingStage) return;
    const from = Number.parseInt(assignStartFromCar, 10);
    const to = Number.parseInt(assignStartToCar, 10);
    const interval = Number.parseInt(assignStartIntervalMin, 10);
    const baseMs = parseTimeToMs(assignStartFirstTime);
    if (
      Number.isNaN(from) ||
      Number.isNaN(to) ||
      Number.isNaN(interval) ||
      baseMs == null
    ) {
      setFlash("Set valid car range, first start time, and interval.");
      return;
    }
    const startNo = Math.min(from, to);
    const endNo = Math.max(from, to);
    const intervalMs = Math.max(0, interval) * 60_000;
    setEntries((prev) => {
      const next = prev.map((row) => {
        if (row.startNumber < startNo || row.startNumber > endNo) return row;
        const offsetIndex = row.startNumber - startNo;
        const scheduled = formatClockFromMs(baseMs + offsetIndex * intervalMs);
        const current = getTimingValuesForEntry(row);
        return updateEntryTimingValues(row, scheduled, current.finishValue);
      });
      entriesRef.current = next;
      return next;
    });
    setShowAssignStartModal(false);
    setFlash(
      `Assigned start times for cars ${startNo}-${endNo} on SS ${selectedRallyTimingStage.order}.`,
    );
    queueTimingAutosave();
  };

  return (
    <div className="space-y-10">
      {pending ? (
        <div
          className="fixed inset-0 z-[70] flex items-start justify-center bg-black/20 pt-16 backdrop-blur-[1px] dark:bg-black/40"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-5 py-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <span
              className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-zinc-900 border-r-transparent dark:border-zinc-100 dark:border-r-transparent"
              aria-hidden
            />
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Saving… please wait
            </span>
          </div>
        </div>
      ) : null}
      {flash ? (
        <p className="text-sm text-green-700 dark:text-green-400">{flash}</p>
      ) : null}

      <section className="rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("details")}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              activeTab === "details"
                ? "bg-red-700 font-medium text-white dark:bg-red-600"
                : "border border-zinc-300 text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
            }`}
          >
            Event details
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("stages")}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              activeTab === "stages"
                ? "bg-red-700 font-medium text-white dark:bg-red-600"
                : "border border-zinc-300 text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
            }`}
          >
            Stages
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("entries")}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              activeTab === "entries"
                ? "bg-red-700 font-medium text-white dark:bg-red-600"
                : "border border-zinc-300 text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
            }`}
          >
            Entries
          </button>
          {meta.type === "rally" ? (
            <button
              type="button"
              onClick={() => setActiveTab("starting-order")}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                activeTab === "starting-order"
                  ? "bg-red-700 font-medium text-white dark:bg-red-600"
                  : "border border-zinc-300 text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
              }`}
            >
              Starting order
            </button>
          ) : null}
          {meta.type === "speed" || meta.type === "rally" ? (
            <button
              type="button"
              onClick={() => setActiveTab("timing")}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                activeTab === "timing"
                  ? "bg-red-700 font-medium text-white dark:bg-red-600"
                  : "border border-zinc-300 text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
              }`}
            >
              Timing control
            </button>
          ) : null}
          {meta.type === "rally" ? (
            <button
              type="button"
              onClick={() => setActiveTab("penalties")}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                activeTab === "penalties"
                  ? "bg-red-700 font-medium text-white dark:bg-red-600"
                  : "border border-zinc-300 text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
              }`}
            >
              Penalties
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setActiveTab("notice-board")}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              activeTab === "notice-board"
                ? "bg-red-700 font-medium text-white dark:bg-red-600"
                : "border border-zinc-300 text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
            }`}
          >
            Official Notice Board
          </button>
        </div>
      </section>

      {activeTab === "details" ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Event details
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Name
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              value={meta.name}
              onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Start date
            </label>
            <input
              type="date"
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              value={meta.dateStart.slice(0, 10)}
              onChange={(e) =>
                setMeta((m) => ({ ...m, dateStart: e.target.value }))
              }
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              End date
            </label>
            <input
              type="date"
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              value={meta.dateEnd.slice(0, 10)}
              onChange={(e) =>
                setMeta((m) => ({ ...m, dateEnd: e.target.value }))
              }
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Type
            </label>
            <select
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              value={meta.type}
              onChange={(e) =>
                setMeta((m) => ({
                  ...m,
                  type: e.target.value as EventType,
                }))
              }
            >
              <option value="rally">Rally</option>
              <option value="speed">Speed</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Status
            </label>
            <select
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              value={meta.status}
              onChange={(e) =>
                setMeta((m) => ({
                  ...m,
                  status: e.target.value as EventStatus,
                }))
              }
            >
              <option value="draft">Draft</option>
              <option value="upcoming">Upcoming</option>
              <option value="live">Live</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Location
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              value={meta.location}
              onChange={(e) =>
                setMeta((m) => ({ ...m, location: e.target.value }))
              }
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Rally logo URL
            </label>
            <input
              type="url"
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              value={meta.logoUrl}
              onChange={(e) =>
                setMeta((m) => ({ ...m, logoUrl: e.target.value }))
              }
              placeholder="https://.../logo.png"
            />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800">
                Upload from PC
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadLogoFile(file);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
              {logoUploading ? (
                <span className="text-xs text-zinc-500">Uploading logo…</span>
              ) : null}
              {logoUploadError ? (
                <span className="text-xs text-red-600 dark:text-red-400">
                  {logoUploadError}
                </span>
              ) : null}
            </div>
            {meta.logoUrl.trim() ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={meta.logoUrl.trim()}
                alt="Rally logo preview"
                className="mt-3 h-16 w-auto rounded border border-zinc-200 bg-white p-1 dark:border-zinc-700"
                loading="lazy"
              />
            ) : null}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={saveMeta}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50 dark:bg-red-600"
          >
            {pending ? (
              <span
                className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-r-transparent"
                aria-hidden
              />
            ) : null}
            {pending ? "Saving…" : "Save details"}
          </button>
          <button
            type="button"
            onClick={confirmDelete}
            disabled={pending}
            className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-800 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/50"
          >
            Delete event
          </button>
        </div>
        </section>
      ) : null}

      {activeTab === "notice-board" ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Official Notice Board
            </h2>
            <button
              type="button"
              onClick={saveMeta}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50 dark:bg-red-600"
            >
              {pending ? (
                <span
                  className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-r-transparent"
                  aria-hidden
                />
              ) : null}
              {pending ? "Saving…" : "Save notice board"}
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Upload PDF/DOC files or add links (Supplementary Regulations, Bulletins,
            Steward Decisions, custom categories). Use <strong>Edit</strong> on a row to
            change title, category, or link.
          </p>

          <div className="mt-5 grid gap-4 md:grid-cols-[1fr_auto]">
            <input
              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              placeholder="New custom category (e.g. Competitor Briefing)"
              value={newCustomCategory}
              onChange={(e) => setNewCustomCategory(e.target.value)}
            />
            <button
              type="button"
              onClick={addOfficialNoticeCustomCategory}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600"
            >
              Add category
            </button>
          </div>
          {removableNoticeCategories.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Custom categories
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {removableNoticeCategories.map((cat) => (
                  <li
                    key={cat}
                    className="inline-flex items-center gap-1 rounded-full border border-zinc-300 bg-zinc-50 pl-3 pr-1 py-1 text-sm text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                  >
                    <span>{cat}</span>
                    <button
                      type="button"
                      onClick={() => removeOfficialNoticeCategory(cat)}
                      className="rounded-full px-2 py-0.5 text-xs text-red-700 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-950/50"
                      title={`Delete category "${cat}"`}
                      aria-label={`Delete category ${cat}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Built-in categories cannot be deleted. Deleting a custom category moves its
                documents to Other.
              </p>
            </div>
          ) : null}

          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <input
              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              placeholder="Document title (optional)"
              value={newDocTitle}
              onChange={(e) => setNewDocTitle(e.target.value)}
            />
            <select
              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              value={newDocCategory}
              onChange={(e) => setNewDocCategory(e.target.value)}
            >
              {officialNoticeCategoryOptions.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
            <input
              type="url"
              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              placeholder="https://... (link)"
              value={newDocUrl}
              onChange={(e) => setNewDocUrl(e.target.value)}
            />
            <label
              className={`inline-flex items-center justify-center rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium dark:border-zinc-600 ${
                editingNoticeDocId
                  ? "cursor-not-allowed opacity-50"
                  : "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800"
              }`}
            >
              Upload document
              <input
                type="file"
                accept=".pdf,.doc,.docx,.txt,.rtf,.odt,.xlsx,.xls"
                className="sr-only"
                disabled={Boolean(editingNoticeDocId)}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadOfficialNoticeDocument(file);
                  e.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {editingNoticeDocId ? (
              <>
                <button
                  type="button"
                  onClick={updateOfficialNoticeLink}
                  className="rounded-lg bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 dark:bg-red-600"
                >
                  Update entry
                </button>
                <button
                  type="button"
                  onClick={cancelEditOfficialNoticeDocument}
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600"
                >
                  Cancel edit
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={addOfficialNoticeLink}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600"
              >
                Add link
              </button>
            )}
          </div>
          {editingNoticeDocId ? (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              Editing an existing entry — change the link (and title/category if needed),
              then click Update entry.
            </p>
          ) : null}
          {docUploading ? (
            <p className="mt-2 text-xs text-zinc-500">Uploading document…</p>
          ) : null}
          {docUploadError ? (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{docUploadError}</p>
          ) : null}

          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-700">
                  <th className="pb-2 pr-2">Category</th>
                  <th className="pb-2 pr-2">Title</th>
                  <th className="pb-2 pr-2">File / Link</th>
                  <th className="pb-2 pr-2">Uploaded</th>
                  <th className="pb-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {meta.officialNoticeDocuments.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400"
                    >
                      No documents uploaded yet.
                    </td>
                  </tr>
                ) : (
                  [...meta.officialNoticeDocuments]
                    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
                    .map((doc) => (
                      <tr
                        key={doc.id}
                        className={`border-b border-zinc-100 dark:border-zinc-800 ${
                          editingNoticeDocId === doc.id
                            ? "bg-amber-50/80 dark:bg-amber-950/30"
                            : ""
                        }`}
                      >
                        <td className="py-2 pr-2">{doc.category}</td>
                        <td className="py-2 pr-2">{doc.title}</td>
                        <td className="py-2 pr-2">
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noreferrer"
                            className="break-all text-blue-700 hover:underline dark:text-blue-400"
                          >
                            {doc.fileName || doc.url}
                          </a>
                        </td>
                        <td className="py-2 pr-2 text-xs text-zinc-500 dark:text-zinc-400">
                          {new Date(doc.uploadedAt).toLocaleString()}
                        </td>
                        <td className="py-2 text-right">
                          <div className="flex flex-wrap justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => startEditOfficialNoticeDocument(doc)}
                              className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => removeOfficialNoticeDocument(doc.id)}
                              className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === "stages" ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Stages
          </h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={addStage}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600"
            >
              Add stage
            </button>
            <button
              type="button"
              onClick={saveStages}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {pending ? (
                <span
                  className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-r-transparent dark:border-zinc-900 dark:border-r-transparent"
                  aria-hidden
                />
              ) : null}
              {pending ? "Saving…" : "Save stages"}
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          <strong>Bar status</strong> drives the public Stage results strip:
          not started (yellow), live (green), completed (red). ALGE can update
          this later via API. <strong>Leg</strong> groups stages on the public
          Itinerary (same number = same leg).
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-700">
                <th className="pb-2 pr-2">#</th>
                <th className="pb-2 pr-2">Name</th>
                <th className="pb-2 pr-2 w-16">Leg</th>
                {meta.type === "rally" ? (
                  <th className="pb-2 pr-2">Distance (km)</th>
                ) : null}
                {meta.type === "rally" ? (
                  <th className="pb-2 pr-2">1st car start</th>
                ) : null}
                {meta.type === "rally" ? (
                  <th className="pb-2 pr-2">Bar status</th>
                ) : null}
                <th className="pb-2">Order</th>
                <th className="pb-2 w-28" />
              </tr>
            </thead>
            <tbody>
              {sortedStages.map((s, idx) => (
                <tr
                  key={s.id}
                  className="border-b border-zinc-100 dark:border-zinc-800"
                >
                  <td className="py-2 pr-2 text-zinc-500">{idx + 1}</td>
                  <td className="py-2 pr-2">
                    <input
                      className="w-full min-w-[8rem] rounded border border-zinc-200 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                      value={s.name}
                      onChange={(e) =>
                        setStages((prev) =>
                          prev.map((x) =>
                            x.id === s.id ? { ...x, name: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      className="w-14 rounded border border-zinc-200 px-2 py-1 text-center dark:border-zinc-700 dark:bg-zinc-950"
                      value={s.leg}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const n =
                          raw === ""
                            ? 1
                            : Math.max(1, Math.floor(Number.parseInt(raw, 10) || 1));
                        setStages((prev) =>
                          prev.map((x) =>
                            x.id === s.id ? { ...x, leg: n } : x,
                          ),
                        );
                      }}
                      title="Itinerary leg (1, 2, …)"
                      aria-label="Leg number"
                    />
                  </td>
                  {meta.type === "rally" ? (
                    <td className="py-2 pr-2">
                      <input
                        type="number"
                        step="0.01"
                        className="w-24 rounded border border-zinc-200 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                        value={s.distanceKm ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          setStages((prev) =>
                            prev.map((x) =>
                              x.id === s.id
                                ? {
                                    ...x,
                                    distanceKm:
                                      v === "" ? null : Number.parseFloat(v),
                                  }
                                : x,
                            ),
                          );
                        }}
                      />
                    </td>
                  ) : null}
                  {meta.type === "rally" ? (
                    <td className="py-2 pr-2">
                      <input
                        type="time"
                        step={60}
                        className="w-[7.5rem] rounded border border-zinc-200 px-2 py-1 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
                        value={s.firstCarStartTime ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          setStages((prev) =>
                            prev.map((x) =>
                              x.id === s.id
                                ? {
                                    ...x,
                                    firstCarStartTime: v === "" ? null : v,
                                  }
                                : x,
                            ),
                          );
                        }}
                        title="Time the first car starts this stage (local)"
                      />
                    </td>
                  ) : null}
                  {meta.type === "rally" ? (
                    <td className="py-2 pr-2">
                      <select
                        className="w-full min-w-[9rem] rounded border border-zinc-200 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                        value={s.progressStatus ?? "pending"}
                        onChange={(e) =>
                          setStages((prev) =>
                            prev.map((x) =>
                              x.id === s.id
                                ? {
                                    ...x,
                                    progressStatus: e.target
                                      .value as StageProgressStatus,
                                  }
                                : x,
                            ),
                          )
                        }
                      >
                        <option value="pending">Not started (yellow)</option>
                        <option value="live">Live (green)</option>
                        <option value="completed">Completed (red)</option>
                      </select>
                    </td>
                  ) : null}
                  <td className="py-2 text-zinc-500">{s.order}</td>
                  <td className="py-2">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="rounded border border-zinc-200 px-2 py-0.5 text-xs dark:border-zinc-700"
                        onClick={() => moveStage(s.id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="rounded border border-zinc-200 px-2 py-0.5 text-xs dark:border-zinc-700"
                        onClick={() => moveStage(s.id, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-800 dark:border-red-900 dark:text-red-400"
                        onClick={() => removeStage(s.id)}
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sortedStages.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500">No stages yet.</p>
          ) : null}
        </div>
        </section>
      ) : null}

      {activeTab === "entries" ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Entries
          </h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={addEntry}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600"
            >
              Add crew
            </button>
            <label className="inline-flex cursor-pointer items-center rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800">
              Import Excel
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importEntriesFromExcel(file);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            <button
              type="button"
              onClick={saveEntries}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {pending ? (
                <span
                  className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-r-transparent dark:border-zinc-900 dark:border-r-transparent"
                  aria-hidden
                />
              ) : null}
              {pending ? "Saving…" : "Save entries"}
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          <strong>Drv / Co nationality</strong> are optional. Pick a country
          (flag + name) from the list, or choose &quot;Other&quot; to type a
          2-letter ISO code. The public site shows the flag next to each name
          when set.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-700">
                <th className="pb-2 pr-2">#</th>
                <th className="pb-2 pr-2">Entrance</th>
                <th className="pb-2 pr-1" title="Optional — driver nationality">
                  Drv
                </th>
                <th className="pb-2 pr-1" title="Optional — co-driver nationality">
                  Co
                </th>
                <th className="pb-2 pr-2">Driver</th>
                <th className="pb-2 pr-2">Co-driver</th>
                <th className="pb-2 pr-2">Car</th>
                <th className="pb-2 pr-2">Class</th>
                <th className="pb-2 pr-2">Start</th>
                <th className="pb-2 w-12" />
              </tr>
            </thead>
            <tbody>
              {entries
                .slice()
                .sort((a, b) => a.startNumber - b.startNumber)
                .map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="py-2 pr-2">
                      <input
                        type="number"
                        className="w-14 rounded border border-zinc-200 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                        value={row.startNumber}
                        onChange={(e) => {
                          const n = Number.parseInt(e.target.value, 10);
                          setEntries((prev) =>
                            prev.map((x) =>
                              x.id === row.id
                                ? {
                                    ...x,
                                    startNumber: Number.isNaN(n) ? 0 : n,
                                  }
                                : x,
                            ),
                          );
                        }}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        className="w-24 rounded border border-zinc-200 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                        value={row.entrance}
                        onChange={(e) =>
                          setEntries((prev) =>
                            prev.map((x) =>
                              x.id === row.id
                                ? { ...x, entrance: e.target.value }
                                : x,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="py-2 pr-1 align-top">
                      <AdminCountrySelect
                        value={row.driverCountryCode}
                        onChange={(code) =>
                          setEntries((prev) =>
                            prev.map((x) =>
                              x.id === row.id
                                ? { ...x, driverCountryCode: code }
                                : x,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="py-2 pr-1 align-top">
                      <AdminCountrySelect
                        value={row.coDriverCountryCode}
                        onChange={(code) =>
                          setEntries((prev) =>
                            prev.map((x) =>
                              x.id === row.id
                                ? { ...x, coDriverCountryCode: code }
                                : x,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        className="w-full min-w-[6rem] rounded border border-zinc-200 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                        value={row.driver}
                        onChange={(e) =>
                          setEntries((prev) =>
                            prev.map((x) =>
                              x.id === row.id
                                ? { ...x, driver: e.target.value }
                                : x,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        className="w-full min-w-[6rem] rounded border border-zinc-200 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                        value={row.coDriver}
                        onChange={(e) =>
                          setEntries((prev) =>
                            prev.map((x) =>
                              x.id === row.id
                                ? { ...x, coDriver: e.target.value }
                                : x,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        className="w-full min-w-[6rem] rounded border border-zinc-200 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                        value={row.car}
                        onChange={(e) =>
                          setEntries((prev) =>
                            prev.map((x) =>
                              x.id === row.id ? { ...x, car: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        className="w-20 rounded border border-zinc-200 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                        value={row.class}
                        onChange={(e) =>
                          setEntries((prev) =>
                            prev.map((x) =>
                              x.id === row.id
                                ? { ...x, class: e.target.value }
                                : x,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <select
                        className="w-16 rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
                        value={row.start ? "yes" : "no"}
                        onChange={(e) =>
                          setEntries((prev) =>
                            prev.map((x) =>
                              x.id === row.id
                                ? { ...x, start: e.target.value === "yes" }
                                : x,
                            ),
                          )
                        }
                      >
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        className="text-xs text-red-700 dark:text-red-400"
                        onClick={() => removeEntry(row.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {entries.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500">No entries yet.</p>
          ) : null}
        </div>
        </section>
      ) : null}

      {meta.type === "rally" && activeTab === "starting-order" ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Starting order
            </h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={loadStartingOrderFromEntries}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600"
              >
                Load from entries
              </button>
              <button
                type="button"
                onClick={printCurrentStartingOrder}
                disabled={startingOrderRows.length === 0}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-zinc-600"
              >
                Print PDF
              </button>
              <button
                type="button"
                onClick={saveStartingOrder}
                disabled={pending}
                className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {pending ? (
                  <span
                    className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-r-transparent dark:border-zinc-900 dark:border-r-transparent"
                    aria-hidden
                  />
                ) : null}
                {pending ? "Saving…" : "Save starting order"}
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Load crews with <strong>Start = Yes</strong>, set first-car time and interval, then
            edit any car&apos;s start time manually when the gap differs (e.g. 4 min). Use{" "}
            <strong>Apply interval to all</strong> to clear manual edits and recalculate.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {availableLegs.map((leg) => (
              <button
                key={leg}
                type="button"
                onClick={() => setStartingOrderLeg(leg)}
                className={`rounded-lg px-3 py-1.5 text-sm ${
                  startingOrderLeg === leg
                    ? "bg-red-700 font-medium text-white dark:bg-red-600"
                    : "border border-zinc-300 text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
                }`}
              >
                LEG {leg}
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Who starts first
              <select
                className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                value={startingOrderRows[0]?.id ?? ""}
                disabled={startingOrderRows.length === 0}
                onChange={(e) => {
                  const id = e.target.value;
                  if (id) setStartingOrderFirst(id);
                }}
              >
                {startingOrderRows.length === 0 ? (
                  <option value="">Load entries first</option>
                ) : (
                  startingOrderRows.map((row) => (
                    <option key={row.id} value={row.id}>
                      #{row.startNumber} {row.driver || "—"}
                      {row.coDriver ? ` / ${row.coDriver}` : ""}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              First car start time
              <input
                type="time"
                step={60}
                className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                value={currentLegStartingOrder.firstCarStartTime || "09:00"}
                onChange={(e) =>
                  patchCurrentLegStartingOrder({ firstCarStartTime: e.target.value })
                }
              />
            </label>
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Interval (minutes)
              <div className="mt-1 flex gap-2">
                <input
                  type="number"
                  min={0}
                  step={1}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  value={currentLegStartingOrder.intervalMinutes}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10);
                    patchCurrentLegStartingOrder({
                      intervalMinutes: Number.isFinite(n) && n >= 0 ? n : 0,
                    });
                  }}
                />
                <button
                  type="button"
                  onClick={applyIntervalToAllStartTimes}
                  disabled={startingOrderRows.length === 0}
                  className="shrink-0 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
                  title="Recalculate every start time from first car + interval (clears manual edits)"
                >
                  Apply to all
                </button>
              </div>
            </label>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-700">
                  <th className="pb-2 pr-2">Pos</th>
                  <th className="pb-2 pr-2">#</th>
                  <th className="pb-2 pr-2">Driver</th>
                  <th className="pb-2 pr-2">Co-driver</th>
                  <th className="pb-2 pr-2">Car</th>
                  <th className="pb-2 pr-2 text-center">Class</th>
                  <th className="pb-2 pr-2 text-center">Start time</th>
                  <th className="pb-2 w-36" />
                </tr>
              </thead>
              <tbody>
                {startingOrderRows.map((row, index) => (
                  <tr
                    key={row.id}
                    className="border-b border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="py-2 pr-2 font-mono text-zinc-700 dark:text-zinc-200">
                      {index + 1}
                    </td>
                    <td className="py-2 pr-2 font-mono text-zinc-900 dark:text-zinc-100">
                      {row.startNumber}
                    </td>
                    <td className="py-2 pr-2">{row.driver || "—"}</td>
                    <td className="py-2 pr-2">{row.coDriver || "—"}</td>
                    <td className="py-2 pr-2">{row.car || "—"}</td>
                    <td className="py-2 pr-2 text-center">{row.class || "—"}</td>
                    <td className="py-2 pr-2 text-center">
                      <input
                        type="time"
                        step={60}
                        className="mx-auto w-[7.5rem] rounded border border-zinc-200 px-2 py-1 text-center font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
                        value={resolveStartingOrderTime(
                          currentLegStartingOrder,
                          row.id,
                          index,
                        )}
                        onChange={(e) =>
                          setManualStartingOrderTime(row.id, e.target.value)
                        }
                        title={
                          currentLegStartingOrder.startTimeByEntryId?.[row.id]
                            ? "Manual start time (saved with starting order)"
                            : "Auto from first car + interval — edit to override"
                        }
                      />
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className="rounded border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-600"
                          onClick={() => moveStartingOrderEntry(row.id, -1)}
                          disabled={index === 0}
                          title="Move up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="rounded border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-600"
                          onClick={() => moveStartingOrderEntry(row.id, 1)}
                          disabled={index === startingOrderRows.length - 1}
                          title="Move down"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="rounded border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-600"
                          onClick={() => setStartingOrderFirst(row.id)}
                          disabled={index === 0}
                          title="Start first"
                        >
                          1st
                        </button>
                        <button
                          type="button"
                          className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-700 dark:border-red-900 dark:text-red-400"
                          onClick={() => removeFromStartingOrder(row.id)}
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {startingOrderRows.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-500">
                No starting order yet. Click <strong>Load from entries</strong> to import
                crews with Start = Yes.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {(meta.type === "speed" || meta.type === "rally") && activeTab === "timing" ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Timing control
            </h2>
            <button
              type="button"
              onClick={saveTiming}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {pending ? (
                <span
                  className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-r-transparent dark:border-zinc-900 dark:border-r-transparent"
                  aria-hidden
                />
              ) : null}
              {pending ? "Saving…" : "Save Times"}
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {meta.type === "speed" ? (
              <>
                <button
                  type="button"
                  onClick={() => setTimingRun("trial")}
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    timingRun === "trial"
                      ? "bg-red-700 font-medium text-white dark:bg-red-600"
                      : "border border-zinc-300 text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
                  }`}
                >
                  Trial
                </button>
                <button
                  type="button"
                  onClick={() => setTimingRun("run1")}
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    timingRun === "run1"
                      ? "bg-red-700 font-medium text-white dark:bg-red-600"
                      : "border border-zinc-300 text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
                  }`}
                >
                  1st Run
                </button>
                <button
                  type="button"
                  onClick={() => setTimingRun("run2")}
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    timingRun === "run2"
                      ? "bg-red-700 font-medium text-white dark:bg-red-600"
                      : "border border-zinc-300 text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
                  }`}
                >
                  2nd Run
                </button>
              </>
            ) : sortedStages.length > 0 ? (
              sortedStages.map((stage) => {
                const active = (selectedRallyTimingStage?.id ?? "") === stage.id;
                return (
                  <button
                    key={stage.id}
                    type="button"
                    onClick={() => setRallyTimingStageId(stage.id)}
                    className={`rounded-lg px-3 py-1.5 text-sm ${
                      active
                        ? "bg-red-700 font-medium text-white dark:bg-red-600"
                        : "border border-zinc-300 text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
                    }`}
                  >
                    SS {stage.order}
                  </button>
                );
              })
            ) : (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                Add stages first to enter rally timings.
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Enter start and finish times for each driver on{" "}
            {meta.type === "speed"
              ? timingRunLabel
              : selectedRallyTimingStage
                ? `SS ${selectedRallyTimingStage.order} (${selectedRallyTimingStage.name})`
                : "the selected stage"}
            This tab stores all timing values with entries.
          </p>
          {meta.type === "speed" ? (
            <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
              {timingRunLabel} import gate:{" "}
              <strong className="capitalize">{timingRunStatus}</strong>
              {timingRunStatus === "live"
                ? " — ALGE stream triggers apply to this run."
                : " — ALGE triggers off; enter times manually (set Live below for ALGE)."}
            </p>
          ) : null}
          {meta.type === "rally" && selectedRallyTimingStage ? (
            <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
              Stage status:{" "}
              <strong className="capitalize">
                {selectedRallyTimingStage.progressStatus}
              </strong>
              {selectedRallyTimingStage.progressStatus === "live"
                ? " — ALGE triggers apply; change on the Stages tab if needed."
                : " — ALGE triggers off; enter times manually (set Live on the Stages tab for ALGE)."}
            </p>
          ) : null}
          {meta.type === "rally" && selectedRallyTimingStage ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={openAssignStartTimesModal}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Assign start times
              </button>
            </div>
          ) : null}
          <>
            {meta.type === "speed" ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Import status
                </label>
                <select
                  className="rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  value={timingRunStatus}
                  onChange={(e) =>
                    setMeta((m) => ({
                      ...m,
                      speedRunImportStatus: {
                        ...m.speedRunImportStatus,
                        [timingRun]: e.target.value as SpeedRunImportStatus,
                      },
                    }))
                  }
                >
                  <option value="scheduled">Scheduled</option>
                  <option value="live">Live</option>
                  <option value="completed">Completed</option>
                </select>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Live: ALGE stream can apply times. Scheduled or Completed: use manual
                  fields only; triggers are ignored.
                </span>
              </div>
            ) : (
              <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                ALGE triggers apply only when the selected stage&apos;s status is{" "}
                <strong>Live</strong> (set on the Stages tab). If the stage is{" "}
                <strong>Completed</strong> or <strong>pending</strong>, enter times
                manually; stream triggers are ignored. Finish device IDs are saved per stage
                so multiple Live stages can use different finish devices at the same time.
              </p>
            )}
            {meta.type === "speed" ? (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Start Device ID
                  </label>
                  <input
                    className="mt-1 w-36 rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    value={algeStartDeviceId}
                    onChange={(e) => setAlgeStartDeviceId(e.target.value)}
                    placeholder="190801013"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Start Channel
                  </label>
                  <input
                    className="mt-1 w-20 rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    value={algeStartChannelId}
                    onChange={(e) => setAlgeStartChannelId(e.target.value)}
                    placeholder="0"
                  />
                </div>
              </div>
            ) : selectedRallyTimingStage ? (
              <div className="mt-3 rounded border border-zinc-200 p-3 dark:border-zinc-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    ALGE finish line for SS {selectedRallyTimingStage.order}
                  </p>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[11px] font-medium ${
                        rallyStageAlgeConfigDirty
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-zinc-400 dark:text-zinc-500"
                      }`}
                    >
                      {rallyStageAlgeConfigDirty ? "Unsaved changes" : "Saved"}
                    </span>
                    <button
                      type="button"
                      onClick={saveMeta}
                      disabled={pending || !rallyStageAlgeConfigDirty}
                      className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      Save device
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div>
                    <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Finish Device ID
                    </label>
                    <input
                      className="mt-1 w-36 rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      value={selectedRallyStageAlgeConfig.finishDeviceId}
                      onChange={(e) =>
                        updateRallyStageAlgeConfig(selectedRallyTimingStage.id, {
                          finishDeviceId: e.target.value,
                        })
                      }
                      placeholder="250440049"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Finish Channel
                    </label>
                    <input
                      className="mt-1 w-20 rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      value={selectedRallyStageAlgeConfig.finishChannelId}
                      onChange={(e) =>
                        updateRallyStageAlgeConfig(selectedRallyTimingStage.id, {
                          finishChannelId: e.target.value,
                        })
                      }
                      placeholder="1"
                    />
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Save the device before connecting the stream so triggers are kept
                  if you reload the page.
                </p>
              </div>
            ) : null}
            {meta.type === "rally" ? (
              <div className="mt-3 rounded border border-zinc-200 p-3 dark:border-zinc-700">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Configured devices
                </p>
                {sortedStages.filter(
                  (s) => meta.rallyStageAlgeConfig[s.id]?.finishDeviceId?.trim(),
                ).length === 0 ? (
                  <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    No SS has a finish device set. Pick an SS above, set its
                    Finish Device ID and click Save device.
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-zinc-200 text-sm dark:divide-zinc-700">
                    {sortedStages
                      .filter(
                        (s) =>
                          meta.rallyStageAlgeConfig[s.id]?.finishDeviceId?.trim(),
                      )
                      .map((s) => {
                        const cfg = meta.rallyStageAlgeConfig[s.id]!;
                        const liveBadge =
                          s.progressStatus === "live" ? (
                            <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-green-800 dark:bg-green-900 dark:text-green-300">
                              Live
                            </span>
                          ) : (
                            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                              {s.progressStatus}
                            </span>
                          );
                        return (
                          <li
                            key={s.id}
                            className="flex flex-wrap items-center justify-between gap-2 py-1.5"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-medium">SS {s.order}</span>
                              {liveBadge}
                              <span className="font-mono text-zinc-700 dark:text-zinc-200">
                                {cfg.finishDeviceId}
                              </span>
                              <span className="text-xs text-zinc-500">
                                ch {cfg.finishChannelId || "1"}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setRallyTimingStageId(s.id)}
                                className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  updateRallyStageAlgeConfig(s.id, {
                                    finishDeviceId: "",
                                  })
                                }
                                className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/30"
                              >
                                Remove
                              </button>
                            </div>
                          </li>
                        );
                      })}
                  </ul>
                )}
                <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Connect stream subscribes to every SS listed here on the same
                  endpoint. Triggers are accepted only when the SS is Live.
                </p>
              </div>
            ) : null}
            {meta.type === "speed" ? (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Finish Device ID
                  </label>
                  <input
                    className="mt-1 w-36 rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    value={algeFinishDeviceId}
                    onChange={(e) => setAlgeFinishDeviceId(e.target.value)}
                    placeholder="190801013"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Finish Channel
                  </label>
                  <input
                    className="mt-1 w-20 rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    value={algeFinishChannelId}
                    onChange={(e) => setAlgeFinishChannelId(e.target.value)}
                    placeholder="1"
                  />
                </div>
              </div>
            ) : null}
            <div className="mt-3 rounded border border-zinc-200 p-3 dark:border-zinc-700">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Live trigger stream (STOMP/SockJS)
                </p>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div>
                    <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Endpoint
                    </label>
                    <input
                      className="mt-1 w-80 rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      value={algeWsEndpoint}
                      onChange={(e) => setAlgeWsEndpoint(e.target.value)}
                      placeholder="https://www.alge-results.com/devices"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Topic (optional)
                    </label>
                    <input
                      className="mt-1 w-80 rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      value={algeWsTopic}
                      onChange={(e) => setAlgeWsTopic(e.target.value)}
                      placeholder="/topic/device/190801013/trigger"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Token (optional)
                    </label>
                    <input
                      className="mt-1 w-72 rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      value={algeWsToken}
                      onChange={(e) => setAlgeWsToken(e.target.value)}
                      placeholder="authorization token"
                    />
                  </div>
                  {!streamConnected ? (
                    <button
                      type="button"
                      onClick={connectStompStream}
                      disabled={pending}
                      className="rounded-lg border border-green-300 px-3 py-1.5 text-sm text-green-700 dark:border-green-700 dark:text-green-400"
                    >
                      Connect stream
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={disconnectStompStream}
                      className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 dark:border-red-800 dark:text-red-400"
                    >
                      Disconnect stream
                    </button>
                  )}
                </div>
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  Status: {streamInfo}
                </p>
                {streamLastPayload ? (
                  <pre className="mt-2 max-h-32 overflow-auto rounded bg-zinc-50 p-2 text-[11px] text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                    {streamLastPayload}
                  </pre>
                ) : null}
            </div>
          </>
          <div className="mt-4 space-y-3 sm:hidden">
            {entries
              .slice()
              .sort((a, b) => a.startNumber - b.startNumber)
              .map((row) => {
                const { startValue, finishValue, penaltyValue } =
                  getTimingValuesForEntry(row);
                const outcome = parseTimingOutcome(startValue, finishValue);
                return (
                  <div
                    key={`mobile-${timingRun}-${row.id}`}
                    className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="font-mono text-sm text-zinc-600 dark:text-zinc-300">
                        #{row.startNumber}
                      </p>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                          {row.driver || "—"}
                        </p>
                        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                          {row.coDriver || "—"}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                        Start
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?([.,]\d{1,3})?$"
                          placeholder="HH:mm:ss.cc"
                          className="mt-1 w-full rounded border border-zinc-200 px-2 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
                          value={startValue}
                          onChange={(e) =>
                            applyTimingEntryUpdate((prev) =>
                              prev.map((x) =>
                                x.id === row.id
                                  ? updateEntryTimingValues(
                                      x,
                                      e.target.value.trim(),
                                      getTimingValuesForEntry(x).finishValue,
                                    )
                                  : x,
                              ),
                            )
                          }
                          title="24-hour format: HH:mm, HH:mm:ss or HH:mm:ss.cc"
                        />
                      </label>
                      <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                        Finish
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?([.,]\d{1,3})?$"
                          placeholder="HH:mm:ss.cc"
                          className="mt-1 w-full rounded border border-zinc-200 px-2 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
                          value={finishValue}
                          onChange={(e) =>
                            applyTimingEntryUpdate((prev) =>
                              prev.map((x) =>
                                x.id === row.id
                                  ? updateEntryTimingValues(
                                      x,
                                      getTimingValuesForEntry(x).startValue,
                                      e.target.value.trim(),
                                    )
                                  : x,
                              ),
                            )
                          }
                          title="24-hour format: HH:mm, HH:mm:ss or HH:mm:ss.cc"
                        />
                      </label>
                    </div>
                    <p className="mt-2 font-mono text-sm text-zinc-700 dark:text-zinc-200">
                      Total:{" "}
                      {computeTotalTime(startValue, finishValue, penaltyValue)}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setTimingOutcomeForEntry(row.id, "dnf", outcome)}
                        className={`rounded border px-3 py-2 text-sm font-medium ${
                          outcome === "dnf"
                            ? "border-green-600 bg-green-600 text-white dark:border-green-500 dark:bg-green-500"
                            : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        }`}
                      >
                        DNF
                      </button>
                      <button
                        type="button"
                        onClick={() => setTimingOutcomeForEntry(row.id, "ret", outcome)}
                        className={`rounded border px-3 py-2 text-sm font-medium ${
                          outcome === "ret"
                            ? "border-green-600 bg-green-600 text-white dark:border-green-500 dark:bg-green-500"
                            : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        }`}
                      >
                        RET
                      </button>
                    </div>
                    {meta.type === "rally" ? (
                      <div className="mt-2 grid grid-cols-1 gap-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                          Penalty
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="^\\d{1,3}:[0-5]\\d$"
                            placeholder="mm:ss"
                            title="Penalty format: mm:ss"
                            className="mt-1 w-full rounded border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                            value={penaltyValue}
                            onChange={(e) =>
                              applyTimingEntryUpdate((prev) =>
                                prev.map((x) =>
                                  x.id === row.id
                                    ? updateEntryTimingPenaltyValues(
                                        x,
                                        normalizePenaltyInput(e.target.value),
                                        getTimingValuesForEntry(x).penaltyNoteValue,
                                      )
                                    : x,
                                ),
                              )
                            }
                          />
                        </label>
                      </div>
                    ) : null}
                  </div>
                );
              })}
          </div>
          <div className="mt-4 hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-700">
                  <th className="pb-2 pr-2 w-14">#</th>
                  <th className="pb-2 pr-2">
                    {meta.type === "rally" ? "Crew" : "Driver"}
                  </th>
                  <th className="pb-2 pr-2 w-24">Start</th>
                  <th className="pb-2 pr-2 w-40">Finish</th>
                  <th className="pb-2 pr-2 w-36">Total time</th>
                  <th className="pb-2 pr-2 w-28">Status</th>
                  {meta.type === "rally" ? (
                    <th className="pb-2 pr-2 w-24">Penalty</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {entries
                  .slice()
                  .sort((a, b) => a.startNumber - b.startNumber)
                  .map((row) => {
                    const { startValue, finishValue, penaltyValue } =
                      getTimingValuesForEntry(row);
                    const outcome = parseTimingOutcome(startValue, finishValue);
                    return (
                      <tr
                        key={`${timingRun}-${row.id}`}
                        className="border-b border-zinc-100 dark:border-zinc-800"
                      >
                      <td className="py-2 pr-2 font-mono text-zinc-600 dark:text-zinc-300">
                        {row.startNumber}
                      </td>
                      <td className="py-2 pr-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                            {row.driver || "—"}
                          </p>
                          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                            {row.coDriver || "—"}
                          </p>
                        </div>
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?([.,]\d{1,3})?$"
                          placeholder="HH:mm:ss.cc"
                          className="w-24 rounded border border-zinc-200 px-2 py-1 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
                          value={startValue}
                          onChange={(e) =>
                            applyTimingEntryUpdate((prev) =>
                              prev.map((x) =>
                                x.id === row.id
                                  ? updateEntryTimingValues(
                                      x,
                                      e.target.value.trim(),
                                      getTimingValuesForEntry(x).finishValue,
                                    )
                                  : x,
                              ),
                            )
                          }
                          title="24-hour format: HH:mm, HH:mm:ss or HH:mm:ss.cc"
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?([.,]\d{1,3})?$"
                          placeholder="HH:mm:ss.cc"
                          className="w-40 rounded border border-zinc-200 px-2 py-1 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
                          value={finishValue}
                          onChange={(e) =>
                            applyTimingEntryUpdate((prev) =>
                              prev.map((x) =>
                                x.id === row.id
                                  ? updateEntryTimingValues(
                                      x,
                                      getTimingValuesForEntry(x).startValue,
                                      e.target.value.trim(),
                                    )
                                  : x,
                              ),
                            )
                          }
                          title="24-hour format: HH:mm, HH:mm:ss or HH:mm:ss.cc"
                        />
                      </td>
                      <td className="py-2 pr-2 font-mono text-zinc-700 dark:text-zinc-200">
                        {computeTotalTime(startValue, finishValue, penaltyValue)}
                      </td>
                      <td className="py-2 pr-2">
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            onClick={() => setTimingOutcomeForEntry(row.id, "dnf", outcome)}
                            className={`rounded border px-2 py-1 text-xs font-medium ${
                              outcome === "dnf"
                                ? "border-green-600 bg-green-600 text-white dark:border-green-500 dark:bg-green-500"
                                : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                            }`}
                          >
                            DNF
                          </button>
                          <button
                            type="button"
                            onClick={() => setTimingOutcomeForEntry(row.id, "ret", outcome)}
                            className={`rounded border px-2 py-1 text-xs font-medium ${
                              outcome === "ret"
                                ? "border-green-600 bg-green-600 text-white dark:border-green-500 dark:bg-green-500"
                                : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                            }`}
                          >
                            RET
                          </button>
                        </div>
                      </td>
                      {meta.type === "rally" ? (
                        <td className="py-2 pr-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="^\\d{1,3}:[0-5]\\d$"
                            placeholder="mm:ss"
                            title="Penalty format: mm:ss"
                            className="w-full rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                            value={penaltyValue}
                            onChange={(e) =>
                              applyTimingEntryUpdate((prev) =>
                                prev.map((x) =>
                                  x.id === row.id
                                    ? updateEntryTimingPenaltyValues(
                                        x,
                                        normalizePenaltyInput(e.target.value),
                                        getTimingValuesForEntry(x).penaltyNoteValue,
                                      )
                                    : x,
                                ),
                              )
                            }
                          />
                        </td>
                      ) : null}
                    </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          {meta.type === "rally" && showAssignStartModal ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Assign start times
                </h3>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Set first-car start and interval for a car range on the selected stage.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    From car
                    <input
                      type="number"
                      min={1}
                      className="mt-1 w-full rounded border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      value={assignStartFromCar}
                      onChange={(e) => setAssignStartFromCar(e.target.value)}
                    />
                  </label>
                  <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    To car
                    <input
                      type="number"
                      min={1}
                      className="mt-1 w-full rounded border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      value={assignStartToCar}
                      onChange={(e) => setAssignStartToCar(e.target.value)}
                    />
                  </label>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Car {assignStartFromCar || "1"} start
                    <input
                      type="time"
                      step={60}
                      className="mt-1 w-full rounded border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      value={assignStartFirstTime}
                      onChange={(e) => setAssignStartFirstTime(e.target.value)}
                    />
                  </label>
                  <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Interval (min)
                    <input
                      type="number"
                      min={0}
                      className="mt-1 w-full rounded border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      value={assignStartIntervalMin}
                      onChange={(e) => setAssignStartIntervalMin(e.target.value)}
                    />
                  </label>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAssignStartModal(false)}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={applyBulkStartTimes}
                    className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 dark:bg-red-600"
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-700">
            {meta.type === "rally" ? (
              <div className="mr-auto flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!selectedRallyTimingStage}
                  onClick={() => {
                    if (!selectedRallyTimingStage) return;
                    void exportRallyStageExcel(
                      meta.name || "event",
                      entries,
                      selectedRallyTimingStage,
                    );
                  }}
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
                >
                  Export SS Excel
                </button>
                <button
                  type="button"
                  disabled={!selectedRallyTimingStage}
                  onClick={() => {
                    if (!selectedRallyTimingStage) return;
                    const upTo = [...stages]
                      .sort((a, b) => a.order - b.order)
                      .filter((s) => s.order <= selectedRallyTimingStage.order);
                    void exportRallyAfterSsExcel(meta.name || "event", entries, upTo);
                  }}
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
                >
                  Export After SS Excel
                </button>
                {(() => {
                  const legs = [
                    ...new Set(
                      stages
                        .map((s) => s.leg)
                        .filter((n) => Number.isFinite(n) && n >= 1),
                    ),
                  ].sort((a, b) => a - b);
                  return legs.map((leg) => {
                    const stagesInLeg = stages
                      .filter((s) => s.leg === leg)
                      .sort((a, b) => a.order - b.order);
                    return (
                      <button
                        key={`excel-leg-${leg}`}
                        type="button"
                        disabled={stagesInLeg.length === 0}
                        onClick={() =>
                          void exportRallyLegExcel(
                            meta.name || "event",
                            entries,
                            stagesInLeg,
                            leg,
                          )
                        }
                        className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
                      >
                        Export LEG{leg} Excel
                      </button>
                    );
                  });
                })()}
                <button
                  type="button"
                  onClick={() =>
                    void exportRallyFinalExcel(
                      meta.name || "event",
                      entries,
                      [...stages].sort((a, b) => a.order - b.order),
                    )
                  }
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
                >
                  Export Final Excel
                </button>
              </div>
            ) : null}
            <button
              type="button"
              onClick={saveTiming}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {pending ? (
                <span
                  className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-r-transparent dark:border-zinc-900 dark:border-r-transparent"
                  aria-hidden
                />
              ) : null}
              {pending ? "Saving…" : "Save Times"}
            </button>
          </div>
        </section>
      ) : null}
      {meta.type === "rally" && activeTab === "penalties" ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Penalties
              </h2>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Event penalties (not jump starts). Choose After SS where each
                applies — included in that After SS / later totals and Final
                Results. Not shown on individual SS stage results. Same car can
                have multiple lines.
              </p>
            </div>
            <button
              type="button"
              onClick={savePenalties}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {pending ? (
                <span
                  className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-r-transparent dark:border-zinc-900 dark:border-r-transparent"
                  aria-hidden
                />
              ) : null}
              {pending ? "Saving…" : "Save penalties"}
            </button>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-700">
                  <th className="pb-2 pr-2 w-24">Car Number</th>
                  <th className="pb-2 pr-2 w-24">Penalty</th>
                  <th className="pb-2 pr-2 w-36">Applies After</th>
                  <th className="pb-2 pr-2">Reason</th>
                  <th className="pb-2 w-20 text-right"> </th>
                </tr>
              </thead>
              <tbody>
                {penaltyLines.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400"
                    >
                      No penalties yet. Click &quot;Add penalty&quot; to create a line.
                    </td>
                  </tr>
                ) : (
                  penaltyLines.map((line) => (
                    <tr
                      key={line.id}
                      className="border-b border-zinc-100 dark:border-zinc-800"
                    >
                      <td className="py-2 pr-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="#"
                          className="w-full rounded border border-zinc-200 px-2 py-1 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
                          value={line.carNumber}
                          onChange={(e) =>
                            setPenaltyLines((prev) =>
                              prev.map((x) =>
                                x.id === line.id
                                  ? {
                                      ...x,
                                      carNumber: e.target.value.replace(/[^\d]/g, ""),
                                    }
                                  : x,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="^\\d{1,3}:[0-5]\\d$"
                          placeholder="mm:ss"
                          title="Penalty format: mm:ss"
                          className="w-full rounded border border-zinc-200 px-2 py-1 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
                          value={line.penalty}
                          onChange={(e) =>
                            setPenaltyLines((prev) =>
                              prev.map((x) =>
                                x.id === line.id
                                  ? {
                                      ...x,
                                      penalty: normalizePenaltyInput(e.target.value),
                                    }
                                  : x,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <select
                          className="w-full rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                          value={line.afterStageOrder}
                          onChange={(e) =>
                            setPenaltyLines((prev) =>
                              prev.map((x) =>
                                x.id === line.id
                                  ? {
                                      ...x,
                                      afterStageOrder: Number.parseInt(
                                        e.target.value,
                                        10,
                                      ),
                                    }
                                  : x,
                              ),
                            )
                          }
                        >
                          {stages.length === 0 ? (
                            <option value={1}>No stages yet</option>
                          ) : (
                            [...stages]
                              .sort((a, b) => a.order - b.order)
                              .map((st) => (
                                <option key={st.id} value={st.order}>
                                  After SS{st.order}
                                  {st.name ? ` — ${st.name}` : ""}
                                </option>
                              ))
                          )}
                        </select>
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          type="text"
                          placeholder="Reason"
                          className="w-full rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                          value={line.note}
                          onChange={(e) =>
                            setPenaltyLines((prev) =>
                              prev.map((x) =>
                                x.id === line.id
                                  ? { ...x, note: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            setPenaltyLines((prev) =>
                              prev.filter((x) => x.id !== line.id),
                            )
                          }
                          className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3">
            <button
              type="button"
              onClick={() => {
                const defaultOrder =
                  [...stages].sort((a, b) => a.order - b.order)[0]?.order ?? 1;
                setPenaltyLines((prev) => [
                  ...prev,
                  {
                    id: newPenaltyLineId(),
                    carNumber: "",
                    penalty: "",
                    note: "",
                    afterStageOrder: defaultOrder,
                  },
                ]);
              }}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              Add penalty
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
