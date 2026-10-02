import { describe, expect, it } from "vitest";
import { itemFormOptions, itemForms } from "./catalog";
import type { Product } from "../models/product.model";

function withForm(id: string, form?: unknown): Product {
  return {
    id,
    title: id,
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

  it("is empty when the product doesn't state a form", () => {
    expect(itemForms(withForm("a"))).toEqual([]);
    expect(itemForms(withForm("a", 42))).toEqual([]);
  });
});

describe("itemFormOptions", () => {
  it("lists only forms with enough products, alphabetically", () => {
    const products = [
      ...Array.from({ length: 5 }, (_, i) => withForm(`s${i}`, i % 2 ? "spray" : "Spray")),
      ...Array.from({ length: 6 }, (_, i) => withForm(`c${i}`, "Cream")),
      withForm("r", "Ribbon"),
    ];
    expect(itemFormOptions(products)).toEqual(["Cream", "Spray"]);
  });
});
