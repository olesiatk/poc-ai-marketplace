import { Component, computed, input, output, signal } from "@angular/core";
import { IconComponent } from "../icon/icon";
import { formatPrice, formatRating } from "../../lib/format";
import type { RankChange } from "../../lib/comparison";
import type { Product } from "../../models/product.model";

export interface RankBadge {
  text: string;
  tone: "new" | "up" | "down" | "same" | "off";
  title: string;
}

/** Display form of a rank change (or, for a dimmed keyword result, of its absence on the AI side). */
export function rankBadge(change: RankChange | null, dimmed = false): RankBadge | null {
  if (dimmed) return { text: "✕ Filtered out by AI", tone: "off", title: "AI search left this out of its results for this query" };
  if (!change) return null;
  switch (change.kind) {
    case "new":
      return { text: "✓ Found only by AI", tone: "new", title: "Keyword search missed this — AI found it by meaning" };
    case "up":
      return { text: `↑${change.by}`, tone: "up", title: `${change.by} places higher than in keyword search` };
    case "down":
      return { text: `↓${change.by}`, tone: "down", title: `${change.by} places lower than in keyword search` };
    case "same":
      return { text: "=", tone: "same", title: "Same position as in keyword search" };
  }
}

/**
 * One result in the keyword-vs-AI search comparison: a horizontal tile —
 * photo on the left; on the right a rank-change badge ("↑5", "Found only by
 * AI", "Filtered out by AI"), the title, a one-line reason for AI-only
 * finds, then price and rating. Wider than tall, so a comparison column
 * fits two per row and three rows per page.
 */
@Component({
  selector: "app-product-row",
  imports: [IconComponent],
  templateUrl: "./product-row.html",
  host: { class: "block" },
})
export class ProductRowComponent {
  readonly product = input.required<Product>();
  /** 1-based position in its result list. */
  readonly rank = input<number | null>(null);
  readonly rankChange = input<RankChange | null>(null);
  readonly reason = input<string | null>(null);
  /** Highlighted because the same product is hovered in the other comparison column. */
  readonly paired = input(false);
  /** A faint green tint for results on the AI side of the comparison. */
  readonly aiTint = input(false);
  /** Keyword side only: the AI side left this product out — faded, with a tag saying so. */
  readonly dimmed = input(false);

  readonly select = output<string>();
  readonly hoverChange = output<string | null>();

  protected readonly formatPrice = formatPrice;
  protected readonly formatRating = formatRating;

  /** images[0] is always the MAIN photo (an invariant of the catalog files, see CLAUDE.md). */
  protected readonly imageUrl = computed(() => this.product().images[0]?.large ?? null);
  protected readonly imageFailed = signal(false);
  protected readonly rankBadge = computed(() => rankBadge(this.rankChange(), this.dimmed()));
}
