"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { FlagImage } from "@/components/flag-image";
import { isIso3166Alpha2 } from "@/lib/flags";
import type {
  Entry,
  RallyEvent,
  SiteSettings,
  Stage,
  StageProgressStatus,
} from "@/lib/rally/types";

const RALLY_TABS = [
  { id: "overview", label: "Overview" },
  { id: "stage-results", label: "Live results" },
  { id: "itinerary", label: "Itinerary" },
  { id: "entries", label: "Entry List" },
  { id: "retirements", label: "Retirements" },
  { id: "penalty", label: "Penalty" },
  { id: "final-results", label: "Final Results" },
] as const;

const SPEED_TABS = [
  { id: "overview", label: "Overview" },
  { id: "stage-results", label: "Live results" },
  { id: "entries", label: "Entry List" },
  { id: "final-results", label: "Final Results" },
] as const;

type TabId = (typeof RALLY_TABS)[number]["id"];

type ResultsSubView = "stage" | "overall";
type SpeedRunId = "trial" | "run1" | "run2" | "best";
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

type Props = {
  site: SiteSettings;
  event: RallyEvent;
  topCrumb?: { href: string; label: string };
};

function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

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
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  options: { nonEmpty: string[]; hasEmpty: boolean };
  filteredCount: number;
  totalCount: number;
}) {
  if (totalCount === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--ewrc-border)] px-4 py-3">
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
  );
}

