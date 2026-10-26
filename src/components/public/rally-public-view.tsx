"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlagImage } from "@/components/flag-image";
import { isIso3166Alpha2 } from "@/lib/flags";
import type {
  Entry,
  RallyEvent,
  SiteSettings,
  Stage,
  StageProgressStatus,
} from "@/lib/rally/types";
import {
  competitiveStageNumber,
  competitiveStages,
  competitiveStagesForLegResults,
  isCompetitiveStage,
  isPreEventStage,
  sortStagesByKindThenOrder,
  stageLegNumber,
} from "@/lib/rally/stage-kind";
import {
  findShakedownBestDurationMs,
  findShakedownBestPassIndex,
  getShakedownPassCount,
  getShakedownPassDurationsMs,
  getShakedownPasses,
  isShakedownStage,
} from "@/lib/rally/shakedown-passes";
import {
  RALLY2_FOOTNOTE,
  buildRallyFinalRanking,
  buildRallyOverallRanking,
  buildSpeedFinalRanking,
  formatDiffDurationMs,
  formatDurationMs,
  getRallyEventPenaltyItems,
  getRallyEventPenaltyTotalMs,
  getRallyStageTimingValues,
  getSpeedBestFromRunsMs,
  getSpeedRunDurationMs,
  getSpeedRunFinishMs,
  getSpeedRunOutcomeLabel,
  getSpeedRunStartMs,
  legOutcomeSortKey,
  parseClockToDayMs,
  parsePenaltyDurationMs,
  parseRallyStageTimingBlob,
  isStageCancelled,
  isStageSettledForLeg,
  resolveRallyStageCell,
  stageAllowsRally2,
  stageChipLabel,
  worstLegRowOutcome,
} from "@/lib/rally/results-timing";
import {
  filterEntriesBySeries,
  RALLY_SERIES_OPTIONS,
  seriesLabel,
  usesDualSeriesEvent,
  type RallySeries,
} from "@/lib/rally/dual-series";

const RALLY_TABS = [
  { id: "overview", label: "Overview" },
  { id: "stage-results", label: "Live results" },
  { id: "itinerary", label: "Itinerary" },
  { id: "entries", label: "Entry List" },
  { id: "retirements", label: "Retirements" },
  { id: "penalty", label: "Penalty" },
  { id: "final-results", label: "Official Final Results" },
  { id: "official-notice-board", label: "Official Notice Board" },
] as const;

const SPEED_TABS = [
  { id: "overview", label: "Overview" },
  { id: "stage-results", label: "Live results" },
  { id: "entries", label: "Entry List" },
  { id: "final-results", label: "Official Final Results" },
  { id: "official-notice-board", label: "Official Notice Board" },
] as const;

type TabId = (typeof RALLY_TABS | typeof SPEED_TABS)[number]["id"];

type ResultsSubView = "stage" | "overall";
type SpeedRunId = "trial" | "run1" | "run2" | "best";
const OFFICIAL_NOTICE_DEFAULT_CATEGORIES = [
  "Supplementary Regulations",
  "Bulletins",
  "Steward Decisions",
  "Sportity",
  "Other",
] as const;
const SPEED_RUNS: ReadonlyArray<{ id: SpeedRunId; label: string }> = [
  { id: "trial", label: "Trial" },
  { id: "run1", label: "1st Run" },
  { id: "run2", label: "2nd Run" },
  { id: "best", label: "Best Time" },
];

type ResultsStripItem =
  | { id: string; type: "stage"; stage: Stage }
  | { id: string; type: "legEnd"; leg: number; stagesInLeg: Stage[] }
  | {
      id: string;
      type: "speedRun";
      runId: SpeedRunId;
      label: string;
      progressStatus: StageProgressStatus;
    };

type ResultsStripRow = {
  key: string;
  label: string;
  items: ResultsStripItem[];
};

type Props = {
  site: SiteSettings;
  event: RallyEvent;
  topCrumb?: { href: string; label: string };
};

function filterEntriesByClass(entries: Entry[], classFilter: string): Entry[] {
  if (classFilter === "") return entries;
  if (classFilter === "__EMPTY__") {
    return entries.filter((e) => !(e.class ?? "").trim());
  }
  return entries.filter((e) => (e.class ?? "").trim() === classFilter);
}

function EntryClassFilterBar({
  id,
  value,
  onChange,
  options,
  filteredCount,
  totalCount,
  rightAction,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  options: { nonEmpty: string[]; hasEmpty: boolean };
  filteredCount: number;
  totalCount: number;
  rightAction?: React.ReactNode;
}) {
  if (totalCount === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ewrc-border)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor={id}
          className="text-xs font-semibold uppercase tracking-wider text-[var(--ewrc-muted)]"
        >
          Class
        </label>
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-[10rem] rounded-md border border-[var(--ewrc-border-ui)] bg-[var(--ewrc-input-bg)] px-3 py-2 text-sm text-[var(--ewrc-input-fg)] focus:border-[var(--ewrc-brand)] focus:outline-none focus:ring-1 focus:ring-[var(--ewrc-focus-ring)]"
        >
          <option value="">All classes</option>
          {options.hasEmpty ? (
            <option value="__EMPTY__">No class</option>
          ) : null}
          {options.nonEmpty.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {value !== "" ? (
          <span className="text-xs text-[var(--ewrc-muted-3)]">
            {filteredCount} of {totalCount} crews
          </span>
        ) : null}
      </div>
      {rightAction ? <div className="shrink-0">{rightAction}</div> : null}
    </div>
  );
}

/** Detect any public-facing event change while polling the live endpoint. */
function fingerprintEventForLivePoll(e: RallyEvent): string {
  return JSON.stringify({
    name: e.name,
    logoUrl: e.logoUrl,
    type: e.type,
    dateStart: e.dateStart,
    dateEnd: e.dateEnd,
    location: e.location,
    status: e.status,
    stages: e.stages.map((s) => ({
      id: s.id,
      order: s.order,
      kind: s.kind ?? "ss",
      progressStatus: s.progressStatus,
      name: s.name,
      leg: s.leg,
      firstCarStartTime: s.firstCarStartTime,
      distanceKm: s.distanceKm,
    })),
    speed: e.type === "speed" ? e.speedRunImportStatus : null,
    entries: e.entries.map((x) => ({
      id: x.id,
      sn: x.startNumber,
      entrance: x.entrance,
      start: x.start !== false,
      driver: x.driver,
      coDriver: x.coDriver,
      car: x.car,
      class: x.class,
      driverCountryCode: x.driverCountryCode,
      coDriverCountryCode: x.coDriverCountryCode,
      series: x.series ?? "merc",
      cyNational: x.cyNational === true,
      trialStartTime: x.trialStartTime,
      trialFinishTime: x.trialFinishTime,
      run1StartTime: x.run1StartTime,
      run1FinishTime: x.run1FinishTime,
      run2StartTime: x.run2StartTime,
      run2FinishTime: x.run2FinishTime,
    })),
    noticeCategories: e.officialNoticeCustomCategories ?? [],
    noticeDocs: (e.officialNoticeDocuments ?? []).map((d) => ({
      id: d.id,
      title: d.title,
      category: d.category,
      url: d.url,
      fileName: d.fileName,
      uploadedAt: d.uploadedAt,
      password: d.password ?? "",
    })),
  });
}

