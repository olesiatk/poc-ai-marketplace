import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { IconComponent } from "../icon/icon";
import { highlightHtml } from "../../lib/search";
import { formatDate, formatPrice, formatRating } from "../../lib/format";
import { listenToHost, sendModal, sendScrollIntoView } from "../../lib/post-message";
import type { MatchInfo, Product, Review, ReviewsMap } from "../../models/product.model";

// Raw marketplace bookkeeping that means nothing to a shopper.
const HIDDEN_DETAIL_KEYS = new Set([
  "UPC", "Item model number", "Is Discontinued By Manufacturer", "Best Sellers Rank", "Date First Available", "ASIN",
]);
const MAX_DETAILS = 8;

// Enough viewport for the modal to render comfortably when a host has
// sized the <iframe> to fit shorter content behind it.
const MODAL_MIN_HEIGHT = 640;

@Component({
  selector: "app-product-modal",
  imports: [IconComponent],
  templateUrl: "./product-modal.html",
})
export class ProductModalComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly product = input.required<Product>();
  readonly reviews = input.required<ReviewsMap>();
  readonly matchInfo = input<MatchInfo | null>(null);

  readonly close = output<void>();

  protected readonly formatPrice = formatPrice;
  protected readonly formatRating = formatRating;
  protected readonly formatDate = formatDate;

  /** Index into product().images of the photo shown large; reset per modal since a new product mounts a new modal. */
  protected readonly activeImage = signal(0);
  protected readonly mainImageUrl = computed(() => {
    const img = this.product().images[this.activeImage()];
    return img ? (img.hiRes ?? img.large) : null;
  });

  /** Only plain string details (the raw data occasionally nests objects), minus internal bookkeeping keys. */
  protected readonly detailEntries = computed(() =>
    Object.entries(this.product().details)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && !HIDDEN_DETAIL_KEYS.has(entry[0]))
      .slice(0, MAX_DETAILS)
  );

  protected readonly reviewList = computed<Review[]>(() => this.reviews()[this.product().id] || []);

  private stopHostListener: (() => void) | null = null;
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  ngOnInit(): void {
    document.body.style.overflow = "hidden";
    sendModal(true, MODAL_MIN_HEIGHT);
    // If embedded, a click/Escape on the host's own dimmed page (outside
    // this iframe) is forwarded here so it closes the modal the same way
    // a click on our own overlay or an in-frame Escape press would.
    this.stopHostListener = listenToHost({ onDismiss: () => this.close.emit() });
  }

  ngAfterViewInit(): void {
    // Ask the host to scroll this modal into view — if the host has sized
    // the <iframe> to fit shorter page content, the modal box (position:
    // fixed, so anchored to the iframe's own viewport) could otherwise
    // open mostly or fully off the host's visible screen.
    const root: HTMLElement = this.elementRef.nativeElement;
    const modalBox: HTMLElement | null = root.querySelector('[data-tour="product-modal"]');
    if (!modalBox) return;
    const rect = modalBox.getBoundingClientRect();
    sendScrollIntoView(rect.top + window.scrollY, rect.height);
  }

  ngOnDestroy(): void {
    document.body.style.overflow = "";
    sendModal(false);
    this.stopHostListener?.();
  }

  @HostListener("document:keydown", ["$event"])
  protected onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") this.close.emit();
  }

  protected onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close.emit();
  }

  protected readonly hasMatchedTerms = computed(() => {
    const info = this.matchInfo();
    return !!info && (info.directTerms.size > 0 || info.synonymTerms.size > 0);
  });

  protected highlight(text: string): string {
    const info = this.matchInfo();
    return highlightHtml(text, info?.directTerms ?? null, info?.synonymTerms ?? null);
  }

  protected starsArray(count: number): number[] {
    return Array.from({ length: Math.round(count) });
  }
}
