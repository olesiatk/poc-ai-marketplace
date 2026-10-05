import { describe, expect, it } from "vitest";
import { parseQueryFilters } from "./query-filters";

const CATEGORIES = ["Skin Care", "Hair Care", "Fragrance", "Makeup", "Makeup Tools", "Bath & Body"];
const FORMS = ["Cream", "Gel", "Liquid", "Lotion", "Oil"];
const parse = (q: string) => parseQueryFilters(q, CATEGORIES, FORMS);

describe("parseQueryFilters", () => {
  it("doesn't filter on a product word the query merely uses", () => {
    expect(parse("hydrating face cream")).toEqual({ maxPrice: null, categories: [], itemForms: [], text: "hydrating face cream" });
    expect(parse("hair care for curls").categories).toEqual([]);
    expect(parse("which category is best").categories).toEqual([]);
  });

  it("filters on a value named next to \"form\" / \"category\", either side", () => {
    expect(parse("moisturizer, cream form").itemForms).toEqual(["Cream"]);
    expect(parse("moisturizer form: cream").itemForms).toEqual(["Cream"]);
    expect(parse("moisturizer form - cream").itemForms).toEqual(["Cream"]);
    expect(parse("category hair care, frizz").categories).toEqual(["Hair Care"]);
    expect(parse("something for frizz in the hair care category").categories).toEqual(["Hair Care"]);
  });

  it("leaves the filter phrases out of the words to search for", () => {
    expect(parse("form cream or liquid foundation for dry skin").text).toBe("foundation for dry skin");
    expect(parse("category hair care: anti-frizz serum").text).toBe(": anti-frizz serum");
  });

  it("takes several listed values", () => {
    expect(parse("form cream or liquid").itemForms).toEqual(["Cream", "Liquid"]);
    expect(parse("cream, gel or lotion forms").itemForms).toEqual(["Cream", "Gel", "Lotion"]);
    expect(parse("gift, category bath and body or fragrance").categories).toEqual(["Fragrance", "Bath & Body"]);
  });

  it("prefers the longer name and keeps \"&\" inside a name", () => {
    expect(parse("category makeup tools").categories).toEqual(["Makeup Tools"]);
    expect(parse("category bath & body").categories).toEqual(["Bath & Body"]);
  });

  it("reads all three at once", () => {
    expect(parse("moisturizer under $25, skin care category, cream or lotion form")).toEqual({
      maxPrice: 25,
      categories: ["Skin Care"],
      itemForms: ["Cream", "Lotion"],
      text: "moisturizer",
    });
  });
});
