import { Component, input, output } from "@angular/core";
import { StarsComponent } from "../stars/stars";

/** Minimum-rating choices, best first; 0 = any rating. */
export const RATING_OPTIONS: readonly number[] = [0, 4.5, 4, 3.5, 3];

/** The minimum-rating filter: a radio group of star rows ("★★★★½ 4.5 & up"). */
@Component({
  selector: "app-rating-select",
  imports: [StarsComponent],
  template: `
    <div role="radiogroup" aria-label="Rating" class="flex flex-col pt-1">
      @for (opt of options; track opt.rating) {
        <label class="check-row min-h-[34px] px-2 -mx-2">
          <input type="radio" [name]="id()" [checked]="opt.rating === value()" (change)="valueChange.emit(opt.rating)" />
          <span class="check-box check-box--radio">
            <span class="check-box__mark w-1.5 h-1.5 rounded-full bg-white"></span>
          </span>
          @if (opt.rating) {
            <app-stars [value]="opt.rating" [size]="18" />
          }
          <span>{{ opt.label }}</span>
        </label>
      }
    </div>
  `,
})
export class RatingSelectComponent {
  readonly id = input.required<string>();
  readonly value = input.required<number>();

  readonly valueChange = output<number>();

  protected readonly options = RATING_OPTIONS.map((rating) => ({
    rating,
    label: rating ? `${rating.toFixed(1)} & up` : "Any rating",
  }));
}
