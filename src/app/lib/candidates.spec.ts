import { describe, expect, it } from "vitest";
import { MAX_CANDIDATES, MAX_PLAN_TERMS, MIN_CANDIDATES, RICH_CANDIDATES, similarTail, buildCatalog, classifyKeywords, dropWeakMatches, parseMatches, parsePlan, selectCandidates } from "./candidates";
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
    description: "A product.",
    features: ["One", "Two", "Three"],
    images: [],
    details: {},
    ...overrides,
  };
}

describe("parsePlan", () => {
  const categories = ["Skin Care", "Makeup"];

  it("keeps only real category names, matched case-insensitively", () => {
    const plan = parsePlan({ categories: ["makeup", "Lipsticks", 3, " Skin Care "], terms: [] }, categories);
    expect(plan.categories).toEqual(["Makeup", "Skin Care"]);
  });

  it("lowercases, dedupes and caps the terms, dropping non-strings", () => {
    const many = Array.from({ length: 30 }, (_, i) => `term ${i}`);
    expect(parsePlan({ terms: ["Acne", "acne ", 7, "x", ...many] }, categories).terms).toEqual(
      ["acne", ...many].slice(0, MAX_PLAN_TERMS)
    );
  });

  it("survives a malformed answer", () => {
    expect(parsePlan({ categories: "Makeup" }, categories)).toEqual({ categories: [], terms: [] });
  });
});

describe("selectCandidates", () => {
  const acnePatch = makeProduct({ id: "patch", title: "Pimple Patch", description: "Acne spot treatment." });
  const acneLipstick = makeProduct({ id: "lip", category: "Makeup", title: "Acne-Safe Lipstick" });
  const zitPopper = makeProduct({ id: "popper", title: "Zits Extractor Tool" });
  const filler = Array.from({ length: 60 }, (_, i) => makeProduct({ id: `f${i}`, title: `Filler ${i}` }));
  const catalog = [...filler, acneLipstick, acnePatch, zitPopper];

  it("looks only in the plan's categories, apart from keyword search's own top results", () => {
    const ids = selectCandidates("lipstick", catalog, {}, { categories: ["Makeup"], terms: [] }).map((p) => p.id);
    expect(ids).toEqual(["lip"]);
    const withKeywordHits = selectCandidates("acne", catalog, {}, { categories: ["Makeup"], terms: [] }).map((p) => p.id);
    expect(withKeywordHits).toEqual(expect.arrayContaining(["lip", "patch"]));
    expect(withKeywordHits).not.toContain("f0");
  });

  it("finds products by the plan's terms, not just the query's words", () => {
    const ids = selectCandidates("something for zits", catalog, {}, { categories: ["Skin Care"], terms: ["acne", "pimple"] }).map((p) => p.id);
    expect(ids.slice(0, 2)).toEqual(expect.arrayContaining(["patch", "popper"]));
    expect(ids).not.toContain("lip");
  });

  it("always includes keyword search's own top results, even outside the plan's categories", () => {
    const ids = selectCandidates("lipstick", catalog, {}, { categories: ["Skin Care"], terms: ["acne"] }).map((p) => p.id);
    expect(ids).toContain("lip");
  });

  it("keeps keyword search's first page whatever the category, but its next results only in the planned categories", () => {
    const makeup = Array.from({ length: 10 }, (_, i) => makeProduct({ id: `k${i}`, category: "Makeup", title: `Acne cover ${i}` }));
    const ids = selectCandidates("acne", [...makeup, acnePatch], {}, { categories: ["Skin Care"], terms: [] }).map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["k0", "k1", "k2", "k3", "k4", "k5", "patch"]));
    expect(ids).not.toContain("k6");
  });

  it("without a plan, searches the whole catalog, padding only up to the minimum pool", () => {
    const picked = selectCandidates("acne", catalog, {}, null);
    expect(picked).toHaveLength(MIN_CANDIDATES);
    expect(picked.slice(0, 2).map((p) => p.id)).toEqual(expect.arrayContaining(["patch", "lip"]));
  });

  it("stops where retrieval scores fall away instead of filling the pool", () => {
    const strong = Array.from({ length: 14 }, (_, i) =>
      makeProduct({ id: `s${i}`, title: `Acne Spot Patch ${i}`, description: "Acne patch for spot treatment.", features: ["acne", "patch"] })
    );
    const weak = Array.from({ length: 30 }, (_, i) => makeProduct({ id: `w${i}`, description: `Mentions acne once ${i}.` }));
    const picked = selectCandidates("acne patch", [...strong, ...weak], {}, null);
    expect(picked.length).toBeLessThan(MAX_CANDIDATES);
    expect(picked.filter((p) => p.id.startsWith("s"))).toHaveLength(14);
  });
});

