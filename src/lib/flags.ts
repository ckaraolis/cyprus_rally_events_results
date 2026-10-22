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

/** Common non-ISO nicknames → ISO 3166-1 alpha-2 (e.g. Excel "KSA"). */
const COUNTRY_CODE_ALIASES: Record<string, string> = {
  KSA: "SA",
};

/** ISO 3166-1 alpha-2 → alpha-3 for print sheets (e.g. CY → CYP). */
const ALPHA2_TO_ALPHA3: Record<string, string> = {
  AD: "AND",
  AL: "ALB",
  AM: "ARM",
  AR: "ARG",
  AT: "AUT",
  AU: "AUS",
  AZ: "AZE",
  BA: "BIH",
  BE: "BEL",
  BG: "BGR",
  BR: "BRA",
  CA: "CAN",
  CH: "CHE",
  CY: "CYP",
  CZ: "CZE",
  DE: "DEU",
  DK: "DNK",
  EE: "EST",
  ES: "ESP",
  FI: "FIN",
  FR: "FRA",
  GB: "GBR",
  GE: "GEO",
  GR: "GRC",
  HR: "HRV",
  HU: "HUN",
  IE: "IRL",
  IL: "ISR",
  IS: "ISL",
  IT: "ITA",
  JO: "JOR",
  JP: "JPN",
  KR: "KOR",
  KZ: "KAZ",
  LB: "LBN",
  LT: "LTU",
  LU: "LUX",
  LV: "LVA",
  MC: "MCO",
  MD: "MDA",
  ME: "MNE",
  MK: "MKD",
  MT: "MLT",
  MX: "MEX",
  NL: "NLD",
  NO: "NOR",
  NZ: "NZL",
  OM: "OMN",
  PL: "POL",
  PT: "PRT",
  QA: "QAT",
  RO: "ROU",
  RS: "SRB",
  RU: "RUS",
  SA: "SAU",
  SE: "SWE",
  SI: "SVN",
  SK: "SVK",
  SM: "SMR",
  TR: "TUR",
  UA: "UKR",
  US: "USA",
  VA: "VAT",
  ZA: "ZAF",
};

export function normalizeCountryCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const letters = raw.trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (!letters) return "";
  const alias = COUNTRY_CODE_ALIASES[letters];
  if (alias) return alias;
  if (letters.length >= 2) return letters.slice(0, 2);
  return "";
}

export function isIso3166Alpha2(code: string): boolean {
  return normalizeCountryCode(code).length === 2;
}

/** ISO alpha-3 for print (e.g. CY → CYP). Falls back to alpha-2 if unknown. */
export function countryCodeToAlpha3(code: string | null | undefined): string {
  const alpha2 = normalizeCountryCode(code);
  if (!alpha2) return "";
  return ALPHA2_TO_ALPHA3[alpha2] ?? alpha2;
}

/** Print / export: "Driver Name (CYP)" when nationality is set. */
export function formatNameWithNationality(
  name: string | null | undefined,
  countryCode: string | null | undefined,
): string {
  const n = (name ?? "").trim() || "—";
  const alpha3 = countryCodeToAlpha3(countryCode);
  return alpha3 ? `${n} (${alpha3})` : n;
}
