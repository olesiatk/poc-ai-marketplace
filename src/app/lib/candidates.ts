import { ACTIVE_DATASET } from "../datasets/active";
import { expandQueryTerms, localHeuristicSearch } from "./search";
import { stem } from "./stem";
import type { ConceptGroups } from "./synonyms";
import type { MatchesMap, Product, ReviewsMap } from "../models/product.model";

/*
 * Retrieval for AI search (see groq.ts): which products the rerank call
 * gets to judge, how much of each one it sees, and reading back what it
 * answered. Pure and API-free, so it's unit-testable without a Groq key.
 */

// Sized so plan + rerank together fit the Groq per-minute token budget —
// see the comment at the top of groq.ts before raising any of these.
export const MAX_CANDIDATES = 32;
// The pool is cut off where retrieval scores fall away (below SCORE_FLOOR of
// the best score), but never shorter than this, padding from the planned
// categories only if retrieval found fewer. Narrow queries ("sunscreen SPF
// 30+") then send ~14 candidates instead of a full pool of filler.
export const MIN_CANDIDATES = 12;
const SCORE_FLOOR = 0.15;
const MIN_FLOOR_SCORE = 5;
// The best-ranked candidates go with description, features and reviews;
// the rest as a one-line title/brand/price (+ a review excerpt when one
// says something about the query).
export const RICH_CANDIDATES = 8;
// Keyword search's first page in the comparison (its page size on desktop)
// is always in the pool, whatever the category — the plan can miss one (lip
// balms filed under Bath & Body for "kissable pout") — so whatever AI
// leaves out of what the keyword side visibly shows, it actually looked at
// and turned down. Further down keyword search's list (to KEYWORD_TOP),
// only products in the planned categories that retrieval also found count:
// the rest is mostly noise (perfumes for "shampoo without fragrance").
export const KEYWORD_PAGE = 6;
export const KEYWORD_TOP = 15;

// Per-product text budget. Titles, descriptions and reviews in these
// catalogs run to hundreds or thousands of characters each — these caps
// keep a rich entry at roughly 150 tokens and a compact one at ~30.
const MAX_TITLE_CHARS = 120;
const MAX_COMPACT_TITLE_CHARS = 70;
const MAX_DESCRIPTION_CHARS = 160;
const MAX_FEATURES = 2;
const MAX_FEATURE_CHARS = 80;
const MAX_REVIEWS = 2;
const MAX_REVIEW_CHARS = 100;
const MAX_COMPACT_REVIEW_CHARS = 80;
export const MAX_PLAN_TERMS = 15;

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

/** What the plan call decides: where to look and which words to look for. */
export interface QueryPlan {
  /** Catalog categories to search in; empty = all of them. */
  categories: string[];
  /** Words and phrases a matching product's own text would likely use. */
  terms: string[];
}