describe("selectCandidates — with vector search", () => {
  const sunscreen = makeProduct({ id: "sun", title: "Sport Sunscreen Lotion SPF 30" });
  const fleece = makeProduct({ id: "fleece", title: "Ski Trip Fleece Headband" });
  const filler = Array.from({ length: 40 }, (_, i) => makeProduct({ id: `f${i}`, title: `Filler ${i}` }));

  it("brings in products close in meaning that share no word with the query", () => {
    const similarity = new Map([["sun", 0.6], ["fleece", 0.2], ...filler.map((p) => [p.id, 0.1] as [string, number])]);
    const ids = selectCandidates("ski trip", [fleece, sunscreen, ...filler], {}, null, similarity).map((p) => p.id);
    expect(ids).toContain("sun");
    expect(ids).toContain("fleece");
  });

  it("puts products that rank high both by words and by meaning first", () => {
    const similarity = new Map([["sun", 0.6], ["fleece", 0.55]]);
    const ids = selectCandidates("ski trip", [sunscreen, fleece, ...filler], {}, null, similarity).map((p) => p.id);
    expect(ids[0]).toBe("fleece");
  });
});

describe("similarTail", () => {
  const similarity = new Map([["a", 0.7], ["b", 0.6], ["c", 0.5], ["d", 0.65], ["e", 0.4], ["f", 0.62]]);

  it("adds unjudged products at least as close as the closest quarter of accepted matches", () => {
    // Accepted 0.7, 0.6, 0.5 → the cut sits at 0.65.
    const tail = similarTail(similarity, () => true, new Set(["a", "b", "c"]), ["a", "b", "c"]);
    expect(tail.map((t) => t.id)).toEqual(["d"]);
  });

  it("leaves out products the model already judged, and ones the filters exclude", () => {
    expect(similarTail(similarity, (id) => id !== "d", new Set(["a", "b", "c", "f"]), ["a", "b", "c"])).toEqual([]);
  });

  it("adds nothing when the model accepted nothing", () => {
    expect(similarTail(similarity, () => true, new Set(), [])).toEqual([]);
  });
});

