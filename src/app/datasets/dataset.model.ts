export interface PresetQuery {
  query: string;
  /** Which AI capability this query shows off, e.g. "Synonyms", "Negation", "Budget". */
  label: string;
}

/**
 * Everything the app needs to know about one product catalog. The app code
 * itself is catalog-agnostic — swapping catalogs means pointing
 * `ACTIVE_DATASET` (see ./active.ts) at a different one of these.
 */
export interface DatasetConfig {
  /** Paths (relative to the app's base href) of the catalog's products and reviews files in public/data. */
  productsUrl: string;
  reviewsUrl: string;

  /** What kind of store this is, as used in the AI search prompt — e.g. "beauty and personal care marketplace". */
  domain: string;

  /**
   * Domain-specific examples for the AI search prompt of how a query can be
   * expanded (synonyms, contextual phrases, implied product types).
   */
  promptExamples: {
    synonyms: string;
    phrases: string;
    implied: string;
  };

  /**
   * Concept groups for local query expansion. Each group is a set of words
   * and short phrases expressing the same underlying concept, so searching
   * one of them also matches products described with another.
   */
  conceptGroups: readonly (readonly string[])[];

  /** Where the recorded AI results for `presetQueries` live (built by scripts/record-ai-snapshots.ts). */
  aiSnapshotsUrl: string;

  /**
   * Ready-made queries shown as chips (and as suggestions for an empty
   * search box), each labeled with the AI capability it demonstrates. Their
   * AI results are served from `aiSnapshotsUrl` rather than a live LLM call,
   * so the demo never depends on the LLM rate limit. The first one runs on
   * page load.
   */
  presetQueries: readonly PresetQuery[];

  /** Placeholder text for the search box. */
  searchPlaceholder: string;

  /**
   * The query the guided tour runs live — should be one of `presetQueries`
   * so it's served from the recording. Should trigger both an exact match
   * and a synonym/concept match on the top result, so the demo shows off
   * both highlight colors.
   */
  demoQuery: string;
}
