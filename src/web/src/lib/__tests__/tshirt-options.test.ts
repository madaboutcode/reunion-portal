/**
 * QA Case 8 (R17): gender-gated t-shirt size picker.
 *
 * Male/null → 10 sizes, XS through 6XL.
 * Female → 10 sizes, 2XS through 5XL.
 * Union of both lists → 11 values.
 */

import { describe, it, expect } from "vitest";
import { getTshirtOptions, MENS_TSHIRT_SIZES, WOMENS_TSHIRT_SIZES } from "../tshirt-options";

describe("getTshirtOptions", () => {
  it("returns 10 sizes XS through 6XL for gender 'male'", () => {
    const options = getTshirtOptions("male");
    expect(options).toHaveLength(10);
    expect(options.map((o) => o.value)).toEqual([
      "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL",
    ]);
  });

  it("returns the men's size set for null/undefined gender", () => {
    expect(getTshirtOptions(null)).toEqual(MENS_TSHIRT_SIZES);
    expect(getTshirtOptions(undefined)).toEqual(MENS_TSHIRT_SIZES);
  });

  it("returns 10 sizes 2XS through 5XL for gender 'female'", () => {
    const options = getTshirtOptions("female");
    expect(options).toHaveLength(10);
    expect(options.map((o) => o.value)).toEqual([
      "2XS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL",
    ]);
  });

  it("men's and women's size lists are exported, distinct, and union to 11 values", () => {
    expect(MENS_TSHIRT_SIZES).toHaveLength(10);
    expect(WOMENS_TSHIRT_SIZES).toHaveLength(10);
    expect(MENS_TSHIRT_SIZES).not.toEqual(WOMENS_TSHIRT_SIZES);

    const union = new Set([
      ...MENS_TSHIRT_SIZES.map((o) => o.value),
      ...WOMENS_TSHIRT_SIZES.map((o) => o.value),
    ]);
    expect(union).toEqual(
      new Set(["2XS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"]),
    );
    expect(union.size).toBe(11);
  });
});
