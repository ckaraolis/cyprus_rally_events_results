"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createEvent } from "../actions";
import type { EventStatus, EventType } from "@/lib/rally/types";

export function CreateEventForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [dateStart, setDateStart] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [dateEnd, setDateEnd] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [type, setType] = useState<EventType>("rally");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState<EventStatus>("upcoming");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const id = await createEvent({
        name,
        type,
        dateStart,
        dateEnd,
        location,
        status,
      });
      setName("");
      setLocation("");
      router.push(`/admin/events/${id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="min-w-[12rem] flex-1">
        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Name
        </label>
        <input
          required
          className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Cyprus Rally 2026"
        />
      </div>
      <div className="w-40">
        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Start date
        </label>
        <input
          type="date"
          required
          className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          value={dateStart}
          onChange={(e) => setDateStart(e.target.value)}
        />
      </div>
      <div className="w-40">
        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          End date
        </label>
        <input
          type="date"
          required
          className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          value={dateEnd}
          onChange={(e) => setDateEnd(e.target.value)}
        />
      </div>
      <div className="w-36">
        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Type
        </label>
        <select
          className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          value={type}
          onChange={(e) => setType(e.target.value as EventType)}
        >
          <option value="rally">Rally</option>
          <option value="speed">Speed</option>
        </select>
      </div>
      <div className="min-w-[10rem] flex-1">
        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Location
        </label>
        <input
          className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. Limassol"
        />
      </div>
      <div className="w-36">
        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Status
        </label>
        <select
          className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          value={status}
          onChange={(e) => setStatus(e.target.value as EventStatus)}
        >
          <option value="draft">Draft</option>
          <option value="upcoming">Upcoming</option>
          <option value="live">Live</option>
          <option value="completed">Completed</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {pending ? "Creating…" : "Create & open"}
      </button>
    </form>
  );
}
