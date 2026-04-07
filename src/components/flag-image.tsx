import { normalizeCountryCode } from "@/lib/flags";

type Props = {
  code: string;
  className?: string;
  /** CDN width token (16, 20, 24, 32, …). */
  size?: 16 | 20 | 24 | 28 | 32;
};

/** Small flag picture (PNG) — avoids emoji showing as “CY” letters on Windows. */
export function FlagImage({ code, className = "", size = 20 }: Props) {
  const c = normalizeCountryCode(code);
  if (c.length !== 2) return null;
  const lower = c.toLowerCase();
  const h = Math.round(size * 0.75);
  return (
    <span
      className={`inline-flex shrink-0 overflow-hidden rounded-sm border border-[var(--ewrc-border-ui)] bg-[var(--ewrc-chip-bg)] align-middle ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://flagcdn.com/w${size}/${lower}.png`}
        alt=""
        width={size}
        height={h}
        className="block object-cover"
        loading="lazy"
        decoding="async"
      />
    </span>
  );
}
