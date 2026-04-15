import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
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
}): Stage {
  return {
    id: row.id,
    name: row.name,
    order: row.order,
    leg: row.leg,
    distanceKm: row.distanceKm,
    firstCarStartTime: row.firstCarStartTime,
    progressStatus:
      row.progressStatus === "live" || row.progressStatus === "completed"
        ? row.progressStatus
        : "pending",
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
        .filter(([k]) => k !== "__officialNoticeData")
        .map(([k, v]) => [k, typeof v === "number" ? v : 0]),
    ),
    officialNoticeCustomCategories: customCategories,
    officialNoticeDocuments: officialDocs,
    stages: row.stages.map(toStage),
    entries: row.entries.map(toEntry),
  };
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
  return {
    site: site
      ? toSite(site)
      : {
          resultsPageTitle: "Cyprus Rally Championships",
          resultsPageSubtitle: "Cyprus Rally Events — live timing & results",
          resultsStatusLabel: "Setup",
          featuredEventId: null,
          publicFooterNote: "",
        },
    events: events.map(toEvent),
    updatedAt: new Date().toISOString(),
  };
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
            __officialNoticeData: {
              customCategories: e.officialNoticeCustomCategories,
              documents: e.officialNoticeDocuments,
            },
          },
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
            __officialNoticeData: {
              customCategories: e.officialNoticeCustomCategories,
              documents: e.officialNoticeDocuments,
            },
          },
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
  });
}
