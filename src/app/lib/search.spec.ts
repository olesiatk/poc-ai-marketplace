import { describe, expect, it } from "vitest";
import { countQueryWords, expandQueryTerms, highlightHtml, localHeuristicSearch, tokenize } from "./search";
import type { Product, Review, ReviewsMap } from "../models/product.model";

// Fixed test groups rather than the active dataset's — keeps these specs
// independent of whichever catalog the app is currently pointed at.
const GROUPS = [
  ["moisturizing", "hydrating", "nourishing", "dry skin", "soft skin"],
  ["anti-aging", "wrinkles", "fine lines", "firming"],
  ["gentle", "sensitive skin", "soothing"],
];

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

function makeReview(overrides: Partial<Review>): Review {
  return {
    id: "r-1",
    productId: "p-1",
    rating: 5,
    title: "",
    text: "",
    helpfulVotes: 0,
    verifiedPurchase: true,
    date: "2021-01-01T00:00:00.000Z",
    images: [],
    ...overrides,
  };
}

describe("expandQueryTerms", () => {
  it("keeps the literal tokens untouched", () => {
    const { tokens } = expandQueryTerms("a hydrating face cream", GROUPS);
    expect(tokens).toEqual(["hydrating", "face", "cream"]);
  });

  it("leaves price mentions out — they're a filter, not words to match", () => {
    const { tokens } = expandQueryTerms("face cream under $20 for dry skin", GROUPS);
    expect(tokens).toEqual(["face", "cream", "dry", "skin"]);
  });

  it("expands a single-word concept to its synonyms and contextual phrases", () => {
    const { expansions } = expandQueryTerms("hydrating cream", GROUPS);
    expect(expansions).toEqual(expect.arrayContaining(["moisturizing", "nourishing", "dry skin", "soft skin"]));
    // The literal token itself shouldn't be duplicated into the expansion list.
    expect(expansions).not.toContain("hydrating");
  });

  it("expands a multi-word phrase in the raw query even though it isn't a single token", () => {
    const { expansions } = expandQueryTerms("something for dry skin", GROUPS);
    expect(expansions).toEqual(expect.arrayContaining(["moisturizing", "hydrating"]));
  });

  it("expands a hyphenated term in the query, which the tokenizer splits apart", () => {
    const { expansions } = expandQueryTerms("anti-aging serum", GROUPS);
    expect(expansions).toEqual(expect.arrayContaining(["wrinkles", "fine lines", "firming"]));
    expect(expansions).not.toContain("anti-aging");
  });

  it("only expands concepts the query actually touches", () => {
    const { expansions } = expandQueryTerms("a gentle cleanser", GROUPS);
    expect(expansions).toEqual(expect.arrayContaining(["sensitive skin", "soothing"]));
    expect(expansions).not.toEqual(expect.arrayContaining(["moisturizing", "wrinkles"]));
  });
});

