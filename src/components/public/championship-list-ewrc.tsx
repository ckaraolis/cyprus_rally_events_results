import Link from "next/link";
import type { RallyEvent } from "@/lib/rally/types";

export function ChampionshipListEwrc({ events }: { events: RallyEvent[] }) {
  const liveEvents = events
    .filter((e) => e.status === "live")
    .sort((a, b) => a.dateStart.localeCompare(b.dateStart));
  const upcomingEvents = events
    .filter((e) => e.status === "upcoming")
    .sort((a, b) => a.dateStart.localeCompare(b.dateStart));
  const completedEvents = events
    .filter((e) => e.status === "completed")
    .sort((a, b) => b.dateStart.localeCompare(a.dateStart));

  const hasAny =
    liveEvents.length > 0 ||
    upcomingEvents.length > 0 ||
    completedEvents.length > 0;

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <h1 className="font-ewrc-heading text-2xl font-bold tracking-tight text-[var(--ewrc-heading)] sm:text-3xl">
          Speed & Rally - Live Results
        </h1>
        <p className="max-w-2xl text-sm text-[var(--ewrc-muted)] sm:text-base">
          Only Speed & Rally Events Results. Browse live, upcoming, and
          completed speed and rally events with stage timing and classifications.
        </p>
      </header>

      {!hasAny ? (
        <div className="ewrc-panel p-8 text-center">
          <p className="text-sm text-[var(--ewrc-muted)]">
            Event listings will appear here when events are published.
          </p>
        </div>
      ) : (
        <>
          {liveEvents.length > 0 ? (
            <EventTable title="Live events" events={liveEvents} />
          ) : null}
          {upcomingEvents.length > 0 ? (
            <EventTable title="Upcoming events" events={upcomingEvents} />
          ) : null}
          {completedEvents.length > 0 ? (
            <EventTable title="Completed events" events={completedEvents} />
          ) : null}
        </>
      )}
    </main>
  );
}

function EventTable({ title, events }: { title: string; events: RallyEvent[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--ewrc-muted)]">
        {title}
      </h2>
      <div className="ewrc-panel overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="ewrc-table ewrc-table-events-list min-w-[740px] w-full table-fixed text-sm">
            <colgroup>
              <col className="w-[36%]" />
              <col className="w-[14%]" />
              <col className="w-[14%]" />
              <col className="w-[20%]" />
              <col className="w-[10%]" />
              <col className="w-[6%]" />
            </colgroup>
            <thead>
              <tr>
                <th>Events</th>
                <th className="text-center">Event type</th>
                <th className="text-center">Date</th>
                <th className="text-center">Location</th>
                <th className="text-center">Status</th>
                <th className="text-center">Open</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={e.id} className={i % 2 === 1 ? "ewrc-row-alt" : ""}>
                  <td className="font-medium text-[var(--ewrc-heading)]">
                    <Link
                      href={`/rally/${e.id}`}
                      className="hover:text-[var(--ewrc-ss)]"
                    >
                      {e.name}
                    </Link>
                  </td>
                  <td className="text-center text-xs uppercase text-[var(--ewrc-accent-text)]">
                    {e.type}
                  </td>
                  <td className="text-center font-mono text-[var(--ewrc-accent-text)]">
                    {e.dateStart}
                  </td>
                  <td className="text-center text-[var(--ewrc-muted)]">
                    {e.location || "—"}
                  </td>
                  <td className="text-center">
                    <span className="text-xs uppercase text-[var(--ewrc-muted-2)]">
                      {e.status}
                    </span>
                  </td>
                  <td className="text-center">
                    <Link
                      href={`/rally/${e.id}`}
                      className="text-[var(--ewrc-brand)] hover:underline"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
