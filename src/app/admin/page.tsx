import Link from "next/link";
import { loadRallyConfig } from "@/lib/rally/config-file";

export default async function AdminHomePage() {
  const config = await loadRallyConfig();
  const todayIso = new Date().toISOString().slice(0, 10);
  const runningNow = config.events
    .filter((e) => e.status === "live")
    .sort((a, b) => a.dateStart.localeCompare(b.dateStart));
  const upcoming = config.events
    .filter((e) => e.status === "upcoming" && e.dateStart >= todayIso)
    .sort((a, b) => a.dateStart.localeCompare(b.dateStart));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Overview</h1>
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Running now
          </h2>
          {runningNow.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
              No event is marked as Live.
            </p>
          ) : (
            <ul className="mt-4 space-y-2 text-sm">
              {runningNow.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-col items-start gap-1 rounded-lg border border-zinc-100 p-2 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between sm:border-0 sm:p-0"
                >
                  <Link
                    href={`/admin/events/${e.id}`}
                    className="w-full break-words font-medium text-red-700 hover:underline dark:text-red-400"
                  >
                    {e.name}
                  </Link>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {e.dateStart || "Date TBA"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Upcoming events
          </h2>
          {upcoming.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
              No upcoming events.
            </p>
          ) : (
            <ul className="mt-4 space-y-2 text-sm">
              {upcoming.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-col items-start gap-1 rounded-lg border border-zinc-100 p-2 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between sm:border-0 sm:p-0"
                >
                  <Link
                    href={`/admin/events/${e.id}`}
                    className="w-full break-words font-medium text-red-700 hover:underline dark:text-red-400"
                  >
                    {e.name}
                  </Link>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {e.dateStart || "Date TBA"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
