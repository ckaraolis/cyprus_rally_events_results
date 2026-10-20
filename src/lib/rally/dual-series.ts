import type { Entry, RallyEvent, RallySeries } from "./types";
import { usesCyprusRallyPrintBrand } from "./print-branding";

export type { RallySeries };

export const RALLY_SERIES_OPTIONS: Array<{
  id: RallySeries;
  label: string;
  shortLabel: string;
}> = [
  { id: "merc", label: "MERC", shortLabel: "MERC" },
  { id: "national", label: "NATIONAL", shortLabel: "NATIONAL" },
];

/** Test / Cyprus Rally (Petrolina) events run MERC + NATIONAL side by side. */
export function usesDualSeriesEvent(
  event: Pick<RallyEvent, "name"> | string,
): boolean {
  const name = typeof event === "string" ? event : event.name;
  return usesCyprusRallyPrintBrand(name);
}

export function normalizeRallySeries(raw: unknown): RallySeries {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return v === "national" ? "national" : "merc";
}

export function normalizeCyNational(raw: unknown): boolean {
  if (raw === true || raw === 1) return true;
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase();
    return v === "yes" || v === "y" || v === "true" || v === "1";
  }
  return false;
}

export function entrySeries(entry: Pick<Entry, "series">): RallySeries {
  return normalizeRallySeries(entry.series);
}

export function entryCyNational(entry: Pick<Entry, "cyNational">): boolean {
  return entry.cyNational === true;
}

export function filterEntriesBySeries(
  entries: Entry[],
  series: RallySeries,
): Entry[] {
  return entries.filter((e) => entrySeries(e) === series);
}

export function filterEntriesCyNational(entries: Entry[]): Entry[] {
  return entries.filter((e) => entryCyNational(e));
}

export function seriesLabel(series: RallySeries): string {
  return series === "national" ? "NATIONAL" : "MERC";
}

export type EntrySeriesFlagsMap = Record<
  string,
  { series: RallySeries; cyNational: boolean }
>;

export function normalizeEntrySeriesFlagsMap(raw: unknown): EntrySeriesFlagsMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: EntrySeriesFlagsMap = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const entryId = id.trim();
    if (!entryId) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const o = value as Record<string, unknown>;
    out[entryId] = {
      series: normalizeRallySeries(o.series),
      cyNational: normalizeCyNational(o.cyNational),
    };
  }
  return out;
}

export function buildEntrySeriesFlagsMap(entries: Entry[]): EntrySeriesFlagsMap {
  const out: EntrySeriesFlagsMap = {};
  for (const e of entries) {
    out[e.id] = {
      series: entrySeries(e),
      cyNational: entryCyNational(e),
    };
  }
  return out;
}

export function applyEntrySeriesFlags(
  entry: Entry,
  flags: EntrySeriesFlagsMap[string] | undefined,
): Entry {
  if (!flags) {
    return {
      ...entry,
      series: entry.series ?? "merc",
      cyNational: entry.cyNational === true,
    };
  }
  return {
    ...entry,
    series: flags.series,
    cyNational: flags.cyNational,
  };
}
