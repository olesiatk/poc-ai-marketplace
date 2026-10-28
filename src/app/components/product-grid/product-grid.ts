import { Component, ElementRef, computed, effect, inject, input, output, signal, untracked } from "@angular/core";
import { breakpointSignal, type Breakpoint } from "../../lib/breakpoints";
import { PagerComponent } from "../pager/pager";
import { ProductRowComponent } from "../product-row/product-row";
import { wordFormProducts } from "../../lib/search";
import type { Product } from "../../models/product.model";

/**
 * Cards per row by viewport width (widest first). Two need ~696px of grid
 * (2 × 340 + gap), which the content column next to the 300px filters
 * sidebar reaches from a 1068px-wide viewport. The grid's column template
 * is driven from this same table, so the page size always matches what's
 * on screen. Inside an <iframe> these are the iframe's own width.
 */
const COLUMN_BREAKPOINTS: readonly Breakpoint<number>[] = [{ minWidth: 1068, value: 2 }];
const MIN_COLUMNS = 1;
// Used where matchMedia doesn't exist (jsdom in unit tests).
const FALLBACK_COLUMNS = 2;
const ROWS_PER_PAGE = 5;

/** The catalog with no query: every product that passes the filters, as horizontal cards. */
@Component({
  selector: "app-product-grid",
  imports: [PagerComponent, ProductRowComponent],
  templateUrl: "./product-grid.html",
})
export class ProductGridComponent {
  readonly products = input.required<Product[]>();

  readonly select = output<string>();
  readonly resetFilters = output<void>();

  protected readonly currentPage = signal(1);
  protected readonly columns = breakpointSignal(COLUMN_BREAKPOINTS, MIN_COLUMNS, FALLBACK_COLUMNS);
  protected readonly pageSize = computed(() => this.columns() * ROWS_PER_PAGE);
  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.products().length / this.pageSize())));
  protected readonly visibleProducts = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.products().slice(start, start + this.pageSize());
  });
  protected readonly title = computed(() => {
    const count = this.products().length;
    return `${count.toLocaleString("en-US")} ${wordFormProducts(count)}`;
  });

  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private previousPageSize = this.pageSize();

  constructor() {
    // A new filter yields a new `products` array — back to the first page.
    effect(() => {
      this.products();
      this.currentPage.set(1);
    });

    // A resize that changes the column count changes the page size — stay
    // on whichever page now contains the first product that was showing.
    effect(() => {
      const size = this.pageSize();
      const firstShown = (untracked(this.currentPage) - 1) * this.previousPageSize;
      this.previousPageSize = size;
      this.currentPage.set(Math.floor(firstShown / size) + 1);
    });
  }

  protected goToPage(page: number): void {
    this.currentPage.set(page);
    // Pagination replaces the visible set, so bring the grid back into view
    // (jsdom in unit tests has no scrollIntoView).
    this.elementRef.nativeElement.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }
}
