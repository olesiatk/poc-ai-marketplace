import { itemFormOptions, itemForms as formsOf } from "./catalog";
import { parsePriceQuery } from "./price-query";
import type { Product } from "../models/product.model";

/*
 * Filters read straight out of a free-text query. A price is picked up
 * wherever it appears ("under $25"); a category or item form only when the
 * query names it explicitly next to the word "category" / "form" —
 * "cream form", "form: cream or liquid", "category hair care", "skin care
 * category" — so an everyday product word ("a hydrating cream") never
 * narrows the results by itself. Several values can be listed ("cream or
 * lotion form"). Deterministic, so the filters move instantly and the same
 * way for recorded preset queries, live AI queries and the local fallback.
 */

export interface QueryFilters {
  maxPrice: number | null;
  /** Empty when the query names none. */
  categories: string[];
  itemForms: string[];
  /** The query without its price and filter phrases — the words left to search for. */
  text: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A value name as a pattern: any spacing, "&" or "and", plural allowed ("Wigs & Extensions", "creams"). */
function namePattern(name: string): string {
  return escapeRegExp(name.toLowerCase())
    .replace(/\s*&\s*/g, "\\s*(?:&|and)\\s*")
    .replace(/\s+/g, "\\s+")
    .concat("(?:s|es)?");
}

const SEPARATOR = String.raw`\s*(?:,|/|\bor\b|\band\b)\s*`;

/**
 * The values of `names` the text lists right before or after `keyword`
 * ("<keyword> a, b or c", "<keyword>: a", "<keyword> - a", "a or b
 * <keyword>"), and the text with those phrases taken out.
 */
function explicitValues(text: string, keyword: string, names: readonly string[]): { values: string[]; rest: string } {
  if (!names.length) return { values: [], rest: text };
  // Longest first, so "Makeup Tools" wins over "Makeup" and "Bath & Body" isn't split at its "&".
  const byLength = [...names].sort((a, b) => b.length - a.length);
  const one = `(?:${byLength.map(namePattern).join("|")})`;
  const list = `${one}(?:${SEPARATOR}${one})*`;
  const phrases = [
    new RegExp(`(?<![a-z])${keyword}\\s*(?:[:=\\-–—]|\\bis\\b)?\\s*(${list})(?![a-z])`, "g"),
    new RegExp(`(?<![a-z])(${list})\\s+${keyword}(?![a-z])`, "g"),
  ];
  const lists = phrases.flatMap((re) => [...text.matchAll(re)].map((m) => m[1]));
  const rest = phrases.reduce((t, re) => t.replace(re, " "), text);

  const found = new Set<string>();
  for (const listed of lists) {
    let rest = listed;
    for (const name of byLength) {
      const re = new RegExp(`(?<![a-z])${namePattern(name)}(?![a-z])`, "g");
      if (re.test(rest)) {
        found.add(name);
        rest = rest.replace(re, " ");
      }
    }
  }
  return { values: names.filter((n) => found.has(n)), rest };
}

/**
 * Reads the price, categories and item forms a query asks for, out of the
 * catalog's own category names and filterable item forms.
 */
export function parseQueryFilters(query: string, categories: readonly string[], itemForms: readonly string[]): QueryFilters {
  const { maxPrice, text } = parsePriceQuery(query);
  const byCategory = explicitValues(text.toLowerCase(), "categor(?:y|ies)", categories);
  const byForm = explicitValues(byCategory.rest, "(?:item\\s+)?forms?", itemForms);
  return {
    maxPrice,
    categories: byCategory.values,
    itemForms: byForm.values,
    text: byForm.rest.replace(/\s*,(\s*,)+/g, ",").replace(/^[\s,]+|[\s,]+$/g, "").replace(/\s+/g, " "),
  };
}

/** {@link parseQueryFilters} against the categories and item forms `products` offer. */
export function queryFiltersFor(query: string, products: readonly Product[]): QueryFilters {
  const categories = [...new Set(products.map((p) => p.category))];
  return parseQueryFilters(query, categories, itemFormOptions([...products]));
}

/** Whether a product passes the filters a query names (no price/category/form named = passes). */
export function passesQueryFilters(product: Product, filters: QueryFilters): boolean {
  return (
    (filters.maxPrice === null || product.price <= filters.maxPrice) &&
    (!filters.categories.length || filters.categories.includes(product.category)) &&
    (!filters.itemForms.length || formsOf(product).some((form) => filters.itemForms.includes(form)))
  );
}
