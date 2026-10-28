import { afterEach, describe, expect, it } from "vitest";
import { TestBed } from "@angular/core/testing";
import { ProductGridComponent } from "./product-grid";
import type { Product } from "../../models/product.model";

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
  fixture.detectChanges();
  return fixture;
}

function cardCount(fixture: ReturnType<typeof setup>): number {
  return fixture.nativeElement.querySelectorAll("app-product-row").length;
}

function findPaginationNav(fixture: ReturnType<typeof setup>): HTMLElement | null {
  return fixture.nativeElement.querySelector("nav[aria-label='Pagination']");
}

function findButton(fixture: ReturnType<typeof setup>, text: string): HTMLButtonElement | null {
  const buttons: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll("button"));
  return buttons.find((b) => b.textContent?.trim() === text || b.getAttribute("aria-label") === text) ?? null;
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

// Without matchMedia (plain jsdom) the grid assumes 2 columns → 5 rows of 2 = 10 per page.
describe("ProductGridComponent pagination", () => {
  it("shows only the first 10 products by default and renders pagination", () => {
    const fixture = setup(makeProducts(14));
    expect(cardCount(fixture)).toBe(10);
    expect(findPaginationNav(fixture)).not.toBeNull();
    expect(findButton(fixture, "2")).not.toBeNull();
  });

  it("shows the remaining products on page 2 and hides them from page 1", () => {
    const fixture = setup(makeProducts(14));
    findButton(fixture, "2")!.click();
    fixture.detectChanges();
    expect(cardCount(fixture)).toBe(4);
  });

  it("disables Previous on the first page and Next on the last page", () => {
    const fixture = setup(makeProducts(14));
    expect(findButton(fixture, "Previous page")!.disabled).toBe(true);
    expect(findButton(fixture, "Next page")!.disabled).toBe(false);

    findButton(fixture, "2")!.click();
    fixture.detectChanges();
    expect(findButton(fixture, "Previous page")!.disabled).toBe(false);
    expect(findButton(fixture, "Next page")!.disabled).toBe(true);
  });

  it("resets back to page 1 when the product list changes (a new filter)", () => {
    const fixture = setup(makeProducts(14));
    findButton(fixture, "2")!.click();
    fixture.detectChanges();
    expect(cardCount(fixture)).toBe(4);

    fixture.componentRef.setInput("products", makeProducts(12, "q"));
    fixture.detectChanges();
    expect(cardCount(fixture)).toBe(10);
    expect(findButton(fixture, "Previous page")!.disabled).toBe(true);
  });

  it("shows no pagination when everything fits on one page", () => {
    const fixture = setup(makeProducts(10));
    expect(cardCount(fixture)).toBe(10);
    expect(findPaginationNav(fixture)).toBeNull();
  });

  it("collapses many pages into an ellipsis", () => {
    const fixture = setup(makeProducts(200));
    const nav = findPaginationNav(fixture)!;
    expect(nav.textContent).toContain("…");
    expect(findButton(fixture, "1")).not.toBeNull();
    expect(findButton(fixture, "20")).not.toBeNull();
  });
});

describe("ProductGridComponent page size follows the column count", () => {
  const gridColumns = (fixture: ReturnType<typeof setup>) =>
    (fixture.nativeElement.querySelector(".grid") as HTMLElement).style.gridTemplateColumns;

  it.each([
    { width: 1440, columns: 2, perPage: 10 },
    { width: 900, columns: 1, perPage: 5 },
    { width: 390, columns: 1, perPage: 5 },
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

    viewport.resize(900); // 5 per page → product 20 is on page 5 (20–24)
    fixture.detectChanges();
    const first = fixture.nativeElement.querySelector("app-product-row [title]")?.textContent?.trim();
    expect(cardCount(fixture)).toBe(5);
    expect(first).toBe("Product 20");
    expect(findButton(fixture, "5")!.getAttribute("aria-current")).toBe("page");
  });
});
