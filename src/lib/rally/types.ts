export type EventStatus = "draft" | "upcoming" | "live" | "completed";
export type EventType = "rally" | "speed";
export type SpeedRunImportStatus = "scheduled" | "live" | "completed";
export type OfficialNoticeCategory =
  | "Supplementary Regulations"
  | "Bulletins"
  | "Steward Decisions"
  | "Other";

/** Public “Stage results” bar: dot colour (yellow / green / red). */
export type StageProgressStatus = "pending" | "live" | "completed";

export interface SiteSettings {
  resultsPageTitle: string;
  resultsPageSubtitle: string;
  resultsStatusLabel: string;
  featuredEventId: string | null;
  /** Short note shown on the public results page */
  publicFooterNote: string;
}

export interface Stage {
  id: string;
  name: string;
  order: number;
  /** 1-based leg for itinerary grouping (e.g. SS1–SS2 = leg 1, SS3 = leg 2). */
  leg: number;
  distanceKm: number | null;
  /** Local time when car 1 starts the stage (HH:mm from admin). Null = TBA. */
  firstCarStartTime: string | null;
  progressStatus: StageProgressStatus;
}

export interface Entry {
  id: string;
  startNumber: number;
  /** Optional entrance identifier/category used by organizers. */
  entrance: string;
  /** Admin-only start permission: false = exclude from live/final result pages. */
  start: boolean;
  /** Speed event (trial run) start time entered by admin, HH:mm[:ss]. */
  trialStartTime: string;
  /** Speed event (trial run) finish time entered by admin, HH:mm[:ss]. */
  trialFinishTime: string;
  /** Speed event (1st run) start time entered by admin. */
  run1StartTime: string;
  /** Speed event (1st run) finish time entered by admin. */
  run1FinishTime: string;
  /** Speed event (2nd run) start time entered by admin. */
  run2StartTime: string;
  /** Speed event (2nd run) finish time entered by admin. */
  run2FinishTime: string;
  driver: string;
  coDriver: string;
  car: string;
  class: string;
  /** ISO 3166-1 alpha-2 (e.g. CY, GR) — flag before driver on stage results */
  driverCountryCode: string;
  /** Optional — flag before co-driver when set */
  coDriverCountryCode: string;
}

export interface RallyEvent {
  id: string;
  name: string;
  /** Optional public logo URL shown above the rally title and in printed sheets. */
  logoUrl: string;
  type: EventType;
  dateStart: string;
  dateEnd: string;
  location: string;
  status: EventStatus;
  /** ALGE import gate per speed run (only "live" should accept imports). */
  speedRunImportStatus: {
    trial: SpeedRunImportStatus;
    run1: SpeedRunImportStatus;
    run2: SpeedRunImportStatus;
  };
  /** Last observed ALGE trigger counts per polling key. */
  algeTriggerCountByKey: Record<string, number>;
  /** Custom category names for Official Notice Board. */
  officialNoticeCustomCategories: string[];
  /** Uploaded documents for Speed Official Notice Board. */
  officialNoticeDocuments: Array<{
    id: string;
    title: string;
    category: OfficialNoticeCategory | string;
    url: string;
    fileName: string;
    uploadedAt: string;
  }>;
  stages: Stage[];
  entries: Entry[];
}

export interface RallySiteConfig {
  site: SiteSettings;
  events: RallyEvent[];
  updatedAt: string;
}
