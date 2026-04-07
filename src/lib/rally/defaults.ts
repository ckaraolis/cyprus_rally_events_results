import type { RallySiteConfig } from "./types";

export const defaultRallyConfig: RallySiteConfig = {
  updatedAt: new Date().toISOString(),
  site: {
    resultsPageTitle: "Cyprus Rally Championship",
    resultsPageSubtitle: "National championship — live timing & results",
    resultsStatusLabel: "Setup",
    featuredEventId: null,
    publicFooterNote: "",
  },
  events: [],
};
