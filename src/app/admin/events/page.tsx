import Link from "next/link";
import { loadRallyConfig } from "@/lib/rally/config-file";
import { CreateEventForm } from "../_components/create-event-form";

export default async function AdminEventsPage() {
  const config = await loadRallyConfig();
  const rallyEvents = config.events.filter((e) => e.type !== "speed");
  const speedEvents = config.events.filter((e) => e.type === "speed");

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Events
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Each event has its own stages and entry list. Open an event to edit
          timing structure and crews before you connect live data.
        </p>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          New event
        </h2>
        <CreateEventForm />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          All events
        </h2>
        {config.events.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 bg-white/50 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/50">
            No events yet. Create one above.
          </p>
        ) : (
          <div className="space-y-5">
            <EventGroup title="Rally events" events={rallyEvents} />
            <EventGroup title="Speed events" events={speedEvents} />
          </div>
        )}
      </section>
    </div>
  );
}

function EventGroup({
  title,
  events,
}: {
  title: string;
  events: Awaited<ReturnType<typeof loadRallyConfig>>["events"];
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {title}
      </h3>
      {events.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 bg-white/50 px-4 py-4 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/50">
          No events in this group.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {events.map((e) => (
            <li key={e.id}>
              <Link
                href={`/admin/events/${e.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/80"
              >
                <div>
                  <p className="font-medium">{e.name}</p>
                  <p className="text-xs text-zinc-500">
                    {e.dateStart} · {e.location || "—"} · {e.status} ·{" "}
                    {e.stages.length} stages · {e.entries.length} entries
                  </p>
                </div>
                <span className="text-sm text-red-700 dark:text-red-400">
                  Edit →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
