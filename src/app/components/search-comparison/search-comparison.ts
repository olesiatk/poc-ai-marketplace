import { Component, computed, input, output, signal } from "@angular/core";
import { ResultColumnComponent } from "../result-column/result-column";
import { breakpointSignal, type Breakpoint } from "../../lib/breakpoints";
import type { RankChange } from "../../lib/comparison";
import { wordFormProducts } from "../../lib/search";
import type { MatchesMap, Product } from "../../models/product.model";

export type ComparisonSide = "keyword" | "ai";

export interface ComparisonSelection {
  id: string;
  side: ComparisonSide;
}

interface ComparisonLayout {
  /** Tiles per row on each side. */
  columns: number;
  pageSize: number;
  /** Both sides next to each other, vs. one side at a time behind a toggle. */
  sideBySide: boolean;
}

/**
 * Per viewport width (the iframe's own, when embedded): horizontal tiles,
 * two per row in three rows once a side is wide enough for two (~275px
 * each), else one per row in six.
 */
const LAYOUTS: readonly Breakpoint<ComparisonLayout>[] = [
  { minWidth: 1200, value: { columns: 2, pageSize: 6, sideBySide: true } },
  { minWidth: 640, value: { columns: 1, pageSize: 6, sideBySide: true } },
];
const PHONE_LAYOUT: ComparisonLayout = { columns: 1, pageSize: 6, sideBySide: false };
// Where matchMedia doesn't exist (jsdom in unit tests).
const FALLBACK_LAYOUT = LAYOUTS[1].value;

/**
 * The same query run two ways, side by side: plain keyword search (the
 * "without AI" baseline — same stemming and field weights, no synonym
 * expansion, no LLM) vs. AI search. On phones one side at a time, AI first.
 */
@Component({
  selector: "app-search-comparison",
  imports: [ResultColumnComponent],
  templateUrl: "./search-comparison.html",
})
export class SearchComparisonComponent {
  readonly query = input.required<string>();
  readonly keywordProducts = input.required<Product[]>();
  readonly aiProducts = input.required<Product[]>();
  readonly keywordMatches = input.required<MatchesMap>();
  readonly aiMatches = input.required<MatchesMap>();
  readonly rankChanges = input.required<Map<string, RankChange>>();
  readonly queryWordCount = input.required<number>();
  /** Keyword results containing every query word, vs. the total containing any of them. */
  readonly keywordAllWordsCount = input.required<number>();
  readonly aiLoading = input(false);
  /** E.g. "Recorded AI run", "Live AI", "AI busy — local"; shown next to the AI heading. */
  readonly aiNote = input<string | null>(null);

  readonly select = output<ComparisonSelection>();
  readonly clearQuery = output<void>();

  protected readonly layout = breakpointSignal(LAYOUTS, PHONE_LAYOUT, FALLBACK_LAYOUT);
  protected readonly activeSide = signal<ComparisonSide>("ai");
  protected readonly hoveredId = signal<string | null>(null);

  protected readonly keywordEmpty = () => `No product contains the words "${this.query()}".`;

  // The headline counts mean different things on the two sides — say so, or
  // the keyword side's much bigger "any word" total reads as the better search.
  protected readonly keywordCount = computed(() => {
    const total = this.keywordProducts().length;
    if (this.queryWordCount() < 2 || total === 0) return `${total} ${wordFormProducts(total)}`;
    return `${total} with any word · ${this.keywordAllWordsCount()} with all`;
  });
  // Nothing to compare against while the AI side is loading, or if it found nothing at all.
  protected readonly aiPicks = computed(() =>
    this.aiLoading() || this.aiMatches().size === 0 ? null : new Set(this.aiMatches().keys())
  );
  protected readonly aiCount = computed(() => {
    const total = this.aiProducts().length;
    return total === 1 ? "1 that fits" : `${total} that fit`;
  });
}
