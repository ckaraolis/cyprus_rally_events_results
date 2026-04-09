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
type AdminTab = "details" | "stages" | "entries" | "timing";
type SpeedTimingRun = "trial" | "run1" | "run2";
type SpeedTimingOutcome = "dns" | "dnf" | null;

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
  if (start === "DNS" || finish === "DNS") return "dns";
  if (start === "DNF" || finish === "DNF") return "dnf";
  return null;
}

function formatTimingOutcomeLabel(outcome: SpeedTimingOutcome): string | null {
  if (outcome === "dns") return "Do Not Start";
  if (outcome === "dnf") return "Do Not Finish";
  return null;
}

export function EventEditor({ event: initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);
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
  const metaRef = useRef(meta);
  const entriesRef = useRef(entries);
  const timingAutosaveInFlightRef = useRef(false);
  const timingAutosaveQueuedRef = useRef(false);
  const lastTimingSavedSigRef = useRef(timingSignature(meta, entries));

  const eventId = initial.id;

  useEffect(() => {
    timingRunRef.current = timingRun;
  }, [timingRun]);

  useEffect(() => {
    metaRef.current = meta;
  }, [meta]);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.order - b.order),
    [stages],
  );

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
          await updateEventMeta(eventId, m);
          await replaceEntries(eventId, en);
          lastTimingSavedSigRef.current = sig;
          router.refresh();
        } while (timingAutosaveQueuedRef.current);
      } finally {
        timingAutosaveInFlightRef.current = false;
      }
    })();
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

  async function connectStompStream() {
    if (!algeStartDeviceId.trim()) {
      setFlash("Set Device ID first.");
      return;
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
      const topic =
        algeWsTopic.trim() || `/topic/device/${algeStartDeviceId.trim()}/trigger`;
      const client = new Client({
        webSocketFactory: () => new SockJS(algeWsEndpoint.trim()),
        connectHeaders: algeWsToken.trim()
          ? { authorization: algeWsToken.trim() }
          : {},
        reconnectDelay: 5000,
      });
      client.onConnect = () => {
        setStreamConnected(true);
        setStreamInfo(`Connected (${topic})`);
        client.subscribe(topic, (message) => {
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
            if (
              Number.isNaN(timestampNum) ||
              Number.isNaN(startNumber)
            ) {
              setStreamInfo(`Connected (${topic}) · trigger received but could not parse start/timestamp`);
              return;
            }
            const triggerTime = formatTriggerClock(
              timestampNum,
              Number.isNaN(timeOffsetNum) ? 0 : timeOffsetNum,
            );
            let matched = false;
            const activeRun = timingRunRef.current;
            const finishChannelNum = Number.parseInt(algeFinishChannelId, 10);
            const startChannelNum = Number.parseInt(algeStartChannelId, 10);
            const activeTrigger: "start" | "finish" =
              !Number.isNaN(timingChannelNum) &&
              !Number.isNaN(finishChannelNum) &&
              timingChannelNum === finishChannelNum
                ? "finish"
                : !Number.isNaN(timingChannelNum) &&
                    !Number.isNaN(startChannelNum) &&
                    timingChannelNum === startChannelNum
                  ? "start"
                  : "start";
            let nextEntriesSnapshot: Entry[] | null = null;
            setEntries((prev) =>
              {
                const next = prev.map((x) => {
                  if (x.startNumber !== startNumber) return x;
                  matched = true;
                  if (activeRun === "trial") {
                    return activeTrigger === "start"
                      ? { ...x, trialStartTime: triggerTime }
                      : { ...x, trialFinishTime: triggerTime };
                  }
                  if (activeRun === "run1") {
                    return activeTrigger === "start"
                      ? { ...x, run1StartTime: triggerTime }
                      : { ...x, run1FinishTime: triggerTime };
                  }
                  return activeTrigger === "start"
                    ? { ...x, run2StartTime: triggerTime }
                    : { ...x, run2FinishTime: triggerTime };
                });
                nextEntriesSnapshot = next;
                return next;
              },
            );
            if (matched && nextEntriesSnapshot) {
              queueLiveEntriesSave(nextEntriesSnapshot);
            }
            setStreamInfo(
              matched
                ? `Connected (${topic}) · #${startNumber} ${activeTrigger}=${triggerTime}`
                : `Connected (${topic}) · trigger for #${startNumber} received, but no matching entry`,
            );
          } catch (e) {
            setStreamInfo(
              `Connected (${topic}) · could not parse trigger: ${e instanceof Error ? e.message : "unknown error"}`,
            );
          }
        });
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
      if (metaRef.current.type !== "speed") return;
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
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
        defval: "",
      });
      if (rows.length === 0) {
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

      const headerKeyMap = new Map<string, string>();
      for (const key of Object.keys(rows[0] ?? {})) {
        headerKeyMap.set(norm(key), key);
      }
      const read = (row: Record<string, unknown>, aliases: string[]) => {
        for (const a of aliases) {
          const original = headerKeyMap.get(norm(a));
          if (original && original in row) return row[original];
        }
        return "";
      };

      const imported: Entry[] = rows.map((row, idx) => {
        const startNumberRaw = read(row, ["#", "No", "Number", "Start Number"]);
        const startNumberParsed = Number.parseInt(
          toStringValue(startNumberRaw),
          10,
        );
        const startNumber = Number.isNaN(startNumberParsed)
          ? idx + 1
          : startNumberParsed;
        return {
          id: crypto.randomUUID(),
          startNumber,
          entrance: toStringValue(read(row, ["Entrance"])),
          start: parseStart(read(row, ["Start"])),
          trialStartTime: "",
          trialFinishTime: "",
          run1StartTime: "",
          run1FinishTime: "",
          run2StartTime: "",
          run2FinishTime: "",
          driver: toStringValue(read(row, ["Driver"])),
          coDriver: toStringValue(read(row, ["Co-driver", "Codriver", "Co Driver"])),
          car: toStringValue(read(row, ["Car"])),
          class: toStringValue(read(row, ["Class"])),
          driverCountryCode: toStringValue(read(row, ["Drv", "Driver Country"])),
          coDriverCountryCode: toStringValue(read(row, ["Co", "Co-driver Country"])),
        };
      });

      setEntries(imported.sort((a, b) => a.startNumber - b.startNumber));
      setFlash(
        `Imported ${imported.length} entries from "${file.name}". Click Save entries to publish.`,
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

  const timingRunLabel =
    timingRun === "trial"
      ? "Trial"
      : timingRun === "run1"
        ? "1st Run"
        : "2nd Run";
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
    nextOutcome: "dns" | "dnf",
    currentOutcome: SpeedTimingOutcome,
  ) => {
    const marker = nextOutcome === "dns" ? "DNS" : "DNF";
    const clear = currentOutcome === nextOutcome;
    setEntries((prev) => {
      const next = prev.map((x) =>
        x.id === entryId
          ? {
              ...x,
              [timingStartField]: clear ? "" : marker,
              [timingFinishField]: clear ? "" : marker,
            }
          : x,
      );
      entriesRef.current = next;
      return next;
    });
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
          {meta.type === "speed" ? (
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

      {meta.type === "speed" && activeTab === "timing" ? (
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
          </div>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Enter start and finish times for each driver on {timingRunLabel}.
            This tab stores all run timings with entries.
          </p>
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
              ALGE import will be allowed only when status is Live.
            </span>
          </div>
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
          <div className="mt-4 space-y-3 sm:hidden">
            {entries
              .slice()
              .sort((a, b) => a.startNumber - b.startNumber)
              .map((row) => {
                const startValue = (row[timingStartField] as string) ?? "";
                const finishValue = (row[timingFinishField] as string) ?? "";
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
                      <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                        {row.driver || "—"}
                      </p>
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
                            setEntries((prev) =>
                              prev.map((x) =>
                                x.id === row.id
                                  ? {
                                      ...x,
                                      [timingStartField]: e.target.value.trim(),
                                    }
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
                            setEntries((prev) =>
                              prev.map((x) =>
                                x.id === row.id
                                  ? {
                                      ...x,
                                      [timingFinishField]: e.target.value.trim(),
                                    }
                                  : x,
                              ),
                            )
                          }
                          title="24-hour format: HH:mm, HH:mm:ss or HH:mm:ss.cc"
                        />
                      </label>
                    </div>
                    <p className="mt-2 font-mono text-sm text-zinc-700 dark:text-zinc-200">
                      Total: {computeTotalTime(startValue, finishValue)}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setTimingOutcomeForEntry(row.id, "dns", outcome)}
                        className={`rounded border px-3 py-2 text-sm font-medium ${
                          outcome === "dns"
                            ? "border-green-600 bg-green-600 text-white dark:border-green-500 dark:bg-green-500"
                            : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        }`}
                      >
                        DNS
                      </button>
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
                    </div>
                  </div>
                );
              })}
          </div>
          <div className="mt-4 hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-700">
                  <th className="pb-2 pr-2 w-14">#</th>
                  <th className="pb-2 pr-2">Driver</th>
                  <th className="pb-2 pr-2 w-32">Start</th>
                  <th className="pb-2 pr-2 w-32">Finish</th>
                  <th className="pb-2 pr-2 w-36">Total time</th>
                  <th className="pb-2 pr-2 w-28">Status</th>
                </tr>
              </thead>
              <tbody>
                {entries
                  .slice()
                  .sort((a, b) => a.startNumber - b.startNumber)
                  .map((row) => {
                    const startValue = (row[timingStartField] as string) ?? "";
                    const finishValue = (row[timingFinishField] as string) ?? "";
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
                        {row.driver || "—"}
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?([.,]\d{1,3})?$"
                          placeholder="HH:mm:ss.cc"
                          className="w-full rounded border border-zinc-200 px-2 py-1 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
                          value={startValue}
                          onChange={(e) =>
                            setEntries((prev) =>
                              prev.map((x) =>
                                x.id === row.id
                                  ? {
                                      ...x,
                                      [timingStartField]: e.target.value.trim(),
                                    }
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
                          className="w-full rounded border border-zinc-200 px-2 py-1 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
                          value={finishValue}
                          onChange={(e) =>
                            setEntries((prev) =>
                              prev.map((x) =>
                                x.id === row.id
                                  ? {
                                      ...x,
                                      [timingFinishField]: e.target.value.trim(),
                                    }
                                  : x,
                              ),
                            )
                          }
                          title="24-hour format: HH:mm, HH:mm:ss or HH:mm:ss.cc"
                        />
                      </td>
                      <td className="py-2 pr-2 font-mono text-zinc-700 dark:text-zinc-200">
                        {computeTotalTime(
                          startValue,
                          finishValue,
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            onClick={() => setTimingOutcomeForEntry(row.id, "dns", outcome)}
                            className={`rounded border px-2 py-1 text-xs font-medium ${
                              outcome === "dns"
                                ? "border-green-600 bg-green-600 text-white dark:border-green-500 dark:bg-green-500"
                                : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                            }`}
                          >
                            DNS
                          </button>
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
                        </div>
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
