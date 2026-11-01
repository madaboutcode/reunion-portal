import { countries, getEmojiFlag, type TCountryCode } from "countries-list";

const TEAM_NAME_ALIASES: Record<string, TCountryCode> = {
  "bosnia & herzegovina": "BA",
  "bosnia and herzegovina": "BA",
  "cape verde": "CV",
  curacao: "CW",
  "curaçao": "CW",
  "czech republic": "CZ",
  "dr congo": "CD",
  "ivory coast": "CI",
  "south korea": "KR",
  turkey: "TR",
  usa: "US",
};

const HARDCODED_FLAGS: Record<string, string> = {
  england: String.fromCodePoint(
    0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f,
  ),
  "northern ireland": String.fromCodePoint(
    0x1f3f4, 0xe0067, 0xe0062, 0xe006e, 0xe0069, 0xe007f,
  ),
  scotland: String.fromCodePoint(
    0x1f3f4, 0xe0067, 0xe0062, 0xe0073, 0xe0063, 0xe0074, 0xe007f,
  ),
  wales: String.fromCodePoint(
    0x1f3f4, 0xe0067, 0xe0062, 0xe0077, 0xe006c, 0xe0073, 0xe007f,
  ),
};

const COUNTRY_NAME_INDEX = new Map<string, TCountryCode>(
  Object.entries(countries).map(([iso, data]) => [
    normalizeTeamName(data.name),
    iso as TCountryCode,
  ]),
);

function normalizeTeamName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

export function getTeamFlagCode(teamName: string): TCountryCode | null {
  const raw = teamName.trim();
  if (!raw) return null;

  const normalized = normalizeTeamName(raw);
  const aliasMatch = TEAM_NAME_ALIASES[normalized] ?? TEAM_NAME_ALIASES[raw.trim().toLowerCase()];
  if (aliasMatch) {
    return aliasMatch;
  }

  return COUNTRY_NAME_INDEX.get(normalized) ?? null;
}

export function getTeamFlagEmoji(teamName: string): string | null {
  const normalized = normalizeTeamName(teamName);
  const hardcoded = HARDCODED_FLAGS[normalized];
  if (hardcoded) return hardcoded;

  const code = getTeamFlagCode(teamName);
  if (!code) return null;

  return getEmojiFlag(code);
}
