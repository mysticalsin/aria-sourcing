/**
 * Resolve free-text candidate locations ("Paris, FR", "Lagos, NG", "Austin, US")
 * to ISO 3166-1 alpha-2 + English name for international hiring maps.
 */

export interface ResolvedCountry {
  iso2: string;
  /** ISO 3166-1 numeric as used by world-atlas feature ids */
  numericId: string;
  name: string;
}

/** ISO2 → numeric id (world-atlas countries-110m feature.id). */
export const ISO2_TO_NUMERIC: Record<string, string> = {
  AF: "004", AL: "008", DZ: "012", AR: "032", AM: "051", AU: "036", AT: "040",
  AZ: "031", BH: "048", BD: "050", BY: "112", BE: "056", BJ: "204", BO: "068",
  BA: "070", BR: "076", BG: "100", BF: "854", KH: "116", CM: "120", CA: "124",
  CL: "152", CN: "156", CO: "170", CG: "178", CD: "180", CR: "188", CI: "384",
  HR: "191", CU: "192", CY: "196", CZ: "203", DK: "208", DO: "214", EC: "218",
  EG: "818", EE: "233", ET: "231", FI: "246", FR: "250", GA: "266", GE: "268",
  DE: "276", GH: "288", GR: "300", GT: "320", GN: "324", HT: "332", HN: "340",
  HK: "344", HU: "348", IS: "352", IN: "356", ID: "360", IR: "364", IQ: "368",
  IE: "372", IL: "376", IT: "380", JM: "388", JP: "392", JO: "400", KZ: "398",
  KE: "404", KW: "414", KG: "417", LA: "418", LV: "428", LB: "422", LR: "430",
  LY: "434", LT: "440", LU: "442", MG: "450", MY: "458", ML: "466", MT: "470",
  MR: "478", MX: "484", MD: "498", MN: "496", ME: "499", MA: "504", MZ: "508",
  MM: "104", NA: "516", NP: "524", NL: "528", NZ: "554", NI: "558", NE: "562",
  NG: "566", KP: "408", MK: "807", NO: "578", OM: "512", PK: "586", PA: "591",
  PY: "600", PE: "604", PH: "608", PL: "616", PT: "620", QA: "634", RO: "642",
  RU: "643", RW: "646", SA: "682", SN: "686", RS: "688", SG: "702", SK: "703",
  SI: "705", SO: "706", ZA: "710", KR: "410", ES: "724", LK: "144", SD: "729",
  SE: "752", CH: "756", SY: "760", TW: "158", TJ: "762", TZ: "834", TH: "764",
  TG: "768", TN: "788", TR: "792", TM: "795", UG: "800", UA: "804", AE: "784",
  GB: "826", US: "840", UY: "858", UZ: "860", VE: "862", VN: "704", YE: "887",
  ZM: "894", ZW: "716",
};

