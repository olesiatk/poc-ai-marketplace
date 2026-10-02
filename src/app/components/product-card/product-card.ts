import { Component, computed, input, output, signal } from "@angular/core";
import { IconComponent } from "../icon/icon";
import { wordFormMatches } from "../../lib/search";
import { formatPrice, formatRating } from "../../lib/format";
import type { MatchInfo, Product } from "../../models/product.model";

/** A product tile in the browse grid (no query) — photo on top, then category, title, brand, price and rating. */
@Component({
  selector: "app-product-card",
  imports: [IconComponent],
  templateUrl: "./product-card.html",
  host: { class: "block" },
})
export class ProductCardComponent {
  readonly product = input.required<Product>();
  readonly matchInfo = input<MatchInfo | null>(null);

  readonly select = output<string>();

  protected readonly wordFormMatches = wordFormMatches;
  protected readonly formatPrice = formatPrice;
  protected readonly formatRating = formatRating;

  /** images[0] is always the MAIN photo (an invariant of the catalog files, see CLAUDE.md). */
  protected readonly imageUrl = computed(() => this.product().images[0]?.large ?? null);
  protected readonly imageFailed = signal(false);

  protected matchCount(info: MatchInfo): number {
    return info.directTerms.size + info.synonymTerms.size;
  }

  protected onSelect(): void {
    this.select.emit(this.product().id);
  }
}
