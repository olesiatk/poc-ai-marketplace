// Records real Groq AI search results for a catalog's preset queries into
// public/data/<name>-ai-snapshots.json, which the app serves for those
// queries instead of calling the LLM live — so the comparison demo is the
// same for every visitor and never trips the LLM rate limit.
//
// The Groq free tier allows about one search per minute, so this paces
// itself (and retries after a rate-limit/invalid-JSON fallback) — expect
// ~1 minute per query. Needs a real GROQ_API_KEY in .env.
//
// By default only records presets missing from an existing snapshot file
// (and drops entries for queries that are no longer presets); pass --all
// to re-record everything, e.g. after changing the catalog or the prompt.
//
// Run with: npm run record:ai -- <beauty|health> [--all]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BEAUTY_DATASET } from "../src/app/datasets/beauty.ts";
import { HEALTH_DATASET } from "../src/app/datasets/health.ts";
import type { DatasetConfig } from "../src/app/datasets/dataset.model.ts";
import { normalizeQuery, type AiSnapshotFile, type SnapshotMatch } from "../src/app/lib/ai-results.ts";
import { groupReviews } from "../src/app/lib/catalog.ts";
import { MODEL, aiSearch, isGroqConfigured } from "../src/app/lib/groq.ts";
import { createVectorSearch, type EmbeddingsFile } from "../src/app/lib/vector-search.ts";
import type { Product, Review } from "../src/app/models/product.model.ts";

const DATASETS: Record<string, DatasetConfig> = { beauty: BEAUTY_DATASET, health: HEALTH_DATASET };
const PACE_MS = 65_000;
const MAX_ATTEMPTS = 4;

const name = process.argv[2];
const dataset = DATASETS[name];
if (!dataset) {
  console.error(`Usage: npm run record:ai -- <${Object.keys(DATASETS).join("|")}>`);
  process.exit(1);
}
if (!isGroqConfigured) {
  console.error("No GROQ_API_KEY configured (run `node scripts/set-env.js` with a key in .env) — nothing to record.");
  process.exit(1);
}

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const products: Product[] = JSON.parse(readFileSync(join(publicDir, dataset.productsUrl), "utf8"));
const reviews = groupReviews(JSON.parse(readFileSync(join(publicDir, dataset.reviewsUrl), "utf8")) as Review[]);
// The same vector search the browser runs, reading the embeddings from disk.
const vectors = createVectorSearch(async () => JSON.parse(readFileSync(join(publicDir, dataset.embeddingsUrl), "utf8")) as EmbeddingsFile);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const outPath = join(publicDir, dataset.aiSnapshotsUrl);
const recordAll = process.argv.includes("--all");

async function main(): Promise<void> {
  const existing: AiSnapshotFile | null = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : null;
  const presetKeys = dataset.presetQueries.map((p) => normalizeQuery(p.query));
  const queries: Record<string, SnapshotMatch[]> = {};
  if (existing && !recordAll) {
    for (const key of presetKeys) if (existing.queries[key]) queries[key] = existing.queries[key];
  }
  const toRecord = dataset.presetQueries.filter((p) => !queries[normalizeQuery(p.query)]);
  if (!toRecord.length) {
    console.log("Every preset is already recorded — nothing to do (pass --all to re-record).");
    return;
  }

  for (const [i, { query }] of toRecord.entries()) {
    if (i > 0) await sleep(PACE_MS);
    let recorded = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !recorded; attempt++) {
      const result = await aiSearch(query, products, reviews, vectors);
      if (result.mode === "groq") {
        queries[normalizeQuery(query)] = [...result.matches.entries()]
          .sort((a, b) => b[1].score - a[1].score)
          .map(([id, info]) => ({
            id,
            score: info.score,
            directTerms: [...info.directTerms],
            synonymTerms: [...info.synonymTerms],
            ...(info.bySimilarity ? { bySimilarity: true } : {}),
          }));
        console.log(`✓ "${query}" — ${result.matches.size} matches`);
        recorded = true;
      } else if (result.error?.includes("tokens per day")) {
        // The daily budget only frees up gradually over 24 hours — retrying
        // a minute later just burns what little is left, so stop here.
        console.error(`✗ "${query}" — Groq's daily token limit is used up. Try again in a few hours.`);
        process.exit(1);
      } else {
        console.log(`… "${query}" — attempt ${attempt} fell back to local (${result.error?.slice(0, 80) ?? "no error"}), retrying`);
        await sleep(PACE_MS);
      }
    }
    if (!recorded) {
      console.error(`✗ "${query}" — gave up after ${MAX_ATTEMPTS} attempts`);
      process.exit(1);
    }
  }

  // Same key order as the presets, so the file diffs cleanly.
  const ordered = Object.fromEntries(presetKeys.map((key) => [key, queries[key]]));
  const out: AiSnapshotFile = { recordedAt: new Date().toISOString(), model: MODEL, queries: ordered };
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
