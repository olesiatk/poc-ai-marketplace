import { Component, ElementRef, HostListener, computed, inject, input, output, signal } from "@angular/core";
import { IconComponent } from "../icon/icon";

/**
 * A multi-select dropdown: a 44px trigger showing the ticked options (or
 * the placeholder), opening a menu of checkbox rows right under it. Ticking
 * keeps the menu open for more; it closes on an outside click or Escape.
 */
@Component({
  selector: "app-filter-select",
  imports: [IconComponent],
  templateUrl: "./filter-select.html",
  host: { class: "block relative" },
})
export class FilterSelectComponent {
  readonly id = input.required<string>();
  /** Accessible name of the trigger, e.g. "Category". */
  readonly label = input.required<string>();
  /** The ticked options; empty = all. */
  readonly value = input.required<readonly string[]>();
  readonly options = input.required<string[]>();
  readonly placeholder = input.required<string>();

  readonly valueChange = output<string[]>();

  protected readonly isOpen = signal(false);
  /** What the trigger shows: "Cream, Lotion", or the placeholder. */
  protected readonly summary = computed(() => this.value().join(", ") || this.placeholder());

  private readonly host: HTMLElement = inject(ElementRef).nativeElement;

  @HostListener("document:mousedown", ["$event"])
  protected onDocumentMouseDown(event: MouseEvent): void {
    if (this.isOpen() && !this.host.contains(event.target as Node)) this.isOpen.set(false);
  }

  @HostListener("keydown.escape")
  protected onEscape(): void {
    if (!this.isOpen()) return;
    this.isOpen.set(false);
    this.host.querySelector("button")?.focus();
  }

  protected toggleOpen(): void {
    this.isOpen.update((open) => !open);
  }

  protected isSelected(option: string): boolean {
    return this.value().includes(option);
  }

  protected toggle(option: string): void {
    const value = this.value();
    this.valueChange.emit(this.isSelected(option) ? value.filter((v) => v !== option) : [...value, option]);
  }
}
