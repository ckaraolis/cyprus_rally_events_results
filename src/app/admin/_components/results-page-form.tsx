"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateSiteSettings } from "../actions";
import type { SiteSettings } from "@/lib/rally/types";

type Props = {
  site: SiteSettings;
  events: { id: string; name: string }[];
};

export function ResultsPageForm({ site: initial, events }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [site, setSite] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);

  function save() {
    setMessage(null);
    startTransition(async () => {
      await updateSiteSettings(site);
      setMessage("Saved.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Page title"
          value={site.resultsPageTitle}
          onChange={(v) =>
            setSite((s) => ({ ...s, resultsPageTitle: v }))
          }
        />
        <Field
          label="Status label"
          hint="Shown as a badge (e.g. Live, Final, Shakedown)"
          value={site.resultsStatusLabel}
          onChange={(v) =>
            setSite((s) => ({ ...s, resultsStatusLabel: v }))
          }
        />
      </div>
      <div>
        <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
          Subtitle
        </label>
        <input
          className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          value={site.resultsPageSubtitle}
          onChange={(e) =>
            setSite((s) => ({ ...s, resultsPageSubtitle: e.target.value }))
          }
        />
      </div>
      <div>
        <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
          Featured event on homepage
        </label>
        <select
          className="mt-1 w-full max-w-md rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          value={site.featuredEventId ?? ""}
          onChange={(e) =>
            setSite((s) => ({
              ...s,
              featuredEventId: e.target.value || null,
            }))
          }
        >
          <option value="">None</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
          Public footer note
        </label>
        <textarea
          rows={3}
          className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          value={site.publicFooterNote}
          onChange={(e) =>
            setSite((s) => ({ ...s, publicFooterNote: e.target.value }))
          }
          placeholder="Optional message under results (sponsors, notice, …)"
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50 dark:bg-red-600 dark:hover:bg-red-700"
        >
          {pending ? "Saving…" : "Save results page"}
        </button>
        {message ? (
          <span className="text-sm text-green-700 dark:text-green-400">
            {message}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </label>
      {hint ? (
        <p className="mt-0.5 text-[11px] text-zinc-400">{hint}</p>
      ) : null}
      <input
        className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
