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
import { formatDate, formatPrice } from "./lib/format";
import { aiSearch, isGroqConfigured } from "./lib/groq";
import { watchIframeHeight } from "./lib/iframe-resize";
import { isEmbedded, listenToHost, sendFrameReady, sendTourStatus } from "./lib/post-message";
import { parseQueryFilters, type QueryFilters } from "./lib/query-filters";
import { countQueryWords, localHeuristicSearch, wordFormProducts } from "./lib/search";
import { buildVocabulary } from "./lib/suggestions";
import { DEMO_QUERY, createTour } from "./lib/tour";
import type { Filters, MatchesMap, Product, Review, ReviewsMap } from "./models/product.model";

const EMPTY_FILTERS: Filters = { categories: [], itemForms: [], maxPrice: Infinity, minRating: 0 };

type QueryFilterField = keyof QueryFilters;
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
  /** Seconds left before the AI side can search live (the free plan allows one live search a minute); 0 = not waiting. */
  protected readonly aiWaitSeconds = signal(0);
  protected readonly aiLoadingText = computed(() =>
    this.aiWaitSeconds() ? `AI will search in ${this.aiWaitSeconds()} s…` : "AI is analyzing the catalog…"
  );
  protected readonly selected = signal<ComparisonSelection | null>(null);

  private aiResults: AiResults | null = null;
  // Guards against a slow AI response for an older query overwriting a newer one.
  private searchSeq = 0;
  /**
   * The filters the current query set by itself ("face cream under $25" →
   * category, item form, max price) — shown as "from your query" on the
   * filters bar, and put back by the next query that doesn't name them.
   * Changing one by hand takes it off this list.
   */
  protected readonly filtersFromQuery = signal<ReadonlySet<QueryFilterField>>(new Set());

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
        (!filters.categories.length || filters.categories.includes(p.category)) &&
        (!filters.itemForms.length || itemForms(p).some((form) => filters.itemForms.includes(form))) &&
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
  /** The query minus the filters it names ("under $25", "cream form") — the words both searches look for. */
  private readonly searchText = computed(() => this.queryFilters(this.query()).text);
  protected readonly keywordMatches = computed(() => {
    const query = this.query();
    return query ? localHeuristicSearch(this.searchText(), this.products(), this.reviews(), []) : NO_MATCHES;
  });
  protected readonly aiMatches = computed(() => this.aiResult()?.matches ?? NO_MATCHES);

  protected readonly keywordProducts = computed(() => rankedBy(this.filteredCatalog(), this.keywordMatches()));
  protected readonly aiProducts = computed(() => rankedBy(this.filteredCatalog(), this.aiMatches()));

  private readonly keywordIds = computed(() => this.keywordProducts().map((p) => p.id));
  private readonly aiIds = computed(() => this.aiProducts().map((p) => p.id));
  protected readonly rankChanges = computed(() => rankChanges(this.keywordIds(), this.aiIds()));
  protected readonly queryWordCount = computed(() => countQueryWords(this.searchText()));
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
    if (this.aiWaitSeconds()) return `AI will search in ${this.aiWaitSeconds()} s… (the demo allows one live AI search a minute)`;
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
          (query, list, reviewsMap) => localHeuristicSearch(this.queryFilters(query).text, list, reviewsMap),
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
    this.filtersFromQuery.update((set) => new Set([...set].filter((f) => f !== event.field)));
    this.filters.update((f) => ({ ...f, [event.field]: event.value }));
  }

  protected onResetFilters(): void {
    this.filtersFromQuery.set(new Set());
    this.filters.set({ ...EMPTY_FILTERS, maxPrice: this.priceLimit() });
    this.onClearQuery();
  }

  /** What `query` would set, out of the values the filter dropdowns offer. */
  private queryFilters(query: string): QueryFilters {
    const { categories, itemForms } = this.filterOptions();
    return parseQueryFilters(query, categories, itemForms);
  }

  /**
   * Sets the filters the query names; puts back the ones the previous query
   * had set but this one doesn't (filters set by hand stay as they are).
   */
  private applyQueryFilters(query: string): void {
    const found = this.queryFilters(query);
    const previous = this.filtersFromQuery();
    const next = { ...this.filters() };
    const fromQuery = new Set<QueryFilterField>();
    if (found.maxPrice !== null) {
      next.maxPrice = Math.min(found.maxPrice, this.priceLimit());
      fromQuery.add("maxPrice");
    } else if (previous.has("maxPrice")) {
      next.maxPrice = this.priceLimit();
    }
    for (const field of ["categories", "itemForms"] as const) {
      if (found[field].length) {
        next[field] = found[field];
        fromQuery.add(field);
      } else if (previous.has(field)) {
        next[field] = [];
      }
    }
    this.filters.set(next);
    this.filtersFromQuery.set(fromQuery);
  }

  /** Fills the search box with `query` and runs it — for preset chips, first load and the tour. */
  protected runQuery(query: string): Promise<void> {
    this.searchValue.set(query);
    return this.onSearch(query);
  }

  protected async onSearch(rawQuery: string): Promise<void> {
    const trimmed = rawQuery.trim();
    const seq = ++this.searchSeq;
    this.applyQueryFilters(trimmed);
    this.query.set(trimmed);
    this.aiResult.set(null);
    this.aiWaitSeconds.set(0);
    if (!trimmed || !this.aiResults) {
      this.isSearching.set(false);
      return;
    }

    this.isSearching.set(true);
    // Within the live-call cooldown: count down, then search for real —
    // unless a newer search replaced this one meanwhile (then only the
    // latest query goes to the AI).
    const wait = this.aiResults.waitMs(trimmed);
    if (wait > 0 && !(await this.waitForLiveTurn(wait, seq))) return;
    const result = await this.aiResults.search(trimmed, this.products(), this.reviews());
    if (seq !== this.searchSeq) return;
    this.aiResult.set(result);
    this.isSearching.set(false);
  }

  /** Ticks `aiWaitSeconds` down over `ms`; false if search `seq` was replaced meanwhile. */
  private async waitForLiveTurn(ms: number, seq: number): Promise<boolean> {
    const end = Date.now() + ms;
    while (seq === this.searchSeq) {
      const left = end - Date.now();
      if (left <= 0) {
        this.aiWaitSeconds.set(0);
        return true;
      }
      this.aiWaitSeconds.set(Math.ceil(left / 1000));
      // Wake on the next whole second, so the countdown ticks evenly.
      await new Promise((resolve) => setTimeout(resolve, left % 1000 || 1000));
    }
    return false;
  }

  protected onClearQuery(): void {
    this.searchSeq++;
    this.aiWaitSeconds.set(0);
    this.applyQueryFilters("");
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

  /** 'category "Skin Care", item form "Cream" or "Lotion", max price $25' — what `query` sets; null if nothing. */
  private describeQueryFilters(query: string): string | null {
    const { categories, itemForms, maxPrice } = this.queryFilters(query);
    const quoted = (values: string[]) => values.map((v) => `"${v}"`).join(" or ");
    const parts = [
      categories.length && `category ${quoted(categories)}`,
      itemForms.length && `item form ${quoted(itemForms)}`,
      maxPrice !== null && `max price ${formatPrice(maxPrice)}`,
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }

  protected startTour(): void {
    this.tourDriver ??= createTour({
      runDemoSearch: () => this.runQuery(DEMO_QUERY),
      openFirstResult: () => {
        const first = this.aiProducts()[0];
        if (first) this.selected.set({ id: first.id, side: "ai" });
      },
      reset: () => this.resetTourDemo(),
      demoFilters: this.describeQueryFilters(DEMO_QUERY),
    });
    sendTourStatus(true);
    this.tourDriver.drive();
  }
}
