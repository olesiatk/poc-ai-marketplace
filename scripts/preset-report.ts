// How well each preset query shows off AI search, by the measurable parts
// of what makes a convincing demo:
//   1. AI finds more — more AI results than keyword results;
//   2. keyword search's visible first page is mostly "Filtered out by AI";
//   3. many AI results are "Found only by AI";
//   4. the query picks two or more categories / item forms by itself.
// The fifth — that AI's picks actually fit better — is a human judgement:
// pass --detail to see both sides' titles next to each other.
//
// Everything is computed the way the comparison UI shows it: the query's
// own filters (price, "… category", "… form") applied to both sides,
// keyword search over the rest of the query, AI results from the recorded
// snapshot. No API calls, except with --try.
//
// Run with:
//   npm run report:presets -- <beauty|health> [--detail]
//       the catalog's presets, from the recorded snapshot
//   npm run report:presets -- <beauty|health> --screen "query" ["query" …]
//       keyword side only, no API — a cheap first pass over candidate queries
//   npm run report:presets -- <beauty|health> --try "query" ["query" …]
//       runs live AI search for candidates (one Groq search each, ~4K tokens,
//       paced a minute apart) — nothing is recorded

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BEAUTY_DATASET } from "../src/app/datasets/beauty.ts";
import { HEALTH_DATASET } from "../src/app/datasets/health.ts";
import type { DatasetConfig } from "../src/app/datasets/dataset.model.ts";
import { normalizeQuery, snapshotToMatches, type AiSnapshotFile } from "../src/app/lib/ai-results.ts";
import { KEYWORD_PAGE } from "../src/app/lib/candidates.ts";
import { groupReviews } from "../src/app/lib/catalog.ts";
import { passesQueryFilters, queryFiltersFor } from "../src/app/lib/query-filters.ts";
import { localHeuristicSearch } from "../src/app/lib/search.ts";
import { createVectorSearch, type EmbeddingsFile } from "../src/app/lib/vector-search.ts";
import type { MatchesMap, Product, Review } from "../src/app/models/product.model.ts";

const DATASETS: Record<string, DatasetConfig> = { beauty: BEAUTY_DATASET, health: HEALTH_DATASET };
const PACE_MS = 65_000;
// "Mostly" / "many", in a page of KEYWORD_PAGE (6) results.
const MIN_FILTERED_OUT = 3;
const MIN_AI_ONLY = 3;

const [name, ...args] = process.argv.slice(2);
const dataset = DATASETS[name];
if (!dataset) {
  console.error(`Usage: npm run report:presets -- <${Object.keys(DATASETS).join("|")}> [--detail | --screen "query"… | --try "query"…]`);
  process.exit(1);
}
const mode = args[0] === "--screen" || args[0] === "--try" ? args[0] : "presets";
const detail = mode !== "presets" || args.includes("--detail");
const candidates = mode === "presets" ? [] : args.slice(1);

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const products: Product[] = JSON.parse(readFileSync(join(publicDir, dataset.productsUrl), "utf8"));
const reviews = groupReviews(JSON.parse(readFileSync(join(publicDir, dataset.reviewsUrl), "utf8")) as Review[]);
const loadEmbeddings = async () => JSON.parse(readFileSync(join(publicDir, dataset.embeddingsUrl), "utf8")) as EmbeddingsFile;
const byId = new Map(products.map((p) => [p.id, p]));

/** Best first, most-rated breaking ties — the order the comparison columns use. */
function ranked(matches: MatchesMap, allowed: (p: Product) => boolean): Product[] {
  return [...matches.keys()]
    .map((id) => byId.get(id))
    .filter((p): p is Product => !!p && allowed(p))
    .sort((a, b) => matches.get(b.id)!.score - matches.get(a.id)!.score || b.ratingCount - a.ratingCount);
}

interface Row {
  query: string;
  keyword: number;
  ai: number | null;
  filteredOut: number | null;
  aiOnly: number | null;
  multiFilter: boolean;
  score: number;
}

