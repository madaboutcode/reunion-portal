/**
 * Every registration code starts with this prefix (then 12 Crockford base32 characters).
 * Single owner: the server generator, route validators, the bank-remark parser and
 * scripts/site_config.py (reg_code_prefix) all read this constant. It is not in
 * site.config.json. Changing it only affects NEW codes; existing registrations and R2 keys
 * keep the old prefix, so change it before the first registration.
 */
export const REG_CODE_PREFIX = "SMRT";

export function formatRegCodeForDisplay(regCode: string): string {
  const normalized = regCode.replace(/-/g, "").trim().toUpperCase();
  if (normalized.length !== 16) return regCode;

  return [
    normalized.slice(0, 4),
    normalized.slice(4, 8),
    normalized.slice(8, 12),
    normalized.slice(12, 16),
  ].join("-");
}
