"use server";

import { revalidatePath } from "next/cache";
import { loadRallyConfig, saveRallyConfig } from "@/lib/rally/config-file";
import { canImportAlgeTimesForRun } from "@/lib/alge/import-gate";
import { mergeImportedSpeedTimes, type SpeedImportRunId } from "@/lib/alge/speed-import";
import { algeAuthorizationHeader, getAlgeAccessToken } from "@/lib/alge/token";
import { joinApiUrl } from "@/lib/alge/proxy-path";
import type {
  Entry,
  EventType,
  EventStatus,
  RallyEvent,
  SiteSettings,
  SpeedRunImportStatus,
  Stage,
} from "@/lib/rally/types";

function findEventIndex(config: Awaited<ReturnType<typeof loadRallyConfig>>, id: string) {
  return config.events.findIndex((e) => e.id === id);
}

export async function updateSiteSettings(site: SiteSettings) {
  const config = await loadRallyConfig();
  config.site = site;
  if (
    site.featuredEventId &&
    !config.events.some((e) => e.id === site.featuredEventId)
  ) {
    config.site.featuredEventId = null;
  }
  await saveRallyConfig(config);
  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/results-page");
}

export async function createEvent(input: {
  name: string;
  type: EventType;
  dateStart: string;
  dateEnd: string;
  location: string;
  status: EventStatus;
  logoUrl?: string;
}) {
  const config = await loadRallyConfig();
  const id = crypto.randomUUID();
  const defaultStages: Stage[] =
    input.type === "speed"
      ? [
          {
            id: crypto.randomUUID(),
            name: "Trial",
            order: 1,
            leg: 1,
            distanceKm: null,
            firstCarStartTime: null,
            progressStatus: "pending",
          },
          {
            id: crypto.randomUUID(),
            name: "1st Run",
            order: 2,
            leg: 1,
            distanceKm: null,
            firstCarStartTime: null,
            progressStatus: "pending",
          },
          {
            id: crypto.randomUUID(),
            name: "2nd Run",
            order: 3,
            leg: 1,
            distanceKm: null,
            firstCarStartTime: null,
            progressStatus: "pending",
          },
        ]
      : [];
  const event: RallyEvent = {
    id,
    name: input.name.trim() || "Untitled rally",
    logoUrl: input.logoUrl?.trim() ?? "",
    type: input.type,
    dateStart: input.dateStart,
    dateEnd: input.dateEnd,
    location: input.location.trim(),
    status: input.status,
    speedRunImportStatus: {
      trial: "scheduled",
      run1: "scheduled",
      run2: "scheduled",
    },
    algeTriggerCountByKey: {},
    officialNoticeCustomCategories: [],
    officialNoticeDocuments: [],
    stages: defaultStages,
    entries: [],
  };
  config.events.push(event);
  await saveRallyConfig(config);
  revalidatePath("/admin/events");
  revalidatePath("/");
  return id;
}

export async function updateEventMeta(
  eventId: string,
  input: {
    name: string;
    type: EventType;
    dateStart: string;
    dateEnd: string;
    location: string;
    status: EventStatus;
    logoUrl: string;
    speedRunImportStatus: {
      trial: SpeedRunImportStatus;
      run1: SpeedRunImportStatus;
      run2: SpeedRunImportStatus;
    };
    algeTriggerCountByKey: Record<string, number>;
    officialNoticeCustomCategories: string[];
    officialNoticeDocuments: RallyEvent["officialNoticeDocuments"];
  },
) {
  const config = await loadRallyConfig();
  const i = findEventIndex(config, eventId);
  if (i === -1) return { ok: false as const, error: "Event not found" };
  const e = config.events[i];
  e.name = input.name.trim() || e.name;
  e.logoUrl = input.logoUrl.trim();
  e.type = input.type;
  e.dateStart = input.dateStart;
  e.dateEnd = input.dateEnd;
  e.location = input.location.trim();
  e.status = input.status;
  e.speedRunImportStatus = input.speedRunImportStatus;
  e.algeTriggerCountByKey = input.algeTriggerCountByKey;
  e.officialNoticeCustomCategories = input.officialNoticeCustomCategories;
  e.officialNoticeDocuments = input.officialNoticeDocuments;
  await saveRallyConfig(config);
  revalidatePath("/admin/events");
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath("/");
  return { ok: true as const };
}

