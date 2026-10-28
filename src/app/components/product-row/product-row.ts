import { Component, computed, input, output, signal } from "@angular/core";
import { IconComponent } from "../icon/icon";
import { formatPrice, formatRating } from "../../lib/format";
import type { MatchReason, RankChange } from "../../lib/comparison";
import type { Product } from "../../models/product.model";

export interface RankBadge {
  text: string;
  tone: "new" | "up" | "down" | "same" | "off";
  title: string;
}

/** Display form of a rank change (or, for a keyword result AI left out, of its absence on the AI side). */
export function rankBadge(change: RankChange | null, filteredOut = false): RankBadge | null {
  if (filteredOut) return { text: "Filtered out by AI", tone: "off", title: "AI search left this out of its results for this query" };
  if (!change) return null;
  switch (change.kind) {
    case "new":
      return { text: "Found only by AI", tone: "new", title: "Keyword search missed this — AI found it by meaning" };
    case "up":
      return { text: `↑ ${change.by} vs keyword`, tone: "up", title: `${change.by} places higher than in keyword search` };
    case "down":
      return { text: `↓ ${change.by} vs keyword`, tone: "down", title: `${change.by} places lower than in keyword search` };
    case "same":
      return { text: "Same rank as keyword", tone: "same", title: "Same position as in keyword search" };
  }
}

/**
 * A product as a horizontal card — the browse catalog and both sides of
 * the search comparison use the same one: photo on the left; on the right
 * a comparison tag ("Found only by AI", "Filtered out by AI", "↑ 2 vs
 * keyword"), title, brand, why AI matched it, then price and rating. The
 * whole card is one button that opens the product modal.
 */
@Component({
  selector: "app-product-row",
  imports: [IconComponent],
  templateUrl: "./product-row.html",
  host: { class: "block" },
})
export class ProductRowComponent {
  readonly product = input.required<Product>();
  /** AI side of the comparison: green fill (and a gradient border for an AI-only find). */
  readonly aiSide = input(false);
  readonly rankChange = input<RankChange | null>(null);
  readonly reason = input<MatchReason | null>(null);
  /** Highlighted because the same product is hovered in the other comparison column. */
  readonly paired = input(false);
  /** Keyword side only: the AI side left this product out. */
  readonly filteredOut = input(false);

  readonly select = output<string>();
  readonly hoverChange = output<string | null>();

  protected readonly formatPrice = formatPrice;
  protected readonly formatRating = formatRating;

  /** images[0] is always the MAIN photo (an invariant of the catalog files, see CLAUDE.md). */
  protected readonly imageUrl = computed(() => this.product().images[0]?.large ?? null);
  protected readonly imageFailed = signal(false);
  protected readonly rankBadge = computed(() => rankBadge(this.rankChange(), this.filteredOut()));
  protected readonly reviewCount = computed(() => this.product().ratingCount.toLocaleString("en-US"));
}