function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Where `term` starts a word in `lower` ("love" also finds "loved"), or -1. */
function wordIndex(lower: string, term: string): number {
  return lower.search(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term.toLowerCase())}`, "u"));
}

/** How many of `terms` the text mentions. */
function relevance(text: string, terms: readonly string[]): number {
  const lower = text.toLowerCase();
  return terms.filter((t) => wordIndex(lower, t) >= 0).length;
}

/**
 * Up to `max` characters of `text`, starting a little before the first of
 * `terms` it mentions — so the sentence that makes a review relevant ("gave
 * it to my mom for her birthday") survives the cut even deep in a long one.
 */
function excerpt(text: string, terms: readonly string[], max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const lower = clean.toLowerCase();
  const hits = terms.map((t) => wordIndex(lower, t)).filter((i) => i >= 0);
  const first = hits.length ? Math.min(...hits) : 0;
  const start = first > max / 3 ? clean.lastIndexOf(" ", first - Math.floor(max / 3)) + 1 : 0;
  return (start > 0 ? "…" : "") + truncate(clean.slice(start), max);
}

function rankedIds(matches: MatchesMap): string[] {
  return [...matches.entries()].sort((a, b) => b[1].score - a[1].score).map(([id]) => id);
}

/**
 * Picks the products for the rerank call, best first: keyword search's
 * first page (whole catalog), its next results that are in the planned
 * categories and retrieval also found, then products in the plan's
 * categories (all, without a plan) ranked by local search with the plan's
 * terms added as synonyms of the query — up to MAX_CANDIDATES, stopping
 * early once scores fall below SCORE_FLOOR of the best one.
 */
export function selectCandidates(query: string, products: Product[], reviews: ReviewsMap, plan: QueryPlan | null): Product[] {
  const categories = new Set(plan?.categories);
  const inScope = (p: Product) => !categories.size || categories.has(p.category);
  const scope = products.filter(inScope);

  // A group made of the query's own words plus the plan's terms is always
  // "touched" by the query, so all the plan's terms join the expansion.
  const queryWords = expandQueryTerms(query, []).tokens;
  const groups: ConceptGroups = plan?.terms.length
    ? [...ACTIVE_DATASET.conceptGroups, [...queryWords, ...plan.terms]]
    : ACTIVE_DATASET.conceptGroups;
  const expanded = localHeuristicSearch(query, scope, reviews, groups);
  const score = (id: string) => expanded.get(id)?.score ?? 0;
  const byId = new Map(products.map((p) => [p.id, p]));

  const keyword = rankedIds(localHeuristicSearch(query, products, reviews, [])).slice(0, KEYWORD_TOP);
  const ids = new Set(keyword.slice(0, KEYWORD_PAGE));
  for (const id of keyword.slice(KEYWORD_PAGE)) if (inScope(byId.get(id)!) && expanded.has(id)) ids.add(id);

  const ranked = rankedIds(expanded);
  const floor = Math.max(MIN_FLOOR_SCORE, SCORE_FLOOR * score(ranked[0] ?? ""));
  for (const id of ranked) {
    if (ids.size >= MAX_CANDIDATES || (score(id) < floor && ids.size >= MIN_CANDIDATES)) break;
    ids.add(id);
  }
  for (const p of scope) {
    if (ids.size >= MIN_CANDIDATES) break;
    ids.add(p.id);
  }

  // Best first, so the rich entries go to the strongest candidates.
  return [...ids].sort((a, b) => score(b) - score(a)).map((id) => byId.get(id)!);
}

/** The rerank call's catalog: one text block, and which product each line number stands for. */
export interface CatalogText {
  text: string;
  /** ids[n - 1] is the product written as line n. */
  ids: string[];
}

/** No "|" inside a field, so a line splits cleanly. */
function field(text: string): string {
  return text.replace(/\|/g, "/");
}

/**
 * What the rerank call sees of each candidate, as plain lines grouped under
 * "## Category" headers rather than JSON objects (repeated keys were a
 * quarter of the tokens) and numbered 1..N rather than by 10-character
 * product id. Rich entries (the top RICH_CANDIDATES) carry features (F),
 * description (D) and the reviews most relevant to `queryWords` and
 * `planTerms` (R), cut around the mention — the first reviews in file order
 * are rarely the ones that say "my mom loved it as a birthday gift". The
 * rest get one review excerpt only if it says something the title doesn't:
 * a query word, or a plan term the title lacks.
 */
export function buildCatalog(
  candidates: Product[],
  reviews: ReviewsMap,
  queryWords: readonly string[] = [],
  planTerms: readonly string[] = []
): CatalogText {
  const terms = [...queryWords, ...planTerms];
  const lines = candidates.map((p, i) => {
    const texts = (reviews[p.id] || []).map((r) => `${r.title}. ${r.text}`);
    const head = `${i + 1} | ${field(truncate(p.title, i < RICH_CANDIDATES ? MAX_TITLE_CHARS : MAX_COMPACT_TITLE_CHARS))} | ${field(p.store)} | $${p.price}`;
    if (i >= RICH_CANDIDATES) {
      const title = p.title.toLowerCase();
      const fresh = [...queryWords, ...planTerms.filter((t) => wordIndex(title, t) < 0)];
      const best = texts.map((text) => ({ text, hits: relevance(text, fresh) })).sort((a, b) => b.hits - a.hits)[0];
      return best?.hits ? `${head} | R: ${field(excerpt(best.text, fresh, MAX_COMPACT_REVIEW_CHARS))}` : head;
    }
    // Stable sort: equally relevant reviews keep file order.
    const ranked = texts.map((text) => ({ text, hits: relevance(text, terms) })).sort((a, b) => b.hits - a.hits);
    return [
      head,
      ...p.features.slice(0, MAX_FEATURES).map((f) => `  F: ${field(truncate(f, MAX_FEATURE_CHARS))}`),
      `  D: ${field(truncate(p.description, MAX_DESCRIPTION_CHARS))}`,
      ...ranked.slice(0, MAX_REVIEWS).map((r) => `  R: ${field(excerpt(r.text, terms, MAX_REVIEW_CHARS))}`),
    ].join("\n");
  });

  // Grouped by category in order of each category's best candidate; line numbers keep the overall ranking.
  const groups = new Map<string, string[]>();
  candidates.forEach((p, i) => (groups.get(p.category) ?? groups.set(p.category, []).get(p.category)!).push(lines[i]));
  const text = [...groups].map(([category, entries]) => `## ${category}\n${entries.join("\n")}`).join("\n");
  return { text, ids: candidates.map((p) => p.id) };
}

