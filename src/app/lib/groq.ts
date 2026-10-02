import { environment } from "../../environments/environment";
import { ACTIVE_DATASET } from "../datasets/active";
import { parsePriceQuery } from "./price-query";
import {
  MAX_PLAN_TERMS,
  RICH_CANDIDATES,
  buildCatalog,
  classifyKeywords,
  dropWeakMatches,
  parseMatches,
  parsePlan,
  selectCandidates,
  type QueryPlan,
} from "./candidates";
import { expandQueryTerms, localHeuristicSearch } from "./search";
import type { AiMode, MatchesMap, Product, ReviewsMap } from "../models/product.model";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const API_KEY = environment.groqApiKey;
// "llama-3.1-8b-instant"/"llama-3.3-70b-versatile" have been retired from
// Groq's catalog — gpt-oss-20b is a currently-available, JSON-mode-capable
// replacement. Verified live against this project's Groq account.
export const MODEL = environment.groqModel || "openai/gpt-oss-20b";

export const isGroqConfigured = Boolean(API_KEY);

// The catalog is 1000+ products — sent in full, that's hundreds of
// thousands of tokens, well past typical free/on-demand Groq rate limits
// (this project's account: 8K TPM), regardless of model. So a search is
// two calls — retrieve-then-rerank with an LLM on both ends:
// 1. plan: a small call that reads the query against the list of catalog
//    categories and returns which categories to look in plus the words a
//    matching product would use (synonyms, the non-slang name, product
//    types) — so retrieval isn't limited to the hand-written concept groups;
// 2. rerank: cheap local retrieval over those categories with those words
//    narrows the catalog to MAX_CANDIDATES, and the LLM judges only those.
// Groq counts the prompt PLUS the full max_tokens reservation against the
// per-minute budget: plan ≈ 0.35K prompt + 300 max_tokens, rerank ≈ 0.8K
// system + ~1.8–2.9K catalog (see candidates.ts) + 900 max_tokens — about
// 4–5K together, so one search fits in a minute with room to spare. The
// reservations sit at ~2-3x the longest answers seen (plan ~160, rerank
// ~300 with reasoning). The fixed system prompts go first and never change,
// so Groq's prompt cache can serve them (cached tokens don't count against
// the rate limits). A 413/429 means this grew past the limit.
const { domain, promptExamples } = ACTIVE_DATASET;

const PLAN_PROMPT = `You plan product searches for a ${domain}.
You are given a shopper's query (typed or transcribed from speech) and the list of the catalog's categories.
Return ONLY valid JSON (no explanations, no markdown) in this exact shape:
{"categories": ["<category>"], "terms": ["<word or phrase>"]}
Rules:
- "categories": every category from the list where a product that fits the query could plausibly be — usually 1-3. Copy the names exactly. Use [] if the query could fit almost any category.
- "terms": 5-${MAX_PLAN_TERMS} lowercase words or short phrases that the title, description or reviews of a fitting product would likely contain: synonyms, the standard name for slang, product types, key ingredients and attributes. Never include something the query asks to avoid (for "without fragrance", never "fragrance").`;

const RERANK_PROMPT = `You are a semantic search engine for a ${domain}.
You are given a user's query (typed or transcribed from speech) and a product catalog: products grouped under "## Category" headers, one per line as "<number> | <title> | <brand> | $<price>", the best-ranked ones followed by indented lines of features (F:), description (D:) and customer reviews (R:).

Your job: find products that are semantically relevant to the query — not only products that contain its exact words. To do that, expand the query in your head before matching, considering:
1. Core concepts and their lexical synonyms — e.g. ${promptExamples.synonyms}.
2. Contextual, multi-word phrases that express the same idea in a product's own words — e.g. ${promptExamples.phrases}.
3. Related attributes implied by the query, even if unstated — product types, ingredients, usage scenarios and who it's for (e.g. ${promptExamples.implied}).
4. Price is in USD. If the query mentions a budget ("under $20", "cheap"), prefer products that fit it.

Analyze the product's title, category, brand, features, description, AND customer reviews — the query's intent may match not only the listed attributes but also what customers wrote in their reviews. Numbers follow a rough pre-ranking; products after the first ${RICH_CANDIDATES} are one line, sometimes with a review excerpt — judge those by what they show. Reviews are picked for relevance to the query: take what customers say seriously (who it was a gift for and how they liked it, how it smells, whether it worked).

Return ONLY valid JSON (no explanations, no markdown) in this exact shape:
{"matches": [{"id": <product number>, "score": <0-100 relevance>, "keywords": ["<word-or-phrase-1>", "<word-or-phrase-2>"]}]}
Rules:
- "keywords" must be words or short phrases that appear VERBATIM in that product's title, features, description, or reviews, and that justify why it's relevant — including synonyms and contextual phrases you matched, not only the user's literal query words. 2-4 keywords per product.
- Include EVERY product in the catalog that fits the query, not just the best few: a close fit scores 80-100, a partial fit that still serves the shopper's goal 60-79. Leave out any product that contradicts any part of the query (a women's perfume for "for men", an eyeliner for "lipstick", a scented product for "without fragrance"). Sort by descending score.
- If no product satisfies every part of the query, still return the closest matches with lower scores (e.g. 30-60) rather than an empty list — but never a product that contradicts it.
- If nothing is relevant, return {"matches": []}.
- Never invent products or numbers that aren't in the catalog.`;

