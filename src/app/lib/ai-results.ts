import type { AiMode, MatchesMap, Product, ReviewsMap } from "../models/product.model";

/** One recorded AI match, as stored in `<name>-ai-snapshots.json` (Sets don't survive JSON). */
export interface SnapshotMatch {
  id: string;
  score: number;
  directTerms: string[];
  synonymTerms: string[];
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

/** The shape of groq.ts's `aiSearch`, injected so this module (and its tests) don't depend on the API client. */
export type LiveSearch = (query: string, products: Product[], reviews: ReviewsMap) => Promise<{ matches: MatchesMap; mode: AiMode; error?: string }>;

// The free Groq tier allows about one search per minute (see groq.ts). A
// live call inside this window would only earn a 429 anyway, so skip
// straight to the local fallback instead of waiting on a doomed request.
export const LIVE_COOLDOWN_MS = 60_000;

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

export function snapshotToMatches(entries: SnapshotMatch[]): MatchesMap {
  return new Map(
    entries.map((m) => [m.id, { score: m.score, directTerms: new Set(m.directTerms), synonymTerms: new Set(m.synonymTerms) }])
  );
}

/**
 * Where the AI side of the search comparison gets its results, in order:
 * 1. a recorded run, for the catalog's preset queries — so the demo never
 *    depends on the LLM rate limit, and every visitor sees the same thing;
 * 2. this session's cache of earlier live LLM results;
 * 3. a live LLM call — unless one was made less than LIVE_COOLDOWN_MS ago,
 *    in which case (like on any LLM failure) the local synonym-expanded
 *    search stands in, flagged `aiUnavailable`.
 */
export class AiResults {
  private readonly cache = new Map<string, AiResult>();
  private lastLiveCall = -Infinity;

  constructor(
    private readonly snapshot: AiSnapshotFile | null,
    private readonly liveSearch: LiveSearch,
    private readonly localSearch: (query: string, products: Product[], reviews: ReviewsMap) => MatchesMap,
    private readonly liveEnabled: boolean,
    private readonly now: () => number = Date.now
  ) {}

  /** True when `query` is served from the recording (no network, no rate limit). */
  isRecorded(query: string): boolean {
    return !!this.snapshot?.queries[normalizeQuery(query)];
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
    if (this.now() - this.lastLiveCall < LIVE_COOLDOWN_MS) {
      return { matches: this.localSearch(query, products, reviews), mode: "local", aiUnavailable: true };
    }

    this.lastLiveCall = this.now();
    const result = await this.liveSearch(query, products, reviews);
    if (result.mode === "groq") {
      const live: AiResult = { matches: result.matches, mode: "groq" };
      this.cache.set(key, live);
      return live;
    }
    return { matches: result.matches, mode: "local", aiUnavailable: true };
  }
}
