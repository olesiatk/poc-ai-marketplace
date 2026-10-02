import { Component, ElementRef, OnDestroy, computed, inject, signal } from "@angular/core";
import type { Driver } from "driver.js";
import { HeroComponent } from "./components/hero/hero";
import { FiltersBarComponent, type FilterChangeEvent } from "./components/filters-bar/filters-bar";
import { ProductGridComponent } from "./components/product-grid/product-grid";
import { ProductModalComponent } from "./components/product-modal/product-modal";
import {
  SearchComparisonComponent,
  type ComparisonSelection,
  type ComparisonSide,
} from "./components/search-comparison/search-comparison";
import { ACTIVE_DATASET } from "./datasets/active";
import { AiResults, type AiResult, type AiSnapshotFile } from "./lib/ai-results";
import { groupReviews, itemFormOptions, itemForms } from "./lib/catalog";
import { missedByKeyword, rankChanges } from "./lib/comparison";
import { formatDate } from "./lib/format";
import { aiSearch, isGroqConfigured } from "./lib/groq";
import { watchIframeHeight } from "./lib/iframe-resize";
import { isEmbedded, listenToHost, sendFrameReady, sendTourStatus } from "./lib/post-message";
import { parsePriceQuery } from "./lib/price-query";
import { countQueryWords, localHeuristicSearch, wordFormProducts } from "./lib/search";
import { buildVocabulary } from "./lib/suggestions";
import { DEMO_QUERY, createTour } from "./lib/tour";
import type { Filters, MatchesMap, Product, Review, ReviewsMap } from "./models/product.model";

const EMPTY_FILTERS: Filters = { category: "", itemForm: "", maxPrice: Infinity, minRating: 0 };
const NO_MATCHES: MatchesMap = new Map();

/** The query shown on first load — the catalog's first preset, served from the recording. */
const DEFAULT_QUERY = ACTIVE_DATASET.presetQueries[0]?.query ?? "";

function uniqueSorted(arr: string[]): string[] {
  return [...new Set(arr)].sort((a, b) => a.localeCompare(b, "en"));
}

/** `products` that are in `matches`, best score first (most-rated breaks ties). */
function rankedBy(products: Product[], matches: MatchesMap): Product[] {
  return products
    .filter((p) => matches.has(p.id))
    .sort((a, b) => matches.get(b.id)!.score - matches.get(a.id)!.score || b.ratingCount - a.ratingCount);
}

@Component({
  selector: "app-root",
  imports: [HeroComponent, FiltersBarComponent, ProductGridComponent, ProductModalComponent, SearchComparisonComponent],
  templateUrl: "./app.html",
})
export class App implements OnDestroy {
  // Not vh-based when embedded: 100vh inside an <iframe> resolves against
  // the iframe's own rendered height, which the host sets FROM our own
  // reported content height (poc-resize-iframe) — if content is shorter
  // than the iframe's current height, min-h-screen would keep the reported
  // height pinned at the iframe's last height, and the host setting the
  // iframe to that height changes what 100vh means next report, forming a
  // resize feedback loop. Only meaningful in standalone/dev use anyway,
  // where the iframe height isn't externally driven by us.
  protected readonly embedded = isEmbedded();
  protected readonly presets = ACTIVE_DATASET.presetQueries;

  protected readonly products = signal<Product[]>([]);
  protected readonly reviews = signal<ReviewsMap>({});
  protected readonly loadError = signal<string | null>(null);

  protected readonly filters = signal<Filters>(EMPTY_FILTERS);
  protected readonly searchValue = signal("");
  protected readonly query = signal("");
  protected readonly aiResult = signal<AiResult | null>(null);
  protected readonly isSearching = signal(false);
  protected readonly selected = signal<ComparisonSelection | null>(null);

  private aiResults: AiResults | null = null;
  // Guards against a slow AI response for an older query overwriting a newer one.
  private searchSeq = 0;
  // True while the price slider sits where a query's budget ("under $20") put
  // it — so the next query without a budget puts it back. Dragging it clears this.
  private maxPriceFromQuery = false;

  protected readonly priceLimit = computed(() => {
    const list = this.products();
    return list.length ? Math.ceil(Math.max(...list.map((p) => p.price))) : 0;
  });

  protected readonly searchVocabulary = computed(() => buildVocabulary(this.products()));

  protected readonly filterOptions = computed(() => {
    const list = this.products();
    return {
      categories: uniqueSorted(list.map((p) => p.category)),
      itemForms: itemFormOptions(list),
    };
  });

