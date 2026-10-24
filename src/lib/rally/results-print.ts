import { formatNameWithNationality } from "@/lib/flags";
import { filterEntriesBySeries, type RallySeries } from "./dual-series";
import {
  buildCyprusRallyPrintHeaderHtml,
  cyprusRallyPrintHeaderCss,
  usesCyprusRallyPrintBrand,
} from "./print-branding";
import {
  findShakedownBestDurationMs,
  getShakedownPassCount,
  getShakedownPassDurationsMs,
  getShakedownPasses,
  isShakedownStage,
} from "./shakedown-passes";
import {
  competitiveStages,
  isCompetitiveStage,
  isPreEventStage,
} from "./stage-kind";
import {
  normalizePrintLogoUrl,
  printHtmlDocument,
} from "./starting-order-print";
import {
  RALLY2_FOOTNOTE,
  buildRallyOverallRanking,
  buildSpeedFinalRanking,
  classifyRallyStageLegCell,
  formatDiffDurationMs,
  formatDurationMs,
  getRallyEventPenaltyItems,
  getRallyEventPenaltyTotalMs,
  getRallyStageTimingValues,
  getSpeedRunDurationMs,
  getSpeedRunOutcomeLabel,
  legOutcomeSortKey,
  parseClockToDayMs,
  parsePenaltyDurationMs,
  parseRallyStageTimingBlob,
  stageChipLabel,
  stageHeadingLabel,
  worstLegRowOutcome,
} from "./results-timing";
import type { Entry, Stage } from "./types";