/** One chat completion with a JSON answer; returns the raw JSON text or throws. */
async function groqJson(system: string, user: string, maxTokens: number): Promise<string> {
  const res = await fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      max_tokens: maxTokens,
      // gpt-oss models reason before answering; at the default effort that
      // reasoning sometimes eats the whole budget and Groq rejects the
      // cut-off answer ("json_validate_failed"). Neither call needs deep
      // reasoning. Other models don't accept the param.
      ...(MODEL.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
      // Plain JSON mode, not strict structured outputs: the model sometimes
      // writes a long match list as one object with duplicate keys, which
      // strict mode rejects outright ("json_validate_failed") but
      // parseMatches can recover.
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Groq API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const content: string | undefined = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from Groq");
  return content;
}

/** The plan call. A failed plan isn't fatal — retrieval just falls back to the concept groups over the whole catalog. */
async function planQuery(query: string, products: Product[]): Promise<QueryPlan | null> {
  const categories = [...new Set(products.map((p) => p.category))].sort((a, b) => a.localeCompare(b, "en"));
  try {
    // Room for gpt-oss's low-effort reasoning plus a ~50-token answer (~160 together seen at most).
    const answer = await groqJson(PLAN_PROMPT, JSON.stringify({ query, categories }), 300);
    return parsePlan(JSON.parse(answer), categories);
  } catch (err) {
    console.warn("Groq query plan failed, retrieving without it:", err);
    return null;
  }
}

export interface AiSearchResult {
  matches: MatchesMap;
  mode: AiMode;
  error?: string;
}

/**
 * Runs AI-powered relevance search via Groq (plan, then rerank — see the
 * top of this file). Falls back to a local client-side keyword heuristic
 * if no API key is configured or the rerank request fails for any reason,
 * so the UI always stays functional.
 */
export async function aiSearch(query: string, products: Product[], reviews: ReviewsMap): Promise<AiSearchResult> {
  if (!isGroqConfigured) {
    return { matches: localHeuristicSearch(query, products, reviews), mode: "local" };
  }

  try {
    // A budget in the query ("under $20") is a hard filter: only products
    // that fit it are candidates, so every slot goes to an affordable one.
    const { maxPrice } = parsePriceQuery(query);
    const affordable = maxPrice === null ? products : products.filter((p) => p.price <= maxPrice);
    const plan = await planQuery(query, affordable);
    const candidates = selectCandidates(query, affordable, reviews, plan);
    const catalog = buildCatalog(candidates, reviews, expandQueryTerms(query, []).tokens, plan?.terms ?? []);

    // Room for gpt-oss's low-effort reasoning plus the JSON answer (~300 together seen at most).
    const answer = await groqJson(RERANK_PROMPT, `Query: ${query}\n\n${catalog.text}`, 900);
    const rawMatches = dropWeakMatches(parseMatches(answer).map((m) => ({ ...m, score: Number(m.score) || 0 })));

    // Where the query's own words occur in each candidate, for exact-match highlighting.
    const literal = localHeuristicSearch(query, candidates, reviews, []);
    const matches: MatchesMap = new Map();
    rawMatches.forEach((raw) => {
      // The model answers with catalog line numbers; anything else isn't a candidate.
      const id = catalog.ids[Number(raw.id) - 1];
      if (!id) return;
      const m = { ...raw, id };
      const keywords = Array.isArray(m.keywords) ? m.keywords : [];
      const cleanedKeywords = keywords.map((k) => String(k).toLowerCase().trim()).filter(Boolean);
      // The model isn't asked to tag each keyword, so classify post-hoc.
      const { directTerms, synonymTerms } = classifyKeywords(query, cleanedKeywords, literal.get(m.id)?.directTerms ?? new Set());
      matches.set(m.id, { score: m.score, directTerms, synonymTerms });
    });

    return { matches, mode: "groq" };
  } catch (err) {
    console.error("Groq AI search failed, falling back to local heuristic:", err);
    return {
      matches: localHeuristicSearch(query, products, reviews),
      mode: "local",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
