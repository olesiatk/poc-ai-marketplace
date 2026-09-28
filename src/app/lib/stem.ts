/**
 * A deliberately light English stemmer — just enough that word forms of the
 * same word match each other ("frizzy"/"frizz", "moisturizing"/
 * "moisturizer"/"moisturize", "creams"/"creamy"/"cream"), the way any
 * standard full-text search engine does out of the box. It is NOT meant to
 * catch synonyms ("unscented" vs "fragrance-free") — that's exactly the gap
 * the AI side of the search comparison is there to show.
 *
 * Both the query and the catalog text go through the same function, so an
 * over-eager rule only ever makes two different words collide; it can
 * never make a word stop matching itself.
 */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/'s$/, "");
  if (w.length <= 3 || /\d/.test(w)) return w;

  // Plurals / 3rd person.
  if (w.endsWith("ies") && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith("sses")) w = w.slice(0, -2);
  else if (/(?:[sxz]|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.endsWith("s") && !/(?:ss|us|is)$/.test(w)) w = w.slice(0, -1);

  // One derivational/inflectional suffix.
  const suffix = ["ing", "ed", "er"].find((s) => w.endsWith(s) && w.length - s.length >= 3);
  if (suffix) w = undouble(w.slice(0, -suffix.length));

  // "creamy"/"curly"/"oily" → "cream"/"curl"/"oil"; "hydrate" → "hydrat"
  // (so it meets "hydrating"). A slightly longer minimum for "-e" keeps
  // short words like "care"/"face" from colliding with "car"/"fac…".
  if (w.endsWith("y") && w.length > 3) w = w.slice(0, -1);
  else if (w.endsWith("e") && w.length > 4) w = w.slice(0, -1);

  return w;
}

/** "runn" → "run", "shipp" → "ship" — but "frizz", "roll", "gloss" stay, since those doubles are part of the word. */
function undouble(w: string): string {
  return /([^aeiouylsz])\1$/.test(w) ? w.slice(0, -1) : w;
}
