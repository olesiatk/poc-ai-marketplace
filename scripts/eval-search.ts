// Retrieval-accuracy evaluation for the local (no-API-key) search heuristic.
//
// Runs a small hand-labeled set of queries — built from products/reviews
// that use a *different* wording than the query (e.g. querying "hydrating"
// for products only ever described as "moisturizing") — against the real
// catalog, and checks that synonym/phrase-expanded search still finds every
// known-good match, comparing against a literal-keyword-only baseline to
// make the recall lift from concept expansion measurable rather than
// anecdotal.
//
// Note on methodology: exhaustively hand-labeling *every* relevant product
// per query in a 1000+ product catalog isn't practical, so this grades
// recall of a small trusted set of known-positive ids — not precision
// against an exhaustively-labeled set. Every known positive was picked by
// hand as clearly relevant AND as never containing the literal query word,
// so it can only be found through expansion.
//
// The ground truth is catalog-specific, so this always evaluates the Beauty
// catalog (with its own concept groups), whichever dataset the app is
// currently pointed at. If the Beauty catalog is rebuilt and an id here
// disappears or changes wording, re-pick known positives.
//
// Run with: npm run eval:search

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BEAUTY_DATASET } from "../src/app/datasets/beauty.ts";
import { groupReviews } from "../src/app/lib/catalog.ts";
import { localHeuristicSearch } from "../src/app/lib/search.ts";
import type { MatchesMap, Product, Review, ReviewsMap } from "../src/app/models/product.model.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

const dataset = BEAUTY_DATASET;
const products: Product[] = JSON.parse(readFileSync(join(publicDir, dataset.productsUrl), "utf8"));
const reviews: ReviewsMap = groupReviews(JSON.parse(readFileSync(join(publicDir, dataset.reviewsUrl), "utf8")) as Review[]);

interface EvalCase {
  query: string;
  /** Known-good ids that must appear in the results. */
  expectedIds: string[];
  note: string;
  /** When true, graded on set-equality with the baseline instead of recall of expectedIds. */
  expectNoExpansionDrift?: boolean;
}

const EVAL_CASES: EvalCase[] = [
  {
    query: "hydrating",
    // Maximum Moisture Cream, Vitamin C Moisturizing Face Oil, Aquaphor, Udder Balm
    expectedIds: ["B0009ET4SG", "B0115YS3OE", "B017BGJLBE", "B072379PFP"],
    note: "single-word synonym — none of these says \"hydrating\" (one says \"hydrate\", which stemming alone catches); the rest only \"moisturizing\"",
  },
  {
    query: "anti-aging",
    // Kopari eye balm, collagen sheet masks, Vitamin C face oil, Vitamin E cream
    expectedIds: ["B07WV6JHVM", "B07Y1WFN7C", "B0115YS3OE", "B07TVFCPGP"],
    note: "hyphenated concept term — these only mention \"wrinkles\"/\"fine lines\", never \"anti-aging\"",
  },
  {
    query: "frizzy",
    // curl cream, smoothing conditioner, repairing hair oil serum, curl softener kit
    expectedIds: ["B00DGXXPF0", "B012DD86DO", "B01ANJVN6M", "B00LSBK9BK"],
    note: "parity case — these say \"frizz\"/\"anti-frizz\", never \"frizzy\", but stemming alone already bridges that, so the keyword baseline finds them too",
  },
  {
    query: "unscented",
    // Anessa sunscreen, No7 retinol night cream, Aveeno CICA ointment, sweet almond carrier oil
    expectedIds: ["B08R8XM54F", "B09JGLT4DB", "B07KKZGQYZ", "B00PG4OX1C"],
    note: "these say \"fragrance-free\"/\"no scent\", never \"unscented\"",
  },
  {
    query: "argan oil shampoo",
    expectedIds: ["B07W6S65ND", "B00LSBK9BK", "B07YXPL3CN"],
    note: "no concept group applies — expanded search must equal the keyword-only baseline exactly (no noise introduced)",
    expectNoExpansionDrift: true,
  },
];

/**
 * The keyword-only baseline — the exact same search the app's "Keyword
 * search" column runs: same tokenizer, stemming and field weights, just
 * with no concept groups (no synonym/phrase expansion).
 */
function keywordOnlySearch(query: string, items: Product[], reviewsMap: ReviewsMap): Set<string> {
  return idsOf(localHeuristicSearch(query, items, reviewsMap, []));
}

function idsOf(matches: MatchesMap): Set<string> {
  return new Set(matches.keys());
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

interface RecallResult {
  found: number;
  total: number;
  missing: string[];
}

function recallOf(predicted: Set<string>, expected: string[]): RecallResult {
  const missing = expected.filter((id) => !predicted.has(id));
  return { found: expected.length - missing.length, total: expected.length, missing };
}

console.log(`Evaluating retrieval accuracy over ${products.length} products, ${EVAL_CASES.length} queries.\n`);

let failures = 0;
let totalExpected = 0;
let totalFoundExpanded = 0;
let totalFoundBaseline = 0;

for (const { query, expectedIds, note, expectNoExpansionDrift } of EVAL_CASES) {
  const expanded = idsOf(localHeuristicSearch(query, products, reviews, dataset.conceptGroups));
  const baseline = keywordOnlySearch(query, products, reviews);

  if (expectNoExpansionDrift) {
    const pass = setsEqual(expanded, baseline);
    if (!pass) failures++;
    console.log(`${pass ? "PASS" : "FAIL"}  "${query}"  [no-expansion-drift check]`);
    console.log(`      ${note}`);
    console.log(`      expanded result count: ${expanded.size}, baseline result count: ${baseline.size}`);
    console.log();
    continue;
  }

  const expandedRecall = recallOf(expanded, expectedIds);
  const baselineRecall = recallOf(baseline, expectedIds);
  totalExpected += expandedRecall.total;
  totalFoundExpanded += expandedRecall.found;
  totalFoundBaseline += baselineRecall.found;

  const pass = expandedRecall.missing.length === 0;
  if (!pass) failures++;

  console.log(`${pass ? "PASS" : "FAIL"}  "${query}"`);
  console.log(`      ${note}`);
  console.log(`      must-find (known positives): [${expectedIds.join(", ")}]`);
  console.log(
    `      expanded search:  found ${expandedRecall.found}/${expandedRecall.total}` +
      ` (${expanded.size} results total)` +
      (expandedRecall.missing.length ? `; MISSING: [${expandedRecall.missing.join(", ")}]` : "")
  );
  console.log(
    `      keyword baseline: found ${baselineRecall.found}/${baselineRecall.total}` +
      ` (${baseline.size} results total)` +
      (baselineRecall.missing.length ? `; missing: [${baselineRecall.missing.join(", ")}]` : "")
  );
  console.log();
}

console.log("─".repeat(60));
console.log(`Known-positive recall — expanded search:  ${totalFoundExpanded}/${totalExpected}`);
console.log(`Known-positive recall — keyword baseline: ${totalFoundBaseline}/${totalExpected}`);
console.log(`${failures} / ${EVAL_CASES.length} queries failed`);

if (failures > 0) {
  console.error(`\nFAILED: ${failures} quer${failures === 1 ? "y" : "ies"} missed a known-positive match or drifted from baseline.`);
  process.exit(1);
}

console.log("\nOK");