/** Keeps only what's usable from a plan answer: real category names, short string terms. */
export function parsePlan(raw: Record<string, unknown>, categories: string[]): QueryPlan {
  const byLower = new Map(categories.map((c) => [c.toLowerCase(), c]));
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
  return {
    categories: [...new Set(strings(raw["categories"]).map((c) => byLower.get(c.trim().toLowerCase())).filter((c) => c !== undefined))],
    terms: [...new Set(strings(raw["terms"]).map((t) => t.trim().toLowerCase()))]
      .filter((t) => t.length >= 2 && t.length <= 40)
      .slice(0, MAX_PLAN_TERMS),
  };
}

/** One match as the rerank call returns it — unvalidated; `id` is a catalog line number. */
export interface RawMatch {
  id?: string | number;
  score?: number;
  keywords?: unknown;
}

// A match written out as the prompt's shape asks: "id", then "score", then "keywords".
const MATCH_RE = /"id"\s*:\s*"?([^",}\s]+)"?\s*,\s*"score"\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*"keywords"\s*:\s*(\[[^\]]*\])/g;

/**
 * Reads the rerank call's {"matches": [...]} answer. With long answers the
 * model sometimes runs every match together into ONE object
 * ({"id": a, "score": …, "id": b, …}) — still valid JSON, so Groq lets it
 * through, but JSON.parse keeps only the last duplicate key. When the text
 * holds more matches than the parse found, they're scanned out of the raw
 * text instead.
 */
export function parseMatches(content: string): RawMatch[] {
  const parsed: unknown = JSON.parse(content);
  const list = (parsed as { matches?: unknown })?.matches;
  const matches: RawMatch[] = Array.isArray(list) ? list : [];
  const written = [...content.matchAll(MATCH_RE)];
  if (written.length <= matches.length) return matches;
  return written.map(([, id, score, keywords]) => ({ id, score: Number(score), keywords: safeJson(keywords) }));
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}

// Asked for every fitting product, the model tends to pad the tail of the
// list with near-misses (an eyeshadow palette for "cologne") at low scores.
export const MIN_SCORE = 60;

/** Drops the low-score tail — unless nothing scores above it, so a weak query still shows its closest matches. */
export function dropWeakMatches<T extends { score: number }>(matches: T[]): T[] {
  return matches.some((m) => m.score >= MIN_SCORE) ? matches.filter((m) => m.score >= MIN_SCORE) : matches;
}

/**
 * Turns the model's keywords for one product into highlight terms. Exact
 * (yellow) = the query's own words as they occur in the product — taken
 * from keyword search's hits (`literalHits`), so word forms count the same
 * way on both sides. Synonym (green) = the model's phrases that bring in
 * something new: at least half their words aren't query words ("fragrance
 * free" for "without fragrance" stays, "blood red lipstick" for "red
 * lipstick" doesn't — its query words are already yellow), and no bare
 * prices or numbers.
 */
export function classifyKeywords(
  query: string,
  keywords: readonly string[],
  literalHits: ReadonlySet<string>
): { directTerms: Set<string>; synonymTerms: Set<string> } {
  const queryWords = expandQueryTerms(query, []).tokens;
  const queryStems = new Set(queryWords.map(stem));
  const synonymTerms = new Set<string>();
  for (const keyword of keywords) {
    const words = keyword.match(/[\p{L}\p{N}]+/gu) ?? [];
    const fresh = words.filter((w) => !queryStems.has(stem(w)));
    if (/\p{L}/u.test(keyword) && fresh.length > 0 && fresh.length * 2 >= words.length) synonymTerms.add(keyword);
  }
  const directTerms = new Set(literalHits);
  // Always leave highlighting something to work with.
  if (!directTerms.size && !synonymTerms.size) queryWords.forEach((w) => directTerms.add(w));
  return { directTerms, synonymTerms };
}