export function RallyPublicView({ site, event: initialEvent, topCrumb }: Props) {
  const [event, setEvent] = useState(initialEvent);
  const lastConfigUpdatedAtRef = useRef<string | null>(null);
  const lastEventPollSigRef = useRef<string | null>(null);
  // Only re-seed from RSC when navigating to a different event — not on every
  // soft refresh, which can overwrite fresher polled times with a stale payload.
  useEffect(() => {
    setEvent(initialEvent);
    lastConfigUpdatedAtRef.current = null;
    lastEventPollSigRef.current = null;
  }, [initialEvent.id]);

  const [tab, setTab] = useState<TabId>("overview");
  const [selectedStripId, setSelectedStripId] = useState<string | null>(null);
  const [resultsSubView, setResultsSubView] =
    useState<ResultsSubView>("stage");
  /** For rally stage view: switch between "this SS only" and "After SSx" cumulative. */
  const [rallyStageView, setRallyStageView] = useState<"stage" | "afterStage">(
    "stage",
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const tabs = useMemo(() => {
    const all = event.type === "speed" ? SPEED_TABS : RALLY_TABS;
    if (event.finalResultsPublished === true) return all;
    return all.filter((t) => t.id !== "final-results");
  }, [event.type, event.finalResultsPublished]);

  useEffect(() => {
    if (tab === "final-results" && event.finalResultsPublished !== true) {
      setTab("overview");
    }
  }, [tab, event.finalResultsPublished]);

  /** Entry List tab: empty string = all classes; "__EMPTY__" = crews with no class set. */
  const [entryListClassFilter, setEntryListClassFilter] = useState("");
  /** Stage results tab (stage + overall sub-views): same filter semantics. */
  const [stageResultsClassFilter, setStageResultsClassFilter] = useState("");
  /** Final results tab: same filter semantics. */
  const [finalResultsClassFilter, setFinalResultsClassFilter] = useState("");
  /** Dual-series (Cyprus/Test): public must pick MERC or LOCAL. */
  const dualSeries = usesDualSeriesEvent(event);
  const [selectedSeries, setSelectedSeries] = useState<RallySeries | null>(
    null,
  );

  useEffect(() => {
    setSelectedSeries(null);
  }, [event.id]);

  const stagesSorted = useMemo(
    () => sortStagesByKindThenOrder(event.stages),
    [event.stages],
  );
  const competitiveStagesSorted = useMemo(
    () => competitiveStages(event.stages),
    [event.stages],
  );

  const entriesSorted = useMemo(() => {
    const all = [...event.entries].sort((a, b) => a.startNumber - b.startNumber);
    if (!dualSeries || !selectedSeries) return all;
    return filterEntriesBySeries(all, selectedSeries);
  }, [event.entries, dualSeries, selectedSeries]);
  const entriesStartedSorted = useMemo(
    () => entriesSorted.filter((e) => e.start !== false),
    [entriesSorted],
  );

  const rallyPenaltyRows = useMemo(
    () =>
      event.type === "rally"
        ? collectRallyPublicPenalties(entriesStartedSorted, stagesSorted)
        : [],
    [entriesStartedSorted, event.type, stagesSorted],
  );

  const entryListClassOptions = useMemo(() => {
    const nonEmpty = new Set<string>();
    let hasEmpty = false;
    for (const e of entriesSorted) {
      const c = (e.class ?? "").trim();
      if (c) nonEmpty.add(c);
      else hasEmpty = true;
    }
    const sorted = [...nonEmpty].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
    return { nonEmpty: sorted, hasEmpty };
  }, [entriesSorted]);

  const entriesForEntryList = useMemo(
    () => filterEntriesByClass(entriesSorted, entryListClassFilter),
    [entriesSorted, entryListClassFilter],
  );
  const hideSpeedCoDriverInEntryList = useMemo(
    () =>
      event.type === "speed" &&
      entriesSorted.every((e) => !(e.coDriver ?? "").trim()),
    [event.type, entriesSorted],
  );

  const entriesForStageResults = useMemo(
    () => filterEntriesByClass(entriesStartedSorted, stageResultsClassFilter),
    [entriesStartedSorted, stageResultsClassFilter],
  );
  const entriesForFinalResults = useMemo(
    () => filterEntriesByClass(entriesSorted, finalResultsClassFilter),
    [entriesSorted, finalResultsClassFilter],
  );
  const officialNoticeDocumentsSorted = useMemo(
    () =>
      [...(event.officialNoticeDocuments ?? [])].sort((a, b) =>
        b.uploadedAt.localeCompare(a.uploadedAt),
      ),
    [event.officialNoticeDocuments],
  );
  const officialNoticeCategories = useMemo(() => {
    const fromDocs = officialNoticeDocumentsSorted
      .map((d) => d.category?.trim() ?? "")
      .filter(Boolean);
    const merged = new Set<string>([
      ...OFFICIAL_NOTICE_DEFAULT_CATEGORIES,
      ...(event.officialNoticeCustomCategories ?? []),
      ...fromDocs,
    ]);
    return [...merged];
  }, [event.officialNoticeCustomCategories, officialNoticeDocumentsSorted]);

  const totalKm = useMemo(
    () =>
      competitiveStagesSorted.reduce(
        (acc, s) => acc + (typeof s.distanceKm === "number" ? s.distanceKm : 0),
        0,
      ),
    [competitiveStagesSorted],
  );

  /** Itinerary: pre-event block, then each competitive LEG (never “Leg 0”). */
  const itinerarySections = useMemo(() => {
    const preEvent = stagesSorted.filter(isPreEventStage);
    const byLeg = new Map<number, Stage[]>();
    const legOrder: number[] = [];
    for (const s of competitiveStagesSorted) {
      const leg = typeof s.leg === "number" && s.leg >= 1 ? Math.floor(s.leg) : 1;
      if (!byLeg.has(leg)) {
        byLeg.set(leg, []);
        legOrder.push(leg);
      }
      byLeg.get(leg)!.push(s);
    }
    const sections: Array<{
      key: string;
      title: string;
      stages: Stage[];
      showNumbers: boolean;
    }> = [];
    if (preEvent.length > 0) {
      sections.push({
        key: "pre-event",
        title: "Shakedown & Qualify",
        stages: preEvent,
        showNumbers: false,
      });
    }
    for (const leg of legOrder) {
      sections.push({
        key: `leg-${leg}`,
        title: `Leg ${leg}`,
        stages: byLeg.get(leg)!,
        showNumbers: true,
      });
    }
    return sections;
  }, [competitiveStagesSorted, stagesSorted]);

  /**
   * Stage strip rows: Shakedown/Qualify together, then each LEG’s SS + LEG results.
   * Compact multi-line layout — no LEG 0.
   */
  const resultsStripRows = useMemo((): ResultsStripRow[] => {
    if (event.type === "speed") {
      return [
        {
          key: "speed",
          label: "Runs",
          items: SPEED_RUNS.map((r) => ({
            id: `sp-${r.id}`,
            type: "speedRun" as const,
            runId: r.id,
            label: r.label,
            progressStatus:
              r.id === "best"
                ? ("completed" as const)
                : event.speedRunImportStatus?.[r.id] === "live"
                  ? ("live" as const)
                  : event.speedRunImportStatus?.[r.id] === "completed"
                    ? ("completed" as const)
                    : ("pending" as const),
          })),
        },
      ];
    }

    const rows: ResultsStripRow[] = [];
    const preEvent = stagesSorted.filter(isPreEventStage);
    if (preEvent.length > 0) {
      rows.push({
        key: "pre-event",
        label: "Shakedown & Qualify",
        items: preEvent.map((s) => ({
          id: `st-${s.id}`,
          type: "stage" as const,
          stage: s,
        })),
      });
    }

    const byLeg = new Map<number, Stage[]>();
    const legOrder: number[] = [];
    for (const s of competitiveStagesSorted) {
      const leg = typeof s.leg === "number" && s.leg >= 1 ? Math.floor(s.leg) : 1;
      if (!byLeg.has(leg)) {
        byLeg.set(leg, []);
        legOrder.push(leg);
      }
      byLeg.get(leg)!.push(s);
    }
    for (const leg of legOrder) {
      const stagesInLeg = byLeg.get(leg)!;
      const items: ResultsStripItem[] = stagesInLeg.map((s) => ({
        id: `st-${s.id}`,
        type: "stage" as const,
        stage: s,
      }));
      items.push({
        id: `le-leg-${leg}`,
        type: "legEnd",
        leg,
        stagesInLeg,
      });
      rows.push({
        key: `leg-${leg}`,
        label: `Leg ${leg}`,
        items,
      });
    }
    return rows;
  }, [
    competitiveStagesSorted,
    event.speedRunImportStatus,
    event.type,
    stagesSorted,
  ]);

  const resultsStripItems = useMemo(
    () => resultsStripRows.flatMap((row) => row.items),
    [resultsStripRows],
  );

  useEffect(() => {
    if (resultsStripItems.length === 0) {
      setSelectedStripId(null);
      return;
    }
    setSelectedStripId((prev) => {
      if (prev && resultsStripItems.some((x) => x.id === prev)) return prev;
      return resultsStripItems[0]!.id;
    });
  }, [resultsStripItems]);

  const selectedStripItem =
    resultsStripItems.find((x) => x.id === selectedStripId) ??
    resultsStripItems[0] ??
    null;
  /**
   * Competitive SS from the first up to the selected stage (all legs in order).
   * LEG2 After-SS therefore continues from LEG1’s last overall. Cancelled stages
   * stay in the list so After a cancelled SS still resolves to the previous overall
   * inside `buildRallyOverallRanking`.
   */
  const cumulativeStagesUpToSelected = useMemo<Stage[]>(() => {
    if (
      event.type !== "rally" ||
      !selectedStripItem ||
      selectedStripItem.type !== "stage" ||
      !isCompetitiveStage(selectedStripItem.stage)
    ) {
      return [];
    }
    const idx = competitiveStagesSorted.findIndex(
      (s) => s.id === selectedStripItem.stage.id,
    );
    if (idx < 0) return [];
    return competitiveStagesSorted.slice(0, idx + 1);
  }, [competitiveStagesSorted, event.type, selectedStripItem]);
  const showAfterStageTab = cumulativeStagesUpToSelected.length >= 2;
  const effectiveRallyStageView: "stage" | "afterStage" = showAfterStageTab
    ? rallyStageView
    : "stage";
  const normalizedLogoUrl = useMemo(
    () => normalizeLogoUrl(event.logoUrl),
    [event.logoUrl],
  );
  const onStageSpeedRows = useMemo(() => {
    if (
      event.type !== "speed" ||
      !selectedStripItem ||
      selectedStripItem.type !== "speedRun" ||
      selectedStripItem.runId === "best"
    ) {
      return [];
    }
    const runId = selectedStripItem.runId;
    const now = new Date(nowMs);
    const nowDayMs =
      now.getHours() * 3_600_000 +
      now.getMinutes() * 60_000 +
      now.getSeconds() * 1_000 +
      now.getMilliseconds();
    return entriesForStageResults
      .map((row) => {
        const startMs = getSpeedRunStartMs(row, runId);
        const finishMs = getSpeedRunFinishMs(row, runId);
        return { row, startMs, finishMs };
      })
      .filter(
        (x): x is { row: Entry; startMs: number; finishMs: number | null } =>
          x.startMs != null,
      )
      .filter((x) => x.startMs <= nowDayMs)
      .filter((x) => x.finishMs == null)
      .sort((a, b) => a.startMs - b.startMs);
  }, [entriesForStageResults, event.type, nowMs, selectedStripItem]);
  const onStageRallyRows = useMemo(() => {
    if (
      event.type !== "rally" ||
      !selectedStripItem ||
      selectedStripItem.type !== "stage"
    ) {
      return [];
    }
    const stageId = selectedStripItem.stage.id;
    return entriesForStageResults
      .map((row) => {
        const values = getRallyStageTimingValues(row, stageId);
        const startMs = parseClockToDayMs(values.startValue);
        const finishMs = parseClockToDayMs(values.finishValue);
        return { row, startMs, finishMs, startValue: values.startValue };
      })
      .filter(
        (
          x,
        ): x is {
          row: Entry;
          startMs: number;
          finishMs: number | null;
          startValue: string;
        } => x.startMs != null,
      )
      // Show as soon as ALGE/admin writes a start time (do not wait for wall clock).
      .filter((x) => x.finishMs == null)
      .sort((a, b) => a.startMs - b.startMs);
  }, [entriesForStageResults, event.type, selectedStripItem]);
  const entriesForSelectedSpeedRun = useMemo(() => {
    if (!selectedStripItem || selectedStripItem.type !== "speedRun") return [];
    if (selectedStripItem.runId === "best") {
      return entriesForStageResults.filter(
        (row) =>
          getSpeedRunDurationMs(row, "run1") != null ||
          getSpeedRunDurationMs(row, "run2") != null ||
          getSpeedRunDurationMs(row, "trial") != null ||
          getSpeedRunOutcomeLabel(row, "trial") != null ||
          getSpeedRunOutcomeLabel(row, "run1") != null ||
          getSpeedRunOutcomeLabel(row, "run2") != null,
      );
    }
    const runId = selectedStripItem.runId as "trial" | "run1" | "run2";
    return entriesForStageResults.filter(
      (row) =>
        getSpeedRunDurationMs(row, runId) != null ||
        getSpeedRunOutcomeLabel(row, runId) != null,
    );
  }, [entriesForStageResults, selectedStripItem]);

  useEffect(() => {
    if (tab === "stage-results") setResultsSubView("stage");
  }, [tab]);

  useEffect(() => {
    setRallyStageView("stage");
  }, [selectedStripId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    /**
     * Live updates via JSON polling — not `router.refresh()`, which re-runs the whole RSC tree
     * and often leaves the dev overlay stuck on “Rendering…”.
     * Every public tab polls the one-event live endpoint every 1s so Overview, Entry List,
     * Itinerary, Penalties, Results, and Notice Board all stay in sync.
     */
    let cancelled = false;
    let inFlight = false;
    const intervalMs = 1000;
    const poll = async () => {
      if (cancelled || inFlight) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      inFlight = true;
      try {
        const url = `/api/rally/events/${encodeURIComponent(initialEvent.id)}/live?_=${Date.now()}`;
        const res = await fetch(url, {
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            Pragma: "no-cache",
            "Cache-Control": "no-cache",
          },
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          events?: RallyEvent[];
          event?: RallyEvent;
          updatedAt: string;
        };
        const match =
          data.event ?? data.events?.find((e) => e.id === initialEvent.id);
        if (!match || cancelled) return;
        const sig = fingerprintEventForLivePoll(match);
        // Only re-render when public content actually changes. Admin saves also bump
        // config `updatedAt` on every keystroke; reacting to that alone made the
        // public page look like it was constantly refreshing for some viewers.
        if (sig === lastEventPollSigRef.current) {
          lastConfigUpdatedAtRef.current = data.updatedAt;
          return;
        }
        lastConfigUpdatedAtRef.current = data.updatedAt;
        lastEventPollSigRef.current = sig;
        setEvent(match);
      } catch {
        /* offline / transient */
      } finally {
        inFlight = false;
      }
    };
    const id = window.setInterval(poll, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [initialEvent.id]);

  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) {
      setTab("overview");
    }
  }, [tab, tabs]);

  if (dualSeries && selectedSeries == null) {
    return (
      <>
        <div className="border-b border-[var(--ewrc-border)] bg-gradient-to-b from-[var(--ewrc-gradient-top)] to-[var(--ewrc-gradient-bottom)]">
          <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
            {topCrumb ? (
              <Link
                href={topCrumb.href}
                className="mb-3 inline-block text-xs font-medium text-[var(--ewrc-muted-3)] transition-colors hover:text-[var(--ewrc-brand)]"
              >
                {topCrumb.label}
              </Link>
            ) : null}
            {normalizedLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={normalizedLogoUrl}
                alt={`${event.name} logo`}
                className="mb-4 h-auto w-full max-w-[300px] rounded border border-[var(--ewrc-border)] bg-[var(--ewrc-surface-raised)] p-1 object-contain"
                style={{ aspectRatio: "1333 / 537" }}
                loading="lazy"
              />
            ) : null}
            <h1 className="font-ewrc-heading text-2xl font-bold tracking-tight text-[var(--ewrc-heading)] sm:text-3xl">
              {event.name}
            </h1>
            <p className="mt-3 max-w-xl text-sm text-[var(--ewrc-muted-2)]">
              This event runs two classifications. Choose which results to view.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 sm:gap-6">
              {RALLY_SERIES_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSelectedSeries(opt.id)}
                  className="rounded-xl border-2 border-[var(--ewrc-border-ui)] bg-[var(--ewrc-surface-raised)] px-6 py-10 text-center transition-colors hover:border-[var(--ewrc-brand)] hover:bg-[var(--ewrc-chip-on-bg)]"
                >
                  <span className="font-ewrc-heading block text-2xl font-bold tracking-wide text-[var(--ewrc-heading)]">
                    {opt.label}
                  </span>
                  <span className="mt-2 block text-xs uppercase tracking-widest text-[var(--ewrc-muted-3)]">
                    View results
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="border-b border-[var(--ewrc-border)] bg-gradient-to-b from-[var(--ewrc-gradient-top)] to-[var(--ewrc-gradient-bottom)]">
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              {topCrumb ? (
                <Link
                  href={topCrumb.href}
                  className="mb-2 inline-block text-xs font-medium text-[var(--ewrc-muted-3)] transition-colors hover:text-[var(--ewrc-brand)]"
                >
                  {topCrumb.label}
                </Link>
              ) : null}
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--ewrc-brand)]">
                {event.type === "speed" ? "SPEED" : "RALLY"}
                {dualSeries && selectedSeries
                  ? ` · ${seriesLabel(selectedSeries)}`
                  : ""}
              </p>
              {normalizedLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={normalizedLogoUrl}
                  alt={`${event.name} logo`}
                  className="mt-2 h-auto w-full max-w-[300px] rounded border border-[var(--ewrc-border)] bg-[var(--ewrc-surface-raised)] p-1 object-contain"
                  style={{ aspectRatio: "1333 / 537" }}
                  loading="lazy"
                />
              ) : null}
              <h1 className="font-ewrc-heading mt-1 text-2xl font-bold tracking-tight text-[var(--ewrc-heading)] sm:text-3xl">
                {event.name}
              </h1>
              <p className="mt-2 text-sm text-[var(--ewrc-subtext)]">
                <span>{formatEventDateRange(event.dateStart, event.dateEnd)}</span>
                {event.location ? (
                  <>
                    <span className="mx-2 text-[var(--ewrc-pipe)]">|</span>
                    <span>{event.location}</span>
                  </>
                ) : null}
              </p>
            </div>
            <div className="flex w-full flex-col items-start gap-2 sm:w-auto sm:items-end">
              <span
                className={
                  "inline-flex items-center rounded px-2.5 py-1 text-xs font-bold uppercase tracking-wide " +
                  (event.status === "live"
                    ? "bg-[var(--ewrc-status-live-bg)] text-[var(--ewrc-status-live-fg)]"
                    : event.status === "completed"
                      ? "bg-[var(--ewrc-status-final-bg)] text-[var(--ewrc-status-final-fg)]"
                      : event.status === "upcoming"
                        ? "bg-[var(--ewrc-status-draft-bg)] text-[var(--ewrc-status-draft-fg)]"
                      : "bg-[var(--ewrc-status-draft-bg)] text-[var(--ewrc-status-draft-fg)]")
                }
              >
                {event.status}
              </span>
              <span className="text-right text-xs text-[var(--ewrc-muted-3)]">
                {entriesSorted.length} crews · {competitiveStagesSorted.length} stages
                {totalKm > 0 ? ` · ${totalKm.toFixed(1)} km` : null}
              </span>
              {dualSeries && selectedSeries ? (
                <button
                  type="button"
                  onClick={() => setSelectedSeries(null)}
                  className="rounded border border-[var(--ewrc-border-ui)] bg-[var(--ewrc-input-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--ewrc-muted)] transition-colors hover:border-[var(--ewrc-brand)] hover:text-[var(--ewrc-brand)]"
                >
                  Switch series
                </button>
              ) : null}
            </div>
          </div>

          <div
            role="tablist"
            className="mt-6 flex gap-0 overflow-x-auto border-b border-[var(--ewrc-border-ui)] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={
                  "relative shrink-0 border-b-2 px-3 py-3 text-sm font-semibold transition-colors sm:px-4 " +
                  (tab === t.id
                    ? "border-[var(--ewrc-brand)] text-[var(--ewrc-heading)]"
                    : "border-transparent text-[var(--ewrc-muted)] hover:text-[var(--ewrc-strong)]")
                }
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {tab === "overview" ? (
          <div className="space-y-6">
            <div className="ewrc-panel grid gap-4 sm:grid-cols-2">
              <StatBox label="Entries" value={String(entriesSorted.length)} />
              <StatBox label="Location" value={event.location || "—"} />
            </div>
            {site.publicFooterNote ? (
              <div className="ewrc-panel p-4 text-sm leading-relaxed text-[var(--ewrc-body-secondary)]">
                {site.publicFooterNote}
              </div>
            ) : null}
            <div className="ewrc-panel p-4 text-sm leading-relaxed text-[var(--ewrc-muted)]">
              <p className="font-medium text-[var(--ewrc-strong)]">Live timing</p>
              <p className="mt-2">
                Stage times, overall classification, retirements, and penalties
                from ALGE MT1 will fill the other tabs when the API is connected.
              </p>
            </div>
          </div>
        ) : null}

        {tab === "stage-results" ? (
          <div className="space-y-4">
            <p className="text-sm text-[var(--ewrc-muted-2)]">
              {event.type === "speed"
                ? "Speed mode: trial does not count in final ranking; best of 1st Run and 2nd Run counts."
                : "Pick a stage or an "}
              {event.type === "rally" ? (
                <strong className="text-[var(--ewrc-accent-text)]">end of leg</strong>
              ) : null}{" "}
              {event.type === "rally" ? "block, then use the buttons below to switch between " : ""}
              <strong className="text-[var(--ewrc-accent-text)]">Live results</strong> (times for that
              pick) and <strong className="text-[var(--ewrc-accent-text)]">
                {event.type === "speed" ? "Final results" : "Overall results"}
              </strong>{" "}
              (classification). Dots on stages:{" "}
              <span className="text-[var(--ewrc-yellow)]">yellow</span> = not started,{" "}
              <span className="text-[var(--ewrc-green)]">green</span> = live,{" "}
              <span className="text-[var(--ewrc-red)]">red</span> = completed,{" "}
              <span className="text-[var(--ewrc-black)]">black</span> = cancelled,{" "}
              <span className="text-[var(--ewrc-blue)]">blue</span> = stopped.
            </p>

            <div className="ewrc-panel overflow-hidden p-0">
              <EntryClassFilterBar
                id="stage-results-class-filter"
                value={stageResultsClassFilter}
                onChange={setStageResultsClassFilter}
                options={entryListClassOptions}
                filteredCount={entriesForStageResults.length}
                totalCount={entriesSorted.length}
              />
              {resultsStripItems.length === 0 ? (
                <p className="p-6 text-center text-sm text-[var(--ewrc-muted-3)]">
                  {event.type === "speed"
                    ? "No runs available for this speed event."
                    : "No stages defined. Add them in Admin → Events."}
                </p>
              ) : (
                <>
                  <div className="space-y-1.5 overflow-x-auto px-3 py-2.5 sm:px-4">
                    {resultsStripRows.map((row) => (
                      <div
                        key={row.key}
                        className="flex min-w-min items-center"
                        role="list"
                        aria-label={row.label}
                      >
                          {row.items.map((item, i) => {
                            const isSelected = selectedStripItem?.id === item.id;
                            return (
                              <div
                                key={item.id}
                                className="flex items-center"
                                role="listitem"
                              >
                                {i > 0 ? (
                                  <span
                                    className="select-none px-1.5 text-sm font-extralight leading-none text-[var(--ewrc-strip-sep)] sm:px-2"
                                    aria-hidden
                                  >
                                    |
                                  </span>
                                ) : null}
                                {item.type === "stage" ? (
                                  <button
                                    type="button"
                                    onClick={() => setSelectedStripId(item.id)}
                                    aria-pressed={isSelected}
                                    title={
                                      item.stage.distanceKm != null
                                        ? `${item.stage.name} — ${item.stage.distanceKm} km`
                                        : item.stage.name
                                    }
                                    className={
                                      "flex items-center gap-1.5 rounded border px-2 py-1 text-left transition-colors " +
                                      (isSelected
                                        ? "border-[var(--ewrc-brand)] bg-[var(--ewrc-chip-on-bg)] ring-1 ring-[var(--ewrc-chip-on-ring)]"
                                        : "border-[var(--ewrc-border-ui)] bg-[var(--ewrc-chip-bg)] hover:border-[var(--ewrc-border-ui-hover)] hover:bg-[var(--ewrc-chip-hover-bg)]")
                                    }
                                  >
                                    <span
                                      className={
                                        "shrink-0 font-mono text-[11px] font-bold sm:text-xs " +
                                        (isPreEventStage(item.stage)
                                          ? "text-[var(--ewrc-muted)]"
                                          : "text-[var(--ewrc-ss)]")
                                      }
                                    >
                                      {stageChipLabel(item.stage, event.stages)}
                                    </span>
                                    <StageProgressDot
                                      status={item.stage.progressStatus ?? "pending"}
                                    />
                                  </button>
                                ) : item.type === "legEnd" ? (
                                  <button
                                    type="button"
                                    onClick={() => setSelectedStripId(item.id)}
                                    aria-pressed={isSelected}
                                    title={`LEG${item.leg} results`}
                                    className={
                                      "flex shrink-0 items-center gap-1 whitespace-nowrap rounded border px-2 py-1 text-left text-[11px] transition-colors sm:text-xs " +
                                      (isSelected
                                        ? "border-[var(--ewrc-leg-on-border)] bg-[var(--ewrc-leg-on-bg)] ring-1 ring-[var(--ewrc-leg-on-ring)]"
                                        : "border-[var(--ewrc-leg-card-border)] bg-[var(--ewrc-leg-card-bg)] hover:border-[var(--ewrc-leg-card-hover-border)] hover:bg-[var(--ewrc-leg-card-hover-bg)]")
                                    }
                                  >
                                    <span className="font-bold uppercase tracking-wide text-[var(--ewrc-leg-amber)]">
                                      LEG{item.leg}
                                    </span>
                                    <span className="font-semibold text-[var(--ewrc-leg-cream)]">
                                      Results
                                    </span>
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setSelectedStripId(item.id)}
                                    aria-pressed={isSelected}
                                    title={item.label}
                                    className={
                                      "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border px-2 py-1 text-left text-[11px] transition-colors sm:text-xs " +
                                      (isSelected
                                        ? "border-[var(--ewrc-brand)] bg-[var(--ewrc-chip-on-bg)] ring-1 ring-[var(--ewrc-chip-on-ring)]"
                                        : "border-[var(--ewrc-border-ui)] bg-[var(--ewrc-chip-bg)] hover:border-[var(--ewrc-border-ui-hover)] hover:bg-[var(--ewrc-chip-hover-bg)]")
                                    }
                                  >
                                    <span className="font-bold uppercase tracking-wide text-[var(--ewrc-ss)]">
                                      {item.label}
                                    </span>
                                    {item.runId !== "best" ? (
                                      <StageProgressDot
                                        status={item.progressStatus}
                                      />
                                    ) : null}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {selectedStripItem ? (
              <div className="ewrc-panel overflow-hidden p-0">
                <div className="border-b border-[var(--ewrc-border)] px-4 py-3">
                  {selectedStripItem.type === "stage" ? (
                    <>
                      <h2 className="font-ewrc-heading text-xs font-bold uppercase tracking-widest text-[var(--ewrc-muted)]">
                        Live results
                      </h2>
                      <p className="mt-1 text-sm font-semibold text-[var(--ewrc-heading)]">
                        {isPreEventStage(selectedStripItem.stage) ? (
                          <span className="font-normal text-[var(--ewrc-strong)]">
                            {selectedStripItem.stage.name}
                          </span>
                        ) : (
                          <>
                            {stageChipLabel(selectedStripItem.stage, event.stages)}{" "}
                            <span className="font-normal text-[var(--ewrc-strong)]">
                              {selectedStripItem.stage.name}
                            </span>
                          </>
                        )}
                      </p>
                      {selectedStripItem.stage.distanceKm != null ? (
                        <p className="mt-0.5 text-xs text-[var(--ewrc-muted-3)]">
                          {selectedStripItem.stage.distanceKm} km
                        </p>
                      ) : null}
                      {event.type === "rally" && showAfterStageTab ? (
                        <div
                          className="mt-3 inline-flex rounded-md border border-[var(--ewrc-border)] p-0.5"
                          role="tablist"
                          aria-label="Stage view"
                        >
                          <button
                            type="button"
                            role="tab"
                            aria-selected={effectiveRallyStageView === "stage"}
                            onClick={() => setRallyStageView("stage")}
                            className={
                              "rounded px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-colors " +
                              (effectiveRallyStageView === "stage"
                                ? "bg-[var(--ewrc-chip-on-bg)] text-[var(--ewrc-heading)] ring-1 ring-[var(--ewrc-chip-on-ring)]"
                                : "text-[var(--ewrc-muted)] hover:text-[var(--ewrc-strong)]")
                            }
                          >
                            {stageChipLabel(selectedStripItem.stage, event.stages)}{" "}
                            Stage Results
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={effectiveRallyStageView === "afterStage"}
                            onClick={() => setRallyStageView("afterStage")}
                            className={
                              "rounded px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-colors " +
                              (effectiveRallyStageView === "afterStage"
                                ? "bg-[var(--ewrc-chip-on-bg)] text-[var(--ewrc-heading)] ring-1 ring-[var(--ewrc-chip-on-ring)]"
                                : "text-[var(--ewrc-muted)] hover:text-[var(--ewrc-strong)]")
                            }
                          >
                            After {stageChipLabel(selectedStripItem.stage, event.stages)}{" "}
                            Results
                          </button>
                        </div>
                      ) : null}
                      {event.type === "rally" &&
                      effectiveRallyStageView === "stage" ? (
                        <div className="mt-2 rounded-md border border-[var(--ewrc-border)] bg-[var(--ewrc-input-bg)] px-3 py-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ewrc-muted)]">
                            On Stage:
                          </p>
                          {onStageRallyRows.length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ewrc-strong)]">
                              {onStageRallyRows.map(({ row, startValue }) => (
                                <span key={`on-stage-rally-${row.id}`} className="font-mono">
                                  #{row.startNumber} {row.driver || "—"} (
                                  {formatOnStageStartHm(startValue)})
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-1 text-xs text-[var(--ewrc-muted-3)]">
                              No crew currently on stage.
                            </p>
                          )}
                        </div>
                      ) : null}
                    </>
                  ) : selectedStripItem.type === "legEnd" ? (
                    <>
                      <h2 className="font-ewrc-heading mt-0 flex flex-wrap items-baseline gap-1.5 text-sm font-bold uppercase tracking-wide text-[var(--ewrc-leg-cream)]">
                        <span className="text-[var(--ewrc-leg-amber)]">
                          LEG{selectedStripItem.leg}
                        </span>
                        <span>Results</span>
                      </h2>
                    </>
                  ) : (
                    <>
                      <h2 className="font-ewrc-heading text-xs font-bold uppercase tracking-widest text-[var(--ewrc-muted)]">
                        Live results
                      </h2>
                      <p className="mt-1 text-sm font-semibold text-[var(--ewrc-heading)]">
                        {selectedStripItem.label}
                      </p>
                      {selectedStripItem.runId !== "best" ? (
                        <div className="mt-2 rounded-md border border-[var(--ewrc-border)] bg-[var(--ewrc-input-bg)] px-3 py-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ewrc-muted)]">
                            On Stage:
                          </p>
                          {onStageSpeedRows.length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ewrc-strong)]">
                              {onStageSpeedRows.map(({ row }) => (
                                <span key={`on-stage-${row.id}`} className="font-mono">
                                  #{row.startNumber} {row.driver || "—"}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-1 text-xs text-[var(--ewrc-muted-3)]">
                              No driver currently on stage.
                            </p>
                          )}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
                <div className="min-w-0 overflow-x-auto">
                  {entriesStartedSorted.length > 0 &&
                  entriesForStageResults.length === 0 ? (
                    <p className="p-6 text-center text-sm text-[var(--ewrc-muted-3)]">
                      No crews in this class. Adjust the Class filter above.
                    </p>
                  ) : selectedStripItem.type === "speedRun" ? (
                    selectedStripItem.runId === "best" ? (
                      <SpeedBestTable rows={entriesForSelectedSpeedRun} />
                    ) : (
                      <SpeedRunTable
                        entries={entriesForSelectedSpeedRun}
                        runId={selectedStripItem.runId}
                      />
                    )
                  ) : selectedStripItem.type === "stage" ? (
                    event.type === "rally" &&
                    effectiveRallyStageView === "afterStage" ? (
                      <CumulativeAfterStageTable
                        entries={entriesForStageResults}
                        stages={cumulativeStagesUpToSelected}
                      />
                    ) : (
                      <StageTimesTable
                        entries={entriesForStageResults}
                        stage={
                          event.type === "rally"
                            ? selectedStripItem.stage
                            : undefined
                        }
                      />
                    )
                  ) : (
                    <LegResultsTable
                      entries={entriesForStageResults}
                      leg={selectedStripItem.leg}
                      stagesInLeg={competitiveStagesForLegResults(
                        event.stages,
                        selectedStripItem.leg,
                      )}
                      allStages={event.stages}
                    />
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "itinerary" ? (
          <div className="ewrc-panel p-5 sm:p-6">
            <h2 className="font-ewrc-heading text-sm font-bold uppercase tracking-widest text-[var(--ewrc-muted)]">
              Itinerary
            </h2>
            <div className="mt-6 space-y-0">
              {itinerarySections.map((section, groupIdx) => (
                <div
                  key={section.key}
                  className={
                    groupIdx > 0
                      ? "mt-8 border-t border-[var(--ewrc-border)] pt-6"
                      : ""
                  }
                >
                  {itinerarySections.length > 1 || section.key === "pre-event" ? (
                    <h3 className="mb-3 font-ewrc-heading text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--ewrc-leg-heading)]">
                      {section.title}
                    </h3>
                  ) : null}
                  <ol className="space-y-0">
                    {section.stages.map((s, i) => {
                      const ssNo = competitiveStageNumber(s, event.stages);
                      return (
                      <li key={s.id} className="flex gap-4">
                        <div className="flex w-8 flex-col items-center">
                          <span className="font-mono text-sm font-bold text-[var(--ewrc-brand)]">
                            {section.showNumbers && ssNo != null ? ssNo : "·"}
                          </span>
                          {i < section.stages.length - 1 ? (
                            <span className="mt-1 h-full min-h-[1.5rem] w-px bg-[var(--ewrc-line)]" />
                          ) : null}
                        </div>
                        <div className="flex-1 border-b border-[var(--ewrc-border)] pb-4">
                          <p className="font-medium text-[var(--ewrc-heading)]">{s.name}</p>
                          <p className="mt-1 text-xs text-[var(--ewrc-accent-text)]">
                            First car:{" "}
                            {s.firstCarStartTime ? (
                              <span className="font-mono font-semibold text-[var(--ewrc-itin-time)]">
                                {s.firstCarStartTime}
                              </span>
                            ) : (
                              <span className="text-[var(--ewrc-muted-3)]">TBA</span>
                            )}
                          </p>
                          <p className="mt-0.5 text-xs text-[var(--ewrc-muted-2)]">
                            {s.distanceKm != null
                              ? `${s.distanceKm} km`
                              : "Distance TBA"}
                          </p>
                        </div>
                      </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
            </div>
            {competitiveStagesSorted.length > 0 ? (
              <p className="mt-6 border-t border-[var(--ewrc-border)] pt-4 text-sm text-[var(--ewrc-muted)]">
                Total competitive distance:{" "}
                <span className="font-mono text-[var(--ewrc-strong)]">
                  {totalKm > 0 ? `${totalKm.toFixed(1)} km` : "—"}
                </span>
              </p>
            ) : (
              <p className="mt-4 text-sm text-[var(--ewrc-muted-3)]">No stages to show.</p>
            )}
          </div>
        ) : null}

        {tab === "entries" ? (
          <div className="ewrc-panel overflow-hidden p-0">
            <p className="border-b border-[var(--ewrc-border)] px-4 py-2 text-xs text-[var(--ewrc-muted-3)]">
              Nationality flags appear next to names when set in Admin (Drv / Co
              country). Otherwise only names are shown.
            </p>
            <EntryClassFilterBar
              id="entry-list-class-filter"
              value={entryListClassFilter}
              onChange={setEntryListClassFilter}
              options={entryListClassOptions}
              filteredCount={entriesForEntryList.length}
              totalCount={entriesSorted.length}
            />
            <div className="overflow-x-auto">
              <table className="ewrc-table ewrc-table-entry-list min-w-[820px] w-full text-sm">
                <thead>
                  <tr>
                    <th className="w-14 text-center">#</th>
                    <th className="w-24 text-center">Entrance</th>
                    <th className="text-center">Driver</th>
                    {!hideSpeedCoDriverInEntryList ? (
                      <th className="text-center">Co-driver</th>
                    ) : null}
                    <th className="text-center">Car</th>
                    <th className="w-24 text-center">Class</th>
                  </tr>
                </thead>
                <tbody>
                  {entriesSorted.length > 0 && entriesForEntryList.length === 0 ? (
                    <tr>
                      <td
                        colSpan={hideSpeedCoDriverInEntryList ? 5 : 6}
                        className="py-10 text-center text-sm text-[var(--ewrc-muted-3)]"
                      >
                        No crews in this class. Pick another class or &quot;All
                        classes&quot;.
                      </td>
                    </tr>
                  ) : (
                    entriesForEntryList.map((row, i) => (
                      <tr
                        key={row.id}
                        className={i % 2 === 1 ? "ewrc-row-alt" : ""}
                      >
                        <td className="text-center font-mono text-[var(--ewrc-ss)]">
                          {row.startNumber}
                        </td>
                        <td className="text-center text-[var(--ewrc-accent-text)]">
                          {row.entrance || "—"}
                        </td>
                        <td className="text-center font-medium text-[var(--ewrc-heading)]">
                          <NameWithOptionalFlag
                            code={row.driverCountryCode ?? ""}
                            name={row.driver}
                            className="font-medium text-[var(--ewrc-heading)]"
                            centered
                          />
                        </td>
                        {!hideSpeedCoDriverInEntryList ? (
                          <td className="text-center text-[var(--ewrc-strong)]">
                            <NameWithOptionalFlag
                              code={row.coDriverCountryCode ?? ""}
                              name={row.coDriver}
                              className="text-[var(--ewrc-strong)]"
                              centered
                            />
                          </td>
                        ) : null}
                        <td className="text-center text-[var(--ewrc-accent-text)]">
                          {row.car || "—"}
                        </td>
                        <td className="text-center text-[var(--ewrc-muted)]">
                          {row.class || "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {entriesSorted.length === 0 ? (
              <p className="p-6 text-center text-sm text-[var(--ewrc-muted-3)]">
                No entries yet. Add crews in Admin → Events.
              </p>
            ) : null}
          </div>
        ) : null}

        {tab === "retirements" ? (
          <div className="ewrc-panel overflow-hidden p-0">
            <p className="border-b border-[var(--ewrc-border)] px-4 py-3 text-sm text-[var(--ewrc-muted-2)]">
              Retirements will be listed here (manual or from timing feed).
            </p>
            <div className="overflow-x-auto">
              <table className="ewrc-table min-w-[640px] w-full text-sm">
                <thead>
                  <tr>
                    <th className="w-12 text-right">#</th>
                    <th className="w-14 text-right">No.</th>
                    <th>Crew</th>
                    <th>Reason</th>
                    <th className="w-20">SS</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-[var(--ewrc-muted-3)]">
                      No retirements
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab === "penalty" ? (
          <div className="ewrc-panel overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="ewrc-table min-w-[560px] w-full text-sm">
                <thead>
                  <tr>
                    <th className="w-14 text-right">No.</th>
                    <th>Crew</th>
                    <th className="w-28">Penalty</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {rallyPenaltyRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-10 text-center text-[var(--ewrc-muted-3)]">
                        No penalties
                      </td>
                    </tr>
                  ) : (
                    rallyPenaltyRows.map((p, i) => (
                      <tr key={p.key} className={i % 2 === 1 ? "ewrc-row-alt" : ""}>
                        <td className="text-right font-mono text-[var(--ewrc-ss)]">
                          {p.startNumber}
                        </td>
                        <td className="align-top py-2.5">
                          <div className="flex flex-col gap-0.5 leading-tight">
                            <span className="text-sm font-medium text-[var(--ewrc-crew)]">
                              {p.driver}
                            </span>
                            <span className="text-sm text-[var(--ewrc-muted)]">
                              {p.coDriver}
                            </span>
                          </div>
                        </td>
                        <td className="font-mono text-[var(--ewrc-strong)]">{p.penalty}</td>
                        <td className="text-[var(--ewrc-muted)]">{p.reason}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab === "final-results" ? (
          <div className="space-y-4">
            <p className="text-sm text-[var(--ewrc-muted-2)]">
              {event.type === "speed"
                ? "Final order uses only the faster of 1st and 2nd run. Trial is not used in final Best/Total. If both runs have no time (e.g. DNF/DNS), Best/Total shows -."
                : "Overall: stage times (incl. jump starts) plus event penalties from the Penalties tab (from their After SS onward)."}
            </p>
            <div className="ewrc-panel overflow-hidden p-0">
              <EntryClassFilterBar
                id="final-results-class-filter"
                value={finalResultsClassFilter}
                onChange={setFinalResultsClassFilter}
                options={entryListClassOptions}
                filteredCount={entriesForFinalResults.length}
                totalCount={entriesStartedSorted.length}
              />
            </div>
            <div className="ewrc-panel overflow-hidden p-0">
              <div className="overflow-x-auto">
                {event.type === "speed" ? (
                  <SpeedFinalTable rows={entriesForFinalResults} />
                ) : (
                  <OverallClassificationTable
                    rows={entriesForFinalResults}
                    stages={competitiveStagesSorted}
                  />
                )}
              </div>
              {entriesStartedSorted.length === 0 ? (
                <p className="p-6 text-center text-sm text-[var(--ewrc-muted-3)]">
                  No entries — add crews in Admin to build the final results
                  grid.
                </p>
              ) : entriesForFinalResults.length === 0 ? (
                <p className="p-6 text-center text-sm text-[var(--ewrc-muted-3)]">
                  No crews in this class. Pick another class or &quot;All classes&quot;.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === "official-notice-board" ? (
          <div className="ewrc-panel p-5 sm:p-6">
            <h2 className="font-ewrc-heading text-sm font-bold uppercase tracking-widest text-[var(--ewrc-muted)]">
              Official Notice Board
            </h2>
            <p className="mt-3 text-sm text-[var(--ewrc-muted-2)]">
              Supplementary Regulations, Bulletins, Steward Decisions, Sportity, and
              additional official documents published by the event admin.
            </p>
            {officialNoticeDocumentsSorted.length === 0 ? (
              <div className="mt-5 rounded-lg border border-[var(--ewrc-border)] bg-[var(--ewrc-input-bg)] px-4 py-5">
                <p className="text-sm text-[var(--ewrc-muted-3)]">
                  No notices published yet.
                </p>
              </div>
            ) : (
              <div className="mt-5 space-y-5">
                {officialNoticeCategories.map((category) => {
                  const rows = officialNoticeDocumentsSorted.filter(
                    (doc) => (doc.category || "Other") === category,
                  );
                  if (rows.length === 0) return null;
                  return (
                    <section
                      key={category}
                      className="overflow-hidden rounded-lg border border-[var(--ewrc-border)]"
                    >
                      <div className="border-b border-[var(--ewrc-border)] bg-[var(--ewrc-input-bg)] px-4 py-2.5">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--ewrc-muted)]">
                          {category}
                        </h3>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="ewrc-table w-full min-w-[560px] text-sm">
                          <thead>
                            <tr>
                              <th>Document</th>
                              <th className="w-44 text-center">Published</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((doc, idx) => {
                              const password = (doc.password ?? "").trim();
                              return (
                              <tr key={doc.id} className={idx % 2 === 1 ? "ewrc-row-alt" : ""}>
                                <td className="py-2.5">
                                  <p className="font-medium text-[var(--ewrc-heading)]">
                                    {doc.title}
                                  </p>
                                  <a
                                    href={doc.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs text-[var(--ewrc-brand)] underline-offset-2 hover:underline"
                                  >
                                    {doc.fileName}
                                  </a>
                                  {password ? (
                                    <p className="mt-1 text-xs text-[var(--ewrc-muted-2)]">
                                      Password:{" "}
                                      <span className="font-mono font-semibold text-[var(--ewrc-heading)]">
                                        {password}
                                      </span>
                                    </p>
                                  ) : null}
                                </td>
                                <td className="text-center text-xs text-[var(--ewrc-muted-2)]">
                                  {new Date(doc.uploadedAt).toLocaleString()}
                                </td>
                              </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </main>
    </>
  );
}

/** Flag image + name when ISO is set; name only when optional nationality is blank. */
function NameWithOptionalFlag({
  code,
  name,
  className,
  centered,
}: {
  code: string;
  name: string;
  className: string;
  centered?: boolean;
}) {
  const showFlag = isIso3166Alpha2(code);
  const inner = (
    <>
      {showFlag ? <FlagImage code={code} size={20} /> : null}
      <span className={className}>{name || "—"}</span>
    </>
  );
  if (centered) {
    return (
      <span className="inline-flex items-center justify-center gap-1.5">
        {inner}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">{inner}</span>
  );
}

/** Stacked driver / co-driver / car — same layout as eWRC-style stage results. */
function CrewStackCell({ row }: { row: Entry }) {
  const hasCoDriver = Boolean((row.coDriver ?? "").trim());
  const showFlagColumn =
    isIso3166Alpha2(row.driverCountryCode ?? "") ||
    (hasCoDriver && isIso3166Alpha2(row.coDriverCountryCode ?? ""));
  return (
    <td className="align-top py-2.5">
      <div className="flex flex-col gap-1 leading-tight">
        {showFlagColumn ? (
          <>
            <div className="grid grid-cols-[1.5rem_1fr] items-center gap-x-2">
              <span className="flex w-5 shrink-0 items-center justify-center">
                <FlagImage code={row.driverCountryCode ?? ""} size={20} />
              </span>
              <span className="text-sm font-medium text-[var(--ewrc-crew)]">
                {row.driver || "—"}
              </span>
            </div>
            {hasCoDriver ? (
              <div className="grid grid-cols-[1.5rem_1fr] items-center gap-x-2">
                <span className="flex w-5 shrink-0 items-center justify-center">
                  <FlagImage code={row.coDriverCountryCode ?? ""} size={20} />
                </span>
                <span className="text-sm font-medium text-[var(--ewrc-crew)]">
                  {row.coDriver}
                </span>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <span className="text-sm font-medium text-[var(--ewrc-crew)]">
              {row.driver || "—"}
            </span>
            {hasCoDriver ? (
              <span className="text-sm font-medium text-[var(--ewrc-crew)]">
                {row.coDriver}
              </span>
            ) : null}
          </>
        )}
        <div
          className={
            showFlagColumn
              ? "pl-[calc(1.375rem+0.5rem)] text-[11px] text-[var(--ewrc-muted-2)]"
              : "text-[11px] text-[var(--ewrc-muted-2)]"
          }
        >
          {row.car || "—"}
        </div>
      </div>
    </td>
  );
}

function DriverOnlyCell({ row }: { row: Entry }) {
  return (
    <td className="align-top py-2.5">
      <NameWithOptionalFlag
        code={row.driverCountryCode ?? ""}
        name={row.driver}
        className="font-medium text-[var(--ewrc-crew)]"
      />
    </td>
  );
}

/** Per-stage times for the leg + penalty, leg total, diff (ALGE fills values). */
function LegResultsTable({
  entries,
  leg,
  stagesInLeg,
  allStages,
}: {
  entries: Entry[];
  /** Selected end-of-leg (LEG 2 sheet may include LEG 1 stages). */
  leg: number;
  stagesInLeg: Stage[];
  allStages: Stage[];
}) {
  type LegRow = {
    row: Entry;
    cells: Array<{
      outcome: "DNS" | "DNF" | "RET" | null;
      durationMs: number | null;
    }>;
    /** 0 = full leg timed, 1 = incomplete (-), 2 = DNS/DNF/RET on any stage */
    sortTier: 0 | 1 | 2;
    rowOutcome: "DNS" | "DNF" | "RET" | null;
    ssTimesMs: number | null;
    totalMs: number | null;
    penaltyMs: number;
  };

  const resultLeg =
    Number.isFinite(leg) && leg >= 1 ? Math.floor(leg) : 1;
  /** Later-leg columns wait for completed/stopped; LEG1 columns show as entered. */
  const laterLegStagesSettled = useMemo(
    () =>
      stagesInLeg
        .filter((st) => stageLegNumber(st) >= 2 && !isStageCancelled(st))
        .every((st) => isStageSettledForLeg(st)),
    [stagesInLeg],
  );
  const totalsReady = resultLeg === 1 || laterLegStagesSettled;
  const sorted = useMemo((): LegRow[] => {
    const legOrders = new Set(stagesInLeg.map((s) => s.order));
    const countingStages = stagesInLeg.filter((st) => !isStageCancelled(st));
    const rows: LegRow[] = entries.map((row) => {
      let jumpPenaltyMs = 0;
      const cells = stagesInLeg.map((st) => {
        // Cancelled SS: always "—" (no times count).
        if (isStageCancelled(st)) {
          return { outcome: null, durationMs: null };
        }
        const values = getRallyStageTimingValues(row, st.id);
        const pen = parsePenaltyDurationMs(values.penaltyValue) ?? 0;
        const stLeg = stageLegNumber(st);
        // LEG1 stages: times as in stage control. Later legs: once completed/stopped.
        if (
          stLeg >= 2 &&
          st.progressStatus !== "completed" &&
          st.progressStatus !== "stopped"
        ) {
          return { outcome: null, durationMs: null };
        }
        jumpPenaltyMs += pen;
        const cell = resolveRallyStageCell(row, st);
        // Per-SS cell is pure stage time; jump starts are in Penalty.
        return {
          outcome: cell.outcome,
          durationMs: cell.durationMs,
        };
      });
      const countingCells = cells.filter((_, i) => !isStageCancelled(stagesInLeg[i]!));
      const rowOutcome = worstLegRowOutcome(countingCells);
      const allTimedNoOutcome =
        countingStages.length > 0 &&
        countingCells.every((c) => c.outcome == null && c.durationMs != null);
      const eventPenaltyMs = totalsReady
        ? getRallyEventPenaltyItems(row)
            .filter((item) => legOrders.has(item.afterStageOrder))
            .reduce(
              (sum, item) => sum + (parsePenaltyDurationMs(item.penalty) ?? 0),
              0,
            )
        : 0;
      const ssTimesMs =
        totalsReady && allTimedNoOutcome
          ? countingCells.reduce((sum, c) => sum + (c.durationMs ?? 0), 0)
          : null;
      const penaltyMs = jumpPenaltyMs + eventPenaltyMs;
      const totalMs =
        ssTimesMs != null ? ssTimesMs + penaltyMs : null;
      const sortTier: 0 | 1 | 2 =
        totalsReady && rowOutcome != null
          ? 2
          : totalMs != null
            ? 0
            : 1;
      return {
        row,
        cells,
        sortTier,
        rowOutcome,
        ssTimesMs,
        totalMs,
        penaltyMs,
      };
    });

    return rows.sort((a, b) => {
      if (a.sortTier !== b.sortTier) return a.sortTier - b.sortTier;
      if (a.sortTier === 0) {
        const ta = a.totalMs ?? 0;
        const tb = b.totalMs ?? 0;
        if (ta !== tb) return ta - tb;
        return a.row.startNumber - b.row.startNumber;
      }
      if (a.sortTier === 2) {
        const oa = a.rowOutcome!;
        const ob = b.rowOutcome!;
        const ka = legOutcomeSortKey(oa);
        const kb = legOutcomeSortKey(ob);
        if (ka !== kb) return ka - kb;
        return a.row.startNumber - b.row.startNumber;
      }
      return a.row.startNumber - b.row.startNumber;
    });
  }, [entries, stagesInLeg, totalsReady]);

  const leaderTotal = sorted.find((x) => x.sortTier === 0)?.totalMs ?? null;

  if (stagesInLeg.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-[var(--ewrc-muted-3)]">
        No stages in this leg.
      </p>
    );
  }

  if (sorted.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-[var(--ewrc-muted-3)]">
        No entries for this leg list yet.
      </p>
    );
  }

  return (
    <table className="ewrc-table w-full min-w-max text-sm">
      <thead>
        <tr>
          <th className="w-8 text-right">Pos</th>
          <th className="w-8 text-right">#</th>
          <th className="min-w-[11rem]">Crew</th>
          <th className="w-14 !text-center">Class</th>
          {stagesInLeg.map((st) => (
            <th key={st.id} className="w-16 whitespace-nowrap !text-center">
              {stageChipLabel(st, allStages)}
            </th>
          ))}
          <th className="w-20 !text-center">SS Times</th>
          <th className="w-20 !text-center">Penalty</th>
          <th className="w-24 !text-center">Total</th>
          <th className="w-20 !text-center">Diff</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((legRow, i) => {
          const {
            row,
            cells,
            sortTier,
            rowOutcome,
            ssTimesMs,
            totalMs,
            penaltyMs,
          } = legRow;
          return (
            <tr key={row.id} className={i % 2 === 1 ? "ewrc-row-alt" : ""}>
              <td className="align-top text-right font-mono text-[var(--ewrc-strong)]">
                {i + 1}
              </td>
              <td className="align-top text-right font-mono text-[var(--ewrc-ss)]">
                {row.startNumber}
              </td>
              <CrewStackCell row={row} />
              <td className="align-middle !text-center text-[11px] text-[var(--ewrc-muted)] sm:text-xs">
                {row.class || "—"}
              </td>
              {cells.map((c, idx) => (
                <td
                  key={stagesInLeg[idx]!.id}
                  className="align-middle !text-center font-mono text-[11px] text-[var(--ewrc-strong)] sm:text-xs"
                >
                  {c.outcome != null
                    ? c.outcome
                    : formatDurationMs(c.durationMs)}
                </td>
              ))}
              <td className="align-middle !text-center font-mono text-[11px] text-[var(--ewrc-strong)] sm:text-xs">
                {totalsReady && rowOutcome != null
                  ? rowOutcome
                  : formatDurationMs(ssTimesMs)}
              </td>
              <td className="align-middle !text-center font-mono text-[11px] text-[var(--ewrc-heading)] sm:text-xs">
                {penaltyMs > 0 ? formatDurationMs(penaltyMs) : "—"}
              </td>
              <td className="align-middle !text-center font-mono text-[11px] text-[var(--ewrc-strong)] sm:text-xs">
                {totalsReady && rowOutcome != null
                  ? rowOutcome
                  : formatDurationMs(totalMs)}
              </td>
              <td className="align-middle !text-center font-mono text-[11px] text-[var(--ewrc-heading)] sm:text-xs">
                {sortTier !== 0 ||
                leaderTotal == null ||
                totalMs == null ||
                totalMs <= leaderTotal
                  ? "—"
                  : `+${formatDiffDurationMs(totalMs - leaderTotal)}`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** "After SSx" view: SS Times, Penalty, Total (= SS Times + Penalty). */
function CumulativeAfterStageTable({
  entries,
  stages,
}: {
  entries: Entry[];
  stages: Stage[];
}) {
  const sorted = useMemo(
    () => buildRallyOverallRanking(entries, stages),
    [entries, stages],
  );
  const leaderTotal = sorted.find((x) => x.tier === 0)?.totalMs ?? null;

  if (stages.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-[var(--ewrc-muted-3)]">
        No prior stages to total.
      </p>
    );
  }

  if (sorted.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-[var(--ewrc-muted-3)]">
        No crew has finished every stage up to here yet.
      </p>
    );
  }

  let classifiedPos = 0;

  return (
    <table className="ewrc-table ewrc-table-speed-run min-w-[560px] w-full text-sm">
      <thead>
        <tr>
          <th className="w-10 text-right">Pos</th>
          <th className="w-10 text-right">#</th>
          <th className="min-w-[10rem]">Crew</th>
          <th className="w-28 !text-center">SS Times</th>
          <th className="w-24 !text-center">Penalty</th>
          <th className="w-28 !text-center">Total time</th>
          <th className="w-24 !text-center">Diff</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map(
          ({ row, ssTimesMs, totalMs, penaltyMs, tier, statusLabel }, i) => {
            const pos = tier === 0 ? String(++classifiedPos) : "—";
            return (
              <tr key={row.id} className={i % 2 === 1 ? "ewrc-row-alt" : ""}>
                <td className="align-top text-right font-mono text-[var(--ewrc-strong)]">
                  {pos}
                </td>
                <td className="align-top text-right font-mono text-[var(--ewrc-ss)]">
                  {row.startNumber}
                </td>
                <CrewStackCell row={row} />
                <td className="align-middle text-center font-mono text-[var(--ewrc-strong)]">
                  {tier === 0
                    ? formatDurationMs(ssTimesMs)
                    : (statusLabel ?? "—")}
                </td>
                <td className="align-middle text-center font-mono text-[var(--ewrc-heading)]">
                  {tier === 0 && penaltyMs > 0
                    ? formatDurationMs(penaltyMs)
                    : "—"}
                </td>
                <td className="align-middle text-center font-mono text-[var(--ewrc-strong)]">
                  {tier === 0
                    ? formatDurationMs(totalMs)
                    : (statusLabel ?? "—")}
                </td>
                <td className="align-middle text-center font-mono text-[var(--ewrc-heading)]">
                  {tier === 0 &&
                  leaderTotal != null &&
                  totalMs != null &&
                  totalMs > leaderTotal
                    ? `+${formatDiffDurationMs(totalMs - leaderTotal)}`
                    : "—"}
                </td>
              </tr>
            );
          },
        )}
      </tbody>
    </table>
  );
}

function StageTimesTable({
  entries,
  stage,
}: {
  entries: Entry[];
  stage?: Stage;
}) {
  const stageId = stage?.id;
  const shakedown = !!stage && isShakedownStage(stage);
  const shakedownPasses = shakedown && stage ? getShakedownPassCount(stage) : 3;
  const timeDigits: 2 | 3 =
    stage && isPreEventStage(stage) ? 3 : 2;

  const shakedownSorted = useMemo(() => {
    if (!shakedown || !stageId || !stage) return [];
    const passCount = getShakedownPassCount(stage);
    return [...entries]
      .map((row) => {
        const blob = parseRallyStageTimingBlob(row.trialStartTime ?? "");
        const passes = getShakedownPasses(blob[stageId], passCount);
        const durations = getShakedownPassDurationsMs(
          passes,
          parseClockToDayMs,
          passCount,
        );
        const bestMs = findShakedownBestDurationMs(durations);
        const bestIdx = findShakedownBestPassIndex(durations);
        return { row, durations, bestMs, bestIdx };
      })
      .filter(
        (x): x is {
          row: Entry;
          durations: Array<number | null>;
          bestMs: number;
          bestIdx: number | null;
        } => x.bestMs != null,
      )
      .sort((a, b) =>
        a.bestMs !== b.bestMs
          ? a.bestMs - b.bestMs
          : a.row.startNumber - b.row.startNumber,
      );
  }, [entries, stageId, shakedown, stage]);

  const showRally2 = !!stage && stageAllowsRally2(stage);
  const sorted = useMemo(() => {
    if (shakedown || !stage || !stageId) return [];
    return [...entries]
      .map((row) => {
        const values = getRallyStageTimingValues(row, stageId);
        const cell = resolveRallyStageCell(row, stage);
        const penaltyMs = parsePenaltyDurationMs(values.penaltyValue);
        const pen = penaltyMs ?? 0;
        const rally2 = showRally2 && cell.rally2;
        if (cell.durationMs == null) {
          return {
            row,
            durationMs: null as number | null,
            penaltyMs,
            penaltyRaw: values.penaltyValue,
            rally2,
          };
        }
        // Jump-start penalties are added into the published stage time.
        return {
          row,
          durationMs: cell.durationMs + pen,
          penaltyMs,
          penaltyRaw: values.penaltyValue,
          rally2,
        };
      })
      .filter(
        (x): x is {
          row: Entry;
          durationMs: number;
          penaltyMs: number | null;
          penaltyRaw: string;
          rally2: boolean;
        } => x.durationMs != null,
      )
      .sort((a, b) =>
        a.durationMs !== b.durationMs
          ? a.durationMs - b.durationMs
          : a.row.startNumber - b.row.startNumber,
      );
  }, [entries, stage, stageId, shakedown, showRally2]);
  const hasRally2Marker = sorted.some((x) => x.rally2);
  const leaderMs = shakedown
    ? (shakedownSorted[0]?.bestMs ?? null)
    : (sorted[0]?.durationMs ?? null);

  if (stage && isStageCancelled(stage)) {
    return (
      <p className="p-6 text-center text-sm text-[var(--ewrc-muted-3)]">
        Stage cancelled — no times.
      </p>
    );
  }

  if (shakedown) {
    if (shakedownSorted.length === 0) {
      return (
        <p className="p-6 text-center text-sm text-[var(--ewrc-muted-3)]">
          No timed entries for this stage yet.
        </p>
      );
    }
    return (
      <table className="ewrc-table ewrc-table-speed-run min-w-[560px] w-full text-sm">
        <thead>
          <tr>
            <th className="w-12 text-right">Pos</th>
            <th className="w-12 text-right">#</th>
            <th className="min-w-[10rem]">Crew</th>
            {Array.from({ length: shakedownPasses }, (_, pi) => (
              <th key={pi} className="w-24 !text-center">
                {pi + 1}
              </th>
            ))}
            <th className="w-28 !text-center">Best</th>
            <th className="w-24 !text-center">Diff</th>
          </tr>
        </thead>
        <tbody>
          {shakedownSorted.map(({ row, durations, bestMs, bestIdx }, i) => (
            <tr key={row.id} className={i % 2 === 1 ? "ewrc-row-alt" : ""}>
              <td className="align-top text-right font-mono text-[var(--ewrc-strong)]">
                {i + 1}
              </td>
              <td className="align-top text-right font-mono text-[var(--ewrc-ss)]">
                {row.startNumber}
              </td>
              <CrewStackCell row={row} />
              {Array.from({ length: shakedownPasses }, (_, pi) => {
                const d = durations[pi];
                const isBest = bestIdx === pi && d != null;
                return (
                  <td
                    key={pi}
                    className={`align-middle text-center font-mono ${
                      isBest
                        ? "font-bold text-[var(--ewrc-strong)]"
                        : "text-[var(--ewrc-heading)]"
                    }`}
                  >
                    {d != null ? formatDurationMs(d, timeDigits) : "—"}
                  </td>
                );
              })}
              <td className="align-middle text-center font-mono font-bold text-[var(--ewrc-strong)]">
                {formatDurationMs(bestMs, timeDigits)}
              </td>
              <td className="align-middle text-center font-mono text-[var(--ewrc-heading)]">
                {leaderMs == null || bestMs <= leaderMs
                  ? "—"
                  : `+${formatDiffDurationMs(bestMs - leaderMs, timeDigits)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (sorted.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-[var(--ewrc-muted-3)]">
        No timed entries for this stage yet.
      </p>
    );
  }

  return (
    <div>
      <table className="ewrc-table ewrc-table-speed-run min-w-[480px] w-full text-sm">
        <thead>
          <tr>
            <th className="w-12 text-right">Pos</th>
            <th className="w-12 text-right">#</th>
            <th className="min-w-[10rem]">Crew</th>
            <th className="w-28 !text-center">Time</th>
            <th className="w-24 !text-center">Penalty</th>
            <th className="w-24 !text-center">Diff</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ row, durationMs, penaltyRaw, rally2 }, i) => (
            <tr key={row.id} className={i % 2 === 1 ? "ewrc-row-alt" : ""}>
              <td className="align-top text-right font-mono text-[var(--ewrc-strong)]">
                {i + 1}
              </td>
              <td className="align-top text-right font-mono text-[var(--ewrc-ss)]">
                {rally2 ? `*${row.startNumber}` : row.startNumber}
              </td>
              <CrewStackCell row={row} />
              <td className="align-middle text-center font-mono text-[var(--ewrc-strong)]">
                {formatDurationMs(durationMs, timeDigits)}
              </td>
              <td className="align-middle text-center font-mono text-[var(--ewrc-heading)]">
                {penaltyRaw.trim() ? penaltyRaw.trim() : "—"}
              </td>
              <td className="align-middle text-center font-mono text-[var(--ewrc-heading)]">
                {leaderMs == null || durationMs <= leaderMs
                  ? "—"
                  : `+${formatDiffDurationMs(durationMs - leaderMs, timeDigits)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hasRally2Marker ? (
        <p className="mt-3 px-1 text-xs text-[var(--ewrc-muted-2)]">
          {RALLY2_FOOTNOTE}
        </p>
      ) : null}
    </div>
  );
}

function SpeedRunTable({
  entries,
  runId,
}: {
  entries: Entry[];
  runId: "trial" | "run1" | "run2";
}) {
  const sorted = useMemo(
    () =>
      [...entries].sort((a, b) => {
        const ta = getSpeedRunDurationMs(a, runId);
        const tb = getSpeedRunDurationMs(b, runId);
        if (ta == null && tb == null) return a.startNumber - b.startNumber;
        if (ta == null) return 1;
        if (tb == null) return -1;
        if (ta !== tb) return ta - tb;
        return a.startNumber - b.startNumber;
      }),
    [entries, runId],
  );
  const leaderMs = useMemo(() => {
    for (const row of sorted) {
      const t = getSpeedRunDurationMs(row, runId);
      if (t != null) return t;
    }
    return null;
  }, [runId, sorted]);

  if (sorted.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-[var(--ewrc-muted-3)]">
        No entries for this run yet.
      </p>
    );
  }

  return (
    <table className="ewrc-table ewrc-table-speed-run min-w-[420px] w-full text-sm">
      <thead>
        <tr>
          <th className="w-12 !text-center">Pos</th>
          <th className="w-12 !text-center">#</th>
          <th className="min-w-[10rem]">Driver</th>
          <th className="w-28 !text-center">Time</th>
          <th className="w-24 !text-center">Diff</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((row, i) => (
          <tr key={row.id} className={i % 2 === 1 ? "ewrc-row-alt" : ""}>
            <td className="align-top !text-center font-mono text-[var(--ewrc-pos)]">
              {i + 1}
            </td>
            <td className="align-top !text-center font-mono text-[var(--ewrc-ss)]">
              {row.startNumber}
            </td>
            <DriverOnlyCell row={row} />
            <td className="align-middle !text-center">
              <span className="flex w-full justify-center text-center font-mono text-[var(--ewrc-strong)]">
                {getSpeedRunOutcomeLabel(row, runId) ??
                  formatDurationMs(getSpeedRunDurationMs(row, runId))}
              </span>
            </td>
            <td className="align-middle !text-center">
              <span className="flex w-full justify-center text-center font-mono text-[var(--ewrc-heading)]">
                {(() => {
                  const t = getSpeedRunDurationMs(row, runId);
                  if (t == null || leaderMs == null) return "—";
                  const diff = t - leaderMs;
                  if (diff <= 0) return "—";
                  return `+${formatDiffDurationMs(diff)}`;
                })()}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OverallClassificationTable({
  rows,
  stages,
}: {
  rows: Entry[];
  stages: Stage[];
}) {
  const sorted = useMemo(
    () => buildRallyFinalRanking(rows, stages),
    [rows, stages],
  );
  const leaderTotal = sorted.find((x) => x.tier === 0)?.totalMs ?? null;
  const displayRows = useMemo(() => {
    let classifiedPos = 0;
    return sorted.map((item) => ({
      ...item,
      pos: item.tier === 0 ? ++classifiedPos : null,
    }));
  }, [sorted]);

  if (stages.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-[var(--ewrc-muted-3)]">
        No stages configured yet.
      </p>
    );
  }

  if (sorted.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-[var(--ewrc-muted-3)]">
        Final results appear once crews have times, retirements, or non-starters.
      </p>
    );
  }

  return (
    <table className="ewrc-table min-w-[720px] w-full text-sm">
      <thead>
        <tr>
          <th className="w-8 text-right">Pos</th>
          <th className="w-8 text-right">#</th>
          <th className="min-w-[11rem]">Crew</th>
          <th className="w-14 !text-center">Class</th>
          <th className="w-28 !text-center">Time</th>
          <th className="w-24 !text-center">Penalty</th>
          <th className="w-28 !text-center">Total time</th>
          <th className="w-24 !text-center">Diff</th>
        </tr>
      </thead>
      <tbody>
        {displayRows.map(
          ({ row, timeMs, penaltyMs, totalMs, tier, statusLabel, pos }, i) => (
            <tr key={row.id} className={i % 2 === 1 ? "ewrc-row-alt" : ""}>
              <td className="align-top text-right font-mono text-[var(--ewrc-strong)]">
                {pos ?? "—"}
              </td>
              <td className="align-top text-right font-mono text-[var(--ewrc-ss)]">
                {row.startNumber}
              </td>
              <CrewStackCell row={row} />
              <td className="align-middle !text-center text-[11px] text-[var(--ewrc-muted)] sm:text-xs">
                {row.class || "—"}
              </td>
              <td className="align-middle !text-center font-mono text-[11px] text-[var(--ewrc-strong)] sm:text-xs">
                {tier === 0 ? formatDurationMs(timeMs) : "—"}
              </td>
              <td className="align-middle !text-center font-mono text-[11px] text-[var(--ewrc-heading)] sm:text-xs">
                {tier === 0 && penaltyMs > 0 ? formatDurationMs(penaltyMs) : "—"}
              </td>
              <td className="align-middle !text-center font-mono text-[11px] text-[var(--ewrc-strong)] sm:text-xs">
                {tier === 0
                  ? formatDurationMs(totalMs)
                  : statusLabel ?? "—"}
              </td>
              <td className="align-middle !text-center font-mono text-[11px] text-[var(--ewrc-heading)] sm:text-xs">
                {tier === 0 &&
                leaderTotal != null &&
                totalMs != null &&
                totalMs > leaderTotal
                  ? `+${formatDiffDurationMs(totalMs - leaderTotal)}`
                  : "—"}
              </td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}

function SpeedBestTable({ rows }: { rows: Entry[] }) {
  const sorted = useMemo(
    () =>
      [...rows]
        .map((row) => {
          const bestFromRuns = getSpeedBestFromRunsMs(row);
          const trial = getSpeedRunDurationMs(row, "trial");
          const best = bestFromRuns ?? trial;
          const tier = bestFromRuns != null ? 0 : trial != null ? 1 : 2;
          return { row, best, bestFromRuns, tier };
        })
        .filter((x): x is { row: Entry; best: number; bestFromRuns: number | null; tier: number } => x.best != null)
        .sort((a, b) =>
          a.tier !== b.tier
            ? a.tier - b.tier
            : a.best !== b.best
              ? a.best - b.best
              : a.row.startNumber - b.row.startNumber,
        ),
    [rows],
  );
  const leaderBest = sorted.find((x) => x.bestFromRuns != null)?.bestFromRuns ?? sorted[0]?.best ?? null;

  return (
    <table className="ewrc-table ewrc-table-speed-best min-w-[520px] w-full text-sm sm:min-w-[620px]">
      <thead>
        <tr>
          <th className="w-12 !text-center">Pos</th>
          <th className="w-12 !text-center">#</th>
          <th className="min-w-[10rem]">Driver</th>
          <th className="w-24 !text-center">Best</th>
          <th className="w-24 !text-center">Diff</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map(({ row, best, bestFromRuns }, i) => (
          <tr key={row.id} className={i % 2 === 1 ? "ewrc-row-alt" : ""}>
            <td className="align-top !text-center font-mono text-[var(--ewrc-pos)]">
              {i + 1}
            </td>
            <td className="align-top !text-center font-mono text-[var(--ewrc-ss)]">
              {row.startNumber}
            </td>
            <DriverOnlyCell row={row} />
            <td className="align-middle text-center font-mono text-[var(--ewrc-strong)]">
              {formatDurationMs(best)}
            </td>
            <td className="align-middle text-center font-mono text-[var(--ewrc-heading)]">
              {leaderBest == null ||
              bestFromRuns == null ||
              bestFromRuns <= leaderBest
                ? "—"
                : `+${formatDiffDurationMs(bestFromRuns - leaderBest)}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SpeedFinalTable({ rows }: { rows: Entry[] }) {
  const sorted = useMemo(() => buildSpeedFinalRanking(rows), [rows]);
  const leaderBest = sorted.find((x) => x.tier === 0)?.bestFromRuns ?? null;

  return (
    <table className="ewrc-table ewrc-table-speed-final min-w-[760px] w-full text-sm">
      <thead>
        <tr>
          <th className="w-12 text-center">Pos</th>
          <th className="w-12 text-center">#</th>
          <th className="min-w-[10rem]">Driver</th>
          <th className="min-w-[8rem] text-center">Car</th>
          <th className="w-20 text-center">Class</th>
          <th className="w-24 text-center">Trial</th>
          <th className="w-24 text-center">1st Run</th>
          <th className="w-24 text-center">2nd Run</th>
          <th className="w-24 text-center">Best</th>
          <th className="w-24 text-center">Diff</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map(({ row, trial, run1, run2, bestFromRuns, bestDisplay, nonStarter }, i) => (
          <tr key={row.id} className={i % 2 === 1 ? "ewrc-row-alt" : ""}>
            <td className="align-top text-center font-mono text-[var(--ewrc-pos)]">
              {i + 1}
            </td>
            <td className="align-top text-center font-mono text-[var(--ewrc-ss)]">
              {row.startNumber}
            </td>
            <DriverOnlyCell row={row} />
            <td className="align-middle text-center text-[var(--ewrc-accent-text)]">
              {row.car || "—"}
            </td>
            <td className="align-middle text-center text-[var(--ewrc-muted)]">
              {row.class || "—"}
            </td>
            <td className="align-middle text-center font-mono text-[var(--ewrc-strong)]">
              {nonStarter
                ? "-"
                : getSpeedRunOutcomeLabel(row, "trial") ?? formatDurationMs(trial)}
            </td>
            <td className="align-middle text-center font-mono text-[var(--ewrc-strong)]">
              {nonStarter
                ? "-"
                : getSpeedRunOutcomeLabel(row, "run1") ?? formatDurationMs(run1)}
            </td>
            <td className="align-middle text-center font-mono text-[var(--ewrc-strong)]">
              {nonStarter
                ? "-"
                : getSpeedRunOutcomeLabel(row, "run2") ?? formatDurationMs(run2)}
            </td>
            <td className="align-middle text-center font-mono text-[var(--ewrc-strong)]">
              {nonStarter
                ? "NON STARTER"
                : bestDisplay != null
                  ? formatDurationMs(bestDisplay)
                  : "-"}
            </td>
            <td className="align-middle text-center font-mono text-[var(--ewrc-heading)]">
              {nonStarter ||
              leaderBest == null ||
              bestFromRuns == null ||
              bestFromRuns <= leaderBest
                ? "-"
                : `+${formatDiffDurationMs(bestFromRuns - leaderBest)}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StageProgressDot({ status }: { status: StageProgressStatus }) {
  const base =
    "inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-[var(--ewrc-dot-ring)]";
  switch (status) {
    case "live":
      return (
        <span
          className={`${base} bg-[var(--ewrc-green)] shadow-[0_0_10px_rgba(34,197,94,0.45)]`}
          title="Live"
          aria-label="Stage live"
        />
      );
    case "completed":
      return (
        <span
          className={`${base} bg-[var(--ewrc-red)]`}
          title="Completed"
          aria-label="Stage completed"
        />
      );
    case "cancelled":
      return (
        <span
          className={`${base} bg-[var(--ewrc-black)]`}
          title="Cancelled"
          aria-label="Stage cancelled"
        />
      );
    case "stopped":
      return (
        <span
          className={`${base} bg-[var(--ewrc-blue)]`}
          title="Stopped"
          aria-label="Stage stopped"
        />
      );
    default:
      return (
        <span
          className={`${base} bg-[var(--ewrc-yellow)]`}
          title="Not started"
          aria-label="Stage not started"
        />
      );
  }
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[var(--ewrc-border)] bg-[var(--ewrc-input-bg)] px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ewrc-muted-3)]">
        {label}
      </p>
      <p className="font-ewrc-heading mt-1 text-xl font-bold text-[var(--ewrc-heading)]">
        {value}
      </p>
    </div>
  );
}

function formatEventDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatEventDateRange(startIso: string, endIso: string): string {
  if (!startIso) return "Date TBA";
  if (!endIso || endIso === startIso) return formatEventDate(startIso);

  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${formatEventDate(startIso)} - ${formatEventDate(endIso)}`;
  }

  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();

  if (sameMonth) {
    const monthYear = start.toLocaleDateString("en-GB", {
      month: "short",
      year: "numeric",
    });
    return `${start.getDate()}-${end.getDate()} ${monthYear}`;
  }

  if (sameYear) {
    const startLeft = start.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
    const endRight = end.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    return `${startLeft} - ${endRight}`;
  }

  return `${formatEventDate(startIso)} - ${formatEventDate(endIso)}`;
}

function normalizeLogoUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (/^data:/i.test(value)) return value;
  if (/^blob:/i.test(value)) return value;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return value;
  return `/${value}`;
}

/** Display ALGE/admin stage start as HH:MM in the On Stage strip. */
function formatOnStageStartHm(value: string): string {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return value.trim() || "—";
  return `${m[1]!.padStart(2, "0")}:${m[2]}`;
}

type RallyPublicPenaltyRow = {
  key: string;
  startNumber: number;
  driver: string;
  coDriver: string;
  penalty: string;
  reason: string;
};

function collectRallyPublicPenalties(
  entries: Entry[],
  stages: Stage[],
): RallyPublicPenaltyRow[] {
  const out: RallyPublicPenaltyRow[] = [];
  for (const row of entries) {
    for (const st of stages) {
      const values = getRallyStageTimingValues(row, st.id);
      if (!values.penaltyValue) continue;
      out.push({
        key: `${row.id}-ss-${st.id}`,
        startNumber: row.startNumber,
        driver: row.driver || "—",
        coDriver: row.coDriver || "—",
        penalty: values.penaltyValue,
        reason: values.penaltyNoteValue || `Jump Start SS${st.order}`,
      });
    }
    for (const item of getRallyEventPenaltyItems(row)) {
      out.push({
        key: `${row.id}-event-${item.id}`,
        startNumber: row.startNumber,
        driver: row.driver || "—",
        coDriver: row.coDriver || "—",
        penalty: item.penalty,
        reason:
          item.note ||
          `Event penalty (After SS${item.afterStageOrder})`,
      });
    }
  }
  return out.sort((a, b) =>
    a.startNumber !== b.startNumber
      ? a.startNumber - b.startNumber
      : a.reason.localeCompare(b.reason),
  );
}

