import { describe, expect, it } from "vitest";
import { stem } from "./stem";

describe("stem", () => {
  it.each([
    [["frizzy", "frizz", "frizzes"], "frizz"],
    [["moisturizing", "moisturizer", "moisturizers", "moisturize", "moisturized"], "moisturiz"],
    [["cream", "creams", "creamy"], "cream"],
    [["hydrating", "hydrate", "hydrates", "hydrated"], "hydrat"],
    [["curly", "curl", "curls", "curling"], "curl"],
    [["gentle", "gently"], "gentl"],
    [["oily", "oil"], "oil"],
    [["baby", "babies"], "bab"],
    [["brush", "brushes"], "brush"],
  ])("brings %j to the same stem", (words, expected) => {
    words.forEach((word) => expect(stem(word)).toBe(expected));
  });

  it("leaves short words, numbers and non-plural -s endings alone", () => {
    expect(stem("dry")).toBe("dry");
    expect(stem("30ml")).toBe("30ml");
    expect(stem("gloss")).toBe("gloss");
    expect(stem("this")).toBe("this");
  });

  it("doesn't bridge actual synonyms — that's the AI side's job", () => {
    expect(stem("unscented")).not.toBe(stem("fragrance"));
    expect(stem("hydrating")).not.toBe(stem("moisturizing"));
  });
});