  /** The catalog after the manual filters — shared by the browse grid and both comparison sides. */
  protected readonly filteredCatalog = computed(() => {
    const filters = this.filters();
    return this.products().filter(
      (p) =>
        (!filters.category || p.category === filters.category) &&
        (!filters.itemForm || itemForms(p).includes(filters.itemForm)) &&
        p.price <= filters.maxPrice &&
        p.averageRating >= filters.minRating
    );
  });

  /** No query: the whole (filtered) catalog, most-rated first. */
  protected readonly browseProducts = computed(() => [...this.filteredCatalog()].sort((a, b) => b.ratingCount - a.ratingCount));

  /**
   * The "without AI" side: the same local search with no concept groups —
   * stemming and field weighting, but no synonym expansion and no LLM.
   * Synchronous and instant, so it shows while the AI side is still working.
   */
  protected readonly keywordMatches = computed(() => {
    const query = this.query();
    return query ? localHeuristicSearch(query, this.products(), this.reviews(), []) : NO_MATCHES;
  });
  protected readonly aiMatches = computed(() => this.aiResult()?.matches ?? NO_MATCHES);

  protected readonly keywordProducts = computed(() => rankedBy(this.filteredCatalog(), this.keywordMatches()));
  protected readonly aiProducts = computed(() => rankedBy(this.filteredCatalog(), this.aiMatches()));

  private readonly keywordIds = computed(() => this.keywordProducts().map((p) => p.id));
  private readonly aiIds = computed(() => this.aiProducts().map((p) => p.id));
  protected readonly rankChanges = computed(() => rankChanges(this.keywordIds(), this.aiIds()));
  protected readonly queryWordCount = computed(() => countQueryWords(this.query()));
  /** Keyword results that contain every query word — usually a small share of the "any word" total. */
  protected readonly keywordAllWordsCount = computed(() => {
    const matches = this.keywordMatches();
    return this.keywordProducts().filter((p) => matches.get(p.id)?.matchesAllWords).length;
  });
  protected readonly missedCount = computed(() => missedByKeyword(this.keywordIds(), this.aiIds()));

  protected readonly aiNote = computed(() => {
    const result = this.aiResult();
    if (!result) return null;
    if (result.mode === "recorded") return `Recorded AI run · ${formatDate(result.recordedAt!)}`;
    if (result.mode === "groq") return "Live AI";
    return result.aiUnavailable ? "AI busy · local synonyms" : "Local synonyms";
  });

  protected readonly statusMessage = computed(() => {
    if (!this.query()) return "";
    if (this.isSearching()) return "AI is analyzing your query…";
    if (!this.aiResult()) return "";
    const missed = this.missedCount();
    const aiCount = this.aiProducts().length;
    const keywordCount = this.keywordProducts().length;
    if (missed > 0) return `AI found ${missed} ${wordFormProducts(missed)} keyword search missed.`;
    if (aiCount === 0) return "AI found nothing relevant for this query. Try rephrasing it.";
    // Nothing new, but a much shorter list — the win here is cutting the noise.
    // Say what the keyword count really is, so the bigger number doesn't read as the better search.
    if (aiCount < keywordCount) {
      const found =
        this.queryWordCount() > 1
          ? `${keywordCount} products with any of your words (${this.keywordAllWordsCount()} with all of them)`
          : `${keywordCount} products with your word`;
      return `Keyword search returned ${found} — AI kept the ${aiCount} that actually fit.`;
    }
    return "Both searches agree — AI just put the best ones first.";
  });

  protected readonly selectedProduct = computed(() => {
    const sel = this.selected();
    return sel ? this.products().find((p) => p.id === sel.id) ?? null : null;
  });

  /** Highlighting follows the side the product was opened from; none from the browse grid. */
  protected readonly selectedMatchInfo = computed(() => {
    const sel = this.selected();
    if (!sel || !this.query()) return null;
    return (sel.side === "keyword" ? this.keywordMatches() : this.aiMatches()).get(sel.id) ?? null;
  });

  private tourDriver: Driver | null = null;
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly stopHeightWatch: () => void;
  private readonly stopHostListener: () => void;

