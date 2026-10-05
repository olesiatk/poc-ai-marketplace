import { describe, expect, it } from "vitest";
import { itemFormOptions, itemForms } from "./catalog";
import type { Product } from "../models/product.model";

function withForm(id: string, form?: unknown, title = id): Product {
  return {
    id,
    title,
    category: "Skin Care",
    store: "Acme",
    price: 10,
    averageRating: 4.5,
    ratingCount: 1,
    description: "",
    features: [],
    images: [],
    details: form === undefined ? {} : { "Item Form": form },
  };
}

describe("itemForms", () => {
  it("splits multi-form values and normalizes case and plurals", () => {
    expect(itemForms(withForm("a", "liquid, Cream,Gels"))).toEqual(["Liquid", "Cream", "Gel"]);
  });

  it("is empty when the product states no form and its title names none", () => {
    expect(itemForms(withForm("a"))).toEqual([]);
    expect(itemForms(withForm("a", 42))).toEqual([]);
  });

  it("falls back to the forms the title names when none is stated", () => {
    expect(itemForms(withForm("a", undefined, "Lavender Body Oil, 4 oz"))).toEqual(["Oil"]);
    expect(itemForms(withForm("a", undefined, "Oil-Free Daily Moisturizer"))).toEqual([]);
    // A stated form wins over the title.
    expect(itemForms(withForm("a", "Liquid", "Coconut Oil Shampoo"))).toEqual(["Liquid"]);
  });
});

describe("itemFormOptions", () => {
  it("lists only real product forms with enough products, alphabetically", () => {
    const products = [
      ...Array.from({ length: 5 }, (_, i) => withForm(`s${i}`, i % 2 ? "spray" : "Spray")),
      ...Array.from({ length: 6 }, (_, i) => withForm(`c${i}`, "Cream")),
      withForm("r", "Ribbon"),
      ...Array.from({ length: 6 }, (_, i) => withForm(`p${i}`, "Pair")),
    ];
    expect(itemFormOptions(products)).toEqual(["Cream", "Spray"]);
  });
});
