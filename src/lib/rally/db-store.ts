import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { normalizeLegStartingOrders } from "./leg-starting-order";
import { normalizeStageKind } from "./stage-kind";
import type { Entry, RallyEvent, RallySiteConfig, SiteSettings, Stage } from "./types";

function toSite(row: {
  resultsPageTitle: string;
  resultsPageSubtitle: string;
  resultsStatusLabel: string;
  featuredEventId: string | null;
  publicFooterNote: string;
}): SiteSettings {
  return {
    resultsPageTitle: row.resultsPageTitle,
    resultsPageSubtitle: row.resultsPageSubtitle,
    resultsStatusLabel: row.resultsStatusLabel,
    featuredEventId: row.featuredEventId,
    publicFooterNote: row.publicFooterNote,
  };
}

function toStage(row: {
  id: string;
  name: string;
  order: number;
  leg: number;
  distanceKm: number | null;
  firstCarStartTime: string | null;
  progressStatus: string;
}, kindRaw?: unknown): Stage {
  return {
    id: row.id,
    name: row.name,
    order: row.order,
    leg: row.leg,
    kind: normalizeStageKind(kindRaw),
    distanceKm: row.distanceKm,
    firstCarStartTime: row.firstCarStartTime,
    progressStatus: (() => {
      const p = String(row.progressStatus ?? "")
        .trim()
        .toLowerCase();
      if (p === "live" || p === "completed") return p;
      return "pending";
    })(),
  };
}

function toEntry(row: {
  id: string;
  startNumber: number;
  entrance: string;
  start: boolean;
  trialStartTime: string;
  trialFinishTime: string;
  run1StartTime: string;
  run1FinishTime: string;
  run2StartTime: string;
  run2FinishTime: string;
  driver: string;
  coDriver: string;
  car: string;
  class: string;
  driverCountryCode: string;
  coDriverCountryCode: string;
}): Entry {
  return { ...row };
}