function parseAlgeCount(payload: unknown): number | null {
  const first = (payload as { data?: unknown[] } | null)?.data?.[0];
  const value = (first as { value?: unknown } | undefined)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseAlgeLatestTrigger(payload: unknown): {
  startNumber: number;
  timestamp100ns: number;
  timeOffsetMin: number;
} | null {
  const first = (payload as { data?: unknown[] } | null)?.data?.[0] as
    | Record<string, unknown>
    | undefined;
  if (!first) return null;
  const startNumber = (
    first.startNumber as { startNumber?: unknown } | undefined
  )?.startNumber;
  const timestamp = first.timestamp;
  const timeOffset = first.timeOffset;
  if (
    typeof startNumber !== "number" ||
    !Number.isFinite(startNumber) ||
    typeof timestamp !== "number" ||
    !Number.isFinite(timestamp)
  ) {
    return null;
  }
  return {
    startNumber: Math.floor(startNumber),
    timestamp100ns: timestamp,
    timeOffsetMin:
      typeof timeOffset === "number" && Number.isFinite(timeOffset) ? timeOffset : 0,
  };
}

function format100nsClockWithOffset(timestamp100ns: number, timeOffsetMin: number): string {
  const adjusted100ns = timestamp100ns + timeOffsetMin * 60 * 10_000_000;
  const ms = Math.floor(adjusted100ns / 10_000);
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  const cs = String(Math.floor((d.getUTCMilliseconds() % 1000) / 10)).padStart(2, "0");
  return `${hh}:${mm}:${ss}.${cs}`;
}

export async function pollAlgeTriggerForSpeedRun(input: {
  eventId: string;
  runId: SpeedImportRunId;
  triggerKind: "start" | "finish";
  deviceId: string;
  channelId: string;
}) {
  const config = await loadRallyConfig();
  const i = findEventIndex(config, input.eventId);
  if (i === -1) return { ok: false as const, error: "Event not found" };
  const event = config.events[i];
  if (event.type !== "speed") return { ok: false as const, error: "Only speed events are supported" };
  if (!canImportAlgeTimesForRun(event, input.runId)) {
    return { ok: false as const, error: "Run is not live. Set it to Live first." };
  }
  const base = process.env.ALGE_API_BASE?.trim();
  if (!base) return { ok: false as const, error: "ALGE_API_BASE is not configured" };
  const deviceId = input.deviceId.trim();
  const channelId = input.channelId.trim();
  if (!deviceId || !channelId) {
    return { ok: false as const, error: "Device ID and Channel ID are required" };
  }

  let token: string;
  try {
    token = await getAlgeAccessToken();
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "ALGE auth failed" };
  }
  const [authName, authValue] = algeAuthorizationHeader(token);
  const headers = { Accept: "application/json", [authName]: authValue };
  const countPath = ["mt1", "api", "devices", deviceId, "channel", channelId, "trigger", "count"];
  const countUrl = joinApiUrl(base, countPath, new URLSearchParams());
  const countRes = await fetch(countUrl, { method: "GET", headers, cache: "no-store" });
  const countText = await countRes.text();
  if (!countRes.ok) {
    return { ok: false as const, error: `Count request failed (${countRes.status}): ${countText.slice(0, 200)}` };
  }
  const countValue = parseAlgeCount(JSON.parse(countText) as unknown);
  if (countValue == null) return { ok: false as const, error: "Invalid trigger count payload" };

  const key = `${input.runId}:${input.triggerKind}:${deviceId}:${channelId}`;
  const prevCount = event.algeTriggerCountByKey?.[key] ?? 0;
  if (countValue <= prevCount) {
    return { ok: true as const, imported: false, reason: "No new trigger", count: countValue };
  }

  const triggerPath = ["mt1", "api", "devices", deviceId, "channel", channelId, "trigger"];
  const triggerUrl = joinApiUrl(base, triggerPath, new URLSearchParams("limit=1"));
  const triggerRes = await fetch(triggerUrl, { method: "GET", headers, cache: "no-store" });
  const triggerText = await triggerRes.text();
  if (!triggerRes.ok) {
    return { ok: false as const, error: `Trigger request failed (${triggerRes.status}): ${triggerText.slice(0, 200)}` };
  }
  const trigger = parseAlgeLatestTrigger(JSON.parse(triggerText) as unknown);
  if (!trigger) return { ok: false as const, error: "Invalid trigger payload" };

  const clockValue = format100nsClockWithOffset(trigger.timestamp100ns, trigger.timeOffsetMin);
  let updated = false;
  const nextEntries = event.entries.map((e) => {
    if (e.startNumber !== trigger.startNumber) return e;
    updated = true;
    if (input.runId === "trial") {
      return input.triggerKind === "start"
        ? { ...e, trialStartTime: clockValue }
        : { ...e, trialFinishTime: clockValue };
    }
    if (input.runId === "run1") {
      return input.triggerKind === "start"
        ? { ...e, run1StartTime: clockValue }
        : { ...e, run1FinishTime: clockValue };
    }
    return input.triggerKind === "start"
      ? { ...e, run2StartTime: clockValue }
      : { ...e, run2FinishTime: clockValue };
  });

  event.algeTriggerCountByKey = {
    ...(event.algeTriggerCountByKey ?? {}),
    [key]: countValue,
  };
  event.entries = nextEntries;
  await saveRallyConfig(config);
  revalidatePath(`/admin/events/${input.eventId}`);
  revalidatePath(`/rally/${input.eventId}`);
  revalidatePath("/");
  return {
    ok: true as const,
    imported: updated,
    reason: updated ? undefined : `No entry found for start number ${trigger.startNumber}`,
    count: countValue,
    startNumber: trigger.startNumber,
    time: clockValue,
  };
}

