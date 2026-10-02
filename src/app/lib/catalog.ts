import type { Product, Review, ReviewsMap } from "../models/product.model";

/** Groups the flat review list from `<name>-reviews.json` by product id, keeping file order within each product. */
export function groupReviews(reviews: Review[]): ReviewsMap {
  const map: ReviewsMap = {};
  for (const review of reviews) (map[review.productId] ??= []).push(review);
  return map;
}

/** "liquid" / "Liquids" → "Liquid", so the same form written two ways is one filter option. */
function normalizeForm(raw: string): string {
  const form = raw.trim().toLowerCase().replace(/([^s])s$/, "$1");
  return form ? form[0].toUpperCase() + form.slice(1) : "";
}

/**
 * A product's item forms ("Liquid", "Cream"…) from the marketplace's
 * "Item Form" detail — a few list several ("Liquid, Cream, Gel"). Empty for
 * the many products that don't state one.
 */
export function itemForms(product: Product): string[] {
  const raw = product.details["Item Form"];
  return typeof raw === "string" ? raw.split(",").map(normalizeForm).filter(Boolean) : [];
}

// Rarer forms ("Oval Brush", "Ribbon") would only bloat the dropdown.
const MIN_PRODUCTS_PER_FORM = 5;

/** The item forms common enough to filter by, alphabetically. */
export function itemFormOptions(products: Product[]): string[] {
  const counts = new Map<string, number>();
  for (const p of products) for (const form of new Set(itemForms(p))) counts.set(form, (counts.get(form) ?? 0) + 1);
  return [...counts]
    .filter(([, n]) => n >= MIN_PRODUCTS_PER_FORM)
    .map(([form]) => form)
    .sort((a, b) => a.localeCompare(b, "en"));
}
