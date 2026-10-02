import { Component, computed, input, output, signal } from "@angular/core";
import { IconComponent } from "../icon/icon";

/** Minimum-rating choices, best first; 0 = any rating. */
export const RATING_OPTIONS: readonly number[] = [0, 4.5, 4, 3.5, 3];

type StarFill = "full" | "half" | "empty";

/** Five stars for a rating threshold: 3.5 → full, full, full, half, empty. */
function starsFor(rating: number): StarFill[] {
  return [1, 2, 3, 4, 5].map((n) => (rating >= n ? "full" : rating >= n - 0.5 ? "half" : "empty"));
}

/**
 * The minimum-rating filter: a dropdown whose options are star rows
 * ("★★★★½ 4.5 & up"), matching the stars on the product cards. A listbox of
 * its own rather than FilterSelect — that one is a type-to-search text
 * input, pointless for five fixed options and unable to show icons when
 * closed. Keyboard: Enter/Space/↓ open; ↑/↓/Home/End move; Enter picks;
 * Escape/Tab close.
 */
@Component({
  selector: "app-rating-select",
  imports: [IconComponent],
  templateUrl: "./rating-select.html",
})
export class RatingSelectComponent {
  readonly id = input.required<string>();
  readonly value = input.required<number>();

  readonly valueChange = output<number>();

  protected readonly options = RATING_OPTIONS.map((rating) => ({
    rating,
    stars: starsFor(rating),
    label: rating ? `${rating.toFixed(1)} & up` : "Any rating",
    ariaLabel: rating ? `${rating} stars and up` : "Any rating",
  }));

  protected readonly isOpen = signal(false);
  /** Index of the keyboard-highlighted option while open. */
  protected readonly active = signal(0);
  protected readonly selected = computed(() => this.options.find((o) => o.rating === this.value()) ?? this.options[0]);

  protected open(): void {
    this.active.set(Math.max(0, this.options.indexOf(this.selected())));
    this.isOpen.set(true);
  }

  protected close(): void {
    this.isOpen.set(false);
  }

  protected toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  protected pick(rating: number): void {
    this.close();
    if (rating !== this.value()) this.valueChange.emit(rating);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const last = this.options.length - 1;
    if (!this.isOpen()) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        this.open();
      }
      return;
    }
    const moves: Record<string, () => number> = {
      ArrowDown: () => Math.min(last, this.active() + 1),
      ArrowUp: () => Math.max(0, this.active() - 1),
      Home: () => 0,
      End: () => last,
    };
    if (moves[event.key]) {
      event.preventDefault();
      this.active.set(moves[event.key]());
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.pick(this.options[this.active()].rating);
    } else if (event.key === "Escape") {
      event.preventDefault();
      this.close();
    } else if (event.key === "Tab") {
      this.close();
    }
  }
}
