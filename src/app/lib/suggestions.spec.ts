import { describe, expect, it } from "vitest";
import { EXAMPLE_QUERIES, buildVocabulary, getSuggestions } from "./suggestions";
import type { Product } from "../models/product.model";

function makeProduct(overrides: Partial<Product>): Product {
  return {
    id: "p-1",
    title: "Product",
    category: "Skin Care",
    store: "Acme",
    price: 10,
    averageRating: 4.5,
    ratingCount: 100,
    description: "",
    features: [],
    images: [],
    details: {},
    ...overrides,
  };
}

// "moisturizer" recurs across 3 titles, so it's common enough to be offered as a completion.
const products = [
  makeProduct({ id: "p-1", title: "Daily Moisturizer for Face" }),
  makeProduct({ id: "p-2", title: "Night Moisturizer with Retinol" }),
  makeProduct({ id: "p-3", title: "Moisturizer SPF 30" }),
  makeProduct({ id: "p-4", title: "Rare Unicornium Serum", category: "Hair Care", store: "Glowco" }),
];
const groups = [["hydrating", "moisturizing", "dry skin"]];
const vocabulary = buildVocabulary(products, groups);

describe("getSuggestions", () => {
  it("returns the curated example queries when the input is empty", () => {
    const suggestions = getSuggestions("", vocabulary);
    expect(suggestions.map((s) => s.query)).toEqual(EXAMPLE_QUERIES.slice(0, suggestions.length));
    // Clicking one fills the input with exactly that query.
    expect(suggestions[0].completion).toBe(suggestions[0].query);
  });

  it("completes a partial word from the catalog vocabulary", () => {
    const suggestions = getSuggestions("moist", vocabulary);
    const match = suggestions.find((s) => s.query === "moisturizer");
    expect(match).toBeDefined();
    expect(match!.completion).toBe("urizer");
  });

  it("preserves the already-typed prefix when completing the last word", () => {
    const suggestions = getSuggestions("a gentle moist", vocabulary);
    const match = suggestions.find((s) => s.query === "a gentle moisturizer");
    expect(match).toBeDefined();
    expect(match!.completion).toBe("urizer");
  });

  it("suggests a next word once the current word is finished (trailing space)", () => {
    const suggestions = getSuggestions("hydrating ", vocabulary);
    expect(suggestions.length).toBeGreaterThan(0);
    suggestions.forEach((s) => {
      expect(s.query.startsWith("hydrating ")).toBe(true);
      expect(s.query.length).toBeGreaterThan("hydrating ".length);
      // Regression: trailing whitespace on the input must not leak into a
      // double space between the typed word and the suggested next word.
      expect(s.query).not.toContain("  ");
    });
  });

  it("never suggests the query the user already typed verbatim", () => {
    const suggestions = getSuggestions("moisturizer", vocabulary);
    expect(suggestions.some((s) => s.query.toLowerCase() === "moisturizer")).toBe(false);
  });

  it("surfaces a matching example query as a suggestion", () => {
    const prefix = EXAMPLE_QUERIES[0].slice(0, Math.ceil(EXAMPLE_QUERIES[0].length / 2));
    const suggestions = getSuggestions(prefix, vocabulary);
    expect(suggestions.some((s) => s.query === EXAMPLE_QUERIES[0])).toBe(true);
  });
});

describe("buildVocabulary", () => {
  it("includes categories, brands, synonyms and recurring title words in the completion pool", () => {
    expect(vocabulary.terms).toEqual(
      expect.arrayContaining(["skin care", "hair care", "acme", "glowco", "hydrating", "dry skin", "moisturizer"])
    );
  });

  it("leaves out title words that only appear in a single product", () => {
    expect(vocabulary.terms).not.toContain("unicornium");
  });

  it("puts categories and one headword per concept group in the next-word pool", () => {
    expect(vocabulary.nextWordTerms).toEqual(expect.arrayContaining(["skin care", "hair care", "hydrating"]));
    expect(vocabulary.nextWordTerms).not.toContain("moisturizing");
  });
});