describe("localHeuristicSearch — synonym & contextual recall", () => {
  const moisturizer = makeProduct({
    id: "skin-01",
    title: "Daily Face Moisturizer",
    features: ["Nourishing formula for soft skin"],
    description: "A lightweight moisturizing cream for everyday use.",
  });
  const shampoo = makeProduct({
    id: "hair-01",
    title: "Clarifying Shampoo",
    category: "Hair Care",
    description: "Removes buildup and leaves hair clean.",
  });
  const products = [moisturizer, shampoo];
  const reviews: ReviewsMap = {};

  it("finds nothing for the literal query word alone (sanity baseline)", () => {
    // The catalog text never says "hydrating" — plain matching on the
    // literal token alone would hit nothing.
    const rawTokenHits = products.filter((p) =>
      `${p.title} ${p.features.join(" ")} ${p.description}`.toLowerCase().includes("hydrating")
    );
    expect(rawTokenHits).toHaveLength(0);
  });

  it("matches a product via synonym expansion even when the literal query word never appears in the catalog", () => {
    const matches = localHeuristicSearch("hydrating", products, reviews, GROUPS);
    expect(matches.has("skin-01")).toBe(true);
    expect(matches.has("hair-01")).toBe(false);
  });

  it("matches a product via a contextual multi-word phrase", () => {
    const matches = localHeuristicSearch("something for soft skin", products, reviews, GROUPS);
    expect(matches.has("skin-01")).toBe(true);
  });

  it("records the matched synonym term (not the original query word) as a synonym term, not a direct term", () => {
    const matches = localHeuristicSearch("hydrating", products, reviews, GROUPS);
    const info = matches.get("skin-01")!;
    expect(info.synonymTerms.has("moisturizing")).toBe(true);
    expect(info.synonymTerms.has("nourishing")).toBe(true);
    expect(info.directTerms.size).toBe(0);
  });

  it("ranks a literal keyword match above a synonym-only match", () => {
    const literalOnly = makeProduct({ id: "literal", title: "Hydrating Serum", description: "A hydrating serum." });
    const synonymOnly = makeProduct({ id: "synonym", title: "Moisturizing Serum", description: "A moisturizing serum." });
    const matches = localHeuristicSearch("hydrating", [literalOnly, synonymOnly], reviews, GROUPS);
    expect(matches.get("literal")!.score).toBeGreaterThan(matches.get("synonym")!.score);
  });

  it("uses whole-word matching, not raw substring containment", () => {
    // "tan" is a substring of "important" — a naive `.includes()` check
    // would wrongly count a "tan" query as matching this product.
    const product = makeProduct({ id: "p-tan", description: "An important step in any routine." });
    const matches = localHeuristicSearch("tan", [product], reviews, GROUPS);
    expect(matches.has("p-tan")).toBe(false);
  });
});

describe("localHeuristicSearch — stemming", () => {
  const reviews: ReviewsMap = {};
  const antiFrizz = makeProduct({ id: "p-frizz", title: "Anti-Frizz Serum", description: "Tames frizz in humid weather." });

  it("matches other forms of a query word (\"frizzy\" finds \"frizz\")", () => {
    expect(localHeuristicSearch("frizzy", [antiFrizz], reviews, []).has("p-frizz")).toBe(true);
  });

  it("highlights the word forms as they appear in the product, not the query's form", () => {
    const info = localHeuristicSearch("frizzy", [antiFrizz], reviews, []).get("p-frizz")!;
    expect(info.directTerms).toEqual(new Set(["frizz"]));
  });

  it("matches a hyphenated phrase against the same words written with a hyphen", () => {
    const matches = localHeuristicSearch("something anti-frizz", [antiFrizz], reviews, [["smooth", "anti-frizz"]]);
    expect(matches.has("p-frizz")).toBe(true);
  });

  it("with no concept groups, does not bridge synonyms (the keyword-search baseline)", () => {
    const fragranceFree = makeProduct({ id: "p-ff", title: "Fragrance-Free Lotion" });
    expect(localHeuristicSearch("unscented", [fragranceFree], reviews, []).size).toBe(0);
    expect(localHeuristicSearch("unscented", [fragranceFree], reviews, [["unscented", "fragrance-free"]]).has("p-ff")).toBe(true);
  });
});

describe("localHeuristicSearch — any word vs. all words", () => {
  const reviews: ReviewsMap = {};
  const faceCream = makeProduct({ id: "p-cream", title: "Hydrating Face Cream" });
  const handCream = makeProduct({ id: "p-hand", title: "Hand Cream" });

  it("matches a product with any query word, flagging the ones with all of them", () => {
    const matches = localHeuristicSearch("hydrating face creams", [faceCream, handCream], reviews, []);
    expect(matches.get("p-cream")?.matchesAllWords).toBe(true);
    expect(matches.get("p-hand")?.matchesAllWords).toBe(false);
  });

  it("doesn't count a synonym hit as one of the query's words", () => {
    const moisturizing = makeProduct({ id: "p-moist", title: "Moisturizing Face Cream" });
    const matches = localHeuristicSearch("hydrating face cream", [moisturizing], reviews, GROUPS);
    expect(matches.get("p-moist")?.matchesAllWords).toBe(false);
  });

  it("counts distinct query words by stem, leaving out stopwords and prices", () => {
    expect(countQueryWords("cream creams for my face under $20")).toBe(2);
    expect(countQueryWords("unscented")).toBe(1);
  });
});

