import Link from "next/link";
import { notFound } from "next/navigation";
import { loadRallyConfig } from "@/lib/rally/config-file";
import { EventEditor } from "../../_components/event-editor";

type Props = { params: Promise<{ eventId: string }> };

export default async function AdminEventDetailPage({ params }: Props) {
  const { eventId } = await params;
  const config = await loadRallyConfig();
  const event = config.events.find((e) => e.id === eventId);
  if (!event) notFound();

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/events"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
        >
          ← All events
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {event.name}
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Update rally details, stage list, and registered crews.
        </p>
      </div>
      <EventEditor event={event} />
    </div>
  );
}
