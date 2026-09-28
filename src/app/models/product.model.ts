/**
 * Shapes of the static catalog files in public/data
 * (`<name>-products.json` / `<name>-reviews.json`).
 */

export interface ProductImage {
  /** "MAIN" for the primary photo (always images[0]), "PT01".. for the rest. */
  variant: string;
  large: string;
  hiRes: string | null;
}

export interface Product {
  id: string;
  title: string;
  category: string;
  /** Brand / seller name. */
  store: string;
  price: number;
  /** Overall marketplace rating, not just of the reviews shipped with the catalog. */
  averageRating: number;
  ratingCount: number;
  description: string;
  features: string[];
  images: ProductImage[];
  details: Record<string, unknown>;
}

export interface Review {
  id: string;
  productId: string;
  rating: number;
  title: string;
  text: string;
  helpfulVotes: number;
  verifiedPurchase: boolean;
  /** ISO 8601. */
  date: string;
  /** Customer-uploaded photo URLs. */
  images: string[];
}

/** Reviews grouped by product id. */
export type ReviewsMap = Record<string, Review[]>;

export interface MatchInfo {
  score: number;
  /** Terms that are literal query words — highlighted in yellow. */
  directTerms: Set<string>;
  /** Synonyms/contextual phrases pulled in via concept expansion — highlighted in light green. */
  synonymTerms: Set<string>;
}

export type MatchesMap = Map<string, MatchInfo>;

export interface Filters {
  category: string;
  brand: string;
  maxPrice: number;
  /** 0 = any rating. */
  minRating: number;
}

export interface FilterOptions {
  categories: string[];
  brands: string[];
}

/** "recorded" = a stored real LLM run for a preset query (see lib/ai-results.ts). */
export type AiMode = "groq" | "recorded" | "local" | null;
