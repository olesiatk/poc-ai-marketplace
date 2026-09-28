import { Component, computed, input, output, signal } from "@angular/core";
import { IconComponent } from "../icon/icon";
import { rankBadge } from "../product-card/product-card";
import { formatPrice, formatRating } from "../../lib/format";
import type { RankChange } from "../../lib/comparison";
import type { Product } from "../../models/product.model";

/** A one-line result for the search comparison on narrow screens — the list-row counterpart of a compact product card. */
@Component({
  selector: "app-product-row",
  imports: [IconComponent],
  templateUrl: "./product-row.html",
  host: { class: "block" },
})
export class ProductRowComponent {
  readonly product = input.required<Product>();
  readonly rank = input<number | null>(null);
  readonly rankChange = input<RankChange | null>(null);
  readonly reason = input<string | null>(null);
  readonly paired = input(false);
  /** A faint green tint for results on the AI side of the comparison. */
  readonly aiTint = input(false);

  readonly select = output<string>();
  readonly hoverChange = output<string | null>();

  protected readonly formatPrice = formatPrice;
  protected readonly formatRating = formatRating;

  protected readonly imageUrl = computed(() => this.product().images[0]?.large ?? null);
  protected readonly imageFailed = signal(false);
  protected readonly rankBadge = computed(() => rankBadge(this.rankChange()));
}
