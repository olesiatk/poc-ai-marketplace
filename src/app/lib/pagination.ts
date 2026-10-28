export type PageSlot = number | "gap";

/**
 * Page numbers to show (1-based), at most five slots with "…" gaps:
 * 1 2 3 … 9 / 1 … 5 … 9 / 1 … 7 8 9.
 */
export function pageSlots(current: number, total: number): PageSlot[] {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 2) return [1, 2, 3, "gap", total];
  if (current >= total - 1) return [1, "gap", total - 2, total - 1, total];
  return [1, "gap", current, "gap", total];
}