function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Shared landscape one-page results sheet used by rally/speed Print PDF. */
export function buildLandscapeResultsPdfHtml(input: {
  eventName: string;
  subtitle: string;
  modeLabel: string;
  columns: string[];
  tableRows: string[][];
  logoUrl: string;
  /** Optional note below the table (e.g. Rally2 footnote). */
  footnote?: string | null;
  /**
   * Rally SS / After SS layout:
   * narrow Pos/#, wider Driver/Co-driver, Car mid, Class small+center,
   * then SS Time / Penalty / Total / Diff centered.
   */
  rallyClassificationLayout?: boolean;
  /** LEG sheet: Pos/#, Driver, Co-driver, Car, Class, SS1..SSn, SS Times, Penalty, Total, Diff. */
  rallyLegLayout?: boolean;
  /** Shakedown: Pos/#, Driver, Co-driver, Car, Class, 1..N, Best, Diff. */
  shakedownLayout?: boolean;
  /** Active shakedown pass count (2 or 3) when shakedownLayout is set. */
  shakedownPassCount?: 2 | 3;
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
  const shakedownLayout = input.shakedownLayout === true;
  const shakedownPassCount =
    input.shakedownPassCount === 2 ? 2 : shakedownLayout ? 3 : 0;
  const legStageCount = Math.max(0, input.legStageCount ?? 0);
  const branded = usesCyprusRallyPrintBrand(input.eventName);
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
  const logoH = n <= 20 ? 52 : n <= 30 ? 42 : 34;
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
  if (shakedownLayout) {
    // Pos, #, Driver, Co-driver, Car, Class, 1..N, Best, Diff
    const passCols = Array.from(
      { length: shakedownPassCount + 2 },
      () => '<col class="c-pass" />',
    ).join("");
    colgroup = `<colgroup>
      <col class="c-pos" /><col class="c-num" />
      <col class="c-driver" /><col class="c-codriver" /><col class="c-car" /><col class="c-class" />
      ${passCols}
    </colgroup>`;
  } else if (legLayout && legStageCount > 0) {
    // Reserve four trailing time cols (SS Times, Penalty, Total, Diff).
    const ssCols = Array.from(
      { length: legStageCount },
      () => '<col class="c-ss" />',
    ).join("");
    colgroup = `<colgroup>
      <col class="c-pos" /><col class="c-num" />
      <col class="c-driver" /><col class="c-codriver" /><col class="c-car" /><col class="c-class" />
      ${ssCols}
      <col class="c-time" /><col class="c-time" /><col class="c-time" /><col class="c-diff" />
    </colgroup>`;
  } else if (rallyLayout && colCount >= 10) {
    // Pos, #, Driver, Co-driver, Car, Class, SS Time(s), Penalty, Total time, Diff
    colgroup = `<colgroup>
      <col class="c-pos" /><col class="c-num" />
      <col class="c-driver" /><col class="c-codriver" /><col class="c-car" /><col class="c-class" />
      <col class="c-time" /><col class="c-time" /><col class="c-time" /><col class="c-diff" />
    </colgroup>`;
  } else if (input.narrowPosNum || rallyLayout || legLayout) {
    colgroup = `<colgroup><col class="c-pos" /><col class="c-num" />${input.columns
      .slice(2)
      .map(() => "<col />")
      .join("")}</colgroup>`;
  }

  // LEG with many SS columns must leave room for Diff (was getting clipped off-page).
  const legSsWidthPct =
    legStageCount >= 6 ? 3.6 : legStageCount >= 4 ? 4.2 : 5.0;
  const legDriverWidthPct = legStageCount >= 6 ? 11.0 : legStageCount >= 4 ? 12.0 : 13.2;
  const legCarWidthPct = legStageCount >= 6 ? 9.0 : 11;
  const legTimeWidthPct = legStageCount >= 6 ? 5.6 : legStageCount >= 4 ? 6.0 : 6.4;
  const driverWidthPct = shakedownLayout
    ? "16%"
    : legLayout
      ? `${legDriverWidthPct}%`
      : "14.5%";
  const carWidthPct = shakedownLayout
    ? "14%"
    : legLayout
      ? `${legCarWidthPct}%`
      : "12.5%";
  const classWidthPct = legLayout ? "4.2%" : "4.8%";
  const passWidthPct = "7.2%";
  const timeWidthPct = legLayout ? `${legTimeWidthPct}%` : "7.2%";

  const headerHtml = branded
    ? buildCyprusRallyPrintHeaderHtml({
        sheetTitle: input.subtitle,
        logoMaxHeightPx: Math.max(logoH, 58),
      })
    : `<div class="header">${
        input.logoUrl
          ? `<img src="${escapeHtml(input.logoUrl)}" alt="Event logo" class="logo" />`
          : ""
      }<h1>${escapeHtml(input.eventName)}</h1><h2>${escapeHtml(input.subtitle)}</h2><h3>${escapeHtml(input.modeLabel)}</h3></div>`;

  return `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(input.eventName)} - ${escapeHtml(input.subtitle)}</title><style>
  @page { size: A4 landscape; margin: 8mm; }
  html, body { margin: 0; padding: 0; color: #111; background: #fff; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 281mm; max-width: 100%; margin: 0 auto; box-sizing: border-box; }
  .header { display: flex; flex-direction: column; align-items: center; gap: 2px; margin: 0 0 5mm; text-align: center; }
  .logo { max-height: ${logoH}px; width: auto; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1 { margin: 0; font-size: ${titlePt}pt; line-height: 1.15; }
  h2 { margin: 2px 0 0; font-size: ${subPt}pt; font-weight: 600; line-height: 1.2; }
  h3 { margin: 1px 0 0; font-size: ${Math.max(7, subPt - 1)}pt; font-weight: 500; color: #444; text-transform: uppercase; letter-spacing: .04em; }
  ${branded ? cyprusRallyPrintHeaderCss(logoH) : ""}
  table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: ${fontPt}pt; }
  th, td { border: 1px solid #bdbdbd; padding: ${padY}mm ${legLayout && legStageCount >= 6 ? Math.min(padX, 0.7) : padX}mm; vertical-align: middle; line-height: 1.2; word-wrap: break-word; overflow: hidden; }
  th { background: #f0f0f0; font-weight: 700; }
  th.c, td.c { text-align: center; }
  th.l, td.l { text-align: left; }
  col.c-pos { width: ${legLayout ? "3.2%" : "3.6%"}; }
  col.c-num { width: ${legLayout ? "2.4%" : "2.8%"}; }
  th:nth-child(1), th:nth-child(2), td:nth-child(1), td:nth-child(2) { white-space: nowrap; word-wrap: normal; overflow: visible; }
  col.c-driver, col.c-codriver { width: ${driverWidthPct}; }
  col.c-car { width: ${carWidthPct}; }
  col.c-class { width: ${classWidthPct}; }
  col.c-ss { width: ${legSsWidthPct}%; }
  col.c-pass { width: ${passWidthPct}; }
  col.c-time { width: ${timeWidthPct}; }
  col.c-diff { width: ${timeWidthPct}; }
  .footnote { margin: 3mm 0 0; font-size: 8pt; font-weight: 500; color: #333; }
  @media print { @page { size: A4 landscape; margin: 8mm; } html, body { margin: 0; } .page { width: auto; overflow: visible; } table { width: 100% !important; } }
  @media screen { body { padding: 12px; background: #e8e8e8; } .page { background: #fff; padding: 8mm; box-shadow: 0 1px 6px rgba(0,0,0,.2); } }
  </style></head><body><div class="page">${headerHtml}<table>${colgroup}<thead><tr>${input.columns
    .map((c, colIdx) => {
      const cls = shouldCenter(colIdx) ? "c" : "l";
      return `<th class="${cls}">${escapeHtml(c)}</th>`;
    })
    .join("")}</tr></thead><tbody>${bodyHtml}</tbody></table>${
      input.footnote?.trim()
        ? `<p class="footnote">${escapeHtml(input.footnote.trim())}</p>`
        : ""
    }</div></body></html>`;
}

export function buildRallyShakedownPdfRows(entries: Entry[], stage: Stage): string[][] {
  const stageId = stage.id;
  const timeDigits: 2 | 3 = 3;
  const passCount = getShakedownPassCount(stage);
  const ranked = [...entries]
    .map((row) => {
      const blob = parseRallyStageTimingBlob(row.trialStartTime ?? "");
      const passes = getShakedownPasses(blob[stageId], passCount);
      const durations = getShakedownPassDurationsMs(
        passes,
        parseClockToDayMs,
        passCount,
      );
      const bestMs = findShakedownBestDurationMs(durations);
      return { row, durations, bestMs };
    })
    .filter((x) => x.bestMs != null)
    .sort((a, b) =>
      (a.bestMs ?? 0) !== (b.bestMs ?? 0)
        ? (a.bestMs ?? 0) - (b.bestMs ?? 0)
        : a.row.startNumber - b.row.startNumber,
    );
  const leaderMs = ranked[0]?.bestMs ?? null;
  return ranked.map(({ row, durations, bestMs }, i) => {
    const passCells = Array.from({ length: passCount }, (_, pi) => {
      const d = durations[pi];
      return d != null ? formatDurationMs(d, timeDigits) : "—";
    });
    return [
      String(i + 1),
      String(row.startNumber),
      formatNameWithNationality(row.driver, row.driverCountryCode),
      formatNameWithNationality(row.coDriver, row.coDriverCountryCode),
      row.car || "—",
      row.class || "—",
      ...passCells,
      bestMs != null ? formatDurationMs(bestMs, timeDigits) : "—",
      bestMs == null || leaderMs == null || bestMs <= leaderMs
        ? "—"
        : `+${formatDiffDurationMs(bestMs - leaderMs, timeDigits)}`,
    ];
  });
}

export function buildRallyStagePdfRows(entries: Entry[], stage: Stage): {
  rows: string[][];
  footnote: string | null;
} {
  if (isShakedownStage(stage)) {
    return { rows: buildRallyShakedownPdfRows(entries, stage), footnote: null };
  }
  const stageId = stage.id;
  const timeDigits: 2 | 3 = isPreEventStage(stage) ? 3 : 2;
  const showRally2 = isCompetitiveStage(stage);
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
        rally2: showRally2 && values.rally2,
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
  const rows = ranked.map(
    ({ row, cell, ssTimeMs, penaltyMs, totalMs, rally2 }, i) => [
      String(i + 1),
      rally2 ? `*${row.startNumber}` : String(row.startNumber),
      formatNameWithNationality(row.driver, row.driverCountryCode),
      formatNameWithNationality(row.coDriver, row.coDriverCountryCode),
      row.car || "—",
      row.class || "—",
      cell.outcome != null ? cell.outcome : formatDurationMs(ssTimeMs, timeDigits),
      penaltyMs > 0 ? formatDurationMs(penaltyMs) : "—",
      cell.outcome != null ? cell.outcome : formatDurationMs(totalMs, timeDigits),
      totalMs == null || leaderMs == null || totalMs <= leaderMs
        ? "—"
        : `+${formatDiffDurationMs(totalMs - leaderMs, timeDigits)}`,
    ],
  );
  return {
    rows,
    footnote: ranked.some((x) => x.rally2) ? RALLY2_FOOTNOTE : null,
  };
}

export function buildRallyOverallPdfRows(
  entries: Entry[],
  stages: Stage[],
  eventPenaltyMode: "through-max" | "in-stages-only" = "through-max",
): string[][] {
  const ranked = buildRallyOverallRanking(entries, stages, eventPenaltyMode);
  const leaderTotal = ranked.find((x) => x.tier === 0)?.totalMs ?? null;
  let classifiedPos = 0;
  return ranked.map(
    ({ row, totalMs, penaltyMs, ssTimesMs, tier, statusLabel }) => {
      const pos = tier === 0 ? String(++classifiedPos) : "—";
      return [
        pos,
        String(row.startNumber),
        formatNameWithNationality(row.driver, row.driverCountryCode),
        formatNameWithNationality(row.coDriver, row.coDriverCountryCode),
        row.car || "—",
        row.class || "—",
        tier === 0 ? formatDurationMs(ssTimesMs) : (statusLabel ?? "—"),
        tier === 0 && penaltyMs > 0 ? formatDurationMs(penaltyMs) : "—",
        tier === 0 ? formatDurationMs(totalMs) : (statusLabel ?? "—"),
        tier === 0 &&
        leaderTotal != null &&
        totalMs != null &&
        totalMs > leaderTotal
          ? `+${formatDiffDurationMs(totalMs - leaderTotal)}`
          : "—",
      ];
    },
  );
}

/** LEG sheet: all crews, per-SS times (only when stages are completed). */
function buildRallyLegPdfSheet(
  entries: Entry[],
  stagesInLeg: Stage[],
  allStages: Stage[],
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
    ...stagesInLeg.map((st) => stageChipLabel(st, allStages)),
    "SS Times",
    "Penalty",
    "Total",
    "Diff",
  ];
  const tableRows = ranked.map((legRow, i) => [
    String(i + 1),
    String(legRow.row.startNumber),
    formatNameWithNationality(
      legRow.row.driver,
      legRow.row.driverCountryCode,
    ),
    formatNameWithNationality(
      legRow.row.coDriver,
      legRow.row.coDriverCountryCode,
    ),
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

export type SpeedPrintRunId = "trial" | "run1" | "run2" | "best";

type PrintBase = {
  eventName: string;
  logoUrl: string | null | undefined;
  /** Entries to print (already filtered by series / class / started as needed). */
  entries: Entry[];
};

function buildSpeedBestTableRows(rows: Entry[]): {
  columns: string[];
  tableRows: string[][];
} {
  const ranked = buildSpeedFinalRanking(rows);
  const leaderBest = ranked.find((x) => x.tier === 0)?.bestFromRuns ?? null;
  const columns = [
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
  const tableRows = ranked.map(
    ({ row, trial, run1, run2, bestFromRuns, bestDisplay, nonStarter }, i) => [
      String(i + 1),
      String(row.startNumber),
      formatNameWithNationality(row.driver, row.driverCountryCode),
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
  return { columns, tableRows };
}

/**
 * Rally stage sheet: this SS only (`ss`) or cumulative After SSx (`overall`).
 * Shakedown / Qualify always print the stage sheet.
 */
function entriesForPrint(entries: Entry[], series: RallySeries | null): Entry[] {
  return series != null ? filterEntriesBySeries(entries, series) : [...entries];
}

/**
 * Rally stage sheet: this SS only (`ss`) or cumulative After SSx (`overall`).
 * Shakedown / Qualify always print the stage sheet.
 */
export async function printRallyStageResultsPdf(
  input: PrintBase & {
    stage: Stage;
    allStages: Stage[];
    mode?: "ss" | "overall";
  },
): Promise<boolean> {
  const { stage, allStages } = input;
  const logoUrl = normalizePrintLogoUrl(input.logoUrl);
  const printOpts = {
    landscape: true as const,
    eventName: input.eventName,
  };

  if (input.mode === "overall" && isCompetitiveStage(stage)) {
    const sorted = competitiveStages(allStages);
    const idx = sorted.findIndex((s) => s.id === stage.id);
    const cumulative = idx >= 0 ? sorted.slice(0, idx + 1) : [];
    if (cumulative.length >= 1) {
      const defaultSubject = `Overall Classification after ${stageHeadingLabel(stage, allStages)}`;
      return printHtmlDocument(
        ({ subject, series }) => {
          const tableRows = buildRallyOverallPdfRows(
            entriesForPrint(input.entries, series),
            cumulative,
          );
          return buildLandscapeResultsPdfHtml({
            eventName: input.eventName,
            subtitle: subject,
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
        },
        { ...printOpts, defaultSubject },
      );
    }
  }

  const shakedown = isShakedownStage(stage);
  const qualify = stage.kind === "qualify";
  const shakedownPasses = shakedown ? getShakedownPassCount(stage) : 3;
  const defaultSubject = shakedown
    ? "Shakedown Results"
    : qualify
      ? "Overall Classification Qualifying Stage"
      : isPreEventStage(stage)
        ? stageHeadingLabel(stage, allStages)
        : `Stage Classification ${stageHeadingLabel(stage, allStages)}`;
  return printHtmlDocument(
    ({ subject, series }) => {
      const { rows: tableRows, footnote } = buildRallyStagePdfRows(
        entriesForPrint(input.entries, series),
        stage,
      );
      return buildLandscapeResultsPdfHtml({
        eventName: input.eventName,
        subtitle: subject,
        modeLabel: "Stage results",
        columns: shakedown
          ? [
              "Pos",
              "#",
              "Driver",
              "Co-driver",
              "Car",
              "Class",
              ...Array.from({ length: shakedownPasses }, (_, i) => String(i + 1)),
              "Best",
              "Diff",
            ]
          : [
              "Pos",
              "#",
              "Driver",
              "Co-driver",
              "Car",
              "Class",
              isPreEventStage(stage) ? "Time" : "SS Time",
              "Penalty",
              "Total time",
              "Diff",
            ],
        tableRows,
        logoUrl,
        footnote,
        rallyClassificationLayout: !shakedown,
        shakedownLayout: shakedown,
        shakedownPassCount: shakedown ? shakedownPasses : undefined,
        centerFromCol: 5,
      });
    },
    { ...printOpts, defaultSubject },
  );
}

/** Rally end-of-leg sheet: per-SS columns for every crew. */
export async function printRallyLegResultsPdf(
  input: PrintBase & {
    leg: number;
    stagesInLeg: Stage[];
    allStages: Stage[];
  },
): Promise<boolean> {
  const defaultSubject = `LEG ${input.leg} Overall Classification`;
  return printHtmlDocument(
    ({ subject, series }) => {
      const { columns, tableRows } = buildRallyLegPdfSheet(
        entriesForPrint(input.entries, series),
        input.stagesInLeg,
        input.allStages,
      );
      return buildLandscapeResultsPdfHtml({
        eventName: input.eventName,
        subtitle: subject,
        modeLabel: "Leg classification",
        columns,
        tableRows,
        logoUrl: normalizePrintLogoUrl(input.logoUrl),
        rallyLegLayout: true,
        legStageCount: input.stagesInLeg.length,
        centerFromCol: 5,
      });
    },
    {
      landscape: true,
      defaultSubject,
      eventName: input.eventName,
    },
  );
}

/** Speed run sheet (Trial / 1st Run / 2nd Run) or the Best Time classification. */
export async function printSpeedRunResultsPdf(
  input: PrintBase & {
    runId: SpeedPrintRunId;
    /** Heading shown on the sheet (e.g. "1st Run"). */
    label: string;
  },
): Promise<boolean> {
  const logoUrl = normalizePrintLogoUrl(input.logoUrl);
  const defaultSubject = input.label.trim() || "Results";
  const printOpts = {
    landscape: true as const,
    defaultSubject,
    eventName: input.eventName,
  };
  if (input.runId === "best") {
    return printHtmlDocument(
      ({ subject, series }) => {
        const { columns, tableRows } = buildSpeedBestTableRows(
          entriesForPrint(input.entries, series),
        );
        return buildLandscapeResultsPdfHtml({
          eventName: input.eventName,
          subtitle: subject,
          modeLabel: "Best Time classification",
          columns,
          tableRows,
          logoUrl,
        });
      },
      printOpts,
    );
  }
  const runId = input.runId;
  return printHtmlDocument(
    ({ subject, series }) => {
      const ranked = entriesForPrint(input.entries, series)
        .map((r) => ({ r, t: getSpeedRunDurationMs(r, runId) }))
        .filter((x): x is { r: Entry; t: number } => x.t != null)
        .sort((a, b) =>
          a.t !== b.t ? a.t - b.t : a.r.startNumber - b.r.startNumber,
        );
      const leader = ranked[0]?.t ?? null;
      const tableRows = ranked.map(({ r, t }, i) => [
        String(i + 1),
        String(r.startNumber),
        formatNameWithNationality(r.driver, r.driverCountryCode),
        formatDurationMs(t),
        leader == null || t <= leader
          ? "—"
          : `+${formatDiffDurationMs(t - leader)}`,
      ]);
      return buildLandscapeResultsPdfHtml({
        eventName: input.eventName,
        subtitle: subject,
        modeLabel: "Run results",
        columns: ["Pos", "#", "Driver", "Time", "Diff"],
        tableRows,
        logoUrl,
      });
    },
    printOpts,
  );
}

/** Speed Official Final Results (ordered by best of 1st / 2nd run). */
export async function printSpeedFinalResultsPdf(
  input: PrintBase & { sheetTitle?: string },
): Promise<boolean> {
  const defaultSubject =
    input.sheetTitle?.trim() || "Official Final Results";
  return printHtmlDocument(
    ({ subject, series }) => {
      const { columns, tableRows } = buildSpeedBestTableRows(
        entriesForPrint(input.entries, series),
      );
      return buildLandscapeResultsPdfHtml({
        eventName: input.eventName,
        subtitle: subject,
        modeLabel: "Ordered by Best Time",
        columns,
        tableRows,
        logoUrl: normalizePrintLogoUrl(input.logoUrl),
      });
    },
    {
      landscape: true,
      defaultSubject,
      eventName: input.eventName,
    },
  );
}