  constructor() {
    Promise.all([
      fetch(ACTIVE_DATASET.productsUrl).then((r) => r.json()),
      fetch(ACTIVE_DATASET.reviewsUrl).then((r) => r.json()),
      // Optional — without it, preset queries just go to the live AI like any other.
      fetch(ACTIVE_DATASET.aiSnapshotsUrl)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([products, reviews, snapshot]: [Product[], Review[], AiSnapshotFile | null]) => {
        this.products.set(products);
        this.reviews.set(groupReviews(reviews));
        this.filters.update((f) => ({ ...f, maxPrice: this.priceLimit() }));
        this.aiResults = new AiResults(
          snapshot,
          aiSearch,
          (query, list, reviewsMap) => localHeuristicSearch(query, list, reviewsMap),
          isGroqConfigured
        );
        // Open straight on a comparison, so the difference is visible without typing anything.
        this.runQuery(DEFAULT_QUERY);
      })
      .catch((err) => this.loadError.set(err.message));

    // No-ops unless this app is actually running inside a host's <iframe>.
    sendFrameReady();
    const heightWatch = watchIframeHeight(this.elementRef.nativeElement);
    this.stopHeightWatch = heightWatch.stop;
    this.stopHostListener = listenToHost({
      onAskForHeight: () => heightWatch.reportNow(),
      onDismiss: () => {
        // driver.js's public destroy() bypasses onDestroyStarted (it's
        // the "force" path), so the tour's own reset callback would
        // never run from here — reset explicitly first.
        if (this.tourDriver?.isActive()) {
          this.resetTourDemo();
          this.tourDriver.destroy();
        }
      },
    });
  }

  /** Undoes the tour's demo: closes the modal and puts the default comparison back. */
  private resetTourDemo(): void {
    this.selected.set(null);
    this.runQuery(DEFAULT_QUERY);
    sendTourStatus(false);
  }

  protected onFilterChange(event: FilterChangeEvent): void {
    if (event.field === "maxPrice") this.maxPriceFromQuery = false;
    this.filters.update((f) => ({ ...f, [event.field]: event.value }));
  }

  protected onResetFilters(): void {
    this.maxPriceFromQuery = false;
    this.filters.set({ ...EMPTY_FILTERS, maxPrice: this.priceLimit() });
    this.onClearQuery();
  }

  /** Moves the price slider to the query's budget, or back to the top if the previous query had set it. */
  private applyQueryPrice(query: string): void {
    const { maxPrice } = parsePriceQuery(query);
    if (maxPrice !== null) {
      this.maxPriceFromQuery = true;
      this.filters.update((f) => ({ ...f, maxPrice: Math.min(maxPrice, this.priceLimit()) }));
    } else {
      this.releaseQueryPrice();
    }
  }

  private releaseQueryPrice(): void {
    if (!this.maxPriceFromQuery) return;
    this.maxPriceFromQuery = false;
    this.filters.update((f) => ({ ...f, maxPrice: this.priceLimit() }));
  }

  /** Fills the search box with `query` and runs it — for preset chips, first load and the tour. */
  protected runQuery(query: string): Promise<void> {
    this.searchValue.set(query);
    return this.onSearch(query);
  }

  protected async onSearch(rawQuery: string): Promise<void> {
    const trimmed = rawQuery.trim();
    const seq = ++this.searchSeq;
    this.applyQueryPrice(trimmed);
    this.query.set(trimmed);
    this.aiResult.set(null);
    if (!trimmed || !this.aiResults) {
      this.isSearching.set(false);
      return;
    }

    this.isSearching.set(true);
    const result = await this.aiResults.search(trimmed, this.products(), this.reviews());
    if (seq !== this.searchSeq) return;
    this.aiResult.set(result);
    this.isSearching.set(false);
  }

  protected onClearQuery(): void {
    this.searchSeq++;
    this.releaseQueryPrice();
    this.searchValue.set("");
    this.query.set("");
    this.aiResult.set(null);
    this.isSearching.set(false);
  }

  protected onSelect(id: string, side: ComparisonSide | null = null): void {
    this.selected.set(side ? { id, side } : { id, side: "ai" });
  }

  ngOnDestroy(): void {
    this.tourDriver?.destroy();
    this.stopHeightWatch();
    this.stopHostListener();
  }

  protected startTour(): void {
    this.tourDriver ??= createTour({
      runDemoSearch: () => this.runQuery(DEMO_QUERY),
      openFirstResult: () => {
        const first = this.aiProducts()[0];
        if (first) this.selected.set({ id: first.id, side: "ai" });
      },
      reset: () => this.resetTourDemo(),
    });
    sendTourStatus(true);
    this.tourDriver.drive();
  }
}
