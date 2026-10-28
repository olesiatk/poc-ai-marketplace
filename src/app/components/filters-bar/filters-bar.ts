import { Component, computed, input, output } from "@angular/core";
import { FilterSelectComponent } from "../filter-select/filter-select";
import { IconComponent } from "../icon/icon";
import { RatingSelectComponent } from "../rating-select/rating-select";
import { formatPrice } from "../../lib/format";
import type { FilterOptions, Filters } from "../../models/product.model";

export interface FilterChangeEvent {
  field: keyof Filters;
  value: string[] | number;
}

/** How many filters differ from "everything" — for the phone's "Filters (n)" button and "Reset all". */
export function activeFilterCount(filters: Filters, priceLimit: number): number {
  return filters.categories.length + filters.itemForms.length + (filters.minRating ? 1 : 0) + (filters.maxPrice < priceLimit ? 1 : 0);
}

/**
 * The filters sidebar: category and item form dropdowns, rating, max price.
 * Filters the search query set by itself are tagged "From your search". On
 * phones it's a full-screen sheet with a "Show results" button.
 */
@Component({
  selector: "app-filters-bar",
  imports: [FilterSelectComponent, IconComponent, RatingSelectComponent],
  templateUrl: "./filters-bar.html",
})
export class FiltersBarComponent {
  readonly options = input.required<FilterOptions>();
  readonly filters = input.required<Filters>();
  readonly priceLimit = input.required<number>();
  /** Filters the search query set by itself, tagged "From your search". */
  readonly fromQuery = input<ReadonlySet<string>>(new Set());
  /** Shown as a full-screen sheet (phones). */
  readonly sheet = input(false);

  readonly filterChange = output<FilterChangeEvent>();
  readonly reset = output<void>();
  readonly close = output<void>();

  protected readonly hasActive = computed(() => activeFilterCount(this.filters(), this.priceLimit()) > 0);
  protected readonly priceLabel = computed(() => {
    const max = this.filters().maxPrice;
    return max >= this.priceLimit() ? "Any price" : `Up to ${formatPrice(max)}`;
  });
  /** The slider's track, green up to the thumb. */
  protected readonly priceTrack = computed(() => {
    const limit = this.priceLimit() || 1;
    const pct = ((Math.min(this.filters().maxPrice, limit) / limit) * 100).toFixed(1);
    return `linear-gradient(to right, var(--color-green) ${pct}%, var(--color-line) ${pct}%)`;
  });
  protected readonly formatPrice = formatPrice;

  protected onSelectChange(field: "categories" | "itemForms", value: string[]): void {
    this.filterChange.emit({ field, value });
  }

  protected onRatingChange(rating: number): void {
    this.filterChange.emit({ field: "minRating", value: rating });
  }

  protected onPriceChange(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.filterChange.emit({ field: "maxPrice", value });
  }
}
