import { Component, input, output } from "@angular/core";
import { FilterSelectComponent } from "../filter-select/filter-select";
import { RatingSelectComponent } from "../rating-select/rating-select";
import { formatPrice } from "../../lib/format";
import type { FilterOptions, Filters } from "../../models/product.model";

export interface FilterChangeEvent {
  field: keyof Filters;
  value: string[] | number;
}

@Component({
  selector: "app-filters-bar",
  imports: [FilterSelectComponent, RatingSelectComponent],
  templateUrl: "./filters-bar.html",
})
export class FiltersBarComponent {
  readonly options = input.required<FilterOptions>();
  readonly filters = input.required<Filters>();
  readonly priceLimit = input.required<number>();
  /** Filters the search query set by itself, tagged "from your query". */
  readonly fromQuery = input<ReadonlySet<string>>(new Set());

  readonly filterChange = output<FilterChangeEvent>();
  readonly reset = output<void>();

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
