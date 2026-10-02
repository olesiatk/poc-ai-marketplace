import { Component, computed, effect, input, output, signal } from "@angular/core";
import { ProductRowComponent } from "../product-row/product-row";
import { matchReason, type RankChange } from "../../lib/comparison";
import type { MatchesMap, Product } from "../../models/product.model";

/**
 * One side of the keyword-vs-AI search comparison: a header with the
 * result count, then a page of results as horizontal tiles in one or two
 * columns, with its own pagination (the two sides have very different lengths).
 */
@Component({
  selector: "app-result-column",
  imports: [ProductRowComponent],
  templateUrl: "./result-column.html",
  // The AI side sits on a framed white panel; the keyword side stays on the
  // bare page background, so the two read as two separate result sets.
  host: { class: "block min-w-0", "[class.ai-panel]": "side() === 'ai'", "[class.keyword-column]": "side() === 'keyword'" },
})
export class ResultColumnComponent {
  readonly side = input.required<"keyword" | "ai">();
  readonly heading = input.required<string>();
  readonly subheading = input.required<string>();
  /** The result count as shown next to the heading, e.g. "12 that fit". */
  readonly countText = input.required<string>();
  readonly products = input.required<Product[]>();
  readonly matches = input.required<MatchesMap>();
  /** Keyword side only — the AI side's results; anything not in it is faded. Null while AI is loading or found nothing. */
  readonly aiPicks = input<ReadonlySet<string> | null>(null);
  /** AI side only — how each result moved vs. the keyword list. */
  readonly rankChanges = input<Map<string, RankChange> | null>(null);
  /** Tiles per row. */
  readonly columns = input(1);
  readonly pageSize = input.required<number>();
  readonly hoveredId = input<string | null>(null);
  readonly loading = input(false);
  readonly emptyText = input.required<string>();
  /** Small note next to the heading, e.g. which AI engine produced the list. */
  readonly note = input<string | null>(null);
  /** Marks the first result as a guided-tour target. */
  readonly tourTarget = input<string | null>(null);

  readonly select = output<string>();
  readonly hoverChange = output<string | null>();

  protected readonly page = signal(1);

  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.products().length / this.pageSize())));
  protected readonly visible = computed(() => {
    const start = (this.page() - 1) * this.pageSize();
    return this.products()
      .slice(start, start + this.pageSize())
      .map((product, i) => ({ product, rank: start + i + 1 }));
  });

  constructor() {
    // New results (query, filters) or a new page size (resize) → back to page 1.
    effect(() => {
      this.products();
      this.pageSize();
      this.page.set(1);
    });
  }

  protected changeFor(id: string): RankChange | null {
    return this.rankChanges()?.get(id) ?? null;
  }

  /** Only AI-only finds get a reason line — elsewhere the literal query words already explain the match. */
  protected reasonFor(id: string): string | null {
    return this.changeFor(id)?.kind === "new" ? matchReason(this.matches().get(id)) : null;
  }

  protected isDimmed(id: string): boolean {
    const picks = this.aiPicks();
    return !!picks && !picks.has(id);
  }

  protected goTo(page: number): void {
    if (page >= 1 && page <= this.totalPages()) this.page.set(page);
  }
}
