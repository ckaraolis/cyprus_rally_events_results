"use client";

import { useEffect, useMemo, useState } from "react";
import { FlagImage } from "@/components/flag-image";
import { COUNTRY_PRESETS } from "@/lib/country-presets";

const CUSTOM = "__custom__";

function normalizeCode(v: string): string {
  return v.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
}

type Props = {
  value: string;
  onChange: (code: string) => void;
};

export function AdminCountrySelect({ value, onChange }: Props) {
  const normalized = normalizeCode(value || "");
  const inPreset = COUNTRY_PRESETS.some((p) => p.code === normalized);
  const [otherOpen, setOtherOpen] = useState(false);

  useEffect(() => {
    if (inPreset && normalized) setOtherOpen(false);
  }, [inPreset, normalized]);

  const selectValue = useMemo(() => {
    if (inPreset) return normalized;
    if (normalized) return CUSTOM;
    if (otherOpen) return CUSTOM;
    return "";
  }, [inPreset, normalized, otherOpen]);

  return (
    <div className="flex min-w-[9rem] max-w-[11rem] flex-col gap-1">
      <div className="flex items-center gap-2">
        {normalized ? (
          <FlagImage code={normalized} size={24} className="shrink-0" />
        ) : (
          <span className="inline-block w-6 shrink-0" aria-hidden />
        )}
        <select
        className="min-w-0 flex-1 rounded border border-zinc-200 px-1.5 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-950"
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") {
            setOtherOpen(false);
            onChange("");
            return;
          }
          if (v === CUSTOM) {
            setOtherOpen(true);
            onChange("");
            return;
          }
          setOtherOpen(false);
          onChange(v);
        }}
      >
        <option value="">— No flag</option>
        {COUNTRY_PRESETS.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
        <option value={CUSTOM}>Other… (type ISO code)</option>
      </select>
      </div>
      {selectValue === CUSTOM ? (
        <div className="flex items-center gap-1.5 pl-8">
          <input
            maxLength={2}
            className="min-w-0 flex-1 rounded border border-zinc-200 px-1.5 py-1 text-center font-mono text-xs uppercase tracking-wide dark:border-zinc-700 dark:bg-zinc-950"
            value={normalized}
            placeholder="ISO"
            aria-label="Custom country code"
            onChange={(e) => onChange(normalizeCode(e.target.value))}
          />
        </div>
      ) : null}
    </div>
  );
}
