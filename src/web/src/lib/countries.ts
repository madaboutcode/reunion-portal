import { countries, getEmojiFlag, type TCountryCode } from "countries-list";

// Country list for the country selector — stores country name as value
const allCountries = Object.entries(countries).map(([iso, data]) => ({
  value: data.name,
  label: `${getEmojiFlag(iso as TCountryCode)} ${data.name}`,
  iso,
}));

// Kerala diaspora countries pinned at the top (India first, then alphabetical)
const PINNED_ISO = [
  "IN", "AE", "SA", "QA", "KW", "BH", "OM",
  "SG", "MY", "AU", "NZ",
  "US", "CA", "GB", "IE", "DE",
  "CH", "NL", "NO", "SE", "DK",
  "FR", "IT", "JP", "KR",
];

const pinnedSet = new Set(PINNED_ISO);
const pinned = PINNED_ISO
  .map((iso) => allCountries.find((c) => c.iso === iso)!)
  .filter(Boolean);

const rest = allCountries
  .filter((c) => !pinnedSet.has(c.iso))
  .sort((a, b) => a.label.localeCompare(b.label));

const SEPARATOR = { value: "", label: "──────────", disabled: true };

/** Country options: diaspora countries pinned at top, then all others alphabetically. */
export const COUNTRIES = [...pinned, SEPARATOR, ...rest];