export async function testAlgeAuthNow() {
  const base = process.env.ALGE_API_BASE?.trim();
  if (!base) return { ok: false as const, error: "ALGE_API_BASE is not configured" };

  let token: string;
  try {
    token = await getAlgeAccessToken();
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "ALGE auth failed",
    };
  }

  try {
    const target = joinApiUrl(
      base,
      ["mt1", "api", "user", "current"],
      new URLSearchParams(),
    );
    const [authName, authValue] = algeAuthorizationHeader(token);
    const res = await fetch(target, {
      method: "GET",
      headers: { Accept: "application/json", [authName]: authValue },
      cache: "no-store",
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      // keep null
    }
    const status =
      json && typeof json === "object" && "status" in json
        ? Number((json as Record<string, unknown>).status)
        : null;
    const message =
      json && typeof json === "object" && "message" in json
        ? String((json as Record<string, unknown>).message ?? "")
        : "";

    if (res.status === 403 || status === -1007) {
      return {
        ok: true as const,
        level: "warn" as const,
        summary: "Not logged in / token expired",
        detail: message || "Please refresh token or check credentials.",
      };
    }
    if (status === -9000) {
      return {
        ok: true as const,
        level: "warn" as const,
        summary: "API quota limit reached",
        detail: "Wait 10-90 seconds before retrying.",
      };
    }
    if (status === 0 && res.ok) {
      return {
        ok: true as const,
        level: "success" as const,
        summary: "ALGE auth is valid",
        detail: message || "Token accepted by /mt1/api/user/current.",
      };
    }
    return {
      ok: true as const,
      level: "warn" as const,
      summary: `Unexpected auth response (${res.status})`,
      detail: message || text.slice(0, 200),
    };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "Failed to call ALGE user/current",
    };
  }
}

export async function importSpeedTimesFromAlge(input: {
  eventId: string;
  runId: SpeedImportRunId;
  apiPath: string;
}) {
  const config = await loadRallyConfig();
  const i = findEventIndex(config, input.eventId);
  if (i === -1) return { ok: false as const, error: "Event not found" };
  const event = config.events[i];
  if (event.type !== "speed") {
    return { ok: false as const, error: "ALGE import is only for speed events" };
  }
  if (!canImportAlgeTimesForRun(event, input.runId)) {
    return {
      ok: false as const,
      error: `Run ${input.runId} is not live. Set status to Live first.`,
    };
  }

  const base = process.env.ALGE_API_BASE?.trim();
  if (!base) return { ok: false as const, error: "ALGE_API_BASE is not configured" };
  const path = input.apiPath.trim().replace(/^\/+/, "");
  if (!path) return { ok: false as const, error: "ALGE API path is required" };

  let token: string;
  try {
    token = await getAlgeAccessToken();
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "ALGE auth failed",
    };
  }

  let payload: unknown;
  try {
    const target = joinApiUrl(base, path.split("/").filter(Boolean), new URLSearchParams());
    const [authName, authValue] = algeAuthorizationHeader(token);
    const res = await fetch(target, {
      method: "GET",
      headers: { Accept: "application/json", [authName]: authValue },
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false as const,
        error: `ALGE request failed (${res.status}): ${text.slice(0, 200)}`,
      };
    }
    payload = JSON.parse(text) as unknown;
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "Failed to fetch ALGE data",
    };
  }

  const { nextEntries, updated, unmatchedRows } = mergeImportedSpeedTimes(
    event.entries,
    input.runId,
    payload,
  );
  config.events[i].entries = nextEntries;
  await saveRallyConfig(config);
  revalidatePath(`/admin/events/${input.eventId}`);
  revalidatePath(`/rally/${input.eventId}`);
  revalidatePath("/");
  return { ok: true as const, updated, unmatchedRows };
}

export async function deleteEvent(eventId: string) {
  const config = await loadRallyConfig();
  config.events = config.events.filter((e) => e.id !== eventId);
  if (config.site.featuredEventId === eventId) {
    config.site.featuredEventId = null;
  }
  await saveRallyConfig(config);
  revalidatePath("/admin/events");
  revalidatePath("/admin/results-page");
  revalidatePath("/");
}

export async function replaceStages(eventId: string, stages: Stage[]) {
  const config = await loadRallyConfig();
  const i = findEventIndex(config, eventId);
  if (i === -1) return { ok: false as const, error: "Event not found" };
  config.events[i].stages = stages;
  await saveRallyConfig(config);
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath("/");
  return { ok: true as const };
}

export async function replaceEntries(eventId: string, entries: Entry[]) {
  const config = await loadRallyConfig();
  const i = findEventIndex(config, eventId);
  if (i === -1) return { ok: false as const, error: "Event not found" };
  config.events[i].entries = entries;
  await saveRallyConfig(config);
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath(`/rally/${eventId}`);
  revalidatePath("/");
  return { ok: true as const };
}
