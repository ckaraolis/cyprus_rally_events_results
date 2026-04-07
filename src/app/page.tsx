import Link from "next/link";
import { ChampionshipListEwrc } from "@/components/public/championship-list-ewrc";
import { EwrcChrome } from "@/components/public/ewrc-chrome";
import { RallyPublicView } from "@/components/public/rally-public-view";
import { loadRallyConfig } from "@/lib/rally/config-file";

export const dynamic = "force-dynamic";

export default async function Home() {
  const config = await loadRallyConfig();
  const { site } = config;
  const featuredById = config.events.find(
    (e) => e.id === site.featuredEventId,
  );
  const featured =
    featuredById ??
    (config.events.length === 1 ? config.events[0] : undefined);

  return (
    <EwrcChrome site={site}>
      {featured ? (
        <>
          {config.events.length > 1 ? (
            <div className="border-b border-[var(--ewrc-border)] bg-[var(--ewrc-footer-bg)]">
              <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2.5 sm:px-6">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--ewrc-muted-2)]">
                  Other rallies
                </span>
                {config.events
                  .filter((e) => e.id !== featured.id)
                  .map((e) => (
                    <Link
                      key={e.id}
                      href={`/rally/${e.id}`}
                      className="rounded border border-[var(--ewrc-link-other-border)] bg-[var(--ewrc-link-other-bg)] px-2.5 py-1 text-xs text-[var(--ewrc-link-other-text)] transition-colors hover:border-[var(--ewrc-brand)] hover:text-[var(--ewrc-heading)]"
                    >
                      {e.name}
                    </Link>
                  ))}
              </div>
            </div>
          ) : null}
          <RallyPublicView site={site} event={featured} />
        </>
      ) : config.events.length > 1 ? (
        <ChampionshipListEwrc events={config.events} />
      ) : (
        <main className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
          <div className="ewrc-panel mx-auto max-w-lg p-10">
            <p className="text-sm text-[var(--ewrc-muted)]">
              No events yet. Create a rally in{" "}
              <Link
                href="/admin/events"
                className="font-medium text-[var(--ewrc-brand)] hover:underline"
              >
                Admin → Events & entries
              </Link>{" "}
              to show entry list, stages, and itinerary here.
            </p>
          </div>
        </main>
      )}
    </EwrcChrome>
  );
}
