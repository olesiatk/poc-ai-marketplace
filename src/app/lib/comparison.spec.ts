import { describe, expect, it } from "vitest";
import { matchReason, missedByKeyword, rankChanges } from "./comparison";

describe("rankChanges", () => {
  const keyword = ["a", "b", "c", "d"];
  const ai = ["c", "x", "a", "b"];
  const changes = rankChanges(keyword, ai);

  it("marks products keyword search never returned as new", () => {
    expect(changes.get("x")).toEqual({ kind: "new" });
  });

  it("counts places moved up and down relative to the keyword list", () => {
    expect(changes.get("c")).toEqual({ kind: "up", by: 2 });
    expect(changes.get("a")).toEqual({ kind: "down", by: 2 });
    expect(changes.get("b")).toEqual({ kind: "down", by: 2 });
  });

  it("reports an unchanged position as same", () => {
    expect(rankChanges(["a", "b"], ["a", "z"]).get("a")).toEqual({ kind: "same" });
  });

  it("only describes AI-list products", () => {
    expect(changes.has("d")).toBe(false);
  });
});

describe("missedByKeyword", () => {
  it("counts AI results the keyword list doesn't contain", () => {
    expect(missedByKeyword(["a", "b"], ["b", "c", "d"])).toBe(2);
    expect(missedByKeyword(["a", "b"], ["b", "a"])).toBe(0);
  });
});

describe("matchReason", () => {
  it("prefers synonym terms and caps the list", () => {
    const reason = matchReason({
      score: 1,
      directTerms: new Set(["cream"]),
      synonymTerms: new Set(["fragrance-free", "no scent", "hypoallergenic"]),
    });
    expect(reason).toBe('matched "fragrance-free", "no scent"');
  });

  it("returns null when there's nothing to explain", () => {
    expect(matchReason(null)).toBeNull();
    expect(matchReason({ score: 1, directTerms: new Set(), synonymTerms: new Set() })).toBeNull();
  });
});
