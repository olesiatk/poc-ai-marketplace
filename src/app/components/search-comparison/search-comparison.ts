import { Component, input, output, signal } from "@angular/core";
import { ResultColumnComponent, type ColumnLayout } from "../result-column/result-column";
import { breakpointSignal, type Breakpoint } from "../../lib/breakpoints";
import type { RankChange } from "../../lib/comparison";
import type { MatchesMap, Product } from "../../models/product.model";

export type ComparisonSide = "keyword" | "ai";

export interface ComparisonSelection {
  id: string;
  side: ComparisonSide;
}

interface ComparisonLayout {
  layout: ColumnLayout;
  cardsPerRow: number;
  pageSize: number;
  /** Both sides next to each other, vs. one side at a time behind a toggle. */
  sideBySide: boolean;
}

/**
 * Per viewport width (the iframe's own, when embedded). Card layouts show
 * two full rows per side; list layouts six rows.
 */
const LAYOUTS: readonly Breakpoint<ComparisonLayout>[] = [
  { minWidth: 1280, value: { layout: "cards", cardsPerRow: 3, pageSize: 6, sideBySide: true } },
  { minWidth: 1024, value: { layout: "cards", cardsPerRow: 2, pageSize: 4, sideBySide: true } },
  { minWidth: 640, value: { layout: "list", cardsPerRow: 1, pageSize: 6, sideBySide: true } },
];
const PHONE_LAYOUT: ComparisonLayout = { layout: "list", cardsPerRow: 1, pageSize: 6, sideBySide: false };
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
  readonly aiLoading = input(false);
  /** E.g. "Recorded AI run", "Live AI", "AI busy — local"; shown next to the AI heading. */
  readonly aiNote = input<string | null>(null);

  readonly select = output<ComparisonSelection>();
  readonly clearQuery = output<void>();

  protected readonly layout = breakpointSignal(LAYOUTS, PHONE_LAYOUT, FALLBACK_LAYOUT);
  protected readonly activeSide = signal<ComparisonSide>("ai");
  protected readonly hoveredId = signal<string | null>(null);

  protected readonly keywordEmpty = () => `No product contains the words "${this.query()}".`;
}