export function RallyPublicView({ site, event, topCrumb }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("overview");
  const [selectedStripId, setSelectedStripId] = useState<string | null>(null);
  const [resultsSubView, setResultsSubView] =
    useState<ResultsSubView>("stage");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const tabs = event.type === "speed" ? SPEED_TABS : RALLY_TABS;

  /** Entry List tab: empty string = all classes; "__EMPTY__" = crews with no class set. */
  const [entryListClassFilter, setEntryListClassFilter] = useState("");
  /** Stage results tab (stage + overall sub-views): same filter semantics. */
  const [stageResultsClassFilter, setStageResultsClassFilter] = useState("");

  const stagesSorted = useMemo(
    () => [...event.stages].sort((a, b) => a.order - b.order),
    [event.stages],
  );

  const entriesSorted = useMemo(
    () => [...event.entries].sort((a, b) => a.startNumber - b.startNumber),
    [event.entries],
  );
  const entriesStartedSorted = useMemo(
    () => entriesSorted.filter((e) => e.start !== false),
    [entriesSorted],
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

  const totalKm = useMemo(
    () =>
      stagesSorted.reduce(
        (acc, s) => acc + (typeof s.distanceKm === "number" ? s.distanceKm : 0),
        0,
      ),
    [stagesSorted],
  );

  /** Leg groups in stage order (first time a leg appears defines section order). */
  const itineraryByLeg = useMemo(() => {
    const ordered = [...event.stages].sort((a, b) => a.order - b.order);
    const legOrder: number[] = [];
    const seen = new Set<number>();
    for (const s of ordered) {
      if (!seen.has(s.leg)) {
        seen.add(s.leg);
        legOrder.push(s.leg);
      }
    }
    const map = new Map<number, Stage[]>();
    for (const s of ordered) {
      const list = map.get(s.leg);
      if (list) list.push(s);
      else map.set(s.leg, [s]);
    }
    return legOrder.map((leg) => ({ leg, stages: map.get(leg)! }));
  }, [event.stages]);

  /** Stage strip + “End of leg N” after each leg’s last stage (running order). */
  const resultsStripItems = useMemo((): ResultsStripItem[] => {
    if (event.type === "speed") {
      return SPEED_RUNS.map((r) => ({
        id: `sp-${r.id}`,
        type: "speedRun",
        runId: r.id,
        label: r.label,
        progressStatus:
          r.id === "best"
            ? "completed"
            : event.speedRunImportStatus?.[r.id] === "live"
              ? "live"
              : event.speedRunImportStatus?.[r.id] === "completed"
                ? "completed"
                : "pending",
      }));
    }
    const sorted = stagesSorted;
    const out: ResultsStripItem[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i];
      out.push({ id: `st-${s.id}`, type: "stage", stage: s });
      const next = sorted[i + 1];
      if (!next || next.leg !== s.leg) {
        let runStart = i;
        while (runStart > 0 && sorted[runStart - 1].leg === s.leg) {
          runStart--;
        }
        out.push({
          id: `le-${s.id}`,
          type: "legEnd",
          leg: s.leg,
          stagesInLeg: sorted.slice(runStart, i + 1),
        });
      }
    }
    return out;
  }, [event.type, stagesSorted]);

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
  const entriesForSelectedSpeedRun = useMemo(() => {
    if (!selectedStripItem || selectedStripItem.type !== "speedRun") return [];
    if (selectedStripItem.runId === "best") {
      return entriesForStageResults.filter(
        (row) =>
          getSpeedRunDurationMs(row, "run1") != null ||
          getSpeedRunDurationMs(row, "run2") != null,
      );
    }
    const runId = selectedStripItem.runId as "trial" | "run1" | "run2";
    return entriesForStageResults.filter(
      (row) => getSpeedRunDurationMs(row, runId) != null,
    );
  }, [entriesForStageResults, selectedStripItem]);

  function printStageResultsPdf() {
    if (!selectedStripItem) return;

    const rows = [...entriesForStageResults];
    const headingStage =
      selectedStripItem.type === "stage"
        ? `SS${selectedStripItem.stage.order} ${selectedStripItem.stage.name}`
        : selectedStripItem.type === "legEnd"
          ? `LEG${selectedStripItem.leg} Results`
          : selectedStripItem.label;
    const headingMode = "Results";
    const logoUrl = normalizedLogoUrl;

    let columns: string[] = [];
    let tableRows: string[][] = [];

    if (event.type === "speed" && selectedStripItem.type === "speedRun" && selectedStripItem.runId === "best") {
      columns = [
        "Pos",
        "#",
        "Driver",
        "Trial",
        "1st Run",
        "2nd Run",
        "Best",
        "Diff",
      ];
      tableRows = rows.map((r, i) => [
        String(i + 1),
        String(r.startNumber),
        r.driver || "—",
        "—",
        "—",
        "—",
        "—",
        "—",
      ]);
    } else if (selectedStripItem.type === "legEnd") {
      columns = [
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
      ];
      tableRows = rows.map((r, i) => [
        String(i + 1),
        String(r.startNumber),
        r.driver || "—",
        r.coDriver || "—",
        r.car || "—",
        r.class || "—",
        "—",
        "—",
        "—",
        "—",
      ]);
    } else if (
      event.type === "speed" &&
      selectedStripItem.type === "speedRun" &&
      selectedStripItem.runId !== "best"
    ) {
      const runId = selectedStripItem.runId;
      const ranked = [...rows]
        .map((r) => ({ r, t: getSpeedRunDurationMs(r, runId) }))
        .filter((x): x is { r: Entry; t: number } => x.t != null)
        .sort((a, b) => (a.t !== b.t ? a.t - b.t : a.r.startNumber - b.r.startNumber));
      const leader = ranked[0]?.t ?? null;
      columns = [
        "Pos",
        "#",
        "Driver",
        "Time",
        "Diff",
      ];
      tableRows = ranked.map(({ r, t }, i) => [
        String(i + 1),
        String(r.startNumber),
        r.driver || "—",
        formatDurationMs(t),
        leader == null || t <= leader ? "—" : `+${formatDiffDurationMs(t - leader)}`,
      ]);
    } else {
      columns = ["Pos", "#", "Driver", "Co-driver", "Car", "Time", "Diff"];
      tableRows = rows.map((r, i) => [
        String(i + 1),
        String(r.startNumber),
        r.driver || "—",
        r.coDriver || "—",
        r.car || "—",
        "—",
        "—",
      ]);
    }

    const headHtml = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
    const bodyHtml =
      tableRows.length > 0
        ? tableRows
            .map(
              (r) =>
                `<tr>${r.map((v) => `<td>${escapeHtml(v)}</td>`).join("")}</tr>`,
            )
            .join("")
        : `<tr><td colspan="${columns.length}" style="text-align:center;color:#666;">No crews in this class.</td></tr>`;

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(event.name)} - ${escapeHtml(headingStage)}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; margin: 24px; color: #111; }
    .page { max-width: 1120px; margin: 0 auto; }
    .header { display: flex; flex-direction: column; align-items: center; gap: 8px; margin-bottom: 14px; text-align: center; }
    .logo-wrap { min-height: 10px; display: flex; justify-content: center; }
    .logo { max-height: 72px; width: auto; }
    .header-text { text-align: center; }
    h1 { margin: 0; font-size: 22px; line-height: 1.15; }
    h2 { margin: 6px 0 0; font-size: 16px; font-weight: 600; line-height: 1.2; }
    h3 { margin: 4px 0 0; font-size: 13px; font-weight: 500; color: #444; text-transform: uppercase; letter-spacing: .04em; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 0 auto; }
    th, td { border: 1px solid #cfcfcf; padding: 6px 8px; vertical-align: middle; }
    th { background: #f4f4f4; text-align: left; }
    @media print {
      @page { size: A4 portrait; margin: 12mm; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="logo-wrap">
        ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="Rally logo" class="logo" />` : ""}
      </div>
      <div class="header-text">
        <h1>${escapeHtml(event.name)}</h1>
        <h2>${escapeHtml(headingStage)}</h2>
        <h3>${escapeHtml(headingMode)}</h3>
      </div>
    </div>
    <table>
      <thead><tr>${headHtml}</tr></thead>
      <tbody>${bodyHtml}</tbody>
    </table>
  </div>
</body>
</html>`;

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);

    const cleanup = () => {
      window.setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 1000);
    };

    iframe.onload = () => {
      try {
        const w = iframe.contentWindow;
        if (!w) return;
        w.focus();
        w.print();
      } finally {
        cleanup();
      }
    };

    const doc = iframe.contentDocument;
    if (!doc) {
      cleanup();
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
  }

  function printSpeedFinalResultsPdf() {
    if (event.type !== "speed") return;
    const ranked = [...entriesStartedSorted]
      .map((row) => {
        const trial = getSpeedRunDurationMs(row, "trial");
        const run1 = getSpeedRunDurationMs(row, "run1");
        const run2 = getSpeedRunDurationMs(row, "run2");
        const best =
          run1 == null ? run2 : run2 == null ? run1 : Math.min(run1, run2);
        const sortValue = best ?? trial;
        return { row, trial, run1, run2, best, sortValue };
      })
      .filter((x) => x.sortValue != null)
      .sort((a, b) =>
        a.best != null && b.best == null
          ? -1
          : a.best == null && b.best != null
            ? 1
            : (a.sortValue ?? Number.MAX_SAFE_INTEGER) -
                (b.sortValue ?? Number.MAX_SAFE_INTEGER) || a.row.startNumber - b.row.startNumber,
      );
    const leaderBest = ranked.find((x) => x.best != null)?.best ?? null;
    const columns = ["Pos", "#", "Driver", "Car", "Class", "Trial", "1st Run", "2nd Run", "Best", "Diff"];
    const tableRows = ranked.map(({ row, trial, run1, run2, best }, i) => [
      String(i + 1),
      String(row.startNumber),
      row.driver || "—",
      row.car || "—",
      row.class || "—",
      formatDurationMs(trial),
      formatDurationMs(run1),
      formatDurationMs(run2),
      formatDurationMs(best),
      leaderBest == null || best == null || best <= leaderBest
        ? "—"
        : `+${formatDiffDurationMs(best - leaderBest)}`,
    ]);

    const headHtml = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
    const bodyHtml =
      tableRows.length > 0
        ? tableRows
            .map((r) => `<tr>${r.map((v) => `<td>${escapeHtml(v)}</td>`).join("")}</tr>`)
            .join("")
        : `<tr><td colspan="${columns.length}" style="text-align:center;color:#666;">No entries.</td></tr>`;
    const logoUrl = normalizedLogoUrl;
    const html = `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(event.name)} - Final Results</title><style>
    body { font-family: Arial, Helvetica, sans-serif; margin: 24px; color: #111; }
    .page { max-width: 1120px; margin: 0 auto; }
    .header { display: flex; flex-direction: column; align-items: center; gap: 8px; margin-bottom: 14px; text-align: center; }
    .logo { max-height: 72px; width: auto; }
    h1 { margin: 0; font-size: 22px; line-height: 1.15; }
    h2 { margin: 6px 0 0; font-size: 16px; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 0 auto; }
    th, td { border: 1px solid #cfcfcf; padding: 6px 8px; vertical-align: middle; }
    th { background: #f4f4f4; text-align: left; }
    @media print { @page { size: A4 portrait; margin: 12mm; } }
    </style></head><body><div class="page"><div class="header">${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="Rally logo" class="logo" />` : ""}<h1>${escapeHtml(event.name)}</h1><h2>Final Results</h2></div><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div></body></html>`;
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);
    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        window.setTimeout(() => iframe.remove(), 1000);
      }
    };
    const doc = iframe.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
  }

  useEffect(() => {
    if (tab === "stage-results") setResultsSubView("stage");
  }, [tab]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      router.refresh();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [router]);

  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) {
      setTab("overview");
    }
  }, [tab, tabs]);

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
            <div className="flex flex-col items-end gap-2">
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
                {entriesSorted.length} crews · {stagesSorted.length} stages
                {totalKm > 0 ? ` · ${totalKm.toFixed(1)} km` : null}
              </span>
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
                  "relative shrink-0 border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors sm:px-4 sm:text-sm " +
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
              <span className="text-[var(--ewrc-red)]">red</span> = completed.
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
                  <div className="overflow-x-auto overflow-y-hidden">
                    <div
                      className="flex min-w-min items-center px-3 py-4 sm:px-5"
                      role="list"
                      aria-label="Select a stage or end of leg"
                    >
                      {resultsStripItems.map((item, i) => {
                        const isSelected = selectedStripItem?.id === item.id;
                        return (
                          <div
                            key={item.id}
                            className="flex items-center"
                            role="listitem"
                          >
                            {i > 0 ? (
                              <span
                                className="select-none px-2.5 text-xl font-extralight leading-none text-[var(--ewrc-strip-sep)] sm:px-3"
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
                                  "flex items-center gap-2 rounded border px-3 py-2.5 text-left transition-colors " +
                                  (isSelected
                                    ? "border-[var(--ewrc-brand)] bg-[var(--ewrc-chip-on-bg)] ring-1 ring-[var(--ewrc-chip-on-ring)]"
                                    : "border-[var(--ewrc-border-ui)] bg-[var(--ewrc-chip-bg)] hover:border-[var(--ewrc-border-ui-hover)] hover:bg-[var(--ewrc-chip-hover-bg)]")
                                }
                              >
                                <span className="shrink-0 font-mono text-xs font-bold text-[var(--ewrc-ss)] sm:text-sm">
                                  SS{item.stage.order}
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
                                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border px-3 py-2.5 text-left text-sm transition-colors " +
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
                                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border px-3 py-2.5 text-left text-sm transition-colors " +
                                  (isSelected
                                    ? "border-[var(--ewrc-brand)] bg-[var(--ewrc-chip-on-bg)] ring-1 ring-[var(--ewrc-chip-on-ring)]"
                                    : "border-[var(--ewrc-border-ui)] bg-[var(--ewrc-chip-bg)] hover:border-[var(--ewrc-border-ui-hover)] hover:bg-[var(--ewrc-chip-hover-bg)]")
                                }
                              >
                                <span className="font-bold uppercase tracking-wide text-[var(--ewrc-ss)]">
                                  {item.label}
                                </span>
                                {item.runId !== "best" ? (
                                  <StageProgressDot status={item.progressStatus} />
                                ) : null}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 border-t border-[var(--ewrc-border)] px-4 py-3 sm:px-5">
                    <button
                      type="button"
                      onClick={printStageResultsPdf}
                      className="rounded-lg border border-[var(--ewrc-border-ui)] bg-[var(--ewrc-input-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--ewrc-muted)] transition-colors hover:border-[var(--ewrc-brand)] hover:text-[var(--ewrc-brand)]"
                    >
                      Print PDF
                    </button>
                  </div>
                  {event.type === "rally" ? (
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[var(--ewrc-border)] px-4 py-3 text-xs text-[var(--ewrc-muted-2)] sm:px-5">
                      <span className="flex items-center gap-2">
                        <StageProgressDot status="pending" />
                        Not started
                      </span>
                      <span className="flex items-center gap-2">
                        <StageProgressDot status="live" />
                        Live
                      </span>
                      <span className="flex items-center gap-2">
                        <StageProgressDot status="completed" />
                        Completed
                      </span>
                    </div>
                  ) : null}
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
                        SS{selectedStripItem.stage.order}{" "}
                        <span className="font-normal text-[var(--ewrc-strong)]">
                          {selectedStripItem.stage.name}
                        </span>
                      </p>
                      {selectedStripItem.stage.distanceKm != null ? (
                        <p className="mt-0.5 text-xs text-[var(--ewrc-muted-3)]">
                          {selectedStripItem.stage.distanceKm} km
                        </p>
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
                      <p className="mt-1 text-xs text-[var(--ewrc-muted-3)]">
                        Cumulative times for this leg (from ALGE when connected).
                      </p>
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
                    <StageTimesTable entries={entriesForStageResults} />
                  ) : (
                    <LegResultsTable
                      entries={entriesForStageResults}
                      stagesInLeg={selectedStripItem.stagesInLeg}
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
              {itineraryByLeg.map(({ leg, stages: legStages }, groupIdx) => (
                <div
                  key={leg}
                  className={
                    groupIdx > 0
                      ? "mt-10 border-t border-[var(--ewrc-border)] pt-8"
                      : ""
                  }
                >
                  {itineraryByLeg.length > 1 ? (
                    <h3 className="mb-4 font-ewrc-heading text-xs font-bold uppercase tracking-widest text-[var(--ewrc-leg-heading)]">
                      Leg {leg}
                    </h3>
                  ) : null}
                  <ol className="space-y-0">
                    {legStages.map((s, i) => (
                      <li key={s.id} className="flex gap-4">
                        <div className="flex w-8 flex-col items-center">
                          <span className="font-mono text-sm font-bold text-[var(--ewrc-brand)]">
                            {s.order}
                          </span>
                          {i < legStages.length - 1 ? (
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
                    ))}
                  </ol>
                </div>
              ))}
            </div>
            {stagesSorted.length > 0 ? (
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
            <p className="border-b border-[var(--ewrc-border)] px-4 py-3 text-sm text-[var(--ewrc-muted-2)]">
              Time penalties and reprimands (stewards / admin).
            </p>
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
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-[var(--ewrc-muted-3)]">
                      No penalties
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab === "final-results" ? (
          <div className="space-y-4">
            <p className="text-sm text-[var(--ewrc-muted-2)]">
              {event.type === "speed"
                ? "Speed final classification after timing is connected. Positions and times below are placeholders (drivers listed by start order)."
                : "Overall classification after timing is connected. Positions and times below are placeholders (crews listed by start order)."}
            </p>
            {event.type === "speed" ? (
              <div>
                <button
                  type="button"
                  onClick={printSpeedFinalResultsPdf}
                  className="rounded-lg border border-[var(--ewrc-border-ui)] bg-[var(--ewrc-input-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--ewrc-muted)] transition-colors hover:border-[var(--ewrc-brand)] hover:text-[var(--ewrc-brand)]"
                >
                  Print PDF
                </button>
              </div>
            ) : null}
            <div className="ewrc-panel overflow-hidden p-0">
              <div className="overflow-x-auto">
                {event.type === "speed" ? (
                  <SpeedFinalTable rows={entriesStartedSorted} />
                ) : (
                  <OverallClassificationTable rows={entriesStartedSorted} />
                )}
              </div>
              {entriesStartedSorted.length === 0 ? (
                <p className="p-6 text-center text-sm text-[var(--ewrc-muted-3)]">
                  No entries — add crews in Admin to build the final results
                  grid.
                </p>
              ) : null}
            </div>
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
  stagesInLeg,
}: {
  entries: Entry[];
  stagesInLeg: Stage[];
}) {
  const sorted = useMemo(
    () => [...entries].sort((a, b) => a.startNumber - b.startNumber),
    [entries],
  );

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
          <th className="w-12 text-right">Pos</th>
          <th className="w-12 text-right">#</th>
          <th className="min-w-[10rem]">Driver</th>
          {stagesInLeg.map((st) => (
            <th key={st.id} className="w-24 whitespace-nowrap text-center">
              SS{st.order}
            </th>
          ))}
          <th className="w-24 text-center">Penalty</th>
          <th className="w-28 text-center">Total</th>
          <th className="w-24 text-center">Diff</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((row, i) => (
          <tr key={row.id} className={i % 2 === 1 ? "ewrc-row-alt" : ""}>
            <td className="align-top text-right font-mono text-[var(--ewrc-strong)]">
              {i + 1}
            </td>
            <td className="align-top text-right font-mono text-[var(--ewrc-ss)]">
              {row.startNumber}
            </td>
            <CrewStackCell row={row} />
            {stagesInLeg.map((st) => (
              <td
                key={st.id}
                className="align-middle text-center font-mono text-[var(--ewrc-time-placeholder)]"
              >
                —
              </td>
            ))}
            <td className="align-middle">
              <span className="flex w-full justify-center font-mono text-[var(--ewrc-time-placeholder)]">
                —
              </span>
            </td>
            <td className="align-middle">
              <span className="flex w-full justify-center font-mono text-[var(--ewrc-time-placeholder)]">
                —
              </span>
            </td>
            <td className="align-middle text-center font-mono text-[var(--ewrc-time-placeholder)]">—</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StageTimesTable({ entries }: { entries: Entry[] }) {
  const sorted = useMemo(
    () => [...entries].sort((a, b) => a.startNumber - b.startNumber),
    [entries],
  );

  if (sorted.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-[var(--ewrc-muted-3)]">
        No entries for this stage list yet.
      </p>
    );
  }

  return (
    <table className="ewrc-table ewrc-table-speed-run min-w-[420px] w-full text-sm">
      <thead>
        <tr>
          <th className="w-12 text-right">Pos</th>
          <th className="w-12 text-right">#</th>
          <th className="min-w-[10rem]">Driver</th>
          <th className="w-28 !text-center">Time</th>
          <th className="w-24 !text-center">Diff</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((row, i) => (
          <tr key={row.id} className={i % 2 === 1 ? "ewrc-row-alt" : ""}>
            <td className="align-top text-right font-mono text-[var(--ewrc-strong)]">
              {i + 1}
            </td>
            <td className="align-top text-right font-mono text-[var(--ewrc-ss)]">
              {row.startNumber}
            </td>
            <DriverOnlyCell row={row} />
            <td className="align-middle text-center font-mono text-[var(--ewrc-time-placeholder)]">—</td>
            <td className="align-middle text-center font-mono text-[var(--ewrc-time-placeholder)]">—</td>
          </tr>
        ))}
      </tbody>
    </table>
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
                {formatDurationMs(getSpeedRunDurationMs(row, runId))}
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

function OverallClassificationTable({ rows }: { rows: Entry[] }) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.startNumber - b.startNumber),
    [rows],
  );

  return (
    <table className="ewrc-table min-w-[720px] w-full text-sm">
      <thead>
        <tr>
          <th className="w-12 text-right">Pos</th>
          <th className="w-12 text-right">#</th>
          <th className="min-w-[10rem]">Crew</th>
          <th className="w-20 text-center">Class</th>
          <th className="w-28 text-center">Time</th>
          <th className="w-24 text-center">Penalty</th>
          <th className="w-28 text-center">Total time</th>
          <th className="w-24 text-center">Diff</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((row, i) => (
          <tr key={row.id} className={i % 2 === 1 ? "ewrc-row-alt" : ""}>
            <td className="align-top text-right font-mono text-[var(--ewrc-strong)]">
              {i + 1}
            </td>
            <td className="align-top text-right font-mono text-[var(--ewrc-ss)]">
              {row.startNumber}
            </td>
            <CrewStackCell row={row} />
            <td className="align-middle text-center text-[var(--ewrc-muted)]">
              {row.class || "—"}
            </td>
            <td className="align-middle text-center font-mono text-[var(--ewrc-time-placeholder)]">—</td>
            <td className="align-middle text-center font-mono text-[var(--ewrc-time-placeholder)]">—</td>
            <td className="align-middle text-center font-mono text-[var(--ewrc-time-placeholder)]">—</td>
            <td className="align-middle text-center font-mono text-[var(--ewrc-time-placeholder)]">—</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SpeedBestTable({ rows }: { rows: Entry[] }) {
  const sorted = useMemo(
    () =>
      [...rows]
        .map((row) => {
          const r1 = getSpeedRunDurationMs(row, "run1");
          const r2 = getSpeedRunDurationMs(row, "run2");
          const best =
            r1 == null
              ? r2
              : r2 == null
                ? r1
                : Math.min(r1, r2);
          return { row, best };
        })
        .filter((x): x is { row: Entry; best: number } => x.best != null)
        .sort((a, b) => (a.best !== b.best ? a.best - b.best : a.row.startNumber - b.row.startNumber)),
    [rows],
  );
  const leaderBest = sorted[0]?.best ?? null;

  return (
    <table className="ewrc-table ewrc-table-speed-best min-w-[620px] w-full text-sm">
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
        {sorted.map(({ row, best }, i) => (
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
              {leaderBest == null || best == null || best <= leaderBest
                ? "—"
                : `+${formatDiffDurationMs(best - leaderBest)}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SpeedFinalTable({ rows }: { rows: Entry[] }) {
  const sorted = useMemo(
    () =>
      [...rows]
        .map((row) => {
          const trial = getSpeedRunDurationMs(row, "trial");
          const run1 = getSpeedRunDurationMs(row, "run1");
          const run2 = getSpeedRunDurationMs(row, "run2");
          const best =
            run1 == null
              ? run2
              : run2 == null
                ? run1
                : Math.min(run1, run2);
          const sortValue = best ?? trial;
          return { row, trial, run1, run2, best, sortValue };
        })
        .filter(
          (
            x,
          ): x is {
            row: Entry;
            trial: number | null;
            run1: number | null;
            run2: number | null;
            best: number | null;
            sortValue: number | null;
          } => x.sortValue != null,
        )
        .sort((a, b) =>
          a.best != null && b.best == null
            ? -1
            : a.best == null && b.best != null
              ? 1
              : a.sortValue !== b.sortValue
                ? (a.sortValue ?? Number.MAX_SAFE_INTEGER) -
                  (b.sortValue ?? Number.MAX_SAFE_INTEGER)
                : a.row.startNumber - b.row.startNumber,
        ),
    [rows],
  );
  const leaderBest = sorted.find((x) => x.best != null)?.best ?? null;

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
        {sorted.map(({ row, trial, run1, run2, best }, i) => (
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
              {formatDurationMs(trial)}
            </td>
            <td className="align-middle text-center font-mono text-[var(--ewrc-strong)]">
              {formatDurationMs(run1)}
            </td>
            <td className="align-middle text-center font-mono text-[var(--ewrc-strong)]">
              {formatDurationMs(run2)}
            </td>
            <td className="align-middle text-center font-mono text-[var(--ewrc-strong)]">
              {formatDurationMs(best)}
            </td>
            <td className="align-middle text-center font-mono text-[var(--ewrc-heading)]">
              {leaderBest == null || best == null || best <= leaderBest
                ? "—"
                : `+${formatDiffDurationMs(best - leaderBest)}`}
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

function getSpeedRunDurationMs(
  row: Entry,
  runId: "trial" | "run1" | "run2",
): number | null {
  const startMs = getSpeedRunStartMs(row, runId);
  const finishMs = getSpeedRunFinishMs(row, runId);
  if (startMs == null || finishMs == null) return null;
  const diff = finishMs - startMs;
  if (diff < 0) return null;
  return diff;
}

function getSpeedRunStartMs(row: Entry, runId: "trial" | "run1" | "run2"): number | null {
  const startRaw =
    runId === "trial"
      ? row.trialStartTime
      : runId === "run1"
        ? row.run1StartTime
        : row.run2StartTime;
  return parseClockToDayMs(startRaw ?? "");
}

function getSpeedRunFinishMs(row: Entry, runId: "trial" | "run1" | "run2"): number | null {
  const finishRaw =
    runId === "trial"
      ? row.trialFinishTime
      : runId === "run1"
        ? row.run1FinishTime
        : row.run2FinishTime;
  return parseClockToDayMs(finishRaw ?? "");
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

function formatDiffDurationMs(ms: number | null): string {
  const base = formatDurationMs(ms);
  if (base.startsWith("0:")) return base.slice(2);
  return base;
}
