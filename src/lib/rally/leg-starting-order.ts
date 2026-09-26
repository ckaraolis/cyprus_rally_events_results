import type { LegStartingOrder, RallyEvent } from "./types";

function normalizeClockHm(v: unknown): string {
  if (typeof v !== "string") return "";
  const t = v.trim();
  const m = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(t);
  if (!m) return "";
  const hh = Math.min(23, Math.max(0, Number.parseInt(m[1]!, 10)));
  const mm = Math.min(59, Math.max(0, Number.parseInt(m[2]!, 10)));
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function normalizeLegStartingOrders(
  raw: unknown,
): RallyEvent["legStartingOrders"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: RallyEvent["legStartingOrders"] = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const o = value as Record<string, unknown>;
    const legFromKey = Number.parseInt(key, 10);
    const leg =
      typeof o.leg === "number" && Number.isFinite(o.leg)
        ? Math.max(1, Math.floor(o.leg))
        : Number.isFinite(legFromKey) && legFromKey >= 1
          ? Math.floor(legFromKey)
          : 1;
    const entryIds = Array.isArray(o.entryIds)
      ? o.entryIds
          .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
          .map((id) => id.trim())
      : [];
    const intervalRaw =
      typeof o.intervalMinutes === "number"
        ? o.intervalMinutes
        : typeof o.intervalMinutes === "string"
          ? Number.parseFloat(o.intervalMinutes)
          : 1;
    const intervalMinutes =
      Number.isFinite(intervalRaw) && intervalRaw >= 0
        ? Math.floor(intervalRaw)
        : 1;
    const order: LegStartingOrder = {
      leg,
      entryIds,
      firstCarStartTime: normalizeClockHm(o.firstCarStartTime) || "09:00",
      intervalMinutes,
    };
    out[String(leg)] = order;
  }
  return out;
}

/** Scheduled start clock (HH:mm) for order index given first-car time + interval. */
export function computeStartingOrderTime(
  firstCarStartTime: string,
  intervalMinutes: number,
  index: number,
): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(firstCarStartTime.trim());
  if (!m) return "—";
  const baseMin =
    Number.parseInt(m[1]!, 10) * 60 + Number.parseInt(m[2]!, 10);
  if (!Number.isFinite(baseMin)) return "—";
  const interval = Math.max(0, Math.floor(intervalMinutes));
  const total = ((baseMin + index * interval) % (24 * 60) + 24 * 60) % (24 * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
