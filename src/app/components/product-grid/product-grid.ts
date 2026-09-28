import { Component, ElementRef, computed, effect, inject, input, output, signal, untracked } from "@angular/core";
import { breakpointSignal, type Breakpoint } from "../../lib/breakpoints";
import { ProductCardComponent } from "../product-card/product-card";
import { wordFormProducts } from "../../lib/search";
import type { MatchesMap, Product } from "../../models/product.model";

/**
 * Grid column count by viewport width (widest first; narrower than all of
 * these → MIN_COLUMNS). The grid's column template is driven from this
 * same table, so the page size below always matches what's on screen.
 * Inside an <iframe> these are the iframe's own width, not the host page's.
 */
const COLUMN_BREAKPOINTS: readonly Breakpoint<number>[] = [
  { minWidth: 1280, value: 5 },
  { minWidth: 1024, value: 4 },
  { minWidth: 640, value: 3 },
];
const MIN_COLUMNS = 2;
// Used where matchMedia doesn't exist (jsdom in unit tests).
const FALLBACK_COLUMNS = 4;

/** Each page is this many full rows — one more on the narrowest layout, where rows are only two cards wide. */
function rowsPerPage(columns: number): number {
  return columns <= MIN_COLUMNS ? 3 : 2;
}
/** Total page-number buttons shown before collapsing the middle into an ellipsis. */
const MAX_VISIBLE_PAGES = 7;

export type PageEntry = number | "ellipsis";

@Component({
  selector: "app-product-grid",
  imports: [ProductCardComponent],
  templateUrl: "./product-grid.html",
})
export class ProductGridComponent {
  readonly products = input.required<Product[]>();
  readonly matches = input.required<MatchesMap>();
  readonly query = input("");
  readonly isSearching = input(false);

  readonly select = output<string>();
  readonly clearQuery = output<void>();

  protected readonly wordFormProducts = wordFormProducts;
  protected readonly currentPage = signal(1);
  protected readonly columns = breakpointSignal(COLUMN_BREAKPOINTS, MIN_COLUMNS, FALLBACK_COLUMNS);
  protected readonly pageSize = computed(() => this.columns() * rowsPerPage(this.columns()));

  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.products().length / this.pageSize())));

  protected readonly visibleProducts = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.products().slice(start, start + this.pageSize());
  });

  protected readonly pageNumbers = computed<PageEntry[]>(() => {
    const total = this.totalPages();
    const current = this.currentPage();
    if (total <= MAX_VISIBLE_PAGES) return Array.from({ length: total }, (_, i) => i + 1);

    const kept = new Set([1, total, current - 1, current, current + 1]);
    const sorted = [...kept].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);

    const entries: PageEntry[] = [];
    let previous = 0;
    for (const page of sorted) {
      if (previous && page - previous > 1) entries.push("ellipsis");
      entries.push(page);
      previous = page;
    }
    return entries;
  });

  private readonly elementRef = inject(ElementRef<HTMLElement>);

  private previousPageSize = this.pageSize();

  constructor() {
    // A new search or filter yields a new `products` array — reset back to
    // the first page rather than keeping a stale offset into it.
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

  protected matchFor(id: string) {
    return this.matches().get(id) ?? null;
  }

  protected goToPage(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.currentPage()) return;
    this.currentPage.set(page);
    // Pagination replaces the visible set rather than appending to it, so
    // bring the grid back into view (jsdom in unit tests has no scrollIntoView).
    this.elementRef.nativeElement.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }
}
