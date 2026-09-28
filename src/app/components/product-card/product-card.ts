import { Component, computed, input, output, signal } from "@angular/core";
import { IconComponent } from "../icon/icon";
import { wordFormMatches } from "../../lib/search";
import { formatPrice, formatRating } from "../../lib/format";
import type { RankChange } from "../../lib/comparison";
import type { MatchInfo, Product } from "../../models/product.model";

/**
 * A product tile. Two uses:
 * - the regular browse grid (no query) — full-size;
 * - one side of the keyword-vs-AI search comparison — `compact`, with a
 *   rank number, and on the AI side a rank-change badge ("↑5", "AI only")
 *   plus a one-line reason for AI-only finds.
 */
@Component({
  selector: "app-product-card",
  imports: [IconComponent],
  templateUrl: "./product-card.html",
  host: { class: "block" },
})
export class ProductCardComponent {
  readonly product = input.required<Product>();
  readonly matchInfo = input<MatchInfo | null>(null);
  readonly compact = input(false);
  /** 1-based position in its result list, shown in compact mode. */
  readonly rank = input<number | null>(null);
  readonly rankChange = input<RankChange | null>(null);
  readonly reason = input<string | null>(null);
  /** Highlighted because the same product is hovered in the other comparison column. */
  readonly paired = input(false);
  /** A faint green tint for results on the AI side of the comparison. */
  readonly aiTint = input(false);

  readonly select = output<string>();
  readonly hoverChange = output<string | null>();

  protected readonly wordFormMatches = wordFormMatches;
  protected readonly formatPrice = formatPrice;
  protected readonly formatRating = formatRating;

  /** images[0] is always the MAIN photo (an invariant of the catalog files, see CLAUDE.md). */
  protected readonly imageUrl = computed(() => this.product().images[0]?.large ?? null);
  protected readonly imageFailed = signal(false);

  protected readonly rankBadge = computed(() => rankBadge(this.rankChange()));

  protected matchCount(info: MatchInfo): number {
    return info.directTerms.size + info.synonymTerms.size;
  }

  protected onSelect(): void {
    this.select.emit(this.product().id);
  }
}

export interface RankBadge {
  text: string;
  tone: "new" | "up" | "down" | "same";
  title: string;
}

/** Display form of a rank change — shared by the card and the list row. */
export function rankBadge(change: RankChange | null): RankBadge | null {
  if (!change) return null;
  switch (change.kind) {
    case "new":
      return { text: "AI only", tone: "new", title: "Keyword search didn't find this product" };
    case "up":
      return { text: `↑${change.by}`, tone: "up", title: `${change.by} places higher than in keyword search` };
    case "down":
      return { text: `↓${change.by}`, tone: "down", title: `${change.by} places lower than in keyword search` };
    case "same":
      return { text: "=", tone: "same", title: "Same position as in keyword search" };
  }
}
