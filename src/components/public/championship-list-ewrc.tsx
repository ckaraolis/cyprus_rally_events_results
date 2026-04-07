import Link from "next/link";
import type { RallyEvent } from "@/lib/rally/types";

export function ChampionshipListEwrc({ events }: { events: RallyEvent[] }) {
  const liveEvents = events
    .filter((e) => e.status === "live")
    .sort((a, b) => a.dateStart.localeCompare(b.dateStart));
  const upcomingEvents = events
    .filter((e) => e.status === "upcoming")
    .sort((a, b) => a.dateStart.localeCompare(b.dateStart));

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <EventTable title="Live events" events={liveEvents} />
      <EventTable title="Upcoming events" events={upcomingEvents} />
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
          <table className="ewrc-table ewrc-table-events-list min-w-[740px] w-full text-sm">
            <thead>
              <tr>
                <th>Events</th>
                <th className="w-28 text-center">Event type</th>
                <th className="w-36 text-center">Date</th>
                <th className="text-center">Location</th>
                <th className="w-24 text-center">Status</th>
                <th className="w-20 text-center">Open</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[var(--ewrc-muted-3)]">
                    No events in this section.
                  </td>
                </tr>
              ) : (
                events.map((e, i) => (
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
