import { describe, expect, it, vi } from "vitest";
import { AiResults, LIVE_SEARCH_TOKENS, TOKENS_PER_MINUTE, normalizeQuery, type AiSnapshotFile, type LiveSearch } from "./ai-results";
import type { MatchesMap } from "../models/product.model";

const SNAPSHOT: AiSnapshotFile = {
  recordedAt: "2026-09-28T10:00:00.000Z",
  model: "test-model",
  queries: { unscented: [{ id: "p-1", score: 90, directTerms: [], synonymTerms: ["fragrance-free"] }] },
};

// Time for the token budget to refill `tokens`.
const refillMs = (tokens: number) => Math.ceil((tokens / TOKENS_PER_MINUTE) * 60_000);
// Long enough for an empty budget to fill up completely.
const FULL_REFILL_MS = 60_000;

const liveMatches: MatchesMap = new Map([["p-live", { score: 80, directTerms: new Set(), synonymTerms: new Set() }]]);
const localMatches: MatchesMap = new Map([["p-local", { score: 5, directTerms: new Set(), synonymTerms: new Set() }]]);

function setup(options: { snapshot?: AiSnapshotFile | null; live?: LiveSearch; liveEnabled?: boolean } = {}) {
  let now = 1_000_000;
  const live = vi.fn(options.live ?? (async () => ({ matches: liveMatches, mode: "groq" as const })));
  const local = vi.fn(() => localMatches);
  const results = new AiResults("snapshot" in options ? (options.snapshot ?? null) : SNAPSHOT, live, local, options.liveEnabled ?? true, () => now);
  return { results, live, local, advance: (ms: number) => (now += ms) };
}

describe("normalizeQuery", () => {
  it("ignores case and extra whitespace", () => {
    expect(normalizeQuery("  Gift  SET under $25 ")).toBe("gift set under $25");
  });
});

describe("AiResults", () => {
  it("serves a preset query from the recording without calling the LLM", async () => {
    const { results, live } = setup();
    const result = await results.search("  Unscented ", [], {});
    expect(result.mode).toBe("recorded");
    expect(result.recordedAt).toBe(SNAPSHOT.recordedAt);
    expect(result.matches.get("p-1")!.synonymTerms.has("fragrance-free")).toBe(true);
    expect(live).not.toHaveBeenCalled();
    expect(results.isRecorded("UNSCENTED")).toBe(true);
  });

  it("calls the LLM live for other queries, and caches the answer", async () => {
    const { results, live, advance } = setup();
    expect((await results.search("hydrating serum", [], {})).mode).toBe("groq");
    advance(FULL_REFILL_MS);
    expect((await results.search("Hydrating  serum", [], {})).matches).toBe(liveMatches);
    expect(live).toHaveBeenCalledTimes(1);
  });

  it("uses the local fallback instead of a doomed live call while the token budget is short", async () => {
    const { results, live } = setup();
    await results.search("first query", [], {});
    await results.search("second query", [], {});
    const third = await results.search("third query", [], {});
    expect(live).toHaveBeenCalledTimes(1);
    expect(third).toMatchObject({ mode: "local", aiUnavailable: true });
    expect(third.matches).toBe(localMatches);
  });

  it("tells how long a live query has to wait for the token budget — nothing for recorded or cached ones", async () => {
    const { results, advance } = setup();
    expect(results.waitMs("first query")).toBe(0);
    await results.search("first query", [], {});
    // A full budget minus one search leaves a bit short of a second one.
    const shortBy = LIVE_SEARCH_TOKENS - (TOKENS_PER_MINUTE - LIVE_SEARCH_TOKENS);
    expect(results.waitMs("second query")).toBe(refillMs(shortBy));
    expect(results.waitMs("unscented")).toBe(0);
    expect(results.waitMs("First  query")).toBe(0);
    advance(refillMs(shortBy));
    expect(results.waitMs("second query")).toBe(0);
  });

  it("settles at one live search per refill of a search's worth of tokens", async () => {
    const { results, live, advance } = setup();
    await results.search("first query", [], {});
    advance(results.waitMs("second query"));
    await results.search("second query", [], {});
    expect(results.waitMs("third query")).toBe(refillMs(LIVE_SEARCH_TOKENS));
    advance(refillMs(LIVE_SEARCH_TOKENS));
    await results.search("third query", [], {});
    expect(live).toHaveBeenCalledTimes(3);
  });

  it("flags an LLM failure as unavailable and doesn't cache it", async () => {
    const { results, live, advance } = setup({ live: async () => ({ matches: localMatches, mode: "local", error: "429" }) });
    expect(await results.search("q", [], {})).toMatchObject({ mode: "local", aiUnavailable: true });
    // A failure empties the budget: the next try waits for a whole search's worth.
    expect(results.waitMs("q")).toBe(refillMs(LIVE_SEARCH_TOKENS));
    advance(refillMs(LIVE_SEARCH_TOKENS));
    await results.search("q", [], {});
    expect(live).toHaveBeenCalledTimes(2);
  });

  it("goes straight to local search when no API key is configured", async () => {
    const { results, live } = setup({ liveEnabled: false });
    const result = await results.search("q", [], {});
    expect(result.mode).toBe("local");
    expect(result.aiUnavailable).toBeUndefined();
    expect(live).not.toHaveBeenCalled();
  });

  it("works without any recording", async () => {
    const { results, live } = setup({ snapshot: null });
    expect((await results.search("unscented", [], {})).mode).toBe("groq");
    expect(live).toHaveBeenCalledTimes(1);
    expect(results.isRecorded("unscented")).toBe(false);
  });
});
