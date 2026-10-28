import { Component, computed, effect, input, output, signal } from "@angular/core";
import { PagerComponent } from "../pager/pager";
import { ProductRowComponent } from "../product-row/product-row";
import { matchReason, type MatchReason, type RankChange } from "../../lib/comparison";
import type { MatchesMap, Product } from "../../models/product.model";

/**
 * One side of the keyword-vs-AI search comparison: a header with the
 * result count, then a page of results as horizontal cards, with its own
 * pagination (the two sides have very different lengths).
 */
@Component({
  selector: "app-result-column",
  imports: [PagerComponent, ProductRowComponent],
  templateUrl: "./result-column.html",
  host: { class: "flex flex-col gap-3 border-line" },
})
export class ResultColumnComponent {
  readonly side = input.required<"keyword" | "ai">();
  readonly heading = input.required<string>();
  /** Two short lines under the heading. */
  readonly subheading = input.required<readonly string[]>();
  /** The result count as shown next to the heading, e.g. "12 that fit". */
  readonly countText = input.required<string>();
  readonly products = input.required<Product[]>();
  readonly matches = input.required<MatchesMap>();
  /** Keyword side only — the AI side's results; anything not in it is tagged "Filtered out by AI". Null while AI is loading or found nothing. */
  readonly aiPicks = input<ReadonlySet<string> | null>(null);
  /** AI side only — how each result moved vs. the keyword list. */
  readonly rankChanges = input<Map<string, RankChange> | null>(null);
  readonly pageSize = input.required<number>();
  readonly hoveredId = input<string | null>(null);
  readonly loading = input(false);
  readonly emptyText = input.required<string>();
  /** Marks the first result as a guided-tour target. */
  readonly tourTarget = input<string | null>(null);

  readonly select = output<string>();
  readonly hoverChange = output<string | null>();

  protected readonly page = signal(1);
  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.products().length / this.pageSize())));
  protected readonly visible = computed(() => {
    const start = (this.page() - 1) * this.pageSize();
    return this.products().slice(start, start + this.pageSize());
  });

  constructor() {
    // New results (query, filters) → back to page 1.
    effect(() => {
      this.products();
      this.pageSize();
      this.page.set(1);
    });
  }

  protected changeFor(id: string): RankChange | null {
    return this.rankChanges()?.get(id) ?? null;
  }

  /** Why AI picked it — AI side only; on the keyword side the literal query words already explain the match. */
  protected reasonFor(id: string): MatchReason | null {
    return this.side() === "ai" ? matchReason(this.matches().get(id)) : null;
  }

  protected isFilteredOut(id: string): boolean {
    const picks = this.aiPicks();
    return !!picks && !picks.has(id);
  }
}
