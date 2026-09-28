/** Whole amounts without cents ("$15"), anything else with both digits ("$89.90", not "$89.9"). */
export function formatPrice(amount: number): string {
  const digits = Number.isInteger(amount) ? 0 : 2;
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function formatRating(rating: number): string {
  return rating.toFixed(1);
}

/** E.g. "Mar 5, 2021" — review dates are ISO strings in the catalog files. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
