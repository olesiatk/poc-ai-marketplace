import { ACTIVE_DATASET } from "../datasets/active";
import { stem } from "./stem";
import { expandConcepts, type ConceptGroups } from "./synonyms";
import type { MatchesMap, Product, ReviewsMap } from "../models/product.model";

const STOPWORDS = new Set([
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
  "want", "wants", "wanted", "need", "needs", "needed", "looking", "look", "for",
  "the", "a", "an", "and", "or", "but", "that", "this", "these", "those",
  "in", "on", "at", "to", "from", "by", "with", "without", "about", "into",
  "my", "your", "our", "their", "his", "its", "some", "any", "very", "really",
  "please", "would", "like", "something", "someone", "just", "can", "could",
]);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9']+/gi) || []).filter(
    (t) => t.length >= 3 && !STOPWORDS.has(t)
  );
}

export interface ExpandedQuery {
  /** Literal tokens extracted from the query itself. */
  tokens: string[];
  /**
   * Synonyms and contextual phrases pulled in via concept expansion (e.g.
   * "hydrating" → "moisturizing", "dry skin") that aren't already literal
   * query tokens.
   */
  expansions: string[];
}

/**
 * Expands a raw query into its literal tokens plus any related synonyms and
 * contextual phrases from the catalog's concept groups, so matching isn't
 * limited to exact lexical strings.
 */
export function expandQueryTerms(query: string, groups: ConceptGroups = ACTIVE_DATASET.conceptGroups): ExpandedQuery {
  const tokens = tokenize(query);
  const expansions = expandConcepts(new Set(tokens), query.toLowerCase(), groups);
  return { tokens, expansions: [...expansions] };
}

interface FieldWeights {
  title: number;
  features: number;
  category: number;
  brand: number;
  desc: number;
  review: number;
}

// Full weight for a term the user actually typed.
const DIRECT_WEIGHTS: FieldWeights = { title: 3, features: 2, category: 2, brand: 2, desc: 1, review: 1 };
// Reduced weight for a term pulled in via synonym/phrase expansion, so
// exact matches still rank above inferred ones.
const SYNONYM_WEIGHTS: FieldWeights = { title: 2, features: 1, category: 1, brand: 1, desc: 1, review: 1 };

const FIELDS = Object.keys(DIRECT_WEIGHTS) as (keyof FieldWeights)[];

interface FieldIndex {
  /** Stems of every word in the field, for single-word lookups. */
  stems: Set<string>;
  /** The field's stems joined as " a b c ", for multi-word phrase lookups on word boundaries. */
  sequence: string;
}

interface ProductIndex {
  fields: Record<keyof FieldWeights, FieldIndex>;
  /** Stem → the actual word forms it came from in this product's text, so a hit can be highlighted as written. */
  surfaces: Map<string, Set<string>>;
}

// Built once per product rather than on every search — the catalog is static after load.
const indexCache = new WeakMap<Product, ProductIndex>();

function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function productIndex(product: Product, reviews: ReviewsMap): ProductIndex {
  let index = indexCache.get(product);
  if (index) return index;

  const text: Record<keyof FieldWeights, string> = {
    title: product.title,
    features: product.features.join(" "),
    category: product.category,
    brand: product.store,
    desc: product.description,
    review: (reviews[product.id] || []).map((r) => `${r.title} ${r.text}`).join(" "),
  };
  const surfaces = new Map<string, Set<string>>();
  const fields = {} as ProductIndex["fields"];
  for (const field of FIELDS) {
    const stems = words(text[field]).map((word) => {
      const s = stem(word);
      if (!surfaces.has(s)) surfaces.set(s, new Set());
      surfaces.get(s)!.add(word);
      return s;
    });
    fields[field] = { stems: new Set(stems), sequence: ` ${stems.join(" ")} ` };
  }
  index = { fields, surfaces };
  indexCache.set(product, index);
  return index;
}

interface TermMatcher {
  term: string;
  weights: FieldWeights;
  isSynonym: boolean;
  /** Set for single words; phrases (spaces/hyphens) are matched against the stem sequence instead. */
  stem: string | null;
  phrase: string | null;
}

function termMatcher(term: string, weights: FieldWeights, isSynonym: boolean): TermMatcher {
  const parts = words(term).map(stem);
  return parts.length === 1
    ? { term, weights, isSynonym, stem: parts[0], phrase: null }
    : { term, weights, isSynonym, stem: null, phrase: ` ${parts.join(" ")} ` };
}

