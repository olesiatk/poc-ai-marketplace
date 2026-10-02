/**
 * Price mentions inside a free-text query ("shampoo under $20 for curly
 * hair", "gift set $10-25"). Parsed deterministically rather than by the
 * LLM, so the price slider moves instantly, the same way for preset
 * (recorded) queries, live AI queries and the local fallback.
 */

// Whole numbers only: the guards stop backtracking from reading "20" as "2".
const NUMBER = String.raw`(?<![\d.,])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?!\d|[.,]\d)`;
const CURRENCY_WORD = String.raw`(?:dollars?|usd|bucks)\b`;
// With a currency marker: "$20", "20$", "20 dollars", "$20 usd".
const AMOUNT = String.raw`\$\s?(${NUMBER})(?:\s?${CURRENCY_WORD})?|(${NUMBER})\s?(?:\$|${CURRENCY_WORD})`;
// A number with no currency marker followed by one of these is a size, count or time, not a price ("under 16 oz").
const NOT_A_PRICE = String.raw`(?!\s?(?:%|(?:oz|fl|ml|l|g|gr|grams?|kg|lbs?|mg|pack|pk|pcs|pieces?|count|ct|x|inch(?:es)?|mm|cm|sec(?:onds?)?|min(?:utes?)?|hours?|hrs?|days?|weeks?|months?|years?|yrs?|steps?|shades?|colou?rs?|spf)\b))`;
// Currency marker optional — only used after a price word or in a range. Three capture groups.
const PRICE = String.raw`(?:${AMOUNT}|(${NUMBER})${NOT_A_PRICE})`;

const MAX_WORDS = `(?<![a-z])(?:under|below|less than|cheaper than|no more than|not more than|at most|up to|max(?:imum)?|within)|<=?|≤`;
const MIN_WORDS = `(?<![a-z])(?:over|above|more than|at least|from|starting at|min(?:imum)?)|>=?|≥`;

const RANGE_RE = new RegExp(
  String.raw`(?:between\s+)?${PRICE}\s*(?:-|–|to|and)\s*${PRICE}`,
  "gi"
);
const MAX_RE = new RegExp(String.raw`(?:${MAX_WORDS})\s*${PRICE}`, "gi");
const MIN_RE = new RegExp(String.raw`(?:${MIN_WORDS})\s*${PRICE}`, "gi");
const PLAIN_RE = new RegExp(AMOUNT, "gi");

export interface PriceQuery {
  /** Upper price bound the query asks for, or null if it names none. */
  maxPrice: number | null;
  /** The query with every price mention removed, for word matching. */
  text: string;
}

function toNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw.replaceAll(",", ""));
  return Number.isFinite(value) ? value : null;
}

/** First non-empty capture group of a match, as a number. */
function amount(groups: (string | undefined)[]): number | null {
  return toNumber(groups.find((g) => g !== undefined));
}

/**
 * Pulls an upper price bound out of `query`. Ranges ("$10-25", "between
 * 10 and 25 dollars") count by their upper end; a lone price with a
 * currency marker ("$20", "20 bucks") counts as a budget. Lower bounds
 * ("over $20") are stripped from the text but don't set `maxPrice` — the
 * price filter only has an upper end. A bare number needs a price word
 * before it ("under 20") and is ignored when followed by a unit ("under 16 oz").
 * With several prices ("$10, $20, $30") the highest wins, so the slider
 * never hides a product at a price the query named.
 */
export function parsePriceQuery(query: string): PriceQuery {
  const bounds: number[] = [];
  const blank = (match: string) => " ".repeat(match.length);

  // Each pass blanks what it consumed, so later (looser) patterns can't re-read it.
  let rest = query.replace(RANGE_RE, (match, ...groups) => {
    const [low, high] = [amount(groups.slice(0, 3)), amount(groups.slice(3, 6))];
    // "2 and 3" with no currency marker is too ambiguous to be a price.
    if (low === null || high === null || !/\$|dollar|usd|buck|between/i.test(match)) return match;
    bounds.push(Math.max(low, high));
    return blank(match);
  });
  rest = rest.replace(MAX_RE, (match, ...groups) => {
    const value = amount(groups.slice(0, 3));
    if (value === null) return match;
    bounds.push(value);
    return blank(match);
  });
  rest = rest.replace(MIN_RE, blank);
  rest = rest.replace(PLAIN_RE, (match, ...groups) => {
    const value = amount(groups.slice(0, 2));
    if (value === null) return match;
    bounds.push(value);
    return blank(match);
  });

  return {
    maxPrice: bounds.length ? Math.max(...bounds) : null,
    text: rest.replace(/\s+/g, " ").trim(),
  };
}
