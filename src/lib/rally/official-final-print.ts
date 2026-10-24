import type { Entry, Stage } from "./types";
import { buildOfficialFinalResultRows } from "./admin-excel-export";
import {
  buildCyprusRallyPrintHeaderHtml,
  cyprusRallyPrintHeaderCss,
  usesCyprusRallyPrintBrand,
} from "./print-branding";
import { filterEntriesBySeries } from "./dual-series";
import {
  normalizePrintLogoUrl,
  printHtmlDocument,
} from "./starting-order-print";

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const FINAL_COLUMNS = [
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
] as const;

function buildOfficialFinalResultsPdfHtml(input: {
  eventName: string;
  logoUrl: string;
  entries: Entry[];
  stages: Stage[];
  sheetTitle: string;
}): string {
  const tableRows = buildOfficialFinalResultRows(input.entries, input.stages);
  const n = Math.max(tableRows.length, 1);
  const fontPt = Math.max(
    5.5,
    n <= 12 ? 10 : n <= 18 ? 9 : n <= 24 ? 8 : n <= 32 ? 7 : n <= 40 ? 6.5 : 6,
  );
  const padY = n <= 18 ? 1.6 : n <= 28 ? 1.1 : n <= 36 ? 0.7 : 0.45;
  const padX = n <= 24 ? 1.2 : 0.9;
  const logoH = Math.max(n <= 20 ? 52 : n <= 30 ? 42 : 34, 58);
  const branded = usesCyprusRallyPrintBrand(input.eventName);
  const logoUrl = normalizePrintLogoUrl(input.logoUrl);
  const subtitle =
    input.sheetTitle.trim() || "Official Final Results";
  const centerFrom = 5;
  const shouldCenter = (colIdx: number) => colIdx <= 1 || colIdx >= centerFrom;

  const bodyHtml =
    tableRows.length > 0
      ? tableRows
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
      : `<tr><td colspan="${FINAL_COLUMNS.length}" class="c" style="color:#666;">No timed entries.</td></tr>`;

  const headerHtml = branded
    ? buildCyprusRallyPrintHeaderHtml({
        sheetTitle: subtitle,
        logoMaxHeightPx: logoH,
      })
    : `<div class="header">${
        logoUrl
          ? `<img src="${escapeHtml(logoUrl)}" alt="Event logo" class="logo" />`
          : ""
      }<h1>${escapeHtml(input.eventName)}</h1><h2>${escapeHtml(subtitle)}</h2></div>`;

  return `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(input.eventName)} - ${escapeHtml(subtitle)}</title><style>
  @page { size: A4 landscape; margin: 8mm; }
  html, body { margin: 0; padding: 0; color: #111; background: #fff; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 281mm; max-width: 100%; margin: 0 auto; box-sizing: border-box; }
  .header { display: flex; flex-direction: column; align-items: center; gap: 2px; margin: 0 0 5mm; text-align: center; }
  .logo { max-height: ${logoH}px; width: auto; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1 { margin: 0; font-size: 15pt; line-height: 1.15; }
  h2 { margin: 2px 0 0; font-size: 10pt; font-weight: 600; line-height: 1.2; }
  ${branded ? cyprusRallyPrintHeaderCss(logoH) : ""}
  table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: ${fontPt}pt; }
  th, td { border: 1px solid #bdbdbd; padding: ${padY}mm ${padX}mm; vertical-align: middle; line-height: 1.2; word-wrap: break-word; overflow: hidden; }
  th { background: #f0f0f0; font-weight: 700; }
  th.c, td.c { text-align: center; }
  th.l, td.l { text-align: left; }
  col.c-pos { width: 3.6%; }
  col.c-num { width: 2.8%; }
  th:nth-child(1), th:nth-child(2), td:nth-child(1), td:nth-child(2) { white-space: nowrap; word-wrap: normal; overflow: visible; }
  col.c-driver, col.c-codriver { width: 14.5%; }
  col.c-car { width: 12.5%; }
  col.c-class { width: 4.8%; }
  col.c-time, col.c-diff { width: 7.2%; }
  @media print { @page { size: A4 landscape; margin: 8mm; } html, body { margin: 0; } .page { width: auto; overflow: visible; } table { width: 100% !important; } }
  @media screen { body { padding: 12px; background: #e8e8e8; } .page { background: #fff; padding: 8mm; box-shadow: 0 1px 6px rgba(0,0,0,.2); } }
  </style></head><body><div class="page">${headerHtml}<table><colgroup>
      <col class="c-pos" /><col class="c-num" />
      <col class="c-driver" /><col class="c-codriver" /><col class="c-car" /><col class="c-class" />
      <col class="c-time" /><col class="c-time" /><col class="c-time" /><col class="c-diff" />
    </colgroup><thead><tr>${FINAL_COLUMNS.map((c, colIdx) => {
      const cls = shouldCenter(colIdx) ? "c" : "l";
      return `<th class="${cls}">${escapeHtml(c)}</th>`;
    }).join("")}</tr></thead><tbody>${bodyHtml}</tbody></table></div></body></html>`;
}

/** Landscape Official Final Results sheet (admin + public print). */
export async function printOfficialFinalResultsPdf(input: {
  eventName: string;
  logoUrl: string;
  entries: Entry[];
  stages: Stage[];
  /** Defaults to "Official Final Results". */
  sheetTitle?: string;
  /**
   * When false, skip MERC/LOCAL picker (e.g. Cyprus Rally Challenge already
   * filtered). When omitted, dual-series events ask in the print dialog.
   */
  dualSeries?: boolean;
}): Promise<boolean> {
  const defaultSubject =
    (input.sheetTitle ?? "").trim() || "Official Final Results";
  return printHtmlDocument(
    ({ subject, series }) => {
      const entries =
        series != null
          ? filterEntriesBySeries(input.entries, series)
          : input.entries;
      return buildOfficialFinalResultsPdfHtml({
        eventName: input.eventName,
        logoUrl: input.logoUrl,
        entries,
        stages: input.stages,
        sheetTitle: subject,
      });
    },
    {
      landscape: true,
      defaultSubject,
      eventName: input.eventName,
      dualSeries: input.dualSeries,
    },
  );
}
