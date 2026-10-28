import { Component, computed, input } from "@angular/core";
import { IconComponent } from "../icon/icon";

/** Five stars filled up to `value` (fractions too): grey stars with green ones clipped on top. */
@Component({
  selector: "app-stars",
  imports: [IconComponent],
  template: `
    <span class="flex gap-0.5" aria-hidden="true">
      @for (fill of fills(); track $index) {
        <span class="relative flex-none text-line" [style.width.px]="size()" [style.height.px]="size()">
          <app-icon name="star" [size]="size()" />
          <span class="absolute inset-y-0 left-0 overflow-hidden text-green" [style.width.%]="fill">
            <app-icon name="star" [size]="size()" />
          </span>
        </span>
      }
    </span>
  `,
  host: { class: "inline-flex" },
})
export class StarsComponent {
  readonly value = input.required<number>();
  readonly size = input(18);

  protected readonly fills = computed(() => [0, 1, 2, 3, 4].map((i) => Math.max(0, Math.min(1, this.value() - i)) * 100));
}
