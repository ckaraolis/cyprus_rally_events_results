import type { Entry } from "./types";
import { formatNameWithNationality } from "@/lib/flags";
import {
  resolveStartingOrderTime,
  startingOrderPrintTitle,
} from "./leg-starting-order";
import {
  buildCyprusRallyPrintHeaderHtml,
  cyprusRallyPrintHeaderCss,
  usesCyprusRallyPrintBrand,
} from "./print-branding";
import { injectPrintSignatureFooter } from "./print-signature";
import { promptPrintSignature } from "./print-signature-prompt";

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isMobilePrintClient(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

function writeAndPrintHtml(
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

export type PrintHtmlDocumentOptions = {
  landscape?: boolean;
  /** Default sheet subject / title shown in the print dialog (editable). */
  defaultSubject: string;
};

/**
 * Opens print options (editable subject + optional signature), then prints.
 * `buildHtml` runs after the dialog so the chosen subject is on the sheet.
 * Yes → signature footer; No → no signature; Esc/outside → cancel.
 */
export async function printHtmlDocument(
  buildHtml: (subject: string) => string,
  options: PrintHtmlDocumentOptions,
): Promise<boolean> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  const defaultSubject = options.defaultSubject.trim() || "Results";
  const result = await promptPrintSignature({ defaultSubject });
  if (result.action === "cancel") return false;
  const subject = result.subject.trim() || defaultSubject;
  let html = buildHtml(subject);
  if (result.action === "sign") {
    html = injectPrintSignatureFooter(html, result.signature);
  }
  writeAndPrintHtml(html, { landscape: options.landscape });
  return true;
}

export function normalizePrintLogoUrl(logoUrl: string | null | undefined): string {
  const raw = (logoUrl ?? "").trim();
  if (!raw) return "";
  if (
    raw.startsWith("data:") ||
    raw.startsWith("blob:") ||
    raw.startsWith("http://") ||
    raw.startsWith("https://") ||
    raw.startsWith("/")
  ) {
    return raw;
  }
  return `/${raw.replace(/^\/+/, "")}`;
}

/** Landscape one-page starting order sheet (Pos…Class left/name cols, Start time centered). */
export function buildStartingOrderPdfHtml(input: {
  eventName: string;
  leg: number;
  logoUrl: string;
  rows: Entry[];
  firstCarStartTime: string;
  intervalMinutes: number;
  startTimeByEntryId?: Record<string, string>;
  /** Sheet title under the logos (editable in the print dialog). */
  sheetTitle?: string;
}): string {
  const n = Math.max(input.rows.length, 1);
  const fontPt = Math.max(
    6,
    n <= 12 ? 10 : n <= 18 ? 9 : n <= 24 ? 8 : n <= 32 ? 7 : n <= 40 ? 6.5 : 6,
  );
  const padY = n <= 18 ? 1.6 : n <= 28 ? 1.1 : n <= 36 ? 0.7 : 0.45;
  const padX = n <= 24 ? 1.4 : 1.0;
  const logoH = n <= 20 ? 48 : n <= 30 ? 36 : 28;
  const titlePt = n <= 24 ? 15 : 12;
  const subPt = n <= 24 ? 10 : 8;

  const columns = [
    "Pos",
    "#",
    "Driver",
    "Co-driver",
    "Car",
    "Class",
    "Start time",
  ];
  // Center Pos/#, Class, and Start time (index 5+).
  const centerFrom = 5;
  const shouldCenter = (colIdx: number) => colIdx <= 1 || colIdx >= centerFrom;
  const orderForResolve = {
    firstCarStartTime: input.firstCarStartTime,
    intervalMinutes: input.intervalMinutes,
    startTimeByEntryId: input.startTimeByEntryId ?? {},
  };

  const tableRows =
    input.rows.length > 0
      ? input.rows.map((row, i) => [
          String(i + 1),
          String(row.startNumber),
          formatNameWithNationality(row.driver, row.driverCountryCode),
          formatNameWithNationality(row.coDriver, row.coDriverCountryCode),
          row.car || "—",
          row.class || "—",
          resolveStartingOrderTime(orderForResolve, row.id, i),
        ])
      : [];

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
      : `<tr><td colspan="${columns.length}" class="c" style="color:#666;">No starters in starting order.</td></tr>`;

  const logoUrl = normalizePrintLogoUrl(input.logoUrl);
  const sheetTitle =
    (input.sheetTitle ?? "").trim() || startingOrderPrintTitle(input.leg);
  const branded = usesCyprusRallyPrintBrand(input.eventName);
  const headerHtml = branded
    ? buildCyprusRallyPrintHeaderHtml({
        sheetTitle,
        logoMaxHeightPx: Math.max(logoH, 58),
      })
    : `<div class="header">${
        logoUrl
          ? `<img src="${escapeHtml(logoUrl)}" alt="Event logo" class="logo" />`
          : ""
      }<h1>${escapeHtml(input.eventName)}</h1><h2>${escapeHtml(sheetTitle)}</h2></div>`;

  return `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(input.eventName)} - ${escapeHtml(sheetTitle)}</title><style>
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
  th, td { border: 1px solid #bdbdbd; padding: ${padY}mm ${padX}mm; vertical-align: middle; line-height: 1.2; word-wrap: break-word; }
  th { background: #f0f0f0; font-weight: 700; }
  th.c, td.c { text-align: center; }
  th.l, td.l { text-align: left; }
  col.c-pos { width: 5%; }
  col.c-num { width: 4%; }
  th:nth-child(1), th:nth-child(2), td:nth-child(1), td:nth-child(2) { white-space: nowrap; word-wrap: normal; overflow: visible; }
  col.c-driver, col.c-codriver { width: 18%; }
  col.c-car { width: 16%; }
  col.c-class { width: 8%; }
  col.c-time { width: 12%; }
  @media print { @page { size: A4 landscape; margin: 8mm; } html, body { margin: 0; } .page { width: auto; } }
  @media screen { body { padding: 12px; background: #e8e8e8; } .page { background: #fff; padding: 8mm; box-shadow: 0 1px 6px rgba(0,0,0,.2); } }
  </style></head><body><div class="page">${headerHtml}<table><colgroup>
      <col class="c-pos" /><col class="c-num" />
      <col class="c-driver" /><col class="c-codriver" /><col class="c-car" /><col class="c-class" />
      <col class="c-time" />
    </colgroup><thead><tr>${columns
      .map((c, colIdx) => {
        const cls = shouldCenter(colIdx) ? "c" : "l";
        return `<th class="${cls}">${escapeHtml(c)}</th>`;
      })
      .join("")}</tr></thead><tbody>${bodyHtml}</tbody></table></div></body></html>`;
}

export async function printStartingOrderPdf(input: {
  eventName: string;
  leg: number;
  logoUrl: string;
  rows: Entry[];
  firstCarStartTime: string;
  intervalMinutes: number;
  startTimeByEntryId?: Record<string, string>;
}): Promise<boolean> {
  const defaultSubject = startingOrderPrintTitle(input.leg);
  return printHtmlDocument(
    (subject) => buildStartingOrderPdfHtml({ ...input, sheetTitle: subject }),
    { landscape: true, defaultSubject },
  );
}