const ISO2_NAMES: Record<string, string> = {
  AF: "Afghanistan", AL: "Albania", DZ: "Algeria", AR: "Argentina", AM: "Armenia",
  AU: "Australia", AT: "Austria", AZ: "Azerbaijan", BH: "Bahrain", BD: "Bangladesh",
  BY: "Belarus", BE: "Belgium", BJ: "Benin", BO: "Bolivia", BA: "Bosnia and Herzegovina",
  BR: "Brazil", BG: "Bulgaria", BF: "Burkina Faso", KH: "Cambodia", CM: "Cameroon",
  CA: "Canada", CL: "Chile", CN: "China", CO: "Colombia", CG: "Congo", CD: "Dem. Rep. Congo",
  CR: "Costa Rica", CI: "Côte d'Ivoire", HR: "Croatia", CU: "Cuba", CY: "Cyprus",
  CZ: "Czechia", DK: "Denmark", DO: "Dominican Republic", EC: "Ecuador", EG: "Egypt",
  EE: "Estonia", ET: "Ethiopia", FI: "Finland", FR: "France", GA: "Gabon", GE: "Georgia",
  DE: "Germany", GH: "Ghana", GR: "Greece", GT: "Guatemala", GN: "Guinea", HT: "Haiti",
  HN: "Honduras", HK: "Hong Kong", HU: "Hungary", IS: "Iceland", IN: "India", ID: "Indonesia",
  IR: "Iran", IQ: "Iraq", IE: "Ireland", IL: "Israel", IT: "Italy", JM: "Jamaica",
  JP: "Japan", JO: "Jordan", KZ: "Kazakhstan", KE: "Kenya", KW: "Kuwait", KG: "Kyrgyzstan",
  LA: "Laos", LV: "Latvia", LB: "Lebanon", LR: "Liberia", LY: "Libya", LT: "Lithuania",
  LU: "Luxembourg", MG: "Madagascar", MY: "Malaysia", ML: "Mali", MT: "Malta",
  MR: "Mauritania", MX: "Mexico", MD: "Moldova", MN: "Mongolia", ME: "Montenegro",
  MA: "Morocco", MZ: "Mozambique", MM: "Myanmar", NA: "Namibia", NP: "Nepal",
  NL: "Netherlands", NZ: "New Zealand", NI: "Nicaragua", NE: "Niger", NG: "Nigeria",
  KP: "North Korea", MK: "North Macedonia", NO: "Norway", OM: "Oman", PK: "Pakistan",
  PA: "Panama", PY: "Paraguay", PE: "Peru", PH: "Philippines", PL: "Poland", PT: "Portugal",
  QA: "Qatar", RO: "Romania", RU: "Russia", RW: "Rwanda", SA: "Saudi Arabia",
  SN: "Senegal", RS: "Serbia", SG: "Singapore", SK: "Slovakia", SI: "Slovenia",
  SO: "Somalia", ZA: "South Africa", KR: "South Korea", ES: "Spain", LK: "Sri Lanka",
  SD: "Sudan", SE: "Sweden", CH: "Switzerland", SY: "Syria", TW: "Taiwan", TJ: "Tajikistan",
  TZ: "Tanzania", TH: "Thailand", TG: "Togo", TN: "Tunisia", TR: "Turkey", TM: "Turkmenistan",
  UG: "Uganda", UA: "Ukraine", AE: "United Arab Emirates", GB: "United Kingdom",
  US: "United States of America", UY: "Uruguay", UZ: "Uzbekistan", VE: "Venezuela",
  VN: "Vietnam", YE: "Yemen", ZM: "Zambia", ZW: "Zimbabwe",
};

/** City / region / alias → ISO2 (lowercase keys). */
const PLACE_ALIASES: Record<string, string> = {
  // Common city aliases from seed + LinkedIn-style locations
  milan: "IT", milano: "IT", rome: "IT", roma: "IT", italy: "IT",
  lagos: "NG", abuja: "NG", nigeria: "NG",
  kraków: "PL", krakow: "PL", warsaw: "PL", warszawa: "PL", poland: "PL",
  paris: "FR", lyon: "FR", france: "FR",
  austin: "US", "san francisco": "US", "new york": "US", seattle: "US",
  "united states": "US", usa: "US", america: "US",
  london: "GB", manchester: "GB", "united kingdom": "GB", england: "GB", uk: "GB",
  berlin: "DE", munich: "DE", münchen: "DE", germany: "DE", deutschland: "DE",
  amsterdam: "NL", netherlands: "NL", holland: "NL",
  madrid: "ES", barcelona: "ES", spain: "ES",
  lisbon: "PT", lisboa: "PT", portugal: "PT",
  toronto: "CA", montreal: "CA", montréal: "CA", vancouver: "CA", canada: "CA",
  sydney: "AU", melbourne: "AU", australia: "AU",
  tokyo: "JP", japan: "JP",
  singapore: "SG",
  dubai: "AE", "abu dhabi": "AE", uae: "AE",
  bangalore: "IN", bengaluru: "IN", mumbai: "IN", delhi: "IN", india: "IN",
  "são paulo": "BR", "sao paulo": "BR", brazil: "BR", brasil: "BR",
  "mexico city": "MX", mexico: "MX",
  stockholm: "SE", sweden: "SE",
  copenhagen: "DK", denmark: "DK",
  oslo: "NO", norway: "NO",
  helsinki: "FI", finland: "FI",
  zurich: "CH", geneva: "CH", switzerland: "CH",
  vienna: "AT", austria: "AT",
  brussels: "BE", belgium: "BE",
  dublin: "IE", ireland: "IE",
  prague: "CZ", czechia: "CZ", "czech republic": "CZ",
  budapest: "HU", hungary: "HU",
  bucharest: "RO", romania: "RO",
  sofia: "BG", bulgaria: "BG",
  athens: "GR", greece: "GR",
  istanbul: "TR", turkey: "TR", türkiye: "TR",
  cairo: "EG", egypt: "EG",
  nairobi: "KE", kenya: "KE",
  johannesburg: "ZA", "cape town": "ZA", "south africa": "ZA",
  seoul: "KR", "south korea": "KR", korea: "KR",
  beijing: "CN", shanghai: "CN", china: "CN",
  "hong kong": "HK",
  taipei: "TW", taiwan: "TW",
  hanoi: "VN", "ho chi minh": "VN", vietnam: "VN",
  bangkok: "TH", thailand: "TH",
  jakarta: "ID", indonesia: "ID",
  manila: "PH", philippines: "PH",
  "tel aviv": "IL", israel: "IL",
  riyadh: "SA", "saudi arabia": "SA",
  "remote / eu": "EU_REMOTE",
  "remote eu": "EU_REMOTE",
  "europe remote": "EU_REMOTE",
};