function report(query: string, aiMatches: MatchesMap | null): Row {
  const filters = queryFiltersFor(query, products);
  const passes = (p: Product) => passesQueryFilters(p, filters);
  const keyword = ranked(localHeuristicSearch(filters.text, products, reviews, []), passes);
  const ai = aiMatches ? ranked(aiMatches, passes) : null;
  const aiIds = new Set(ai?.map((p) => p.id));
  const keywordIds = new Set(keyword.map((p) => p.id));
  const firstPage = keyword.slice(0, KEYWORD_PAGE);

  const filteredOut = ai ? firstPage.filter((p) => !aiIds.has(p.id)).length : null;
  const aiOnly = ai ? ai.filter((p) => !keywordIds.has(p.id)).length : null;
  const multiFilter = filters.categories.length >= 2 || filters.itemForms.length >= 2;
  const checks = ai
    ? [ai.length > keyword.length, filteredOut! >= MIN_FILTERED_OUT, aiOnly! >= MIN_AI_ONLY, multiFilter]
    : [multiFilter];

  if (detail) {
    const named = [
      filters.maxPrice !== null && `max $${filters.maxPrice}`,
      filters.categories.length && `categories: ${filters.categories.join(", ")}`,
      filters.itemForms.length && `forms: ${filters.itemForms.join(", ")}`,
    ].filter(Boolean);
    console.log(`\n=== ${query}${named.length ? `   [${named.join("; ")}]` : ""}`);
    console.log(`  keyword: ${keyword.length} results — first page (✕ = filtered out by AI):`);
    for (const p of firstPage) console.log(`    ${ai && !aiIds.has(p.id) ? "✕" : " "} ${p.category.slice(0, 12).padEnd(12)} ${p.title.slice(0, 70)}`);
    if (ai) {
      const byMeaning = ai.filter((p) => aiMatches!.get(p.id)!.bySimilarity).length;
      console.log(`  AI: ${ai.length} results, ${byMeaning} of them past the model, by meaning (✓ = found only by AI, ≈ = by meaning):`);
      for (const p of ai.slice(0, 30)) {
        const mark = `${keywordIds.has(p.id) ? " " : "✓"}${aiMatches!.get(p.id)!.bySimilarity ? "≈" : " "}`;
        console.log(`    ${mark} ${p.category.slice(0, 12).padEnd(12)} ${p.title.slice(0, 70)}`);
      }
    }
  }
  return { query, keyword: keyword.length, ai: ai?.length ?? null, filteredOut, aiOnly, multiFilter, score: checks.filter(Boolean).length };
}

function printTable(rows: Row[]): void {
  const yes = (ok: boolean) => (ok ? "✔" : "·");
  console.log(`\n${"query".padEnd(58)} KW    AI    more  filtered-out  AI-only  2+ filters  score`);
  for (const r of rows) {
    const ai = r.ai === null ? "—" : String(r.ai);
    const more = r.ai === null ? "—" : yes(r.ai > r.keyword);
    const out = r.filteredOut === null ? "—" : `${yes(r.filteredOut >= MIN_FILTERED_OUT)} ${r.filteredOut}/${KEYWORD_PAGE}`;
    const only = r.aiOnly === null ? "—" : `${yes(r.aiOnly >= MIN_AI_ONLY)} ${r.aiOnly}`;
    console.log(
      `${r.query.slice(0, 57).padEnd(58)} ${String(r.keyword).padEnd(5)} ${ai.padEnd(5)} ${more.padEnd(5)} ${out.padEnd(13)} ${only.padEnd(8)} ${yes(r.multiFilter).padEnd(11)} ${r.ai === null ? "" : `${r.score}/4`}`
    );
  }
  console.log(`\nfiltered-out: keyword first-page results AI left out (needs ≥${MIN_FILTERED_OUT}); AI-only: AI results keyword search missed (needs ≥${MIN_AI_ONLY}).`);
  console.log("Whether AI's picks actually fit better is up to you — rerun with --detail to compare titles.");
}

async function main(): Promise<void> {
  if (mode === "presets") {
    const snapshot: AiSnapshotFile = JSON.parse(readFileSync(join(publicDir, dataset.aiSnapshotsUrl), "utf8"));
    const rows = dataset.presetQueries.map(({ query }) => {
      const recorded = snapshot.queries[normalizeQuery(query)];
      if (!recorded) console.warn(`(no recording for "${query}" — run npm run record:ai)`);
      return report(query, recorded ? snapshotToMatches(recorded) : null);
    });
    printTable(rows);
    return;
  }
  if (mode === "--screen") {
    printTable(candidates.map((q) => report(q, null)));
    return;
  }
  // --try: imported lazily so the other modes don't need a generated environment.ts.
  const { aiSearch, isGroqConfigured } = await import("../src/app/lib/groq.ts");
  const vectors = createVectorSearch(loadEmbeddings);
  if (!isGroqConfigured) {
    console.error("No GROQ_API_KEY configured (put one in .env) — --try needs live AI search.");
    process.exit(1);
  }
  const rows: Row[] = [];
  for (const [i, query] of candidates.entries()) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, PACE_MS));
    const result = await aiSearch(query, products, reviews, vectors);
    if (result.mode !== "groq") console.warn(`("${query}" fell back to local search: ${result.error?.slice(0, 80) ?? "no key"})`);
    rows.push(report(query, result.matches));
  }
  printTable(rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
