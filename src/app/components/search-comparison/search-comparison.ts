import { Component, computed, input, output, signal } from "@angular/core";
import { ResultColumnComponent } from "../result-column/result-column";
import { breakpointSignal, type Breakpoint } from "../../lib/breakpoints";
import type { RankChange } from "../../lib/comparison";
import type { MatchesMap, Product } from "../../models/product.model";

export type ComparisonSide = "keyword" | "ai";

export interface ComparisonSelection {
  id: string;
  side: ComparisonSide;
}

/** A piece of the summary line above the comparison; `strong` pieces are bold. */
export interface SummaryPart {
  text: string;
  strong?: boolean;
}

/**
 * Per viewport width (the iframe's own, when embedded): the two columns
 * side by side once each gets ~360px next to the filters sidebar (from a
 * 1140px-wide viewport), stacked below that, and one at a time behind tabs
 * on phones (where the sidebar becomes a sheet).
 */
type ComparisonLayout = "side-by-side" | "stacked" | "tabs";
const LAYOUTS: readonly Breakpoint<ComparisonLayout>[] = [
  { minWidth: 1140, value: "side-by-side" },
  { minWidth: 720, value: "stacked" },
];
const PAGE_SIZE = 5;

/**
 * The same query run two ways: plain keyword search (the "without AI"
 * baseline — same stemming and field weights, no synonym expansion, no
 * LLM) vs. AI search, under a one-line summary of the difference.
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
  readonly summary = input<SummaryPart[]>([]);
  readonly aiLoading = input(false);
  /** E.g. "Recorded AI run · Oct 6, 2026", "Live AI", "AI busy · local synonyms" — at the end of the summary. */
  readonly aiNote = input<string | null>(null);

  readonly select = output<ComparisonSelection>();

  protected readonly pageSize = PAGE_SIZE;
  protected readonly layout = breakpointSignal(LAYOUTS, "tabs", "side-by-side");
  protected readonly activeSide = signal<ComparisonSide>("ai");
  protected readonly hoveredId = signal<string | null>(null);

  protected readonly keywordEmpty = () => `No product contains the words "${this.query()}".`;
  // Nothing to compare against while the AI side is loading, or if it found nothing at all.
  protected readonly aiPicks = computed(() =>
    this.aiLoading() || this.aiMatches().size === 0 ? null : new Set(this.aiMatches().keys())
  );
  protected readonly keywordCount = computed(() => `${this.keywordProducts().length} found`);
  protected readonly aiCount = computed(() => {
    if (this.aiLoading()) return "…";
    const total = this.aiProducts().length;
    return total === 1 ? "1 that fits" : `${total} that fit`;
  });

  protected shows(side: ComparisonSide): boolean {
    return this.layout() !== "tabs" || this.activeSide() === side;
  }
}
