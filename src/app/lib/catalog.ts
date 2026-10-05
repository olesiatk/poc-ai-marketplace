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

// Product forms worth filtering by — a generic vocabulary, not a catalog's:
// the marketplace's "Item Form" field also holds packaging/shape oddities
// ("Pair", "Elastic", "Individual") that make no sense as a filter.
const PRODUCT_FORMS = new Set([
  "Balm", "Bar", "Butter", "Capsule", "Clay", "Cream", "Drop", "Foam", "Gel", "Liquid", "Lotion", "Mask",
  "Mist", "Oil", "Paste", "Pencil", "Powder", "Scrub", "Serum", "Sheet", "Spray", "Stick", "Tablet", "Wax", "Wipe",
]);

/** Forms named in a title ("Argan Oil Hair Serum" → Oil, Serum) — not "Oil-Free …". */
function formsInTitle(title: string): string[] {
  const lower = title.toLowerCase();
  return [...PRODUCT_FORMS].filter((form) =>
    new RegExp(`(?<![a-z])${form.toLowerCase()}s?(?![a-z])(?![- ]free)`).test(lower)
  );
}

/**
 * A product's item forms ("Liquid", "Cream"…) from the marketplace's
 * "Item Form" detail — a few list several ("Liquid, Cream, Gel"). Over half
 * the products don't state one; for those, the forms their title names
 * ("… Body Oil") stand in, so filtering by a form doesn't hide them all.
 */
export function itemForms(product: Product): string[] {
  const raw = product.details["Item Form"];
  const stated = typeof raw === "string" ? raw.split(",").map(normalizeForm).filter(Boolean) : [];
  return stated.length ? stated : formsInTitle(product.title);
}

// Rarer forms would only bloat the dropdown.
const MIN_PRODUCTS_PER_FORM = 5;

/** The product forms common enough to filter by, alphabetically. */
export function itemFormOptions(products: Product[]): string[] {
  const counts = new Map<string, number>();
  for (const p of products) for (const form of new Set(itemForms(p))) counts.set(form, (counts.get(form) ?? 0) + 1);
  return [...counts]
    .filter(([form, n]) => PRODUCT_FORMS.has(form) && n >= MIN_PRODUCTS_PER_FORM)
    .map(([form]) => form)
    .sort((a, b) => a.localeCompare(b, "en"));
}
