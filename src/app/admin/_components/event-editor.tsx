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
  RallyEvent,
  SpeedRunImportStatus,
  Stage,
  StageProgressStatus,
} from "@/lib/rally/types";
import { AdminCountrySelect } from "./admin-country-select";

type Props = { event: RallyEvent };
type AdminTab =
  | "details"
  | "stages"
  | "entries"
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
const NOTICE_BOARD_DEFAULT_CATEGORIES = [
  "Supplementary Regulations",
  "Bulletins",
  "Steward Decisions",
  "Other",
] as const;

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
    officialNoticeCustomCategories: initial.officialNoticeCustomCategories ?? [],
    officialNoticeDocuments: initial.officialNoticeDocuments ?? [],
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

  useEffect(() => {
    if (meta.type !== "rally") return;
    if (sortedStages.length === 0) {
      setRallyTimingStageId("");
      return;
    }
    if (sortedStages.some((s) => s.id === rallyTimingStageId)) return;
    setRallyTimingStageId(sortedStages[0]?.id ?? "");
  }, [meta.type, rallyTimingStageId, sortedStages]);

  function saveMeta() {
    setFlash(null);
    startTransition(async () => {
      await updateEventMeta(eventId, meta);
      setFlash("Event details saved.");
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
    startTransition(async () => {
      await replaceEntries(eventId, entries);
      setFlash("Penalties saved.");
      router.refresh();
    });
  }

  function saveTiming() {
    setFlash(null);
    startTransition(async () => {
      await updateEventMeta(eventId, meta);
      await replaceEntries(eventId, entries);
      lastTimingSavedSigRef.current = timingSignature(meta, entries);
      setFlash("Timing control saved.");
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
          const metaRes = await updateEventMeta(eventId, m);
          if (!metaRes.ok) {
            console.error("Timing autosave: updateEventMeta failed:", metaRes.error);
            break;
          }
          const entRes = await replaceEntries(eventId, en);
          if (!entRes.ok) {
            console.error("Timing autosave: replaceEntries failed:", entRes.error);
            break;
          }
          lastTimingSavedSigRef.current = sig;
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
  ): Entry {
    if (metaRef.current.type === "rally") {
      const stageId = rallyTimingStageIdRef.current.trim();
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
    if (metaRef.current.type === "rally") {
      if (!algeFinishDeviceId.trim()) {
        setFlash("Set Finish Device ID first.");
        return;
      }
    } else {
      if (!algeStartDeviceId.trim()) {
        setFlash("Set Start Device ID first.");
        return;
      }
      if (!algeFinishDeviceId.trim()) {
        setFlash("Set Finish Device ID first.");
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
      }> = [];
      if (customTopic) {
        subscriptions.push({
          topic: customTopic,
          forcedTrigger: metaRef.current.type === "rally" ? "finish" : null,
        });
      } else if (metaRef.current.type === "rally") {
        subscriptions.push({
          topic: `/topic/device/${algeFinishDeviceId.trim()}/trigger`,
          forcedTrigger: "finish",
        });
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
        (s, i, arr) => arr.findIndex((x) => x.topic === s.topic) === i,
      );
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
                const sid = rallyTimingStageIdRef.current.trim();
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
                        const sid = rallyTimingStageIdRef.current.trim();
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
              let nextEntriesSnapshot: Entry[] | null = null;
              setEntries((prev) => {
                const next = prev.map((x) => {
                  if (x.startNumber !== startNumber) return x;
                  matched = true;
                  return applyTriggerTimingValue(x, activeTrigger, triggerTime);
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

  function removeOfficialNoticeDocument(id: string) {
    setMeta((m) => ({
      ...m,
      officialNoticeDocuments: m.officialNoticeDocuments.filter((x) => x.id !== id),
    }));
  }

  async function uploadOfficialNoticeDocument(file: File) {
    setDocUploadError(null);
    if (meta.type !== "speed") {
      setDocUploadError("Official Notice Board is only available for Speed events.");
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
        officialNoticeCustomCategories:
          NOTICE_BOARD_DEFAULT_CATEGORIES.includes(
            category as (typeof NOTICE_BOARD_DEFAULT_CATEGORIES)[number],
          ) || m.officialNoticeCustomCategories.includes(category)
            ? m.officialNoticeCustomCategories
            : [...m.officialNoticeCustomCategories, category],
      }));
      setNewDocTitle("");
      setFlash("Document uploaded. Click Save details to publish it.");
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
    blob[selectedRallyTimingStage.id] = {
      startTime: current.startTime ?? "",
      finishTime: current.finishTime ?? "",
      penalty: penaltyValue,
      penaltyNote: penaltyNoteValue,
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
  const getPenaltyValuesForEntry = (
    row: Entry,
  ): { penaltyValue: string; penaltyNoteValue: string } => {
    const blob = parseRallyStageTimingBlob(row.trialStartTime ?? "");
    const current = blob[RALLY_PENALTY_KEY] ?? {};
    return {
      penaltyValue: current.penalty?.trim() ?? "",
      penaltyNoteValue: current.penaltyNote?.trim() ?? "",
    };
  };
  const updateEntryPenaltyValues = (
    row: Entry,
    penaltyValue: string,
    penaltyNoteValue: string,
  ): Entry => {
    const blob = parseRallyStageTimingBlob(row.trialStartTime ?? "");
    const current = blob[RALLY_PENALTY_KEY] ?? {};
    blob[RALLY_PENALTY_KEY] = {
      startTime: current.startTime ?? "",
      finishTime: current.finishTime ?? "",
      penalty: penaltyValue,
      penaltyNote: penaltyNoteValue,
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
  const computeTotalTime = (startValue: string, finishValue: string): string => {
    const outcome = parseTimingOutcome(startValue, finishValue);
    const outcomeLabel = formatTimingOutcomeLabel(outcome);
    if (outcomeLabel) return outcomeLabel;
    const startMs = parseTimeToMs(startValue);
    const finishMs = parseTimeToMs(finishValue);
    if (startMs == null || finishMs == null) return "—";
    const diff = finishMs - startMs;
    if (diff < 0) return "—";
    return formatDuration(diff);
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
          {meta.type === "speed" ? (
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
          ) : null}
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
            className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50 dark:bg-red-600"
          >
            Save details
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

      {activeTab === "notice-board" && meta.type === "speed" ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Official Notice Board
            </h2>
            <button
              type="button"
              onClick={saveMeta}
              disabled={pending}
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50 dark:bg-red-600"
            >
              Save notice board
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Upload PDF/DOC files like Supplementary Regulations, Bulletins, Steward
            Decisions, and custom categories.
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

          <div className="mt-5 grid gap-3 md:grid-cols-3">
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
            <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800">
              Upload document
              <input
                type="file"
                accept=".pdf,.doc,.docx,.txt,.rtf,.odt,.xlsx,.xls"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadOfficialNoticeDocument(file);
                  e.currentTarget.value = "";
                }}
              />
            </label>
          </div>
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
                  <th className="pb-2 pr-2">File</th>
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
                      <tr key={doc.id} className="border-b border-zinc-100 dark:border-zinc-800">
                        <td className="py-2 pr-2">{doc.category}</td>
                        <td className="py-2 pr-2">{doc.title}</td>
                        <td className="py-2 pr-2">
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-700 hover:underline dark:text-blue-400"
                          >
                            {doc.fileName}
                          </a>
                        </td>
                        <td className="py-2 pr-2 text-xs text-zinc-500 dark:text-zinc-400">
                          {new Date(doc.uploadedAt).toLocaleString()}
                        </td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            onClick={() => removeOfficialNoticeDocument(doc.id)}
                            className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
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
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Save stages
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
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Save entries
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
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Save timing
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
                manually; stream triggers are ignored.
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
            ) : null}
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
                      {computeTotalTime(startValue, finishValue)}
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
                        {computeTotalTime(startValue, finishValue)}
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
        </section>
      ) : null}
      {meta.type === "rally" && activeTab === "penalties" ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Penalties
            </h2>
            <button
              type="button"
              onClick={savePenalties}
              disabled={pending}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Save penalties
            </button>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-700">
                  <th className="pb-2 pr-2 w-24">Car Number</th>
                  <th className="pb-2 pr-2 w-24">Penalty</th>
                  <th className="pb-2 pr-2">Penalty Note</th>
                </tr>
              </thead>
              <tbody>
                {entries
                  .slice()
                  .sort((a, b) => a.startNumber - b.startNumber)
                  .map((row) => {
                    const { penaltyValue, penaltyNoteValue } =
                      getPenaltyValuesForEntry(row);
                    return (
                      <tr
                        key={`pen-row-${row.id}`}
                        className="border-b border-zinc-100 dark:border-zinc-800"
                      >
                        <td className="py-2 pr-2">
                          <input
                            type="number"
                            className="w-full rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                            value={row.startNumber}
                            onChange={(e) => {
                              const n = Number.parseInt(e.target.value, 10);
                              setEntries((prev) =>
                                prev.map((x) =>
                                  x.id === row.id
                                    ? {
                                        ...x,
                                        startNumber: Number.isNaN(n) ? x.startNumber : n,
                                      }
                                    : x,
                                ),
                              );
                            }}
                          />
                        </td>
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
                              setEntries((prev) =>
                                prev.map((x) =>
                                  x.id === row.id
                                    ? updateEntryPenaltyValues(
                                        x,
                                        normalizePenaltyInput(e.target.value),
                                        getPenaltyValuesForEntry(x).penaltyNoteValue,
                                      )
                                    : x,
                                ),
                              )
                            }
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <input
                            type="text"
                            className="w-full rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                            value={penaltyNoteValue}
                            onChange={(e) =>
                              setEntries((prev) =>
                                prev.map((x) =>
                                  x.id === row.id
                                    ? updateEntryPenaltyValues(
                                        x,
                                        getPenaltyValuesForEntry(x).penaltyValue,
                                        e.target.value,
                                      )
                                    : x,
                                ),
                              )
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