function toEvent(row: {
  id: string;
  name: string;
  logoUrl: string;
  type: string;
  dateStart: string;
  dateEnd: string;
  location: string;
  status: string;
  speedRunImportStatusTrial: string;
  speedRunImportStatusRun1: string;
  speedRunImportStatusRun2: string;
  algeTriggerCountByKey: Prisma.JsonValue;
  stages: Array<Parameters<typeof toStage>[0]>;
  entries: Array<Parameters<typeof toEntry>[0]>;
}): RallyEvent {
  const algeMap =
    row.algeTriggerCountByKey &&
    typeof row.algeTriggerCountByKey === "object" &&
    !Array.isArray(row.algeTriggerCountByKey)
      ? (row.algeTriggerCountByKey as Record<string, unknown>)
      : {};
  const noticeDataRaw =
    algeMap.__officialNoticeData &&
    typeof algeMap.__officialNoticeData === "object" &&
    !Array.isArray(algeMap.__officialNoticeData)
      ? (algeMap.__officialNoticeData as Record<string, unknown>)
      : {};
  const rallyStageAlgeRaw =
    algeMap.__rallyStageAlgeConfig &&
    typeof algeMap.__rallyStageAlgeConfig === "object" &&
    !Array.isArray(algeMap.__rallyStageAlgeConfig)
      ? (algeMap.__rallyStageAlgeConfig as Record<string, unknown>)
      : {};
  const customCategories = Array.isArray(noticeDataRaw.customCategories)
    ? noticeDataRaw.customCategories
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim())
        .filter(Boolean)
    : [];

  const officialDocs = Array.isArray(noticeDataRaw.documents)
    ? noticeDataRaw.documents
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return null;
          const o = item as Record<string, unknown>;
          const id = typeof o.id === "string" ? o.id.trim() : "";
          const title = typeof o.title === "string" ? o.title.trim() : "";
          const category = typeof o.category === "string" ? o.category.trim() : "";
          const url = typeof o.url === "string" ? o.url.trim() : "";
          const fileName = typeof o.fileName === "string" ? o.fileName.trim() : "";
          const uploadedAt = typeof o.uploadedAt === "string" ? o.uploadedAt.trim() : "";
          if (!id || !title || !url) return null;
          return {
            id,
            title,
            category: category || "Other",
            url,
            fileName: fileName || "document",
            uploadedAt: uploadedAt || new Date().toISOString(),
          };
        })
        .filter((x): x is RallyEvent["officialNoticeDocuments"][number] => Boolean(x))
    : [];
  const rallyStageAlgeConfig: RallyEvent["rallyStageAlgeConfig"] = Object.fromEntries(
    Object.entries(rallyStageAlgeRaw)
      .filter(([, v]) => v && typeof v === "object" && !Array.isArray(v))
      .map(([stageId, v]) => {
        const cfg = v as Record<string, unknown>;
        return [
          stageId,
          {
            startDeviceId:
              typeof cfg.startDeviceId === "string" ? cfg.startDeviceId.trim() : "",
            startChannelId:
              typeof cfg.startChannelId === "string" ? cfg.startChannelId.trim() : "0",
            finishDeviceId:
              typeof cfg.finishDeviceId === "string" ? cfg.finishDeviceId.trim() : "",
            finishChannelId:
              typeof cfg.finishChannelId === "string" ? cfg.finishChannelId.trim() : "1",
          },
        ];
      }),
  );
  const legStartingOrdersRaw =
    algeMap.__legStartingOrders &&
    typeof algeMap.__legStartingOrders === "object" &&
    !Array.isArray(algeMap.__legStartingOrders)
      ? algeMap.__legStartingOrders
      : {};
  const stageKindsRaw =
    algeMap.__stageKinds &&
    typeof algeMap.__stageKinds === "object" &&
    !Array.isArray(algeMap.__stageKinds)
      ? (algeMap.__stageKinds as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    name: row.name,
    logoUrl: row.logoUrl,
    type: row.type === "speed" ? "speed" : "rally",
    dateStart: row.dateStart,
    dateEnd: row.dateEnd,
    location: row.location,
    status:
      row.status === "upcoming" || row.status === "live" || row.status === "completed"
        ? row.status
        : "draft",
    speedRunImportStatus: {
      trial: row.speedRunImportStatusTrial === "live" || row.speedRunImportStatusTrial === "completed"
        ? row.speedRunImportStatusTrial
        : "scheduled",
      run1: row.speedRunImportStatusRun1 === "live" || row.speedRunImportStatusRun1 === "completed"
        ? row.speedRunImportStatusRun1
        : "scheduled",
      run2: row.speedRunImportStatusRun2 === "live" || row.speedRunImportStatusRun2 === "completed"
        ? row.speedRunImportStatusRun2
        : "scheduled",
    },
    algeTriggerCountByKey: Object.fromEntries(
      Object.entries(algeMap)
        .filter(
          ([k]) =>
            k !== "__officialNoticeData" &&
            k !== "__rallyStageAlgeConfig" &&
            k !== "__legStartingOrders" &&
            k !== "__stageKinds" &&
            k !== "__configUpdatedAt",
        )
        .map(([k, v]) => [k, typeof v === "number" ? v : 0]),
    ),
    rallyStageAlgeConfig,
    officialNoticeCustomCategories: customCategories,
    officialNoticeDocuments: officialDocs,
    legStartingOrders: normalizeLegStartingOrders(legStartingOrdersRaw),
    stages: row.stages.map((s) => toStage(s, stageKindsRaw[s.id])),
    entries: row.entries.map(toEntry),
  };
}

function eventLiveStampMs(row: {
  updatedAt: Date;
  algeTriggerCountByKey: unknown;
}): number {
  const times = [row.updatedAt.getTime()];
  const alge =
    row.algeTriggerCountByKey &&
    typeof row.algeTriggerCountByKey === "object" &&
    !Array.isArray(row.algeTriggerCountByKey)
      ? (row.algeTriggerCountByKey as Record<string, unknown>)
      : {};
  const stamped = alge.__configUpdatedAt;
  if (typeof stamped === "string") {
    const ms = Date.parse(stamped);
    if (!Number.isNaN(ms)) times.push(ms);
  }
  return Math.max(...times);
}

