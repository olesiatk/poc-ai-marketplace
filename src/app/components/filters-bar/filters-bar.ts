import { Component, computed, input, output } from "@angular/core";
import { FilterSelectComponent } from "../filter-select/filter-select";
import { formatPrice } from "../../lib/format";
import type { FilterOptions, Filters } from "../../models/product.model";

export interface FilterChangeEvent {
  field: keyof Filters;
  value: string | number;
}

/** Minimum-rating choices, as shown in the dropdown → the rating they filter by. */
const RATING_OPTIONS: ReadonlyMap<string, number> = new Map([
  ["4.5 & up", 4.5],
  ["4 & up", 4],
  ["3.5 & up", 3.5],
  ["3 & up", 3],
]);

@Component({
  selector: "app-filters-bar",
  imports: [FilterSelectComponent],
  templateUrl: "./filters-bar.html",
})
export class FiltersBarComponent {
  readonly options = input.required<FilterOptions>();
  readonly filters = input.required<Filters>();
  readonly priceLimit = input.required<number>();

  readonly filterChange = output<FilterChangeEvent>();
  readonly reset = output<void>();

  protected readonly formatPrice = formatPrice;
  protected readonly ratingOptions = [...RATING_OPTIONS.keys()];

  protected readonly ratingLabel = computed(() => {
    const min = this.filters().minRating;
    return [...RATING_OPTIONS].find(([, value]) => value === min)?.[0] ?? "";
  });

  protected onSelectChange(field: "category" | "brand", value: string): void {
    this.filterChange.emit({ field, value });
  }

  protected onRatingChange(label: string): void {
    this.filterChange.emit({ field: "minRating", value: RATING_OPTIONS.get(label) ?? 0 });
  }

  protected onPriceChange(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.filterChange.emit({ field: "maxPrice", value });
  }
}
