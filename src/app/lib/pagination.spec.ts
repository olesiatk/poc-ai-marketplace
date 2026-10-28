import { describe, expect, it } from "vitest";
import { pageSlots } from "./pagination";

describe("pageSlots", () => {
  it("lists every page when there are five or fewer", () => {
    expect(pageSlots(1, 1)).toEqual([1]);
    expect(pageSlots(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("never shows more than five slots", () => {
    expect(pageSlots(1, 9)).toEqual([1, 2, 3, "gap", 9]);
    expect(pageSlots(2, 9)).toEqual([1, 2, 3, "gap", 9]);
    expect(pageSlots(5, 9)).toEqual([1, "gap", 5, "gap", 9]);
    expect(pageSlots(8, 9)).toEqual([1, "gap", 7, 8, 9]);
    expect(pageSlots(9, 9)).toEqual([1, "gap", 7, 8, 9]);
  });
});