export async function loadConfigFromDb(): Promise<RallySiteConfig | null> {
  const site = await prisma.siteSettings.findUnique({ where: { id: 1 } });
  const events = await prisma.event.findMany({
    include: {
      stages: { orderBy: { order: "asc" } },
      entries: { orderBy: { startNumber: "asc" } },
    },
    orderBy: { dateStart: "asc" },
  });
  if (!site && events.length === 0) return null;
  const times: number[] = [];
  if (site?.updatedAt) times.push(site.updatedAt.getTime());
  for (const ev of events) {
    times.push(eventLiveStampMs(ev));
  }
  const newestMs = times.length > 0 ? Math.max(...times) : Date.now();
  return {
    site: site
      ? toSite(site)
      : {
          resultsPageTitle: "Speed & Rally - Live Results",
          resultsPageSubtitle: "Only Speed & Rally Events Results",
          resultsStatusLabel: "Setup",
          featuredEventId: null,
          publicFooterNote: "",
        },
    events: events.map(toEvent),
    updatedAt: new Date(newestMs).toISOString(),
  };
}

/**
 * One-event snapshot for public live polling — avoids loading every event each tick.
 */
export async function loadEventLiveFromDb(
  eventId: string,
): Promise<{ event: RallyEvent; updatedAt: string } | null> {
  const row = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      stages: { orderBy: { order: "asc" } },
      entries: { orderBy: { startNumber: "asc" } },
    },
  });
  if (!row) return null;
  return {
    event: toEvent(row),
    updatedAt: new Date(eventLiveStampMs(row)).toISOString(),
  };
}

/** Large events (many entries) can exceed Prisma’s default 5s interactive transaction limit. */
const SAVE_CONFIG_TX_OPTIONS = {
  maxWait: 10_000,
  timeout: 120_000,
} as const;

/**
 * Fast path for Timing Control: replace one event's entries and bump live-poll stamp.
 * Avoids rewriting every event/stage on each keystroke save.
 */
export async function patchEventEntriesInDb(
  eventId: string,
  entries: Entry[],
  configUpdatedAt: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.event.findUnique({
      where: { id: eventId },
      select: { algeTriggerCountByKey: true },
    });
    if (!existing) {
      throw new Error(`Event not found: ${eventId}`);
    }
    const algeMap =
      existing.algeTriggerCountByKey &&
      typeof existing.algeTriggerCountByKey === "object" &&
      !Array.isArray(existing.algeTriggerCountByKey)
        ? { ...(existing.algeTriggerCountByKey as Record<string, unknown>) }
        : {};
    algeMap.__configUpdatedAt = configUpdatedAt;

    await tx.event.update({
      where: { id: eventId },
      data: {
        algeTriggerCountByKey: algeMap as Prisma.InputJsonValue,
      },
    });

    await tx.entry.deleteMany({ where: { eventId } });
    if (entries.length > 0) {
      await tx.entry.createMany({
        data: entries.map((en) => ({
          id: en.id,
          eventId,
          startNumber: en.startNumber,
          entrance: en.entrance,
          start: en.start,
          trialStartTime: en.trialStartTime,
          trialFinishTime: en.trialFinishTime,
          run1StartTime: en.run1StartTime,
          run1FinishTime: en.run1FinishTime,
          run2StartTime: en.run2StartTime,
          run2FinishTime: en.run2FinishTime,
          driver: en.driver,
          coDriver: en.coDriver,
          car: en.car,
          class: en.class,
          driverCountryCode: en.driverCountryCode,
          coDriverCountryCode: en.coDriverCountryCode,
        })),
      });
    }
  }, SAVE_CONFIG_TX_OPTIONS);
}

