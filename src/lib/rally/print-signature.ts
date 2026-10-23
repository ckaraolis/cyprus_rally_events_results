/** Clerk signature block printed at the bottom of every results PDF. */

export type PrintSignature = {
  /** Signatory name (left column). */
  name: string;
  /** Always "Clerk of the Course" on sheets. */
  title: string;
  /** DD/MM/YYYY */
  date: string;
  /** HH:MM:SS */
  time: string;
};

export const PRINT_SIGNATURE_TITLE = "Clerk of the Course";

const STORAGE_KEY = "rally-print-signature-name";

export function loadSavedPrintSignatureName(): string {
  if (typeof window === "undefined") return "";
  try {
    return (window.localStorage.getItem(STORAGE_KEY) ?? "").trim();
  } catch {
    return "";
  }
}

export function savePrintSignatureName(name: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, name.trim());
  } catch {
    // ignore quota / private mode
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local "now" as DD/MM/YYYY and HH:MM:SS. */
export function nowPrintDateTime(d = new Date()): { date: string; time: string } {
  return {
    date: `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`,
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`,
  };
}

export function isValidPrintDate(raw: string): boolean {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return false;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(year, month - 1, day);
  return (
    dt.getFullYear() === year &&
    dt.getMonth() === month - 1 &&
    dt.getDate() === day
  );
}

export function isValidPrintTime(raw: string): boolean {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = m[3] != null ? Number(m[3]) : 0;
  return h >= 0 && h <= 23 && min >= 0 && min <= 59 && sec >= 0 && sec <= 59;
}

/** Normalize time to HH:MM:SS. */
export function normalizePrintTime(raw: string): string {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return raw.trim();
  return `${pad2(Number(m[1]))}:${pad2(Number(m[2]))}:${pad2(
    m[3] != null ? Number(m[3]) : 0,
  )}`;
}

/** Normalize date to DD/MM/YYYY. */
export function normalizePrintDate(raw: string): string {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return raw.trim();
  return `${pad2(Number(m[1]))}/${pad2(Number(m[2]))}/${m[3]}`;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function printSignatureFooterCss(): string {
  return `
  .sig-footer { display: flex; justify-content: space-between; align-items: flex-end; gap: 12mm; margin: 8mm 18% 0; font-size: 10pt; font-weight: 700; line-height: 1.35; color: #111; }
  .sig-footer .sig-left { text-align: left; }
  .sig-footer .sig-right { text-align: right; white-space: nowrap; }
  .sig-footer .sig-name, .sig-footer .sig-role, .sig-footer .sig-date, .sig-footer .sig-time { margin: 0; }
  `;
}

export function buildPrintSignatureFooterHtml(sig: PrintSignature): string {
  return `<div class="sig-footer">
  <div class="sig-left">
    <p class="sig-name">${escapeHtml(sig.name)}</p>
    <p class="sig-role">${escapeHtml(sig.title)}</p>
  </div>
  <div class="sig-right">
    <p class="sig-date">DATE: ${escapeHtml(sig.date)}</p>
    <p class="sig-time">TIME: ${escapeHtml(sig.time)}</p>
  </div>
</div>`;
}

/** Inject signature CSS + footer into a full print HTML document. */
export function injectPrintSignatureFooter(
  html: string,
  sig: PrintSignature,
): string {
  const css = printSignatureFooterCss();
  const footer = buildPrintSignatureFooterHtml(sig);
  let out = html;
  if (out.includes("</style>")) {
    out = out.replace("</style>", `${css}</style>`);
  } else if (out.includes("</head>")) {
    out = out.replace("</head>", `<style>${css}</style></head>`);
  }
  if (/<\/div>\s*<\/body>/i.test(out)) {
    out = out.replace(/<\/div>\s*<\/body>/i, `${footer}</div></body>`);
  } else if (/<\/body>/i.test(out)) {
    out = out.replace(/<\/body>/i, `${footer}</body>`);
  } else {
    out += footer;
  }
  return out;
}
