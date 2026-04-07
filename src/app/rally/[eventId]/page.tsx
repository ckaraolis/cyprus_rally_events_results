import { notFound } from "next/navigation";
import { EwrcChrome } from "@/components/public/ewrc-chrome";
import { RallyPublicView } from "@/components/public/rally-public-view";
import { loadRallyConfig } from "@/lib/rally/config-file";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ eventId: string }> };

export default async function RallyEventPublicPage({ params }: Props) {
  const { eventId } = await params;
  const config = await loadRallyConfig();
  const event = config.events.find((e) => e.id === eventId);
  if (!event) notFound();

  return (
    <EwrcChrome site={config.site}>
      <RallyPublicView
        site={config.site}
        event={event}
        topCrumb={{ href: "/", label: "← Home" }}
      />
    </EwrcChrome>
  );
}
