import { Component, computed, effect, input, output, signal } from "@angular/core";
import { IconComponent } from "../icon/icon";

const PAGE_SIZE = 10;

/**
 * A searchable, incrementally-loaded multi-select dropdown — a styled
 * replacement for a plain `<select multiple>`. Typing filters the option
 * list; scrolling near the bottom of the open list reveals the next 10
 * matches; clicking an option ticks or unticks it (the list stays open),
 * the first option clears them all. Kept as a text-input + listbox combo
 * (not a native select) specifically because native selects can't do any
 * of that.
 */
@Component({
  selector: "app-filter-select",
  imports: [IconComponent],
  templateUrl: "./filter-select.html",
})
export class FilterSelectComponent {
  readonly id = input.required<string>();
  readonly label = input.required<string>();
  /** The ticked options; empty = all. */
  readonly value = input.required<readonly string[]>();
  readonly options = input.required<string[]>();
  readonly placeholder = input.required<string>();
  /** Shows the "from your query" tag next to the label — the value was read from the search text. */
  readonly fromQuery = input(false);

  readonly valueChange = output<string[]>();

  /** What the closed field shows: "Cream, Lotion", or nothing (then the placeholder). */
  protected readonly summary = computed(() => this.value().join(", "));

  protected readonly isOpen = signal(false);
  protected readonly query = signal("");
  protected readonly visibleCount = signal(PAGE_SIZE);

  protected readonly filteredOptions = computed(() => {
    const q = this.query().trim().toLowerCase();
    const all = this.options();
    return q ? all.filter((opt) => opt.toLowerCase().includes(q)) : all;
  });

  protected readonly visibleOptions = computed(() => this.filteredOptions().slice(0, this.visibleCount()));
  protected readonly hasMore = computed(() => this.visibleCount() < this.filteredOptions().length);

  constructor() {
    // A fresh options list (new catalog data) shouldn't keep a stale filter/page.
    effect(() => {
      this.options();
      this.query.set("");
      this.visibleCount.set(PAGE_SIZE);
    });
  }

  protected onFocus(): void {
    this.isOpen.set(true);
    this.query.set("");
    this.visibleCount.set(PAGE_SIZE);
  }

  protected onBlur(): void {
    this.isOpen.set(false);
  }

  protected onEscape(): void {
    this.isOpen.set(false);
  }

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.visibleCount.set(PAGE_SIZE);
  }

  protected onScroll(event: Event): void {
    if (!this.hasMore()) return;
    const el = event.target as HTMLElement;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) {
      this.visibleCount.update((n) => n + PAGE_SIZE);
    }
  }

  protected isSelected(option: string): boolean {
    return this.value().includes(option);
  }

  /** Ticks or unticks one option, keeping the list open for more. */
  protected toggle(option: string): void {
    const value = this.value();
    this.valueChange.emit(this.isSelected(option) ? value.filter((v) => v !== option) : [...value, option]);
  }

  protected clear(): void {
    this.isOpen.set(false);
    this.query.set("");
    this.valueChange.emit([]);
  }
}
