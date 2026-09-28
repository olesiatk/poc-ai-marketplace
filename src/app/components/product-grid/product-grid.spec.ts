import { afterEach, describe, expect, it } from "vitest";
import { TestBed } from "@angular/core/testing";
import { ProductGridComponent } from "./product-grid";
import type { MatchesMap, Product } from "../../models/product.model";

function makeProducts(count: number, prefix = "p"): Product[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    title: `Product ${i}`,
    category: "Category",
    store: "Brand",
    price: 10,
    averageRating: 4.5,
    ratingCount: 100,
    description: "",
    features: [],
    images: [],
    details: {},
  }));
}

function setup(products: Product[]) {
  const fixture = TestBed.createComponent(ProductGridComponent);
  fixture.componentRef.setInput("products", products);
  fixture.componentRef.setInput("matches", new Map() as MatchesMap);
  fixture.detectChanges();
  return fixture;
}

function cardCount(fixture: ReturnType<typeof setup>): number {
  return fixture.nativeElement.querySelectorAll("app-product-card").length;
}

function findPaginationNav(fixture: ReturnType<typeof setup>): HTMLElement | null {
  return fixture.nativeElement.querySelector("nav[aria-label='Pagination']");
}

function findButton(fixture: ReturnType<typeof setup>, text: string): HTMLButtonElement | null {
  const buttons: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll("button"));
  return buttons.find((b) => b.textContent?.trim() === text) ?? null;
}

/**
 * Fakes a viewport width via window.matchMedia (jsdom has none), and lets a
 * test "resize" it — firing the change listeners the grid registers.
 */
function stubViewportWidth(initialWidth: number) {
  let width = initialWidth;
  const listeners = new Set<() => void>();
  window.matchMedia = ((query: string) => {
    const minWidth = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    return {
      get matches() {
        return width >= minWidth;
      },
      media: query,
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  return {
    resize(newWidth: number) {
      width = newWidth;
      listeners.forEach((cb) => cb());
    },
  };
}

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

// Without matchMedia (plain jsdom) the grid assumes 4 columns → 2 rows of 4 = 8 per page.
describe("ProductGridComponent pagination", () => {
  it("shows only the first 8 products by default and renders pagination", () => {
    const fixture = setup(makeProducts(12));
    expect(cardCount(fixture)).toBe(8);
    expect(findPaginationNav(fixture)).not.toBeNull();
    expect(findButton(fixture, "2")).not.toBeNull();
  });

  it("shows the remaining products on page 2 and hides them from page 1", () => {
    const fixture = setup(makeProducts(12));
    findButton(fixture, "2")!.click();
    fixture.detectChanges();
    expect(cardCount(fixture)).toBe(4);
  });

  it("disables Prev on the first page and Next on the last page", () => {
    const fixture = setup(makeProducts(12));
    expect(findButton(fixture, "‹ Prev")!.disabled).toBe(true);
    expect(findButton(fixture, "Next ›")!.disabled).toBe(false);

    findButton(fixture, "2")!.click();
    fixture.detectChanges();
    expect(findButton(fixture, "‹ Prev")!.disabled).toBe(false);
    expect(findButton(fixture, "Next ›")!.disabled).toBe(true);
  });

  it("resets back to page 1 when the product list changes (a new search or filter)", () => {
    const fixture = setup(makeProducts(12));
    findButton(fixture, "2")!.click();
    fixture.detectChanges();
    expect(cardCount(fixture)).toBe(4);

    fixture.componentRef.setInput("products", makeProducts(10, "q"));
    fixture.detectChanges();
    expect(cardCount(fixture)).toBe(8);
    expect(findButton(fixture, "‹ Prev")!.disabled).toBe(true);
  });

  it("shows no pagination when everything fits on one page", () => {
    const fixture = setup(makeProducts(8));
    expect(cardCount(fixture)).toBe(8);
    expect(findPaginationNav(fixture)).toBeNull();
  });

  it("collapses many pages into an ellipsis around the current page", () => {
    const fixture = setup(makeProducts(200));
    const nav = findPaginationNav(fixture)!;
    expect(nav.textContent).toContain("…");
    expect(findButton(fixture, "1")).not.toBeNull();
    expect(findButton(fixture, "25")).not.toBeNull();
  });
});

describe("ProductGridComponent page size follows the column count", () => {
  const gridColumns = (fixture: ReturnType<typeof setup>) =>
    (fixture.nativeElement.querySelector(".grid") as HTMLElement).style.gridTemplateColumns;

  it.each([
    { width: 1440, columns: 5, perPage: 10 },
    { width: 1100, columns: 4, perPage: 8 },
    { width: 800, columns: 3, perPage: 6 },
    // Only two cards per row → three rows instead of two.
    { width: 390, columns: 2, perPage: 6 },
  ])("$width px wide → $columns columns, $perPage per page", ({ width, columns, perPage }) => {
    stubViewportWidth(width);
    const fixture = setup(makeProducts(40));
    expect(gridColumns(fixture)).toBe(`repeat(${columns}, minmax(0, 1fr))`);
    expect(cardCount(fixture)).toBe(perPage);
  });

  it("re-paginates on resize, staying on the page that holds the first product shown", () => {
    const viewport = stubViewportWidth(1440); // 10 per page
    const fixture = setup(makeProducts(40));
    findButton(fixture, "3")!.click(); // products 20–29
    fixture.detectChanges();

    viewport.resize(1100); // 8 per page → product 20 is on page 3 (16–23)
    fixture.detectChanges();
    const first = fixture.nativeElement.querySelector("app-product-card h3")?.textContent?.trim();
    expect(cardCount(fixture)).toBe(8);
    expect(first).toBe("Product 16");
    expect(findButton(fixture, "3")!.getAttribute("aria-current")).toBe("page");
  });
});
