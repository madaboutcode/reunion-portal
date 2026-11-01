export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Stable face-like placeholder for debug / mock cards (200×200). */
/** Branch-tinted gradient for polaroid initials placeholders (matches prototype). */
export function branchInitialsGradient(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `linear-gradient(135deg, rgba(${r},${g},${b},0.85) 0%, rgba(${r},${g},${b},0.55) 100%)`;
}

export function placeholderPhotoUrl(seed: string | number): string {
  return `https://i.pravatar.cc/200?u=smriti-${encodeURIComponent(String(seed))}`;
}

export function formatLocation(city: string, country: string): string {
  const trimmedCity = city.trim();
  const trimmedCountry = country.trim();
  if (!trimmedCountry || trimmedCountry.toLowerCase() === "india") {
    return trimmedCity;
  }
  return `${trimmedCity}, ${trimmedCountry}`;
}