export async function saveConfigToDb(config: RallySiteConfig): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.siteSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...config.site },
      update: { ...config.site },
    });

    const keepIds = config.events.map((e) => e.id);
    await tx.event.deleteMany({
      where: keepIds.length > 0 ? { id: { notIn: keepIds } } : undefined,
    });

    for (const e of config.events) {
      await tx.event.upsert({
        where: { id: e.id },
        create: {
          id: e.id,
          name: e.name,
          logoUrl: e.logoUrl,
          type: e.type,
          dateStart: e.dateStart,
          dateEnd: e.dateEnd,
          location: e.location,
          status: e.status,
          speedRunImportStatusTrial: e.speedRunImportStatus.trial,
          speedRunImportStatusRun1: e.speedRunImportStatus.run1,
          speedRunImportStatusRun2: e.speedRunImportStatus.run2,
          algeTriggerCountByKey: {
            ...e.algeTriggerCountByKey,
            __rallyStageAlgeConfig: e.rallyStageAlgeConfig,
            __officialNoticeData: {
              customCategories: e.officialNoticeCustomCategories,
              documents: e.officialNoticeDocuments,
            },
            __legStartingOrders: e.legStartingOrders ?? {},
            __stageKinds: Object.fromEntries(
              e.stages.map((s) => [s.id, s.kind ?? "ss"]),
            ),
            /** Bumps on every save so public poll `updatedAt` always moves with timing edits. */
            __configUpdatedAt: config.updatedAt,
          } as unknown as Prisma.InputJsonValue,
        },
        update: {
          name: e.name,
          logoUrl: e.logoUrl,
          type: e.type,
          dateStart: e.dateStart,
          dateEnd: e.dateEnd,
          location: e.location,
          status: e.status,
          speedRunImportStatusTrial: e.speedRunImportStatus.trial,
          speedRunImportStatusRun1: e.speedRunImportStatus.run1,
          speedRunImportStatusRun2: e.speedRunImportStatus.run2,
          algeTriggerCountByKey: {
            ...e.algeTriggerCountByKey,
            __rallyStageAlgeConfig: e.rallyStageAlgeConfig,
            __officialNoticeData: {
              customCategories: e.officialNoticeCustomCategories,
              documents: e.officialNoticeDocuments,
            },
            __legStartingOrders: e.legStartingOrders ?? {},
            __stageKinds: Object.fromEntries(
              e.stages.map((s) => [s.id, s.kind ?? "ss"]),
            ),
            __configUpdatedAt: config.updatedAt,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      await tx.stage.deleteMany({ where: { eventId: e.id } });
      if (e.stages.length > 0) {
        await tx.stage.createMany({
          data: e.stages.map((s) => ({
            id: s.id,
            eventId: e.id,
            name: s.name,
            order: s.order,
            leg: s.leg,
            distanceKm: s.distanceKm,
            firstCarStartTime: s.firstCarStartTime,
            progressStatus: s.progressStatus,
          })),
        });
      }

      await tx.entry.deleteMany({ where: { eventId: e.id } });
      if (e.entries.length > 0) {
        await tx.entry.createMany({
          data: e.entries.map((en) => ({
            id: en.id,
            eventId: e.id,
            startNumber: en.startNumber,
            entrance: en.entrance,
            start: en.start,
            trialStartTime: en.trialStartTime,
            trialFinishTime: en.trialFinishTime,
            run1StartTime: en.run1StartTime,
            run1FinishTime: en.run1FinishTime,
            run2StartTime: en.run2StartTime,
            run2FinishTime: en.run2FinishTime,
            driver: en.driver,
            coDriver: en.coDriver,
            car: en.car,
            class: en.class,
            driverCountryCode: en.driverCountryCode,
            coDriverCountryCode: en.coDriverCountryCode,
          })),
        });
      }
    }
  }, SAVE_CONFIG_TX_OPTIONS);
}
