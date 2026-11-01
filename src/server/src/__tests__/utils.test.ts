/**
 * Tests for slugifyFileName utility.
 *
 * Covers every rule documented on the function:
 * - Lowercase name part
 * - Non-alphanumeric chars replaced with hyphens
 * - Consecutive hyphens collapsed
 * - Leading/trailing hyphens stripped
 * - Name part truncated to 30 chars
 * - Extension preserved and lowercased
 * - No extension handled cleanly
 */

import { describe, it, expect } from "vitest";
import { slugifyFileName } from "../utils.js";

describe("slugifyFileName", () => {
  describe("basic cases", () => {
    it("lowercases the name part", () => {
      expect(slugifyFileName("Receipt.JPG")).toBe("receipt.jpg");
    });

    it("preserves a clean lowercase filename unchanged", () => {
      expect(slugifyFileName("proof.jpg")).toBe("proof.jpg");
    });

    it("handles filename with no extension", () => {
      expect(slugifyFileName("noextension")).toBe("noextension");
    });
  });

  describe("character replacement", () => {
    it("replaces spaces with hyphens", () => {
      expect(slugifyFileName("my receipt.pdf")).toBe("my-receipt.pdf");
    });

    it("replaces parentheses and digits stay", () => {
      expect(slugifyFileName("My Receipt (1).PDF")).toBe("my-receipt-1.pdf");
    });

    it("replaces underscores with hyphens", () => {
      expect(slugifyFileName("proof_upload.png")).toBe("proof-upload.png");
    });

    it("replaces special characters with hyphens", () => {
      expect(slugifyFileName("A@B#C!.png")).toBe("a-b-c.png");
    });
  });

  describe("hyphen collapsing", () => {
    it("collapses consecutive hyphens", () => {
      expect(slugifyFileName("A---B.png")).toBe("a-b.png");
    });

    it("collapses mixed separators into a single hyphen", () => {
      expect(slugifyFileName("A___B___C!.png")).toBe("a-b-c.png");
    });
  });

  describe("leading/trailing hyphen stripping", () => {
    it("strips leading hyphens from name part", () => {
      expect(slugifyFileName("---receipt.jpg")).toBe("receipt.jpg");
    });

    it("strips trailing hyphens from name part", () => {
      expect(slugifyFileName("receipt---.jpg")).toBe("receipt.jpg");
    });

    it("strips both when name is surrounded by special chars", () => {
      expect(slugifyFileName("!!receipt!!.jpg")).toBe("receipt.jpg");
    });
  });

  describe("30-char truncation of name part", () => {
    it("truncates name part exceeding 30 chars", () => {
      const long = "a".repeat(40);
      const result = slugifyFileName(`${long}.pdf`);
      const namePart = result.split(".")[0];
      expect(namePart.length).toBeLessThanOrEqual(30);
      expect(result.endsWith(".pdf")).toBe(true);
    });

    it("does not leave a trailing hyphen after truncation", () => {
      // Construct a name where the 30th char would be a hyphen
      // "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-b" → truncate at 30 → "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-"
      // The trailing hyphen must be stripped.
      const name = "a".repeat(29) + "-b-suffix-extra";
      const result = slugifyFileName(`${name}.jpg`);
      const namePart = result.slice(0, result.lastIndexOf("."));
      expect(namePart).not.toMatch(/-$/);
      expect(namePart.length).toBeLessThanOrEqual(30);
    });
  });

  describe("extension handling", () => {
    it("lowercases the extension", () => {
      expect(slugifyFileName("proof.PNG")).toBe("proof.png");
    });

    it("handles uppercase extension with mixed-case name", () => {
      expect(slugifyFileName("BankTransfer.PDF")).toBe("banktransfer.pdf");
    });

    it("treats a leading dot as no extension (hidden file style)", () => {
      // ".gitignore" — lastDot is at index 0, so hasExt is false
      expect(slugifyFileName(".gitignore")).toBe("gitignore");
    });

    it("uses the last dot for extension when multiple dots exist", () => {
      expect(slugifyFileName("file.backup.tar.gz")).toBe("file-backup-tar.gz");
    });
  });

  describe("real-world filenames", () => {
    it("slugifies a typical WhatsApp image name", () => {
      expect(slugifyFileName("IMG-20260101-WA0012.jpg")).toBe(
        "img-20260101-wa0012.jpg",
      );
    });

    it("slugifies a scanned document with spaces and caps", () => {
      expect(slugifyFileName("Bank Transfer Proof.pdf")).toBe(
        "bank-transfer-proof.pdf",
      );
    });

    it("handles unicode/non-ascii by replacing with hyphens", () => {
      expect(slugifyFileName("résumé.pdf")).toBe("r-sum.pdf");
    });
  });
});
