"use client";

import { useEffect, useId, useState } from "react";
import {
  isValidPrintDate,
  isValidPrintTime,
  loadSavedPrintSignatureName,
  normalizePrintDate,
  normalizePrintTime,
  nowPrintDateTime,
  PRINT_SIGNATURE_TITLE,
  savePrintSignatureName,
} from "@/lib/rally/print-signature";
import {
  resolvePrintSignaturePrompt,
  subscribePrintSignaturePrompt,
} from "@/lib/rally/print-signature-prompt";

export function PrintSignatureHost() {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    return subscribePrintSignaturePrompt((nextOpen, options) => {
      if (nextOpen) {
        const now = nowPrintDateTime();
        setSubject((options.defaultSubject ?? "").trim());
        setName(loadSavedPrintSignatureName());
        setDate(now.date);
        setTime(now.time);
        setError("");
        setOpen(true);
      } else {
        setOpen(false);
      }
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        resolvePrintSignaturePrompt({ action: "cancel" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  function resolvedSubject(): string | null {
    const trimmed = subject.trim();
    if (!trimmed) {
      setError("Enter the print subject / title.");
      return null;
    }
    return trimmed;
  }

  function confirmYes() {
    const subj = resolvedSubject();
    if (!subj) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter the signature name.");
      return;
    }
    if (!isValidPrintDate(date)) {
      setError("Date must be DD/MM/YYYY.");
      return;
    }
    if (!isValidPrintTime(time)) {
      setError("Time must be HH:MM:SS.");
      return;
    }
    const normalizedDate = normalizePrintDate(date);
    const normalizedTime = normalizePrintTime(time);
    savePrintSignatureName(trimmedName);
    resolvePrintSignaturePrompt({
      action: "sign",
      subject: subj,
      signature: {
        name: trimmedName,
        title: PRINT_SIGNATURE_TITLE,
        date: normalizedDate,
        time: normalizedTime,
      },
    });
  }

  function confirmNo() {
    const subj = resolvedSubject();
    if (!subj) return;
    resolvePrintSignaturePrompt({ action: "skip", subject: subj });
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[1px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          resolvePrintSignaturePrompt({ action: "cancel" });
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        <h2
          id={titleId}
          className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
        >
          Print options
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Edit the subject shown at the top of the sheet.{" "}
          <strong>Yes</strong> also adds the signature; <strong>No</strong>{" "}
          prints without a signature.
        </p>

        <label className="mt-5 block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Subject
          <input
            autoFocus
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Stage Classification SS4 Ayios Epifanios 2"
            className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50"
          />
        </label>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Signature
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Nayia Kontopoulou"
                className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50"
              />
            </label>
            <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-700 dark:border-zinc-700 dark:text-zinc-200">
              {PRINT_SIGNATURE_TITLE}
            </p>
          </div>

          <div className="space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Date
              <input
                type="text"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                placeholder="DD/MM/YYYY"
                inputMode="numeric"
                className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50"
              />
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Time
              <input
                type="text"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                placeholder="HH:MM:SS"
                inputMode="numeric"
                className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50"
              />
            </label>
          </div>
        </div>

        {error ? (
          <p className="mt-3 text-sm text-red-700 dark:text-red-400" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={confirmNo}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            No
          </button>
          <button
            type="button"
            onClick={confirmYes}
            className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 dark:bg-red-600 dark:hover:bg-red-500"
          >
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}
