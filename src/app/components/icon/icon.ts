import { Component, input } from "@angular/core";

export type IconName = "mic" | "search" | "close" | "info" | "star" | "chevron-down";

@Component({
  selector: "app-icon",
  templateUrl: "./icon.html",
  styleUrl: "./icon.css",
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly size = input<number>(24);
}
