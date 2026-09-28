import type { MatchInfo } from "../models/product.model";

/**
 * How a product moved between the keyword-search list and the AI list.
 * "new" = keyword search didn't return it at all (it's an "AI only" find).
 */
export type RankChange = { kind: "new" } | { kind: "up" | "down"; by: number } | { kind: "same" };

/**
 * Rank change of every AI-list product relative to where the same product
 * sits in the keyword list (both lists as displayed, i.e. after filters).
 */
export function rankChanges(keywordIds: readonly string[], aiIds: readonly string[]): Map<string, RankChange> {
  const keywordRank = new Map(keywordIds.map((id, i) => [id, i]));
  const changes = new Map<string, RankChange>();
  aiIds.forEach((id, aiRank) => {
    const kwRank = keywordRank.get(id);
    if (kwRank === undefined) changes.set(id, { kind: "new" });
    else if (kwRank === aiRank) changes.set(id, { kind: "same" });
    else changes.set(id, { kind: kwRank > aiRank ? "up" : "down", by: Math.abs(kwRank - aiRank) });
  });
  return changes;
}

/** Number of AI-list products the keyword list doesn't contain. */
export function missedByKeyword(keywordIds: readonly string[], aiIds: readonly string[]): number {
  const keyword = new Set(keywordIds);
  return aiIds.filter((id) => !keyword.has(id)).length;
}

const MAX_REASON_TERMS = 2;

/**
 * A short "why AI matched this" line for an AI-only product: the synonym /
 * related terms it matched on, since by definition none of the literal
 * query words were enough for keyword search to find it.
 */
export function matchReason(info: MatchInfo | null | undefined): string | null {
  if (!info) return null;
  const terms = [...info.synonymTerms, ...info.directTerms].slice(0, MAX_REASON_TERMS);
  return terms.length ? `matched ${terms.map((t) => `"${t}"`).join(", ")}` : null;
}
