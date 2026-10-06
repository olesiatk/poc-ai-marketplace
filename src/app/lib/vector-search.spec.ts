import { describe, expect, it } from "vitest";
import { createVectorSearch, quantize, similarities, type EmbeddingsFile } from "./vector-search";

function fileOf(vectors: Record<string, number[]>): EmbeddingsFile {
  const ids = Object.keys(vectors);
  const dims = vectors[ids[0]].length;
  const all = new Int8Array(ids.length * dims);
  ids.forEach((id, i) => all.set(quantize(vectors[id]), i * dims));
  let binary = "";
  new Uint8Array(all.buffer).forEach((b) => (binary += String.fromCharCode(b)));
  return { model: "test", dims, ids, vectors: btoa(binary) };
}

const FILE = fileOf({ sunscreen: [1, 0, 0], balm: [0.6, 0.8, 0], brush: [0, 0, 1] });

describe("vector search", () => {
  it("scores every product by cosine similarity to the query", async () => {
    const search = createVectorSearch(async () => FILE, async () => async () => [[1, 0, 0]]);
    const scores = await search.rank("ski trip");
    expect(scores.get("sunscreen")).toBeCloseTo(1, 1);
    expect(scores.get("balm")).toBeCloseTo(0.6, 1);
    expect(scores.get("brush")).toBeCloseTo(0, 1);
  });

  it("loads the model and the vectors once", async () => {
    let loads = 0;
    const search = createVectorSearch(
      async () => (loads++, FILE),
      async () => async () => [[0, 0, 1]]
    );
    await search.rank("a");
    await search.rank("b");
    expect(loads).toBe(1);
  });

  it("tries the load again after a failure", async () => {
    let attempt = 0;
    const search = createVectorSearch(async () => {
      if (attempt++ === 0) throw new Error("offline");
      return FILE;
    }, async () => async () => [[1, 0, 0]]);
    await expect(search.rank("a")).rejects.toThrow("offline");
    expect((await search.rank("a")).size).toBe(3);
  });

  it("quantizes unit vectors into int8 without overflow", () => {
    expect([...quantize([1, -1, 0.5, 2])]).toEqual([127, -127, 64, 127]);
    const vectors = new Int8Array([127, 0]);
    expect(similarities({ model: "t", dims: 2, ids: ["a"], vectors: "" }, vectors, [1, 0]).get("a")).toBe(1);
  });
});
