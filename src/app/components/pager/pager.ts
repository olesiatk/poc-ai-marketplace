import { Component, computed, input, output } from "@angular/core";
import { IconComponent } from "../icon/icon";
import { pageSlots } from "../../lib/pagination";

/** One-line pagination: ← 1 2 3 … 9 →, the current page filled in ink. */
@Component({
  selector: "app-pager",
  imports: [IconComponent],
  template: `
    <nav class="flex items-center justify-center gap-2 mt-2" [attr.aria-label]="label()">
      <button type="button" class="btn-icon interactive" aria-label="Previous page" [disabled]="page() === 1" (click)="go(page() - 1)">
        <app-icon name="arrow-left" [size]="20" />
      </button>
      @for (slot of slots(); track $index) {
        @if (slot === "gap") {
          <span class="w-7 text-center text-muted" aria-hidden="true">…</span>
        } @else {
          <button
            type="button"
            class="interactive min-w-10 h-10 px-2.5 border font-bold"
            [class]="slot === page() ? 'bg-ink border-ink text-white' : 'bg-white border-line hover:border-ink'"
            [attr.aria-current]="slot === page() ? 'page' : null"
            (click)="go(slot)"
          >
            {{ slot }}
          </button>
        }
      }
      <button type="button" class="btn-icon interactive" aria-label="Next page" [disabled]="page() === total()" (click)="go(page() + 1)">
        <app-icon name="arrow-right" [size]="20" />
      </button>
    </nav>
  `,
})
export class PagerComponent {
  /** 1-based. */
  readonly page = input.required<number>();
  readonly total = input.required<number>();
  readonly label = input("Pagination");

  readonly pageChange = output<number>();

  protected readonly slots = computed(() => pageSlots(this.page(), this.total()));

  protected go(page: number): void {
    if (page >= 1 && page <= this.total() && page !== this.page()) this.pageChange.emit(page);
  }
}
