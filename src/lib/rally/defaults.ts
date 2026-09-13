import type { RallySiteConfig } from "./types";

export const defaultRallyConfig: RallySiteConfig = {
  updatedAt: new Date().toISOString(),
  site: {
    resultsPageTitle: "Speed & Rally - Live Results",
    resultsPageSubtitle: "Only Speed & Rally Events Results",
    resultsStatusLabel: "Setup",
    featuredEventId: null,
    publicFooterNote: "",
  },
  events: [],
};
