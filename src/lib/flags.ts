/** ISO 3166-1 alpha-2 → regional indicator flag emoji (e.g. CY → 🇨🇾). */
export function countryCodeToFlagEmoji(code: string): string {
  const c = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "";
  const base = 0x1f1e6;
  return String.fromCodePoint(
    base + c.charCodeAt(0) - 65,
    base + c.charCodeAt(1) - 65,
  );
}

export function normalizeCountryCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const letters = raw.trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (letters.length >= 2) return letters.slice(0, 2);
  return "";
}

export function isIso3166Alpha2(code: string): boolean {
  return normalizeCountryCode(code).length === 2;
}
