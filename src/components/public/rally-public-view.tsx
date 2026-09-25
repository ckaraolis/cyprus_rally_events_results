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

const RALLY_TABS = [
  { id: "overview", label: "Overview" },
  { id: "stage-results", label: "Live results" },
  { id: "itinerary", label: "Itinerary" },
  { id: "entries", label: "Entry List" },
  { id: "retirements", label: "Retirements" },
  { id: "penalty", label: "Penalty" },
  { id: "final-results", label: "Final Results" },
  { id: "official-notice-board", label: "Official Notice Board" },
] as const;

const SPEED_TABS = [
  { id: "overview", label: "Overview" },
  { id: "stage-results", label: "Live results" },
  { id: "entries", label: "Entry List" },
  { id: "final-results", label: "Final Results" },
  { id: "official-notice-board", label: "Official Notice Board" },
] as const;

type TabId = (typeof RALLY_TABS | typeof SPEED_TABS)[number]["id"];

type ResultsSubView = "stage" | "overall";
type SpeedRunId = "trial" | "run1" | "run2" | "best";
const OFFICIAL_NOTICE_DEFAULT_CATEGORIES = [
  "Supplementary Regulations",
  "Bulletins",
  "Steward Decisions",
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

function isMobilePrintClient(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

function printHtmlDocument(
  html: string,
  options?: { landscape?: boolean },
): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const landscape = options?.landscape === true;

  if (isMobilePrintClient()) {
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (w) {
      w.document.open();
      w.document.write(html);
      w.document.close();
      window.setTimeout(() => {
        try {
          w.focus();
          w.print();
        } catch {
          // ignore print-block errors on some browsers
        }
      }, 450);
      return;
    }
  }

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  // Give the iframe a real landscape page size so layout/print preview is not 0×0.
  iframe.style.width = landscape ? "1123px" : "794px";
  iframe.style.height = landscape ? "794px" : "1123px";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  const cleanup = () => {
    window.setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 1000);
  };

  iframe.onload = () => {
    window.setTimeout(() => {
      try {
        const win = iframe.contentWindow;
        if (!win) return;
        win.focus();
        win.print();
      } finally {
        cleanup();
      }
    }, landscape ? 200 : 0);
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

/** Shared landscape one-page results sheet used by rally/speed Print PDF. */
function buildLandscapeResultsPdfHtml(input: {
  eventName: string;
  subtitle: string;
  modeLabel: string;
  columns: string[];
  tableRows: string[][];
  logoUrl: string;
  /**
   * Rally SS / After SS layout:
   * narrow Pos/#, wider Driver/Co-driver, Car mid, Class small+center,
   * then SS Time / Penalty / Total / Diff centered.
   */
  rallyClassificationLayout?: boolean;
  /** LEG sheet: Pos/#, Driver, Co-driver, Car, Class, SS1..SSn, SS Times, Penalty, Total, Diff. */
  rallyLegLayout?: boolean;
  /** Number of per-stage columns (SS1..) when rallyLegLayout is set. */
  legStageCount?: number;
  /** Shrink Pos/# columns to leave room for names and times. */
  narrowPosNum?: boolean;
  /** Center this column index and all to the right (e.g. Class → Diff). */
  centerFromCol?: number;
}): string {
  const n = Math.max(input.tableRows.length, 1);
  const colCount = Math.max(input.columns.length, 1);
  const rallyLayout = input.rallyClassificationLayout === true;
  const legLayout = input.rallyLegLayout === true;
  const legStageCount = Math.max(0, input.legStageCount ?? 0);
  const centerFrom =
    input.centerFromCol != null
      ? input.centerFromCol
      : rallyLayout || legLayout
        ? 5
        : Math.max(0, colCount - 2);
  // More columns (e.g. LEG with many SS) need a tighter base size.
  const colTighten =
    colCount >= 14 ? 1.5 : colCount >= 12 ? 1 : colCount >= 10 ? 0.5 : 0;
  const fontPt = Math.max(
    5.5,
    (n <= 12 ? 10 : n <= 18 ? 9 : n <= 24 ? 8 : n <= 32 ? 7 : n <= 40 ? 6.5 : 6) -
      colTighten,
  );
  const padY = n <= 18 ? 1.6 : n <= 28 ? 1.1 : n <= 36 ? 0.7 : 0.45;
  const padX =
    rallyLayout || legLayout
      ? n <= 24
        ? 1.2
        : 0.9
      : colCount >= 10
        ? 1.0
        : n <= 24
          ? 2.2
          : 1.4;
  const logoH = n <= 20 ? 48 : n <= 30 ? 36 : 28;
  const titlePt = n <= 24 ? 15 : 12;
  const subPt = n <= 24 ? 10 : 8;

  const shouldCenter = (colIdx: number) =>
    colIdx <= 1 || colIdx >= centerFrom;

  const bodyHtml =
    input.tableRows.length > 0
      ? input.tableRows
          .map(
            (r) =>
              `<tr>${r
                .map((v, colIdx) => {
                  const center = shouldCenter(colIdx);
                  return `<td${center ? ' class="c"' : ""}>${escapeHtml(v)}</td>`;
                })
                .join("")}</tr>`,
          )
          .join("")
      : `<tr><td colspan="${input.columns.length}" class="c" style="color:#666;">No timed entries.</td></tr>`;

  let colgroup = "";
  if (legLayout && legStageCount > 0) {
    const ssCols = Array.from({ length: legStageCount }, () => '<col class="c-ss" />').join(
      "",
    );
    colgroup = `<colgroup>
      <col class="c-pos" /><col class="c-num" />
      <col class="c-driver" /><col class="c-codriver" /><col class="c-car" /><col class="c-class" />
      ${ssCols}
      <col class="c-time" /><col class="c-time" /><col class="c-time" /><col class="c-time" />
    </colgroup>`;
  } else if (rallyLayout && colCount >= 10) {
    // Pos, #, Driver, Co-driver, Car, Class, SS Time(s), Penalty, Total time, Diff
    colgroup = `<colgroup>
      <col class="c-pos" /><col class="c-num" />
      <col class="c-driver" /><col class="c-codriver" /><col class="c-car" /><col class="c-class" />
      <col class="c-time" /><col class="c-time" /><col class="c-time" /><col class="c-time" />
    </colgroup>`;
  } else if (input.narrowPosNum || rallyLayout || legLayout) {
    colgroup = `<colgroup><col class="c-pos" /><col class="c-num" />${input.columns
      .slice(2)
      .map(() => "<col />")
      .join("")}</colgroup>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(input.eventName)} - ${escapeHtml(input.subtitle)}</title><style>
  @page { size: A4 landscape; margin: 8mm; }
  html, body { margin: 0; padding: 0; color: #111; background: #fff; font-family: Arial, Helvetica, sans-serif; }
  .page { width: 281mm; max-width: 100%; margin: 0 auto; box-sizing: border-box; }
  .header { display: flex; flex-direction: column; align-items: center; gap: 2px; margin: 0 0 5mm; text-align: center; }
  .logo { max-height: ${logoH}px; width: auto; }
  h1 { margin: 0; font-size: ${titlePt}pt; line-height: 1.15; }
  h2 { margin: 2px 0 0; font-size: ${subPt}pt; font-weight: 600; line-height: 1.2; }
  h3 { margin: 1px 0 0; font-size: ${Math.max(7, subPt - 1)}pt; font-weight: 500; color: #444; text-transform: uppercase; letter-spacing: .04em; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: ${fontPt}pt; }
  th, td { border: 1px solid #bdbdbd; padding: ${padY}mm ${padX}mm; vertical-align: middle; line-height: 1.2; word-wrap: break-word; }
  th { background: #f0f0f0; font-weight: 700; }
  th.c, td.c { text-align: center; }
  th.l, td.l { text-align: left; }
  col.c-pos, col.c-num { width: ${legLayout ? "2.1%" : "2.2%"}; }
  col.c-driver, col.c-codriver { width: ${legLayout ? "13.2%" : "13%"}; }
  col.c-car { width: 11%; }
  col.c-class { width: 4.8%; }
  col.c-ss { width: 4.4%; }
  col.c-time { width: ${legLayout ? "6.4%" : "7.2%"}; }
  @media print { @page { size: A4 landscape; margin: 8mm; } html, body { margin: 0; } .page { width: auto; } }
  @media screen { body { padding: 12px; background: #e8e8e8; } .page { background: #fff; padding: 8mm; box-shadow: 0 1px 6px rgba(0,0,0,.2); } }
  </style></head><body><div class="page"><div class="header">${input.logoUrl ? `<img src="${escapeHtml(input.logoUrl)}" alt="Event logo" class="logo" />` : ""}<h1>${escapeHtml(input.eventName)}</h1><h2>${escapeHtml(input.subtitle)}</h2><h3>${escapeHtml(input.modeLabel)}</h3></div><table>${colgroup}<thead><tr>${input.columns
    .map((c, colIdx) => {
      const cls = shouldCenter(colIdx) ? "c" : "l";
      return `<th class="${cls}">${escapeHtml(c)}</th>`;
    })
    .join("")}</tr></thead><tbody>${bodyHtml}</tbody></table></div></body></html>`;
}

function buildRallyStagePdfRows(entries: Entry[], stageId: string): string[][] {
  const ranked = [...entries]
    .map((row) => {
      const values = getRallyStageTimingValues(row, stageId);
      const cell = classifyRallyStageLegCell(values.startValue, values.finishValue);
      const penaltyMs = parsePenaltyDurationMs(values.penaltyValue) ?? 0;
      const ssTimeMs = cell.durationMs;
      const totalMs =
        ssTimeMs != null ? ssTimeMs + penaltyMs : null;
      return {
        row,
        cell,
        ssTimeMs,
        penaltyMs,
        totalMs,
        penaltyRaw: values.penaltyValue,
      };
    })
    .filter(
      (x) =>
        x.totalMs != null ||
        x.cell.outcome != null ||
        x.penaltyMs > 0,
    )
    .sort((a, b) => {
      const aTimed = a.totalMs != null;
      const bTimed = b.totalMs != null;
      if (aTimed && !bTimed) return -1;
      if (!aTimed && bTimed) return 1;
      if (aTimed && bTimed && a.totalMs !== b.totalMs) {
        return (a.totalMs ?? 0) - (b.totalMs ?? 0);
      }
      return a.row.startNumber - b.row.startNumber;
    });
  const leaderMs = ranked.find((x) => x.totalMs != null)?.totalMs ?? null;
  return ranked.map(({ row, cell, ssTimeMs, penaltyMs, totalMs }, i) => [
    String(i + 1),
    String(row.startNumber),
    row.driver || "—",
    row.coDriver || "—",
    row.car || "—",
    row.class || "—",
    cell.outcome != null ? cell.outcome : formatDurationMs(ssTimeMs),
    penaltyMs > 0 ? formatDurationMs(penaltyMs) : "—",
    cell.outcome != null ? cell.outcome : formatDurationMs(totalMs),
    totalMs == null || leaderMs == null || totalMs <= leaderMs
      ? "—"
      : `+${formatDiffDurationMs(totalMs - leaderMs)}`,
  ]);
}

function buildRallyOverallPdfRows(
  entries: Entry[],
  stages: Stage[],
  eventPenaltyMode: "through-max" | "in-stages-only" = "through-max",
): string[][] {
  const stageOrders = new Set(stages.map((s) => s.order));
  const throughOrder =
    stages.length > 0 ? Math.max(...stages.map((s) => s.order)) : 0;
  const ranked = [...entries]
    .map((row) => {
      const stageCells = stages.map((st) => {
        const values = getRallyStageTimingValues(row, st.id);
        const cell = classifyRallyStageLegCell(values.startValue, values.finishValue);
        const jumpMs = parsePenaltyDurationMs(values.penaltyValue) ?? 0;
        return { cell, jumpMs, ssMs: cell.durationMs };
      });
      const allTimed =
        stages.length > 0 &&
        stageCells.every((c) => c.cell.outcome == null && c.ssMs != null);
      // Pure stage times (finish − start); jump starts live in Penalty.
      const ssTimesMs = allTimed
        ? stageCells.reduce((sum, c) => sum + (c.ssMs ?? 0), 0)
        : null;
      const jumpPenaltyMs = stageCells.reduce((sum, c) => sum + c.jumpMs, 0);
      const eventPenaltyMs =
        eventPenaltyMode === "in-stages-only"
          ? getRallyEventPenaltyItems(row)
              .filter((item) => stageOrders.has(item.afterStageOrder))
              .reduce(
                (sum, item) => sum + (parsePenaltyDurationMs(item.penalty) ?? 0),
                0,
              )
          : throughOrder > 0
            ? getRallyEventPenaltyTotalMs(row, throughOrder)
            : 0;
      const penaltyMs = jumpPenaltyMs + eventPenaltyMs;
      const totalMs =
        ssTimesMs != null ? ssTimesMs + penaltyMs : null;
      return { row, totalMs, penaltyMs, ssTimesMs };
    })
    .filter((x): x is { row: Entry; totalMs: number; penaltyMs: number; ssTimesMs: number } =>
      x.totalMs != null,
    )
    .sort((a, b) =>
      a.totalMs !== b.totalMs
        ? a.totalMs - b.totalMs
        : a.row.startNumber - b.row.startNumber,
    );
  const leaderTotal = ranked[0]?.totalMs ?? null;
  return ranked.map(({ row, totalMs, penaltyMs, ssTimesMs }, i) => [
    String(i + 1),
    String(row.startNumber),
    row.driver || "—",
    row.coDriver || "—",
    row.car || "—",
    row.class || "—",
    formatDurationMs(ssTimesMs),
    penaltyMs > 0 ? formatDurationMs(penaltyMs) : "—",
    formatDurationMs(totalMs),
    leaderTotal == null || totalMs <= leaderTotal
      ? "—"
      : `+${formatDiffDurationMs(totalMs - leaderTotal)}`,
  ]);
}

/** Final Results sheet: stage time + event penalties → Total. */
function buildRallyFinalPdfRows(entries: Entry[], stages: Stage[]): string[][] {
  const ranked = [...entries]
    .map((row) => {
      const stageCells = stages.map((st) => {
        const values = getRallyStageTimingValues(row, st.id);
        const cell = classifyRallyStageLegCell(values.startValue, values.finishValue);
        const jumpMs = parsePenaltyDurationMs(values.penaltyValue) ?? 0;
        const timeMs =
          cell.durationMs != null ? cell.durationMs + jumpMs : null;
        return { cell, timeMs };
      });
      const allTimed =
        stages.length > 0 &&
        stageCells.every((c) => c.cell.outcome == null && c.timeMs != null);
      const timeMs = allTimed
        ? stageCells.reduce((sum, c) => sum + (c.timeMs ?? 0), 0)
        : null;
      const penaltyMs = getRallyEventPenaltyTotalMs(row);
      const totalMs = timeMs != null ? timeMs + penaltyMs : null;
      return { row, timeMs, penaltyMs, totalMs };
    })
    .filter(
      (x): x is {
        row: Entry;
        timeMs: number;
        penaltyMs: number;
        totalMs: number;
      } => x.totalMs != null,
    )
    .sort((a, b) =>
      a.totalMs !== b.totalMs
        ? a.totalMs - b.totalMs
        : a.row.startNumber - b.row.startNumber,
    );
  const leaderTotal = ranked[0]?.totalMs ?? null;
  return ranked.map(({ row, timeMs, penaltyMs, totalMs }, i) => [
    String(i + 1),
    String(row.startNumber),
    row.driver || "—",
    row.coDriver || "—",
    row.car || "—",
    row.class || "—",
    formatDurationMs(timeMs),
    penaltyMs > 0 ? formatDurationMs(penaltyMs) : "—",
    formatDurationMs(totalMs),
    leaderTotal == null || totalMs <= leaderTotal
      ? "—"
      : `+${formatDiffDurationMs(totalMs - leaderTotal)}`,
  ]);
}

/** LEG sheet: all crews, per-SS times (only when stages are completed). */
function buildRallyLegPdfSheet(
  entries: Entry[],
  stagesInLeg: Stage[],
): { columns: string[]; tableRows: string[][] } {
  const allLegStagesCompleted =
    stagesInLeg.length > 0 &&
    stagesInLeg.every((st) => st.progressStatus === "completed");
  const legOrders = new Set(stagesInLeg.map((s) => s.order));

  type LegPdfRow = {
    row: Entry;
    cells: string[];
    ssTimesMs: number | null;
    penaltyMs: number;
    totalMs: number | null;
    sortTier: 0 | 1 | 2;
    rowOutcome: "DNS" | "DNF" | "RET" | null;
  };

  const ranked: LegPdfRow[] = entries.map((row) => {
    let jumpPenaltyMs = 0;
    const cells = stagesInLeg.map((st) => {
      if (!allLegStagesCompleted || st.progressStatus !== "completed") {
        return {
          text: "—",
          outcome: null as "DNS" | "DNF" | "RET" | null,
          ssMs: null as number | null,
        };
      }
      const values = getRallyStageTimingValues(row, st.id);
      const pen = parsePenaltyDurationMs(values.penaltyValue) ?? 0;
      jumpPenaltyMs += pen;
      const cell = classifyRallyStageLegCell(values.startValue, values.finishValue);
      if (cell.outcome != null) {
        return { text: cell.outcome, outcome: cell.outcome, ssMs: null };
      }
      // Per-SS column shows pure stage time; jump starts go in Penalty.
      return {
        text: formatDurationMs(cell.durationMs),
        outcome: null,
        ssMs: cell.durationMs,
      };
    });
    const rowOutcome = worstLegRowOutcome(
      cells.map((c) => ({
        outcome: c.outcome,
        durationMs: c.ssMs,
      })),
    );
    const allTimedNoOutcome =
      allLegStagesCompleted &&
      cells.length > 0 &&
      cells.every((c) => c.outcome == null && c.ssMs != null);
    const eventPenaltyMs = allLegStagesCompleted
      ? getRallyEventPenaltyItems(row)
          .filter((item) => legOrders.has(item.afterStageOrder))
          .reduce(
            (sum, item) => sum + (parsePenaltyDurationMs(item.penalty) ?? 0),
            0,
          )
      : 0;
    const ssTimesMs = allTimedNoOutcome
      ? cells.reduce((sum, c) => sum + (c.ssMs ?? 0), 0)
      : null;
    const penaltyMs = jumpPenaltyMs + eventPenaltyMs;
    const totalMs =
      ssTimesMs != null ? ssTimesMs + penaltyMs : null;
    const sortTier: 0 | 1 | 2 =
      allLegStagesCompleted && rowOutcome != null
        ? 2
        : totalMs != null
          ? 0
          : 1;
    return {
      row,
      cells: cells.map((c) => c.text),
      ssTimesMs,
      penaltyMs,
      totalMs,
      sortTier,
      rowOutcome,
    };
  });

  ranked.sort((a, b) => {
    if (a.sortTier !== b.sortTier) return a.sortTier - b.sortTier;
    if (a.sortTier === 0) {
      const ta = a.totalMs ?? 0;
      const tb = b.totalMs ?? 0;
      if (ta !== tb) return ta - tb;
      return a.row.startNumber - b.row.startNumber;
    }
    if (a.sortTier === 2) {
      const ka = legOutcomeSortKey(a.rowOutcome!);
      const kb = legOutcomeSortKey(b.rowOutcome!);
      if (ka !== kb) return ka - kb;
      return a.row.startNumber - b.row.startNumber;
    }
    return a.row.startNumber - b.row.startNumber;
  });

  const leaderTotal = ranked.find((x) => x.sortTier === 0)?.totalMs ?? null;
  const columns = [
    "Pos",
    "#",
    "Driver",
    "Co-driver",
    "Car",
    "Class",
    ...stagesInLeg.map((st) => `SS${st.order}`),
    "SS Times",
    "Penalty",
    "Total",
    "Diff",
  ];
  const tableRows = ranked.map((legRow, i) => [
    String(i + 1),
    String(legRow.row.startNumber),
    legRow.row.driver || "—",
    legRow.row.coDriver || "—",
    legRow.row.car || "—",
    legRow.row.class || "—",
    ...legRow.cells,
    allLegStagesCompleted && legRow.rowOutcome != null
      ? legRow.rowOutcome
      : formatDurationMs(legRow.ssTimesMs),
    legRow.penaltyMs > 0 ? formatDurationMs(legRow.penaltyMs) : "—",
    allLegStagesCompleted && legRow.rowOutcome != null
      ? legRow.rowOutcome
      : formatDurationMs(legRow.totalMs),
    legRow.sortTier !== 0 ||
    leaderTotal == null ||
    legRow.totalMs == null ||
    legRow.totalMs <= leaderTotal
      ? "—"
      : `+${formatDiffDurationMs(legRow.totalMs - leaderTotal)}`,
  ]);
  return { columns, tableRows };
}

/** Detect changes when polling `/api/rally/config` (stage dots, entry times, etc.). */
function fingerprintEventForLivePoll(e: RallyEvent): string {
  return JSON.stringify({
    stages: e.stages.map((s) => ({
      id: s.id,
      order: s.order,
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
      trialStartTime: x.trialStartTime,
      trialFinishTime: x.trialFinishTime,
      run1StartTime: x.run1StartTime,
      run1FinishTime: x.run1FinishTime,
      run2StartTime: x.run2StartTime,
      run2FinishTime: x.run2FinishTime,
    })),
  });
}

export function RallyPublicView({ site, event: initialEvent, topCrumb }: Props) {
  const [event, setEvent] = useState(initialEvent);
  const lastConfigUpdatedAtRef = useRef<string | null>(null);
  const lastEventPollSigRef = useRef<string | null>(null);
  useEffect(() => {
    setEvent(initialEvent);
    lastConfigUpdatedAtRef.current = null;
    lastEventPollSigRef.current = null;
  }, [initialEvent]);

  const [tab, setTab] = useState<TabId>("overview");
  const [selectedStripId, setSelectedStripId] = useState<string | null>(null);
  const [resultsSubView, setResultsSubView] =
    useState<ResultsSubView>("stage");
  /** For rally stage view: switch between "this SS only" and "After SSx" cumulative. */
  const [rallyStageView, setRallyStageView] = useState<"stage" | "afterStage">(
    "stage",
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const tabs = event.type === "speed" ? SPEED_TABS : RALLY_TABS;

  /** Entry List tab: empty string = all classes; "__EMPTY__" = crews with no class set. */
  const [entryListClassFilter, setEntryListClassFilter] = useState("");
  /** Stage results tab (stage + overall sub-views): same filter semantics. */
  const [stageResultsClassFilter, setStageResultsClassFilter] = useState("");
  /** Final results tab: same filter semantics. */
  const [finalResultsClassFilter, setFinalResultsClassFilter] = useState("");

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
  }, [event.speedRunImportStatus, event.type, stagesSorted]);

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
  /** All SS from the first up to and including the currently selected stage (rally only). */
  const cumulativeStagesUpToSelected = useMemo<Stage[]>(() => {
    if (
      event.type !== "rally" ||
      !selectedStripItem ||
      selectedStripItem.type !== "stage"
    ) {
      return [];
    }
    const idx = stagesSorted.findIndex(
      (s) => s.id === selectedStripItem.stage.id,
    );
    if (idx < 0) return [];
    return stagesSorted.slice(0, idx + 1);
  }, [event.type, selectedStripItem, stagesSorted]);
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
    const now = new Date(nowMs);
    const nowDayMs =
      now.getHours() * 3_600_000 +
      now.getMinutes() * 60_000 +
      now.getSeconds() * 1_000 +
      now.getMilliseconds();
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

  function printStageResultsPdf(mode: "auto" | "ss" | "overall" = "auto") {
    if (!selectedStripItem) return;

    const rows = [...entriesForStageResults];
    const logoUrl = normalizedLogoUrl;

    // Rally stage: SS results and/or After SSx overall.
    if (event.type === "rally" && selectedStripItem.type === "stage") {
      const stage = selectedStripItem.stage;
      const wantOverall =
        mode === "overall" ||
        (mode === "auto" && effectiveRallyStageView === "afterStage");
      if (wantOverall && cumulativeStagesUpToSelected.length >= 2) {
        const tableRows = buildRallyOverallPdfRows(
          rows,
          cumulativeStagesUpToSelected,
        );
        const html = buildLandscapeResultsPdfHtml({
          eventName: event.name,
          subtitle: `After SS${stage.order} Results (SS1–SS${stage.order})`,
          modeLabel: "Overall classification",
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
          tableRows,
          logoUrl,
          rallyClassificationLayout: true,
          centerFromCol: 5,
        });
        printHtmlDocument(html, { landscape: true });
        return;
      }
      const tableRows = buildRallyStagePdfRows(rows, stage.id);
      const html = buildLandscapeResultsPdfHtml({
        eventName: event.name,
        subtitle: `SS${stage.order} ${stage.name}`,
        modeLabel: "Stage results",
        columns: [
          "Pos",
          "#",
          "Driver",
          "Co-driver",
          "Car",
          "Class",
          "SS Time",
          "Penalty",
          "Total time",
          "Diff",
        ],
        tableRows,
        logoUrl,
        rallyClassificationLayout: true,
        centerFromCol: 5,
      });
      printHtmlDocument(html, { landscape: true });
      return;
    }

    // Rally leg end: per-SS columns for every crew (landscape, one-page fit).
    if (event.type === "rally" && selectedStripItem.type === "legEnd") {
      const stagesInLeg = selectedStripItem.stagesInLeg;
      const { columns, tableRows } = buildRallyLegPdfSheet(rows, stagesInLeg);
      const html = buildLandscapeResultsPdfHtml({
        eventName: event.name,
        subtitle: `LEG${selectedStripItem.leg} Results`,
        modeLabel: "Leg classification",
        columns,
        tableRows,
        logoUrl,
        rallyLegLayout: true,
        legStageCount: stagesInLeg.length,
        centerFromCol: 5,
      });
      printHtmlDocument(html, { landscape: true });
      return;
    }

    const headingStage =
      selectedStripItem.type === "stage"
        ? `SS${selectedStripItem.stage.order} ${selectedStripItem.stage.name}`
        : selectedStripItem.type === "legEnd"
          ? `LEG${selectedStripItem.leg} Results`
          : selectedStripItem.label;

    let columns: string[] = [];
    let tableRows: string[][] = [];
    let modeLabel = "Results";

    if (event.type === "speed" && selectedStripItem.type === "speedRun" && selectedStripItem.runId === "best") {
      const ranked = buildSpeedFinalRanking(rows);
      const leaderBest = ranked.find((x) => x.tier === 0)?.bestFromRuns ?? null;
      columns = [
        "Pos",
        "#",
        "Driver",
        "Car",
        "Class",
        "Trial",
        "1st Run",
        "2nd Run",
        "Best Time",
        "Diff",
      ];
      modeLabel = "Best Time classification";
      tableRows = ranked.map(
        ({ row, trial, run1, run2, bestFromRuns, bestDisplay, nonStarter }, i) => [
          String(i + 1),
          String(row.startNumber),
          row.driver || "—",
          row.car || "—",
          row.class || "—",
          nonStarter
            ? "—"
            : getSpeedRunOutcomeLabel(row, "trial") ?? formatDurationMs(trial),
          nonStarter
            ? "—"
            : getSpeedRunOutcomeLabel(row, "run1") ?? formatDurationMs(run1),
          nonStarter
            ? "—"
            : getSpeedRunOutcomeLabel(row, "run2") ?? formatDurationMs(run2),
          nonStarter
            ? "NON STARTER"
            : bestDisplay != null
              ? formatDurationMs(bestDisplay)
              : "—",
          nonStarter ||
          leaderBest == null ||
          bestFromRuns == null ||
          bestFromRuns <= leaderBest
            ? "—"
            : `+${formatDiffDurationMs(bestFromRuns - leaderBest)}`,
        ],
      );
      const html = buildLandscapeResultsPdfHtml({
        eventName: event.name,
        subtitle: headingStage,
        modeLabel,
        columns,
        tableRows,
        logoUrl,
      });
      printHtmlDocument(html, { landscape: true });
      return;
    }

    if (
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
      columns = ["Pos", "#", "Driver", "Time", "Diff"];
      modeLabel = "Run results";
      tableRows = ranked.map(({ r, t }, i) => [
        String(i + 1),
        String(r.startNumber),
        r.driver || "—",
        formatDurationMs(t),
        leader == null || t <= leader ? "—" : `+${formatDiffDurationMs(t - leader)}`,
      ]);
      const html = buildLandscapeResultsPdfHtml({
        eventName: event.name,
        subtitle: headingStage,
        modeLabel,
        columns,
        tableRows,
        logoUrl,
      });
      printHtmlDocument(html, { landscape: true });
      return;
    }

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
    const html = buildLandscapeResultsPdfHtml({
      eventName: event.name,
      subtitle: headingStage,
      modeLabel,
      columns,
      tableRows,
      logoUrl,
    });
    printHtmlDocument(html, { landscape: true });
  }

  function printSpeedFinalResultsPdf() {
    if (event.type !== "speed") return;
    const ranked = buildSpeedFinalRanking(entriesForFinalResults);
    const leaderBest = ranked.find((x) => x.tier === 0)?.bestFromRuns ?? null;
    const columns = ["Pos", "#", "Driver", "Car", "Class", "Trial", "1st Run", "2nd Run", "Best Time", "Diff"];
    const tableRows = ranked.map(
      ({ row, trial, run1, run2, bestFromRuns, bestDisplay, nonStarter }, i) => [
        String(i + 1),
        String(row.startNumber),
        row.driver || "—",
        row.car || "—",
        row.class || "—",
        nonStarter
          ? "—"
          : getSpeedRunOutcomeLabel(row, "trial") ?? formatDurationMs(trial),
        nonStarter
          ? "—"
          : getSpeedRunOutcomeLabel(row, "run1") ?? formatDurationMs(run1),
        nonStarter
          ? "—"
          : getSpeedRunOutcomeLabel(row, "run2") ?? formatDurationMs(run2),
        nonStarter
          ? "NON STARTER"
          : bestDisplay != null
            ? formatDurationMs(bestDisplay)
            : "—",
        nonStarter ||
        leaderBest == null ||
        bestFromRuns == null ||
        bestFromRuns <= leaderBest
          ? "—"
          : `+${formatDiffDurationMs(bestFromRuns - leaderBest)}`,
      ],
    );
    const html = buildLandscapeResultsPdfHtml({
      eventName: event.name,
      subtitle: "Final Results",
      modeLabel: "Ordered by Best Time",
      columns,
      tableRows,
      logoUrl: normalizedLogoUrl,
    });
    printHtmlDocument(html, { landscape: true });
  }

  function printRallyFinalResultsPdf() {
    if (event.type !== "rally") return;
    const tableRows = buildRallyFinalPdfRows(
      entriesForFinalResults,
      stagesSorted,
    );
    const html = buildLandscapeResultsPdfHtml({
      eventName: event.name,
      subtitle: "Final Results",
      modeLabel: "Overall classification",
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
      tableRows,
      logoUrl: normalizedLogoUrl,
      rallyClassificationLayout: true,
      centerFromCol: 5,
    });
    printHtmlDocument(html, { landscape: true });
  }

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
     * Live results tab polls every 2s so admin timing changes show up quickly;
     * other tabs use 5s to keep traffic lighter.
     */
    let cancelled = false;
    let inFlight = false;
    const intervalMs = tab === "stage-results" ? 2000 : 5000;
    const poll = async () => {
      if (cancelled || inFlight) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      inFlight = true;
      try {
        const res = await fetch("/api/rally/config", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          events: RallyEvent[];
          updatedAt: string;
        };
        const match = data.events?.find((e) => e.id === initialEvent.id);
        if (!match || cancelled) return;
        const sig = fingerprintEventForLivePoll(match);
        if (
          sig === lastEventPollSigRef.current &&
          data.updatedAt === lastConfigUpdatedAtRef.current
        ) {
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
  }, [initialEvent.id, tab]);

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
                rightAction={
                  event.type === "rally" &&
                  selectedStripItem?.type === "stage" &&
                  showAfterStageTab ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => printStageResultsPdf("ss")}
                        className="rounded-lg border border-[var(--ewrc-border-ui)] bg-[var(--ewrc-input-bg)] px-3 py-2 text-sm font-semibold text-[var(--ewrc-muted)] transition-colors hover:border-[var(--ewrc-brand)] hover:text-[var(--ewrc-brand)]"
                      >
                        Print SS PDF
                      </button>
                      <button
                        type="button"
                        onClick={() => printStageResultsPdf("overall")}
                        className="rounded-lg border border-[var(--ewrc-border-ui)] bg-[var(--ewrc-input-bg)] px-3 py-2 text-sm font-semibold text-[var(--ewrc-muted)] transition-colors hover:border-[var(--ewrc-brand)] hover:text-[var(--ewrc-brand)]"
                      >
                        Print Overall PDF
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => printStageResultsPdf("auto")}
                      className="rounded-lg border border-[var(--ewrc-border-ui)] bg-[var(--ewrc-input-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--ewrc-muted)] transition-colors hover:border-[var(--ewrc-brand)] hover:text-[var(--ewrc-brand)]"
                    >
                      Print PDF
                    </button>
                  )
                }
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
                            SS{selectedStripItem.stage.order} Stage Results
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
                            After SS{selectedStripItem.stage.order} Results
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
                                  #{row.startNumber} {row.driver || "—"} ({startValue})
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
                        stageId={
                          event.type === "rally"
                            ? selectedStripItem.stage.id
                            : undefined
                        }
                      />
                    )
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
            ) : (
              <div>
                <button
                  type="button"
                  onClick={printRallyFinalResultsPdf}
                  className="rounded-lg border border-[var(--ewrc-border-ui)] bg-[var(--ewrc-input-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--ewrc-muted)] transition-colors hover:border-[var(--ewrc-brand)] hover:text-[var(--ewrc-brand)]"
                >
                  Print PDF
                </button>
              </div>
            )}
            <div className="ewrc-panel overflow-hidden p-0">
              <div className="overflow-x-auto">
                {event.type === "speed" ? (
                  <SpeedFinalTable rows={entriesForFinalResults} />
                ) : (
                  <OverallClassificationTable
                    rows={entriesForFinalResults}
                    stages={stagesSorted}
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
              Supplementary Regulations, Bulletins, Steward Decisions, and additional
              official documents published by the event admin.
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
                            {rows.map((doc, idx) => (
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
                                </td>
                                <td className="text-center text-xs text-[var(--ewrc-muted-2)]">
                                  {new Date(doc.uploadedAt).toLocaleString()}
                                </td>
                              </tr>
                            ))}
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
  stagesInLeg,
}: {
  entries: Entry[];
  stagesInLeg: Stage[];
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

  const allLegStagesCompleted = useMemo(
    () =>
      stagesInLeg.length > 0 &&
      stagesInLeg.every((st) => st.progressStatus === "completed"),
    [stagesInLeg],
  );
  const sorted = useMemo((): LegRow[] => {
    const legOrders = new Set(stagesInLeg.map((s) => s.order));
    const rows: LegRow[] = entries.map((row) => {
      let jumpPenaltyMs = 0;
      const cells = stagesInLeg.map((st) => {
        const values = getRallyStageTimingValues(row, st.id);
        const pen = parsePenaltyDurationMs(values.penaltyValue) ?? 0;
        // Only reveal stage times once that stage is officially completed.
        if (st.progressStatus !== "completed") {
          return { outcome: null, durationMs: null };
        }
        jumpPenaltyMs += pen;
        const cell = classifyRallyStageLegCell(
          values.startValue,
          values.finishValue,
        );
        // Per-SS cell is pure stage time; jump starts are in Penalty.
        return {
          outcome: cell.outcome,
          durationMs: cell.durationMs,
        };
      });
      const rowOutcome = worstLegRowOutcome(cells);
      const allTimedNoOutcome =
        cells.length > 0 &&
        cells.every((c) => c.outcome == null && c.durationMs != null);
      const eventPenaltyMs = allLegStagesCompleted
        ? getRallyEventPenaltyItems(row)
            .filter((item) => legOrders.has(item.afterStageOrder))
            .reduce(
              (sum, item) => sum + (parsePenaltyDurationMs(item.penalty) ?? 0),
              0,
            )
        : 0;
      const ssTimesMs =
        allLegStagesCompleted && allTimedNoOutcome
          ? cells.reduce((sum, c) => sum + (c.durationMs ?? 0), 0)
          : null;
      const penaltyMs = jumpPenaltyMs + eventPenaltyMs;
      const totalMs =
        ssTimesMs != null ? ssTimesMs + penaltyMs : null;
      const sortTier: 0 | 1 | 2 =
        allLegStagesCompleted && rowOutcome != null
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
  }, [allLegStagesCompleted, entries, stagesInLeg]);

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
              SS{st.order}
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
                {allLegStagesCompleted && rowOutcome != null
                  ? rowOutcome
                  : formatDurationMs(ssTimesMs)}
              </td>
              <td className="align-middle !text-center font-mono text-[11px] text-[var(--ewrc-heading)] sm:text-xs">
                {penaltyMs > 0 ? formatDurationMs(penaltyMs) : "—"}
              </td>
              <td className="align-middle !text-center font-mono text-[11px] text-[var(--ewrc-strong)] sm:text-xs">
                {allLegStagesCompleted && rowOutcome != null
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
  const throughOrder = useMemo(
    () => (stages.length > 0 ? Math.max(...stages.map((s) => s.order)) : 0),
    [stages],
  );
  const sorted = useMemo(
    () =>
      [...entries]
        .map((row) => {
          const stageCells = stages.map((st) => {
            const values = getRallyStageTimingValues(row, st.id);
            const startMs = parseClockToDayMs(values.startValue);
            const finishMs = parseClockToDayMs(values.finishValue);
            const jumpMs = parsePenaltyDurationMs(values.penaltyValue) ?? 0;
            if (startMs == null || finishMs == null) {
              return { ssMs: null as number | null, jumpMs };
            }
            const raw = finishMs - startMs;
            return {
              ssMs: raw >= 0 ? raw : null,
              jumpMs,
            };
          });
          const allTimed =
            stages.length > 0 && stageCells.every((t) => t.ssMs != null);
          const ssTimesMs = allTimed
            ? stageCells.reduce((sum, t) => sum + (t.ssMs ?? 0), 0)
            : null;
          const jumpPenaltyMs = stageCells.reduce((sum, t) => sum + t.jumpMs, 0);
          const eventPenaltyMs =
            throughOrder > 0
              ? getRallyEventPenaltyTotalMs(row, throughOrder)
              : 0;
          const penaltyMs = jumpPenaltyMs + eventPenaltyMs;
          const totalMs =
            ssTimesMs != null ? ssTimesMs + penaltyMs : null;
          return { row, ssTimesMs, totalMs, penaltyMs };
        })
        .filter(
          (x): x is {
            row: Entry;
            ssTimesMs: number;
            totalMs: number;
            penaltyMs: number;
          } => x.totalMs != null,
        )
        .sort((a, b) => {
          if (a.totalMs !== b.totalMs) return a.totalMs - b.totalMs;
          return a.row.startNumber - b.row.startNumber;
        }),
    [entries, stages, throughOrder],
  );
  const leaderTotal = sorted[0]?.totalMs ?? null;

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
        {sorted.map(({ row, ssTimesMs, totalMs, penaltyMs }, i) => (
          <tr key={row.id} className={i % 2 === 1 ? "ewrc-row-alt" : ""}>
            <td className="align-top text-right font-mono text-[var(--ewrc-strong)]">
              {i + 1}
            </td>
            <td className="align-top text-right font-mono text-[var(--ewrc-ss)]">
              {row.startNumber}
            </td>
            <CrewStackCell row={row} />
            <td className="align-middle text-center font-mono text-[var(--ewrc-strong)]">
              {formatDurationMs(ssTimesMs)}
            </td>
            <td className="align-middle text-center font-mono text-[var(--ewrc-heading)]">
              {penaltyMs > 0 ? formatDurationMs(penaltyMs) : "—"}
            </td>
            <td className="align-middle text-center font-mono text-[var(--ewrc-strong)]">
              {formatDurationMs(totalMs)}
            </td>
            <td className="align-middle text-center font-mono text-[var(--ewrc-heading)]">
              {leaderTotal == null || totalMs <= leaderTotal
                ? "—"
                : `+${formatDiffDurationMs(totalMs - leaderTotal)}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StageTimesTable({
  entries,
  stageId,
}: {
  entries: Entry[];
  stageId?: string;
}) {
  const sorted = useMemo(
    () =>
      [...entries]
        .map((row) => {
          if (!stageId) {
            return {
              row,
              durationMs: null as number | null,
              penaltyMs: null as number | null,
              penaltyRaw: "",
            };
          }
          const values = getRallyStageTimingValues(row, stageId);
          const startMs = parseClockToDayMs(values.startValue);
          const finishMs = parseClockToDayMs(values.finishValue);
          const penaltyMs = parsePenaltyDurationMs(values.penaltyValue);
          const pen = penaltyMs ?? 0;
          if (startMs == null || finishMs == null) {
            return {
              row,
              durationMs: null as number | null,
              penaltyMs,
              penaltyRaw: values.penaltyValue,
            };
          }
          const raw = finishMs - startMs;
          // Jump-start penalties are added into the published stage time.
          return {
            row,
            durationMs: raw >= 0 ? raw + pen : null,
            penaltyMs,
            penaltyRaw: values.penaltyValue,
          };
        })
        .filter(
          (x): x is {
            row: Entry;
            durationMs: number;
            penaltyMs: number | null;
            penaltyRaw: string;
          } => x.durationMs != null,
        )
        .sort((a, b) =>
          a.durationMs !== b.durationMs
            ? a.durationMs - b.durationMs
            : a.row.startNumber - b.row.startNumber,
        ),
    [entries, stageId],
  );
  const leaderMs = sorted[0]?.durationMs ?? null;

  if (sorted.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-[var(--ewrc-muted-3)]">
        No timed entries for this stage yet.
      </p>
    );
  }

  return (
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
        {sorted.map(({ row, durationMs, penaltyRaw }, i) => (
          <tr key={row.id} className={i % 2 === 1 ? "ewrc-row-alt" : ""}>
            <td className="align-top text-right font-mono text-[var(--ewrc-strong)]">
              {i + 1}
            </td>
            <td className="align-top text-right font-mono text-[var(--ewrc-ss)]">
              {row.startNumber}
            </td>
            <CrewStackCell row={row} />
            <td className="align-middle text-center font-mono text-[var(--ewrc-strong)]">
              {formatDurationMs(durationMs)}
            </td>
            <td className="align-middle text-center font-mono text-[var(--ewrc-heading)]">
              {penaltyRaw.trim() ? penaltyRaw.trim() : "—"}
            </td>
            <td className="align-middle text-center font-mono text-[var(--ewrc-heading)]">
              {leaderMs == null || durationMs <= leaderMs
                ? "—"
                : `+${formatDiffDurationMs(durationMs - leaderMs)}`}
            </td>
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
  const sorted = useMemo(() => {
    const ranked = [...rows]
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
        const allTimed =
          stages.length > 0 &&
          stageCells.every((c) => c.cell.outcome == null && c.timeMs != null);
        const timeMs = allTimed
          ? stageCells.reduce((sum, c) => sum + (c.timeMs ?? 0), 0)
          : null;
        const penaltyMs = getRallyEventPenaltyTotalMs(row);
        const totalMs = timeMs != null ? timeMs + penaltyMs : null;
        return { row, timeMs, penaltyMs, totalMs };
      })
      .filter(
        (x): x is {
          row: Entry;
          timeMs: number;
          penaltyMs: number;
          totalMs: number;
        } => x.totalMs != null,
      )
      .sort((a, b) =>
        a.totalMs !== b.totalMs
          ? a.totalMs - b.totalMs
          : a.row.startNumber - b.row.startNumber,
      );
    return ranked;
  }, [rows, stages]);
  const leaderTotal = sorted[0]?.totalMs ?? null;

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
        Final results appear once every stage has a time for a crew.
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
        {sorted.map(({ row, timeMs, penaltyMs, totalMs }, i) => (
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
            <td className="align-middle !text-center font-mono text-[11px] text-[var(--ewrc-strong)] sm:text-xs">
              {formatDurationMs(timeMs)}
            </td>
            <td className="align-middle !text-center font-mono text-[11px] text-[var(--ewrc-heading)] sm:text-xs">
              {penaltyMs > 0 ? formatDurationMs(penaltyMs) : "—"}
            </td>
            <td className="align-middle !text-center font-mono text-[11px] text-[var(--ewrc-strong)] sm:text-xs">
              {formatDurationMs(totalMs)}
            </td>
            <td className="align-middle !text-center font-mono text-[11px] text-[var(--ewrc-heading)] sm:text-xs">
              {leaderTotal == null || totalMs <= leaderTotal
                ? "—"
                : `+${formatDiffDurationMs(totalMs - leaderTotal)}`}
            </td>
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

function parseRallyStageTimingBlob(raw: string): Record<
  string,
  { startTime?: string; finishTime?: string; penalty?: string; penaltyNote?: string }
> {
  const trimmed = raw.trim();
  if (!trimmed || !trimmed.startsWith("{")) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<
      string,
      { startTime?: string; finishTime?: string; penalty?: string; penaltyNote?: string }
    > = {};
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

const RALLY_EVENT_PENALTY_KEY = "__event_penalty__";
const RALLY_EVENT_PENALTY_LIST_KEY = "__event_penalties__";

type RallyEventPenaltyItem = {
  id: string;
  penalty: string;
  note: string;
  /** Applies from After SSx (and later / Final) onward. */
  afterStageOrder: number;
};

/** Parse admin penalty strings like `00:10` / `0:10` (mm:ss) into milliseconds. */
function parsePenaltyDurationMs(raw: string): number | null {
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

function getRallyStageTimingValues(
  row: Entry,
  stageId: string,
): {
  startValue: string;
  finishValue: string;
  penaltyValue: string;
  penaltyNoteValue: string;
} {
  const blob = parseRallyStageTimingBlob(row.trialStartTime ?? "");
  const values = blob[stageId] ?? {};
  return {
    startValue: values.startTime?.trim() ?? "",
    finishValue: values.finishTime?.trim() ?? "",
    penaltyValue: values.penalty?.trim() ?? "",
    penaltyNoteValue: values.penaltyNote?.trim() ?? "",
  };
}

function parseEventPenaltyAfterOrder(raw: unknown, fallback = 1): number {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseInt(raw, 10)
        : Number.NaN;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

function getRallyEventPenaltyItems(row: Entry): RallyEventPenaltyItem[] {
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
function getRallyEventPenaltyItemsThroughOrder(
  row: Entry,
  throughStageOrder: number,
): RallyEventPenaltyItem[] {
  return getRallyEventPenaltyItems(row).filter(
    (item) => item.afterStageOrder <= throughStageOrder,
  );
}

function getRallyEventPenaltyTotalMs(
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

/** Per-stage cell for leg classification: outcome markers vs clocked stage time. */
function classifyRallyStageLegCell(startRaw: string, finishRaw: string): {
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

function worstLegRowOutcome(
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

function legOutcomeSortKey(o: "DNS" | "DNF" | "RET"): number {
  if (o === "DNS") return 0;
  if (o === "DNF") return 1;
  return 2;
}

function getSpeedRunDurationMs(
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

function getSpeedRunOutcomeLabel(
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
function getSpeedBestFromRunsMs(row: Entry): number | null {
  const r1 = getSpeedRunDurationMs(row, "run1");
  const r2 = getSpeedRunDurationMs(row, "run2");
  if (r1 == null && r2 == null) return null;
  if (r1 == null) return r2;
  if (r2 == null) return r1;
  return Math.min(r1, r2);
}

type SpeedFinalRankRow = {
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
function buildSpeedFinalRanking(rows: Entry[]): SpeedFinalRankRow[] {
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
