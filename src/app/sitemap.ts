import type { MetadataRoute } from "next";
import { loadRallyConfig } from "@/lib/rally/config-file";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = "https://cyprusspeedrallyresults.com";
  const config = await loadRallyConfig();
  const eventUrls = config.events.map((e) => ({
    url: `${base}/rally/${e.id}`,
    lastModified: new Date(config.updatedAt),
    changeFrequency: "hourly" as const,
    priority: 0.8,
  }));
  return [
    {
      url: `${base}/`,
      lastModified: new Date(config.updatedAt),
      changeFrequency: "hourly",
      priority: 1,
    },
    ...eventUrls,
  ];
}
