/**
 * A concept group is a set of words and short phrases that express the same
 * underlying concept — used to expand a user's query beyond its literal
 * tokens so that e.g. searching "hydrating" also surfaces products described
 * as "moisturizing", without needing a vector index. The groups themselves
 * are catalog-specific and live in the active dataset config.
 *
 * This is a lightweight, deterministic stand-in for semantic recall: it
 * catches synonym and contextual-phrase matches within the fixed catalog
 * vocabulary, but — unlike real embeddings — it can only find an expansion
 * term that appears verbatim somewhere in a product's text.
 */
export type ConceptGroups = readonly (readonly string[])[];

/**
 * Given a set of literal query tokens and the raw (lowercased) query text,
 * returns every other term from any concept group the query touches —
 * whether by an exact token match (single-word terms) or a substring match
 * (multi-word or hyphenated phrases, which never survive tokenization intact).
 */
export function expandConcepts(tokens: ReadonlySet<string>, lowerQuery: string, groups: ConceptGroups): Set<string> {
  const expansions = new Set<string>();
  const inQuery = (term: string) => (isPhrase(term) ? lowerQuery.includes(term) : tokens.has(term));

  for (const group of groups) {
    if (!group.some(inQuery)) continue;
    for (const term of group) {
      if (!inQuery(term)) expansions.add(term);
    }
  }

  return expansions;
}

/** Terms the tokenizer would split apart (spaces, hyphens) — matched against the raw query instead. */
function isPhrase(term: string): boolean {
  return /[\s-]/.test(term);
}
