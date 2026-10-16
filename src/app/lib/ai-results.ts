import type { AiMode, MatchesMap, Product, ReviewsMap } from "../models/product.model";

/** One recorded AI match, as stored in `<name>-ai-snapshots.json` (Sets don't survive JSON). */
export interface SnapshotMatch {
  id: string;
  score: number;
  directTerms: string[];
  synonymTerms: string[];
  /** Found by meaning beyond what the model judged (see ai-search.ts). */
  bySimilarity?: boolean;
}

/** Recorded real LLM results for a catalog's preset queries — built by scripts/record-ai-snapshots.ts. */
export interface AiSnapshotFile {
  /** ISO 8601. */
  recordedAt: string;
  model: string;
  /** Keyed by {@link normalizeQuery}. */
  queries: Record<string, SnapshotMatch[]>;
}

export interface AiResult {
  matches: MatchesMap;
  mode: AiMode;
  /** Set when a live AI search was wanted but the local fallback was used instead (LLM error, rate limit, cooldown). */
  aiUnavailable?: boolean;
  /** Set for mode "recorded". */
  recordedAt?: string;
}

/** The shape of ai-search.ts's `aiSearch`, injected so this module (and its tests) don't depend on the API client. */
export type LiveSearch = (
  query: string,
  products: Product[],
  reviews: ReviewsMap
) => Promise<{ matches: MatchesMap; mode: AiMode; error?: string; notConfigured?: boolean }>;

// The model deployment has a per-minute token limit (TPM), refilled
// continuously — a token bucket, modelled here because the browser can't
// read the rate-limit headers. One live AI search reserves about
// LIVE_SEARCH_TOKENS: both prompts plus both max_tokens reservations (see
// ai-search.ts). The limit comes from AI_TOKENS_PER_MINUTE at build time
// (scripts/set-env.js); at 8K, say, the first search goes at once, a
// second right after it waits ~12 s, and searches back to back settle at
// one per ~36 s. At typical Azure deployment limits nobody ever waits.
export const DEFAULT_TOKENS_PER_MINUTE = 50_000;
export const LIVE_SEARCH_TOKENS = 4800;

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

export function snapshotToMatches(entries: SnapshotMatch[]): MatchesMap {
  return new Map(
    entries.map((m) => [
      m.id,
      { score: m.score, directTerms: new Set(m.directTerms), synonymTerms: new Set(m.synonymTerms), ...(m.bySimilarity ? { bySimilarity: true } : {}) },
    ])
  );
}

/**
 * Where the AI side of the search comparison gets its results, in order:
 * 1. a recorded run, for the catalog's preset queries — so the demo never
 *    depends on the LLM rate limit, and every visitor sees the same thing;
 * 2. this session's cache of earlier live LLM results;
 * 3. a live LLM call — once the per-minute token budget has room for one
 *    ({@link waitMs}); until then, as on any LLM failure, the local
 *    synonym-expanded search stands in, flagged `aiUnavailable`.
 */
export class AiResults {
  private readonly cache = new Map<string, AiResult>();
  /** Tokens left in the per-minute budget as of `budgetAt` — it starts full. */
  private budget: number;
  private budgetAt: number;
  private readonly tokensPerMs: number;

  constructor(
    private readonly snapshot: AiSnapshotFile | null,
    private readonly liveSearch: LiveSearch,
    private readonly localSearch: (query: string, products: Product[], reviews: ReviewsMap) => MatchesMap,
    /** Turned off for good once the server says it has no AI configured. */
    private liveEnabled: boolean,
    private readonly tokensPerMinute: number = DEFAULT_TOKENS_PER_MINUTE,
    private readonly now: () => number = Date.now
  ) {
    this.budget = tokensPerMinute;
    this.budgetAt = now();
    this.tokensPerMs = tokensPerMinute / 60_000;
  }

  private budgetNow(): number {
    return Math.min(this.tokensPerMinute, this.budget + (this.now() - this.budgetAt) * this.tokensPerMs);
  }

  private spend(tokens: number): void {
    this.budget = this.budgetNow() - tokens;
    this.budgetAt = this.now();
  }

  /** True when `query` is served from the recording (no network, no rate limit). */
  isRecorded(query: string): boolean {
    return !!this.snapshot?.queries[normalizeQuery(query)];
  }

  /**
   * How long `query` has to wait before it can be searched live: 0 when it's
   * served without the LLM (recorded, cached, no API key) or the token
   * budget already has room for a search. Lets the UI count down and search
   * for real afterwards instead of falling back to local search right away.
   */
  waitMs(query: string): number {
    const key = normalizeQuery(query);
    if (this.snapshot?.queries[key] || this.cache.has(key) || !this.liveEnabled) return 0;
    return Math.max(0, Math.ceil((LIVE_SEARCH_TOKENS - this.budgetNow()) / this.tokensPerMs));
  }

  async search(query: string, products: Product[], reviews: ReviewsMap): Promise<AiResult> {
    const key = normalizeQuery(query);
    const recorded = this.snapshot?.queries[key];
    if (recorded) {
      return { matches: snapshotToMatches(recorded), mode: "recorded", recordedAt: this.snapshot!.recordedAt };
    }

    const cached = this.cache.get(key);
    if (cached) return cached;

    if (!this.liveEnabled) return { matches: this.localSearch(query, products, reviews), mode: "local" };
    if (this.waitMs(query) > 0) {
      return { matches: this.localSearch(query, products, reviews), mode: "local", aiUnavailable: true };
    }

    this.spend(LIVE_SEARCH_TOKENS);
    const result = await this.liveSearch(query, products, reviews);
    if (result.mode === "live") {
      const live: AiResult = { matches: result.matches, mode: "live" };
      this.cache.set(key, live);
      return live;
    }
    if (result.notConfigured) {
      this.liveEnabled = false;
      return { matches: result.matches, mode: "local" };
    }
    // Most likely a 429 — someone else on the shared key used the budget up.
    // Assume it's empty, so the next try waits for a full search's worth.
    this.spend(this.budgetNow());
    return { matches: result.matches, mode: "local", aiUnavailable: true };
  }
}
