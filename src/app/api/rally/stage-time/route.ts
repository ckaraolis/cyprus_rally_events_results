import { NextResponse } from "next/server";
import { loadRallyConfig } from "@/lib/rally/config-file";
import {
  formatStageDurationMs,
  getRallyStageTimingValues,
  parsePenaltyDurationMs,
  resolveRallyStageCell,
  stageChipLabel,
  stageHeadingLabel,
} from "@/lib/rally/results-timing";
import type { RallyEvent, Stage } from "@/lib/rally/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
} as const;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE, ...CORS },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE, ...CORS } });
}

function parseCarNumber(raw: string | null): number | null {
  if (raw == null || !String(raw).trim()) return null;
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function pickEvent(config: Awaited<ReturnType<typeof loadRallyConfig>>, eventId: string | null) {
  if (eventId) {
    return config.events.find((e) => e.id === eventId) ?? null;
  }
  const featured = config.site.featuredEventId
    ? config.events.find((e) => e.id === config.site.featuredEventId)
    : null;
  if (featured) return featured;
  return (
    config.events.find((e) => e.status === "live" && e.type === "rally") ??
    config.events.find((e) => e.status === "live") ??
    null
  );
}

function findStageForGpsSection(
  event: RallyEvent,
  gpsSectionId: string,
): Stage | null {
  const needle = gpsSectionId.trim();
  if (!needle) return null;
  const cfg = event.rallyStageAlgeConfig || {};
  for (const [stageId, row] of Object.entries(cfg)) {
    if ((row?.gpsSectionId || "").trim() === needle) {
      return event.stages.find((s) => s.id === stageId) ?? null;
    }
  }
  // Allow passing Results stage id directly as a fallback.
  return event.stages.find((s) => s.id === needle) ?? null;
}

/**
 * Public: official stage time for one car + GPS stage section.
 * Used by Rally GPS driver (poll until finish is in admin/ALGE).
 *
 * GET ?carNumber=12&gpsSectionId=<gps-kmz-stage-uuid>[&eventId=...]
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const carNumber = parseCarNumber(url.searchParams.get("carNumber"));
  const gpsSectionId = (url.searchParams.get("gpsSectionId") || "").trim();
  const eventId = (url.searchParams.get("eventId") || "").trim() || null;

  if (carNumber == null) {
    return json({ ok: false, error: "carNumber required" }, 400);
  }
  if (!gpsSectionId) {
    return json({ ok: false, error: "gpsSectionId required" }, 400);
  }

  const config = await loadRallyConfig();
  const event = pickEvent(config, eventId);
  if (!event) {
    return json({ ok: false, error: "No live/featured event found" }, 404);
  }
  if (event.type !== "rally") {
    return json({ ok: false, error: "Stage times are only for rally events" }, 400);
  }

  const stage = findStageForGpsSection(event, gpsSectionId);
  if (!stage) {
    return json(
      {
        ok: false,
        error:
          "No Results stage linked to this GPS section. Set gpsSectionId on the stage in admin.",
        eventId: event.id,
        gpsSectionId,
      },
      404,
    );
  }

  const entry = event.entries.find(
    (e) => Math.floor(Number(e.startNumber)) === carNumber,
  );
  if (!entry) {
    return json(
      {
        ok: false,
        error: "Car not found in this event",
        eventId: event.id,
        carNumber,
      },
      404,
    );
  }

  const values = getRallyStageTimingValues(entry, stage.id);
  const cell = resolveRallyStageCell(entry, stage);
  const jumpMs = parsePenaltyDurationMs(values.penaltyValue) ?? 0;
  const totalMs =
    cell.durationMs != null ? cell.durationMs + jumpMs : null;
  const ready =
    cell.outcome != null ||
    (values.startValue.trim() !== "" &&
      values.finishValue.trim() !== "" &&
      totalMs != null);

  const stageMeta = {
    id: stage.id,
    name: stage.name,
    chipLabel: stageChipLabel(stage, event.stages),
    heading: stageHeadingLabel(stage, event.stages),
    kind: stage.kind,
  };

  if (!ready) {
    return json({
      ok: true,
      pending: true,
      eventId: event.id,
      carNumber,
      gpsSectionId,
      stage: stageMeta,
      startTime: values.startValue || null,
      finishTime: values.finishValue || null,
      formattedTime: null,
      outcome: cell.outcome,
    });
  }

  const formattedTime =
    cell.outcome ?? formatStageDurationMs(totalMs, stage);

  return json({
    ok: true,
    pending: false,
    eventId: event.id,
    carNumber,
    gpsSectionId,
    stage: stageMeta,
    startTime: values.startValue || null,
    finishTime: values.finishValue || null,
    penaltyMs: jumpMs,
    durationMs: totalMs,
    formattedTime,
    outcome: cell.outcome,
  });
}