const NAME_TO_ISO2 = Object.fromEntries(
  Object.entries(ISO2_NAMES).map(([iso2, name]) => [name.toLowerCase(), iso2]),
);

export function countryFromIso2(iso2: string): ResolvedCountry | null {
  const code = iso2.toUpperCase();
  const numericId = ISO2_TO_NUMERIC[code];
  const name = ISO2_NAMES[code];
  if (!numericId || !name) return null;
  return { iso2: code, numericId, name };
}

/**
 * Parse a free-text location into a country. Returns null for unresolvable /
 * pan-regional remote strings that are not a single country (e.g. "Remote / EU").
 */
export function resolveCountryFromLocation(raw: string): ResolvedCountry | null {
  const text = raw.trim();
  if (!text || /^[—–-]$/.test(text)) return null;

  const lower = text.toLowerCase();
  if (/\bremote\b/.test(lower) && /\b(eu|emea|europe|worldwide|global)\b/.test(lower)) {
    return null; // counted separately as remote/unspecified
  }

  // Trailing ISO2 token: "Milan, IT" / "Austin, US"
  const isoTail = text.match(/,\s*([A-Za-z]{2})\s*$/);
  if (isoTail) {
    const resolved = countryFromIso2(isoTail[1]!);
    if (resolved) return resolved;
  }

  // Leading/standalone ISO2
  if (/^[A-Za-z]{2}$/.test(text)) {
    const resolved = countryFromIso2(text);
    if (resolved) return resolved;
  }

  // Alias / city dictionary (longest keys first)
  const aliasKeys = Object.keys(PLACE_ALIASES).sort((a, b) => b.length - a.length);
  for (const key of aliasKeys) {
    if (lower.includes(key)) {
      const iso2 = PLACE_ALIASES[key]!;
      if (iso2 === "EU_REMOTE") return null;
      const resolved = countryFromIso2(iso2);
      if (resolved) return resolved;
    }
  }

  // Full country name
  for (const [name, iso2] of Object.entries(NAME_TO_ISO2)) {
    if (lower.includes(name)) {
      const resolved = countryFromIso2(iso2);
      if (resolved) return resolved;
    }
  }

  return null;
}

export function isRemoteOrUnspecifiedLocation(raw: string): boolean {
  const lower = raw.trim().toLowerCase();
  if (!lower) return true;
  if (resolveCountryFromLocation(raw)) return false;
  return /\bremote\b|\banywhere\b|\bworldwide\b|\bglobal\b|\beu\b|\bemera\b/.test(lower);
}
