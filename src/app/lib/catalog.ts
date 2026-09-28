import type { Review, ReviewsMap } from "../models/product.model";

/** Groups the flat review list from `<name>-reviews.json` by product id, keeping file order within each product. */
export function groupReviews(reviews: Review[]): ReviewsMap {
  const map: ReviewsMap = {};
  for (const review of reviews) (map[review.productId] ??= []).push(review);
  return map;
}