describe("buildCatalog", () => {
  it("numbers the products in ranking order and groups them under category headers", () => {
    const products = [
      makeProduct({ id: "a", title: "Cream A" }),
      makeProduct({ id: "b", title: "Lipstick B", category: "Makeup" }),
      makeProduct({ id: "c", title: "Cream C" }),
    ];
    const { text, ids } = buildCatalog(products, {});
    expect(ids).toEqual(["a", "b", "c"]);
    expect(text.split("\n").filter((l) => /^(##|\d)/.test(l))).toEqual([
      "## Skin Care",
      "1 | Cream A | Acme | $10",
      "3 | Cream C | Acme | $10",
      "## Makeup",
      "2 | Lipstick B | Acme | $10",
    ]);
  });

  it("sends full detail for the top candidates and one line for the rest", () => {
    const products = Array.from({ length: RICH_CANDIDATES + 2 }, (_, i) => makeProduct({ id: `p${i}` }));
    const lines = buildCatalog(products, {}).text.split("\n");
    expect(lines).toContain("  F: One");
    expect(lines).toContain("  D: A product.");
    expect(lines.filter((l) => l.startsWith("  F:"))).toHaveLength(RICH_CANDIDATES * 2);
    expect(lines).toContain(`${RICH_CANDIDATES + 1} | Product | Acme | $10`);
  });

  it("keeps a field's own | out of the line format", () => {
    expect(buildCatalog([makeProduct({ title: "Gel | Cream" })], {}).text).toContain("1 | Gel / Cream | Acme");
  });
});

describe("buildCatalog — reviews", () => {
  const review = (id: string, text: string) => ({
    id,
    productId: "p0",
    rating: 5,
    title: "Nice",
    text,
    helpfulVotes: 0,
    verifiedPurchase: true,
    date: "2024-01-01",
    images: [],
  });
  const filler = "Arrived quickly and the packaging was fine. ".repeat(4);
  const reviews = {
    p0: [review("r1", "Works ok."), review("r2", "Smells nice."), review("r3", `${filler}I gave it to my mom for her birthday and she loved it.`)],
  };

  it("sends the reviews that mention the query first, cut around the mention", () => {
    const lines = buildCatalog([makeProduct({ id: "p0" })], reviews, ["birthday", "mom"]).text.split("\n");
    const firstReview = lines.find((l) => l.startsWith("  R:"))!;
    expect(firstReview).toMatch(/^ {2}R: ….*my mom for her birthday/);
    expect(firstReview.length).toBeLessThanOrEqual(106);
  });

  it("gives a one-line entry a review excerpt only when it says something the title doesn't", () => {
    const products = Array.from({ length: RICH_CANDIDATES }, (_, i) => makeProduct({ id: `x${i}` }));
    const last = (words: string[], terms: string[], title = "Product") =>
      buildCatalog([...products, makeProduct({ id: "p0", title })], reviews, words, terms).text.split("\n").pop()!;
    expect(last(["birthday"], [])).toMatch(/\| R: .*birthday/);
    expect(last(["lipstick"], [])).not.toContain("R:");
    // A plan term the title already has adds nothing.
    expect(last([], ["mom"], "Gift for Mom")).not.toContain("R:");
    expect(last([], ["mom"])).toContain("R:");
  });
});

describe("parseMatches", () => {
  it("reads a well-formed answer", () => {
    const answer = JSON.stringify({ matches: [{ id: "a", score: 90, keywords: ["x"] }, { id: "b", score: 80, keywords: [] }] });
    expect(parseMatches(answer).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("recovers every match when the model ran them together into one object", () => {
    const answer = '{"matches":[{"id":"a","score":92,"keywords":["Eau de Toilette","Men"],"id":"b","score":88,"keywords":["EDT"],"id":"c","score":70,"keywords":[]}]}';
    expect(parseMatches(answer)).toEqual([
      { id: "a", score: 92, keywords: ["Eau de Toilette", "Men"] },
      { id: "b", score: 88, keywords: ["EDT"] },
      { id: "c", score: 70, keywords: [] },
    ]);
  });
});

describe("parseMatches — line numbers", () => {
  it("recovers run-together matches whose ids are catalog line numbers", () => {
    const answer = '{"matches":[{"id":3,"score":92,"keywords":["eau de toilette"],"id":"7","score":80,"keywords":[]}]}';
    expect(parseMatches(answer)).toEqual([
      { id: "3", score: 92, keywords: ["eau de toilette"] },
      { id: "7", score: 80, keywords: [] },
    ]);
  });
});

describe("dropWeakMatches", () => {
  it("drops the low-score tail", () => {
    expect(dropWeakMatches([{ score: 90 }, { score: 60 }, { score: 55 }])).toEqual([{ score: 90 }, { score: 60 }]);
  });

  it("keeps the closest matches when nothing scores high", () => {
    expect(dropWeakMatches([{ score: 50 }, { score: 30 }])).toEqual([{ score: 50 }, { score: 30 }]);
  });
});

describe("classifyKeywords", () => {
  it("highlights the query's own words as exact, from keyword search's hits", () => {
    const { directTerms, synonymTerms } = classifyKeywords("red lipstick", ["blood red lipstick", "matte waterproof"], new Set(["red", "lipstick"]));
    expect(directTerms).toEqual(new Set(["red", "lipstick"]));
    expect(synonymTerms).toEqual(new Set(["matte waterproof"]));
  });

  it("keeps a phrase that's at least half new words as a synonym", () => {
    expect(classifyKeywords("shampoo without fragrance", ["fragrance free", "shampoo"], new Set()).synonymTerms).toEqual(new Set(["fragrance free"]));
  });

  it("drops bare prices and phrases made only of query words", () => {
    expect(classifyKeywords("thinning hair", ["thinning hair", "$12.95", "hair loss"], new Set(["thinning"])).synonymTerms).toEqual(new Set(["hair loss"]));
  });

  it("falls back to the query words when there's nothing else to highlight", () => {
    expect(classifyKeywords("zits", ["$5"], new Set()).directTerms).toEqual(new Set(["zits"]));
  });
});