function fieldHit(field: FieldIndex, matcher: TermMatcher): boolean {
  return matcher.stem !== null ? field.stems.has(matcher.stem) : field.sequence.includes(matcher.phrase!);
}

/**
 * The word forms to highlight for a hit: for a single word, every form of
 * it that actually occurs in the product ("frizz", "frizzy" for a "frizzy"
 * query); for a phrase, the phrase as written plus its hyphen/space twin
 * ("anti-frizz" ↔ "anti frizz").
 */
function highlightForms(matcher: TermMatcher, index: ProductIndex): string[] {
  if (matcher.stem !== null) return [...(index.surfaces.get(matcher.stem) ?? [matcher.term])];
  return [...new Set([matcher.term, matcher.term.replace(/-/g, " "), matcher.term.replace(/ /g, "-")])];
}

/**
 * Client-side relevance search. Matching is on word stems, so word forms
 * of the same word match each other ("frizzy"/"frizz") — like any standard
 * full-text engine. With `groups` (the catalog's concept groups) it also
 * expands the query with synonyms and contextual phrases for a lightweight
 * semantic-ish recall boost; with no groups (`[]`) it's plain keyword
 * search — the "without AI" side of the search comparison. Also used to
 * pre-select the candidates sent to Groq, and as its fallback.
 */
export function localHeuristicSearch(
  query: string,
  products: Product[],
  reviews: ReviewsMap,
  groups: ConceptGroups = ACTIVE_DATASET.conceptGroups
): MatchesMap {
  const { tokens, expansions } = expandQueryTerms(query, groups);
  const matches: MatchesMap = new Map();
  if (!tokens.length) return matches;

  const matchers = [
    ...tokens.map((term) => termMatcher(term, DIRECT_WEIGHTS, false)),
    ...expansions.map((term) => termMatcher(term, SYNONYM_WEIGHTS, true)),
  ];
  // A synonym that stems to the same thing as a literal query word adds nothing new.
  const directStems = new Set(matchers.filter((m) => !m.isSynonym).map((m) => m.stem));
  const effective = matchers.filter((m) => !m.isSynonym || m.stem === null || !directStems.has(m.stem));

  for (const product of products) {
    const index = productIndex(product, reviews);
    let score = 0;
    const directTerms = new Set<string>();
    const synonymTerms = new Set<string>();

    for (const matcher of effective) {
      let hit = false;
      for (const field of FIELDS) {
        if (fieldHit(index.fields[field], matcher)) {
          score += matcher.weights[field];
          hit = true;
        }
      }
      if (hit) {
        const target = matcher.isSynonym ? synonymTerms : directTerms;
        highlightForms(matcher, index).forEach((form) => target.add(form));
      }
    }

    if (score > 0) matches.set(product.id, { score, directTerms, synonymTerms });
  }

  return matches;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c] as string);
}

const HIGHLIGHT_CLASS = {
  exact: "hl",
  synonym: "hl-synonym",
} as const;

/**
 * Escapes `text` and wraps any occurrence of a term from `directTerms` or
 * `synonymTerms` (Unicode-aware word boundaries) in a <mark>: yellow
 * (`hl`) for an exact query-word match, light green (`hl-synonym`) for a
 * term pulled in via synonym/phrase expansion. Returns an HTML string
 * suitable for [innerHTML].
 */
export function highlightHtml(
  text: string | null | undefined,
  directTerms: Set<string> | null | undefined,
  synonymTerms: Set<string> | null | undefined
): string {
  const escaped = escapeHtml(text ?? "");

  const classByTerm = new Map<string, keyof typeof HIGHLIGHT_CLASS>();
  (directTerms ?? []).forEach((t) => t && classByTerm.set(t.toLowerCase(), "exact"));
  (synonymTerms ?? []).forEach((t) => {
    // A term is never in both sets by construction, but favor "exact" defensively.
    if (t && !classByTerm.has(t.toLowerCase())) classByTerm.set(t.toLowerCase(), "synonym");
  });
  if (!classByTerm.size) return escaped;

  const pattern = [...classByTerm.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  if (!pattern) return escaped;

  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${pattern})(?![\\p{L}\\p{N}])`, "giu");
  return escaped.replace(re, (match) => {
    const kind = classByTerm.get(match.toLowerCase()) ?? "exact";
    return `<mark class="${HIGHLIGHT_CLASS[kind]}">${match}</mark>`;
  });
}

export function wordFormProducts(n: number): string {
  return n === 1 ? "product" : "products";
}

export function wordFormMatches(n: number): string {
  return n === 1 ? "match" : "matches";
}
