import fs from "fs/promises";
import path from "path";
import { defaultRallyConfig } from "./defaults";
import { normalizeCountryCode } from "@/lib/flags";
import { loadConfigFromDb, saveConfigToDb } from "./db-store";
import type {
  Entry,
  EventStatus,
  EventType,
  OfficialNoticeCategory,
  RallyEvent,
  RallySiteConfig,
  SiteSettings,
  SpeedRunImportStatus,
  Stage,
  StageProgressStatus,
} from "./types";

const CONFIG_PATH = path.join(process.cwd(), "data", "rally-site.json");
const DB_READS = process.env.RALLY_DB_READS === "1";
const DB_WRITES = process.env.RALLY_DB_WRITES === "1";
const FILE_WRITES = process.env.RALLY_FILE_WRITES !== "0";

const OFFICIAL_NOTICE_DEFAULT_CATEGORIES: OfficialNoticeCategory[] = [
  "Supplementary Regulations",
  "Bulletins",
  "Steward Decisions",
  "Other",
];

function normalizeOfficialNoticeCategory(v: unknown): string {
  if (typeof v !== "string") return "Other";
  const s = v.trim();
  if (!s) return "Other";
  return s.slice(0, 80);
}

function normalizeOfficialNoticeCustomCategories(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const dedupe = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const v = item.trim().slice(0, 80);
    if (!v) continue;
    if (OFFICIAL_NOTICE_DEFAULT_CATEGORIES.includes(v as OfficialNoticeCategory)) {
      continue;
    }
    dedupe.add(v);
  }
  return [...dedupe];
}

function normalizeOfficialNoticeDocuments(
  raw: unknown,
): RallyEvent["officialNoticeDocuments"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const o =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : {};
      const id =
        typeof o.id === "string" && o.id.trim()
          ? o.id.trim()
          : crypto.randomUUID();
      const title =
        typeof o.title === "string" && o.title.trim() ? o.title.trim().slice(0, 180) : "";
      const url = typeof o.url === "string" ? o.url.trim() : "";
      if (!title || !url) return null;
      const fileName =
        typeof o.fileName === "string" && o.fileName.trim()
          ? o.fileName.trim().slice(0, 220)
          : "document";
      return {
        id,
        title,
        category: normalizeOfficialNoticeCategory(o.category),
        url,
        fileName,
        uploadedAt:
          typeof o.uploadedAt === "string" && o.uploadedAt.trim()
            ? o.uploadedAt
            : new Date().toISOString(),
      };
    })
    .filter((x): x is RallyEvent["officialNoticeDocuments"][number] => Boolean(x));
}

function normalizeProgressStatus(v: unknown): StageProgressStatus {
  if (v === "live" || v === "completed" || v === "pending") return v;
  return "pending";
}

function normalizeFirstCarStartTime(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  if (t.length > 16) return t.slice(0, 16);
  return t;
}

function normalizeLeg(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 1;
  const n = Math.floor(v);
  return n >= 1 ? n : 1;
}

