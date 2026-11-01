/**
 * Manual verification of registration-code display formatting.
 * Run: npx tsx src/web/src/lib/__tests__/reg-code.verify.ts
 */
import { formatRegCodeForDisplay } from "@smriti/shared";

function assert(label: string, actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
  console.log(`  ✓ ${label}`);
}

assert(
  "formats canonical SMRT code",
  formatRegCodeForDisplay("SMRT79WW4A25NWG1"),
  "SMRT-79WW-4A25-NWG1",
);

assert(
  "normalizes lowercase input",
  formatRegCodeForDisplay("smrt79ww4a25nwg1"),
  "SMRT-79WW-4A25-NWG1",
);

assert(
  "leaves unexpected values unchanged",
  formatRegCodeForDisplay("Unavailable"),
  "Unavailable",
);

console.log("\nreg-code.verify.ts passed");