describe("localHeuristicSearch — searchable fields", () => {
  const reviews: ReviewsMap = {};

  it("matches on the brand", () => {
    const product = makeProduct({ id: "p-brand", store: "Glowco" });
    expect(localHeuristicSearch("glowco", [product], reviews, GROUPS).has("p-brand")).toBe(true);
  });

  it("matches on the category", () => {
    const product = makeProduct({ id: "p-cat", category: "Fragrance" });
    expect(localHeuristicSearch("fragrance", [product], reviews, GROUPS).has("p-cat")).toBe(true);
  });

  it("matches on a feature bullet", () => {
    const product = makeProduct({ id: "p-feat", features: ["Paraben free and vegan"] });
    expect(localHeuristicSearch("vegan", [product], reviews, GROUPS).has("p-feat")).toBe(true);
  });

  it("matches on a review's title as well as its text", () => {
    const product = makeProduct({ id: "p-rev" });
    const withReviews: ReviewsMap = {
      "p-rev": [makeReview({ productId: "p-rev", title: "Life changing", text: "Cleared up my skin." })],
    };
    expect(localHeuristicSearch("changing", [product], withReviews, GROUPS).has("p-rev")).toBe(true);
    expect(localHeuristicSearch("cleared", [product], withReviews, GROUPS).has("p-rev")).toBe(true);
  });

  it("weights a title hit above a description-only hit", () => {
    const inTitle = makeProduct({ id: "title", title: "Retinol Night Cream" });
    const inDescription = makeProduct({ id: "desc", description: "Contains retinol." });
    const matches = localHeuristicSearch("retinol", [inTitle, inDescription], reviews, GROUPS);
    expect(matches.get("title")!.score).toBeGreaterThan(matches.get("desc")!.score);
  });

  it("returns no matches for a query made only of stopwords", () => {
    const product = makeProduct({ id: "p-1", description: "for the win" });
    expect(localHeuristicSearch("for the", [product], reviews, GROUPS).size).toBe(0);
  });
});

describe("tokenize", () => {
  it("drops stopwords and short tokens", () => {
    expect(tokenize("I want a gentle moisturizer for my dry skin")).toEqual([
      "gentle", "moisturizer", "dry", "skin",
    ]);
  });
});

describe("highlightHtml", () => {
  it("highlights an exact/direct term in yellow (class \"hl\")", () => {
    const html = highlightHtml("A hydrating cream.", new Set(["hydrating"]), null);
    expect(html).toBe('A <mark class="hl">hydrating</mark> cream.');
  });

  it("highlights a synonym/expanded term in light green (class \"hl-synonym\")", () => {
    const html = highlightHtml("A nourishing cream for dry skin.", null, new Set(["nourishing", "dry skin"]));
    expect(html).toBe(
      'A <mark class="hl-synonym">nourishing</mark> cream for <mark class="hl-synonym">dry skin</mark>.'
    );
  });

  it("highlights direct and synonym terms differently within the same text", () => {
    const html = highlightHtml(
      "A hydrating and nourishing cream.",
      new Set(["hydrating"]),
      new Set(["nourishing"])
    );
    expect(html).toBe('A <mark class="hl">hydrating</mark> and <mark class="hl-synonym">nourishing</mark> cream.');
  });

  it("escapes HTML in the source text", () => {
    const html = highlightHtml("<script>alert(1)</script>", new Set(["alert"]), null);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("returns escaped text unchanged when there are no terms", () => {
    expect(highlightHtml("Plain text", null, null)).toBe("Plain text");
  });
});
