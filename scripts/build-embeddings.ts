// Embeds every product of a catalog for the semantic (vector) search, into
// public/data/<name>-embeddings.json: one int8-quantized, unit-length vector
// per product (see src/app/lib/vector-search.ts). Runs the same small model
// the browser uses at search time; ~40 s for the Beauty catalog. No API key
// needed — the model downloads from Hugging Face on first run.
//
// Re-run after changing the catalog, embeddingText() or EMBEDDING_MODEL, then
// re-record the AI snapshots (npm run record:ai -- <name> --all).
//
// Run with: npm run embed:catalog -- <beauty|health>

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pipeline } from "@huggingface/transformers";
import { BEAUTY_DATASET } from "../src/app/datasets/beauty.ts";
import { HEALTH_DATASET } from "../src/app/datasets/health.ts";
import type { DatasetConfig } from "../src/app/datasets/dataset.model.ts";
import { EMBEDDING_MODEL, embeddingText, quantize, type EmbeddingsFile } from "../src/app/lib/vector-search.ts";
import type { Product } from "../src/app/models/product.model.ts";

const DATASETS: Record<string, DatasetConfig> = { beauty: BEAUTY_DATASET, health: HEALTH_DATASET };
const BATCH = 32;

const name = process.argv[2];
const dataset = DATASETS[name];
if (!dataset) {
  console.error(`Usage: npm run embed:catalog -- <${Object.keys(DATASETS).join("|")}>`);
  process.exit(1);
}

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const products: Product[] = JSON.parse(readFileSync(join(publicDir, dataset.productsUrl), "utf8"));

async function main(): Promise<void> {
  const extract = await pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8" });
  const quantized: Int8Array[] = [];
  for (let i = 0; i < products.length; i += BATCH) {
    const out = await extract(products.slice(i, i + BATCH).map(embeddingText), { pooling: "mean", normalize: true });
    for (const vector of out.tolist() as number[][]) quantized.push(quantize(vector));
    process.stdout.write(`\r${Math.min(i + BATCH, products.length)}/${products.length}`);
  }

  const dims = quantized[0].length;
  const all = new Int8Array(quantized.length * dims);
  quantized.forEach((v, i) => all.set(v, i * dims));
  const file: EmbeddingsFile = {
    model: EMBEDDING_MODEL,
    dims,
    ids: products.map((p) => p.id),
    vectors: Buffer.from(all.buffer).toString("base64"),
  };
  const outPath = join(publicDir, dataset.embeddingsUrl);
  writeFileSync(outPath, JSON.stringify(file) + "\n");
  console.log(`\nWrote ${outPath} (${products.length} × ${dims})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
