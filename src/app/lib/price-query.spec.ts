import { describe, expect, it } from "vitest";
import { parsePriceQuery } from "./price-query";

describe("parsePriceQuery", () => {
  it.each([
    ["gift set under $25", 25, "gift set"],
    ["shampoo under 20 dollars for curly hair", 20, "shampoo for curly hair"],
    ["cheap face cream below $15.50 please", 15.5, "cheap face cream please"],
    ["mascara less than 10 bucks", 10, "mascara"],
    ["serum up to $1,200", 1200, "serum"],
    ["lipstick max 12", 12, "lipstick"],
    ["moisturizer $20 for dry skin", 20, "moisturizer for dry skin"],
    ["nail polish 8$", 8, "nail polish"],
    ["perfume between $30 and $50", 50, "perfume"],
    ["perfume between 30 and 50", 50, "perfume"],
    ["brush set $10-25", 25, "brush set"],
    ["conditioner from $5 to $15 without sulfates", 15, "conditioner from without sulfates"],
    ["under $30 or under $20 shampoo", 30, "or shampoo"],
    ["hydrating face cream over $10, $20, $30", 30, "hydrating face cream , ,"],
  ])("%s → max %s", (query, maxPrice, text) => {
    expect(parsePriceQuery(query)).toEqual({ maxPrice, text });
  });

  it.each([
    ["shampoo under 16 oz", "shampoo under 16 oz"],
    ["2 in 1 shampoo", "2 in 1 shampoo"],
    ["spf 50 sunscreen", "spf 50 sunscreen"],
    ["pack of 3 to 5 items", "pack of 3 to 5 items"],
    ["dries in under 10 minutes", "dries in under 10 minutes"],
  ])("ignores non-price numbers: %s", (query, text) => {
    expect(parsePriceQuery(query)).toEqual({ maxPrice: null, text });
  });

  it("strips a lower bound without setting a max", () => {
    expect(parsePriceQuery("luxury perfume over $100")).toEqual({ maxPrice: null, text: "luxury perfume" });
    expect(parsePriceQuery("perfume more than 100 dollars")).toEqual({ maxPrice: null, text: "perfume" });
  });

  it("combines a lower bound with an upper one", () => {
    expect(parsePriceQuery("at least $10 but under $40 cream")).toEqual({ maxPrice: 40, text: "but cream" });
  });
});