function normalizeDateOnly(v: unknown): string {
  if (typeof v !== "string") return "";
  const s = v.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function normalizeEventType(v: unknown): EventType {
  return v === "speed" ? "speed" : "rally";
}

function normalizeSpeedRunImportStatus(v: unknown): SpeedRunImportStatus {
  if (v === "live" || v === "completed" || v === "scheduled") return v;
  return "scheduled";
}

function normalizeManualStatus(v: unknown): EventStatus {
  if (v === "draft" || v === "upcoming" || v === "live" || v === "completed") {
    return v;
  }
  // Backward compatibility for older data.
  if (v === "final") return "completed";
  return "draft";
}

/** Draft stays manual; all other statuses auto-follow start/end dates. */
function deriveStatusFromDates(
  manual: EventStatus,
  dateStart: string,
  dateEnd: string,
): EventStatus {
  if (manual === "draft") return "draft";
  const today = new Date().toISOString().slice(0, 10);
  if (dateStart && today < dateStart) return "upcoming";
  if (dateEnd && today > dateEnd) return "completed";
  if (dateStart && today >= dateStart) return "live";
  return manual;
}

function normalizeStage(raw: unknown): Stage {
  const o =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const km = o.distanceKm;
  return {
    id: typeof o.id === "string" ? o.id : crypto.randomUUID(),
    name: typeof o.name === "string" ? o.name : "Stage",
    order: typeof o.order === "number" ? o.order : 0,
    leg: normalizeLeg(o.leg),
    distanceKm: typeof km === "number" ? km : null,
    firstCarStartTime: normalizeFirstCarStartTime(o.firstCarStartTime),
    progressStatus: normalizeProgressStatus(o.progressStatus),
  };
}

function normalizeEntry(raw: unknown): Entry {
  const o =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const sn = o.startNumber;
  const trialStartTime =
    typeof o.trialStartTime === "string" ? o.trialStartTime : "";
  const trialFinishTime =
    typeof o.trialFinishTime === "string" ? o.trialFinishTime : "";
  const run1StartTime = typeof o.run1StartTime === "string" ? o.run1StartTime : "";
  const run1FinishTime =
    typeof o.run1FinishTime === "string" ? o.run1FinishTime : "";
  const run2StartTime = typeof o.run2StartTime === "string" ? o.run2StartTime : "";
  const run2FinishTime =
    typeof o.run2FinishTime === "string" ? o.run2FinishTime : "";
  return {
    id: typeof o.id === "string" ? o.id : crypto.randomUUID(),
    startNumber: typeof sn === "number" ? sn : 0,
    entrance: typeof o.entrance === "string" ? o.entrance : "",
    start: o.start !== false,
    trialStartTime,
    trialFinishTime,
    run1StartTime,
    run1FinishTime,
    run2StartTime,
    run2FinishTime,
    driver: typeof o.driver === "string" ? o.driver : "",
    coDriver: typeof o.coDriver === "string" ? o.coDriver : "",
    car: typeof o.car === "string" ? o.car : "",
    class: typeof o.class === "string" ? o.class : "",
    driverCountryCode: normalizeCountryCode(o.driverCountryCode),
    coDriverCountryCode: normalizeCountryCode(o.coDriverCountryCode),
  };
}

function normalizeEvent(raw: unknown): RallyEvent {
  if (!raw || typeof raw !== "object") {
    return {
      id: crypto.randomUUID(),
      name: "Event",
      logoUrl: "",
      type: "rally",
      dateStart: "",
      dateEnd: "",
      location: "",
      status: "draft",
      speedRunImportStatus: {
        trial: "scheduled",
        run1: "scheduled",
        run2: "scheduled",
      },
      algeTriggerCountByKey: {},
      officialNoticeCustomCategories: [],
      officialNoticeDocuments: [],
      stages: [],
      entries: [],
    };
  }
  const o = raw as Record<string, unknown>;
  const dateStart = normalizeDateOnly(o.dateStart);
  const dateEnd = normalizeDateOnly(o.dateEnd);
  const manualStatus = normalizeManualStatus(o.status);
  const status = deriveStatusFromDates(manualStatus, dateStart, dateEnd);
  const stages = Array.isArray(o.stages)
    ? o.stages.map(normalizeStage)
    : [];
  const entries = Array.isArray(o.entries)
    ? o.entries.map(normalizeEntry)
    : [];
  return {
    id: typeof o.id === "string" ? o.id : crypto.randomUUID(),
    name: typeof o.name === "string" ? o.name : "Event",
    logoUrl: typeof o.logoUrl === "string" ? o.logoUrl.trim() : "",
    type: normalizeEventType(o.type),
    dateStart,
    dateEnd,
    location: typeof o.location === "string" ? o.location : "",
    status,
    speedRunImportStatus: {
      trial: normalizeSpeedRunImportStatus(
        (o.speedRunImportStatus as Record<string, unknown> | undefined)?.trial,
      ),
      run1: normalizeSpeedRunImportStatus(
        (o.speedRunImportStatus as Record<string, unknown> | undefined)?.run1,
      ),
      run2: normalizeSpeedRunImportStatus(
        (o.speedRunImportStatus as Record<string, unknown> | undefined)?.run2,
      ),
    },
    algeTriggerCountByKey:
      o.algeTriggerCountByKey &&
      typeof o.algeTriggerCountByKey === "object" &&
      !Array.isArray(o.algeTriggerCountByKey)
        ? Object.fromEntries(
            Object.entries(o.algeTriggerCountByKey as Record<string, unknown>).map(
              ([k, v]) => [k, typeof v === "number" && Number.isFinite(v) ? v : 0],
            ),
          )
        : {},
    officialNoticeCustomCategories: normalizeOfficialNoticeCustomCategories(
      o.officialNoticeCustomCategories,
    ),
    officialNoticeDocuments: normalizeOfficialNoticeDocuments(
      o.officialNoticeDocuments,
    ),
    stages,
    entries,
  };
}

function normalizeConfig(raw: unknown): RallySiteConfig {
  if (!raw || typeof raw !== "object") {
    return { ...defaultRallyConfig, updatedAt: new Date().toISOString() };
  }
  const o = raw as Partial<RallySiteConfig>;
  const site: SiteSettings = {
    ...defaultRallyConfig.site,
    ...(typeof o.site === "object" && o.site !== null ? o.site : {}),
  };
  const events = Array.isArray(o.events)
    ? o.events.map(normalizeEvent)
    : defaultRallyConfig.events;
  return {
    site,
    events,
    updatedAt:
      typeof o.updatedAt === "string" ? o.updatedAt : new Date().toISOString(),
  };
}

export async function loadRallyConfig(): Promise<RallySiteConfig> {
  if (DB_READS) {
    try {
      const fromDb = await loadConfigFromDb();
      if (fromDb) return normalizeConfig(fromDb);
    } catch {
      // Fallback to file store.
    }
  }
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    return normalizeConfig(JSON.parse(raw) as unknown);
  } catch {
    return { ...defaultRallyConfig };
  }
}

export async function saveRallyConfig(config: RallySiteConfig): Promise<void> {
  const next: RallySiteConfig = {
    ...config,
    updatedAt: new Date().toISOString(),
  };
  if (DB_WRITES) {
    await saveConfigToDb(next);
  }
  if (FILE_WRITES) {
    await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    await fs.writeFile(CONFIG_PATH, JSON.stringify(next, null, 2), "utf-8");
  }
}
