import type { TshirtSize, Gender } from "@/types/registration";

// ── T-shirt sizes by gender ───────────────────────────────────────────────

export const MENS_TSHIRT_SIZES: { value: TshirtSize; label: string }[] = [
  { value: "XS", label: "XS" },
  { value: "S", label: "S" },
  { value: "M", label: "M" },
  { value: "L", label: "L" },
  { value: "XL", label: "XL" },
  { value: "2XL", label: "2XL" },
  { value: "3XL", label: "3XL" },
  { value: "4XL", label: "4XL" },
  { value: "5XL", label: "5XL" },
  { value: "6XL", label: "6XL" },
];

export const WOMENS_TSHIRT_SIZES: { value: TshirtSize; label: string }[] = [
  { value: "2XS", label: "2XS" },
  { value: "XS", label: "XS" },
  { value: "S", label: "S" },
  { value: "M", label: "M" },
  { value: "L", label: "L" },
  { value: "XL", label: "XL" },
  { value: "2XL", label: "2XL" },
  { value: "3XL", label: "3XL" },
  { value: "4XL", label: "4XL" },
  { value: "5XL", label: "5XL" },
];

export function getTshirtOptions(gender?: Gender | null) {
  return gender === "female" ? WOMENS_TSHIRT_SIZES : MENS_TSHIRT_SIZES;
}
