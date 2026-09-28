import { ACTIVE_DATASET } from "../datasets/active";
import { tokenize } from "./search";
import type { ConceptGroups } from "./synonyms";
import type { Product } from "../models/product.model";

/** Shown as clickable prompts when the search box is focused and still empty. */
export const EXAMPLE_QUERIES: readonly string[] = ACTIVE_DATASET.presetQueries.map((p) => p.query);

// A title word has to recur across at least this many products to be
// offered as a completion — keeps one-off model numbers and brand-specific
// jargon out of the list.
const MIN_TITLE_WORD_PRODUCTS = 3;

export interface SearchVocabulary {
  /** Full pool (common title words, categories, brands, every synonym) used to complete a word that's still being typed. */
  terms: string[];
  /** A smaller, curated pool (categories + one headword per concept) suggested once a word is finished. */
  nextWordTerms: string[];
}

/** Builds the suggestion vocabulary from the live catalog plus the synonym dictionary. */
export function buildVocabulary(
  products: Product[],
  groups: ConceptGroups = ACTIVE_DATASET.conceptGroups
): SearchVocabulary {
  const terms = new Set<string>();
  const categories = new Set<string>();
  const titleWordProducts = new Map<string, number>();

  for (const p of products) {
    const category = p.category.toLowerCase();
    categories.add(category);
    terms.add(category);
    terms.add(p.store.toLowerCase());
    for (const word of new Set(tokenize(p.title))) {
      if (/\d/.test(word)) continue;
      titleWordProducts.set(word, (titleWordProducts.get(word) ?? 0) + 1);
    }
  }
  titleWordProducts.forEach((count, word) => count >= MIN_TITLE_WORD_PRODUCTS && terms.add(word));
  groups.forEach((group) => group.forEach((t) => terms.add(t)));

  // The first term of each concept group stands in for the whole group
  // (e.g. "moisturizing" for the hydrating/nourishing family) — enough to
  // suggest a search direction without flooding the list with every synonym.
  const headwords = groups.map((group) => group[0]);

  return {
    terms: [...terms].sort((a, b) => a.length - b.length || a.localeCompare(b)),
    nextWordTerms: [...new Set([...categories, ...headwords])].sort((a, b) => a.localeCompare(b)),
  };
}

export interface Suggestion {
  /** The full query text to fill the input with if this suggestion is picked. */
  query: string;
  /** The newly-added tail of `query`, so the UI can visually emphasize it. */
  completion: string;
}

const MAX_SUGGESTIONS = 6;

/**
 * Google-style suggestions for the search box:
 * - empty input → the curated example queries;
 * - typing a word → completes it from the catalog vocabulary;
 * - just finished a word (trailing space) → suggests what to add next.
 */
export function getSuggestions(query: string, vocabulary: SearchVocabulary): Suggestion[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return EXAMPLE_QUERIES.slice(0, MAX_SUGGESTIONS).map((q) => ({ query: q, completion: q }));
  }

  const lower = trimmed.toLowerCase();
  const results: Suggestion[] = [];
  const seen = new Set<string>();

  const addResult = (fullQuery: string, completion: string) => {
    const key = fullQuery.toLowerCase();
    if (!completion || seen.has(key) || key === lower) return;
    seen.add(key);
    results.push({ query: fullQuery, completion });
  };

  const endsWithSpace = /\s$/.test(query);
  const words = trimmed.split(/\s+/);
  const lastWord = endsWithSpace ? "" : (words.pop() ?? "");
  const prefix = words.join(" ");

  if (lastWord) {
    for (const term of vocabulary.terms) {
      if (results.length >= MAX_SUGGESTIONS) break;
      if (term === lastWord.toLowerCase() || !term.startsWith(lastWord.toLowerCase())) continue;
      addResult(prefix ? `${prefix} ${term}` : term, term.slice(lastWord.length));
    }
  } else {
    for (const term of vocabulary.nextWordTerms) {
      if (results.length >= MAX_SUGGESTIONS) break;
      addResult(`${trimmed} ${term}`, term);
    }
  }

  for (const example of EXAMPLE_QUERIES) {
    if (results.length >= MAX_SUGGESTIONS) break;
    if (example.toLowerCase().startsWith(lower)) addResult(example, example.slice(trimmed.length));
  }

  return results.slice(0, MAX_SUGGESTIONS);
}
