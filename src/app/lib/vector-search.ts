import type { Product } from "../models/product.model";

/*
 * Semantic ("vector") search over the whole catalog. Every product is
 * turned into an embedding — a list of numbers that places texts with
 * similar meaning close together — once, ahead of time
 * (scripts/build-embeddings.ts → `<name>-embeddings.json`). A query is
 * embedded with the same small model at search time, in the browser (or in
 * Node for the scripts), and every product is scored by how close it sits.
 *
 * It finds products by meaning without any word in common, which keyword
 * search can't — but a model this small can't reason ("ski trip" alone
 * lands near fleece headbands, not sunscreen), so groq.ts embeds the query
 * together with the AI plan's words ("sunscreen, lip balm, windburn…").
 */

/** The embedding model — small enough to download into a browser (~23 MB, once). */
export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

/** `<name>-embeddings.json`: one int8-quantized, unit-length vector per product. */
export interface EmbeddingsFile {
  model: string;
  dims: number;
  /** Product ids, in the same order as the vectors. */
  ids: string[];
  /** All vectors back to back, each value × 127 rounded to an int8, base64-encoded. */
  vectors: string;
}

/** What a product's embedding is made from — the same text at build time and nowhere else. */
export function embeddingText(product: Product): string {
  return [product.title, product.category, ...product.features.slice(0, 3), product.description.slice(0, 400)]
    .join(". ")
    .replace(/\s+/g, " ")
    .slice(0, 1000);
}

export function quantize(vector: readonly number[]): Int8Array {
  return Int8Array.from(vector, (v) => Math.max(-127, Math.min(127, Math.round(v * 127))));
}

function decodeBase64(text: string): Int8Array {
  const bytes = typeof atob === "function" ? Uint8Array.from(atob(text), (c) => c.charCodeAt(0)) : new Uint8Array(Buffer.from(text, "base64"));
  return new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Cosine similarity of a unit-length query against every stored vector, by product id. */
export function similarities(file: EmbeddingsFile, vectors: Int8Array, query: readonly number[]): Map<string, number> {
  const scores = new Map<string, number>();
  for (let i = 0; i < file.ids.length; i++) {
    let dot = 0;
    for (let k = 0; k < file.dims; k++) dot += vectors[i * file.dims + k] * query[k];
    scores.set(file.ids[i], dot / 127);
  }
  return scores;
}

type Embed = (texts: string[]) => Promise<number[][]>;

/** Loads the embedding model through transformers.js — lazily, so its multi-megabyte runtime only loads when needed. */
async function loadModel(): Promise<Embed> {
  const { pipeline } = await import("@huggingface/transformers");
  const extract = await pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8" });
  return async (texts) => (await extract(texts, { pooling: "mean", normalize: true })).tolist() as number[][];
}

export interface VectorSearch {
  /** Similarity (−1…1, higher = closer in meaning) of every product to `text`. */
  rank(text: string): Promise<Map<string, number>>;
  /** Starts downloading the model and vectors without searching yet. */
  warmUp(): void;
}

/**
 * A vector search over the catalog whose embeddings `loadFile` returns
 * (fetched in the browser, read from disk in scripts). Model and file load
 * once, on first use; a failed load is retried on the next call.
 */
export function createVectorSearch(loadFile: () => Promise<EmbeddingsFile>, loadEmbed: () => Promise<Embed> = loadModel): VectorSearch {
  let ready: Promise<{ file: EmbeddingsFile; vectors: Int8Array; embed: Embed }> | null = null;
  const load = () =>
    (ready ??= Promise.all([loadFile(), loadEmbed()])
      .then(([file, embed]) => ({ file, vectors: decodeBase64(file.vectors), embed }))
      .catch((err) => {
        ready = null;
        throw err;
      }));
  return {
    async rank(text) {
      const { file, vectors, embed } = await load();
      const [query] = await embed([text]);
      return similarities(file, vectors, query);
    },
    warmUp() {
      load().catch(() => undefined);
    },
  };
}
