/** Print sheet branding for Cyprus Rally / Test / FIA MERC results. */

import { PRINT_LOGO_DATA_URLS } from "./print-logo-data";

export const PRINT_BRAND_ASSETS = {
  leftLogo: "/prints/cyprus-aa.png",
  /** Official Cyprus Rally 2026 main logo (center; includes AA badge). */
  centerLogo: "/prints/cyprus-rally-2026.png",
  rightLogo: "/prints/fia-merc.png",
} as const;

export function usesCyprusRallyPrintBrand(eventName: string): boolean {
  const n = eventName.trim().toLowerCase();
  return (
    n.includes("cyprus rally") ||
    n.includes("petrolina") ||
    n === "test" ||
    n.startsWith("test ") ||
    n.includes("test event") ||
    n.includes("test rally")
  );
}

/** Make public asset paths absolute so print iframes (about:blank) can load them. */
export function absolutePrintAssetUrl(path: string): string {
  const raw = path.trim();
  if (!raw) return "";
  if (
    raw.startsWith("data:") ||
    raw.startsWith("blob:") ||
    raw.startsWith("http://") ||
    raw.startsWith("https://")
  ) {
    return raw;
  }
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${withSlash}`;
  }
  return withSlash;
}

export function escapePrintHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Branded header for Cyprus Rally / Test sheets:
 * Cyprus Rally 2026 logo (includes AA) | FIA Middle East Rally Championship
 * plus a centered classification title underneath.
 * Left slot kept empty for balance (AA is already in the main logo).
 */
export function buildCyprusRallyPrintHeaderHtml(input: {
  sheetTitle: string;
  modeLabel?: string;
  logoMaxHeightPx?: number;
}): string {
  // Prefer embedded color data URLs so print iframes never lose color / fail to load.
  const center = PRINT_LOGO_DATA_URLS.center;
  const right = PRINT_LOGO_DATA_URLS.right;
  const logoH = input.logoMaxHeightPx ?? 56;
  const title = escapePrintHtml(input.sheetTitle);
  const mode = (input.modeLabel ?? "").trim();
  return `<div class="brand-header">
  <div class="brand-slot brand-left" aria-hidden="true"></div>
  <div class="brand-slot brand-center"><img src="${center}" alt="Cyprus Rally 2026" class="brand-main" /></div>
  <div class="brand-slot brand-right"><img src="${right}" alt="FIA Middle East Rally Championship" class="brand-side" /></div>
</div>
<h2 class="sheet-title">${title}</h2>${
    mode
      ? `<h3 class="sheet-mode">${escapePrintHtml(mode)}</h3>`
      : ""
  }`;
}

/** CSS shared by branded landscape result / starting-order sheets. */
export function cyprusRallyPrintHeaderCss(logoMaxHeightPx = 56): string {
  return `
  .brand-header { display: grid; grid-template-columns: 1fr 2.8fr 1fr; align-items: center; gap: 3mm; margin: 0 0 2mm; width: 100%; }
  .brand-slot { display: flex; align-items: center; }
  .brand-left { justify-content: flex-start; }
  .brand-center { justify-content: center; }
  .brand-right { justify-content: flex-end; }
  .brand-main, .brand-side { -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
  .brand-main { max-height: ${logoMaxHeightPx}px; width: auto; max-width: 100%; object-fit: contain; }
  .brand-side { max-height: ${Math.round(logoMaxHeightPx * 0.9)}px; width: auto; max-width: 100%; object-fit: contain; }
  .sheet-title { margin: 3mm 0 3mm; font-size: 14pt; font-weight: 700; line-height: 1.2; text-align: center; }
  .sheet-mode { margin: 0 0 3mm; font-size: 8pt; font-weight: 500; color: #444; text-transform: uppercase; letter-spacing: .04em; text-align: center; }
`;
}
