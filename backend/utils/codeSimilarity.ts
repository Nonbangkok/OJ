/**
 * Normalised token-stream similarity for C++ sources (contest cheat
 * detection). Renaming variables, reformatting, and comment changes do
 * not change the token stream, while genuinely different programs do.
 *
 * Pipeline: strip comments -> tokenise (identifiers and literals each
 * collapse to a placeholder) -> build k-gram shingles -> Jaccard overlap
 * between the two shingle sets.
 */

/** Tokens identifiers and literals collapse to during normalisation. */
const ID_PLACEHOLDER = 'ID';
const LITERAL_PLACEHOLDER = 'LIT';

// Longest run of a digit accepted inside an identifier (e.g. int64) — the
// scanner is intentionally simple: anything starting with a letter or
// underscore is an identifier.
const IDENTIFIER_START = /[A-Za-z_]/;
const DIGIT = /[0-9]/;

/** Remove // and /* *​/ comments without touching string literals. */
export const stripComments = (source: string): string => {
  let out = '';
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '"' || char === "'") {
      // Copy the string literal verbatim.
      const quote = char;
      out += char;
      index += 1;
      while (index < source.length) {
        out += source[index];
        if (source[index] === '\\') {
          out += source[index + 1] ?? '';
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }

    out += char;
    index += 1;
  }
  return out;
};

/**
 * Convert a (comment-free) source into a normalised token string where
 * identifiers and literals collapse to placeholders. Whitespace is
 * irrelevant, so reformatting does not change the result.
 */
export const normalizeSource = (source: string): string => {
  const stripped = stripComments(source);
  const tokens: string[] = [];
  let index = 0;

  while (index < stripped.length) {
    const char = stripped[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (IDENTIFIER_START.test(char)) {
      let end = index + 1;
      while (end < stripped.length && /[A-Za-z0-9_]/.test(stripped[end])) end += 1;
      tokens.push(ID_PLACEHOLDER);
      index = end;
      continue;
    }

    if (DIGIT.test(char)) {
      let end = index + 1;
      while (end < stripped.length && /[0-9a-fA-FxX.uUlL]/.test(stripped[end])) end += 1;
      tokens.push(LITERAL_PLACEHOLDER);
      index = end;
      continue;
    }

    // Preprocessor directives (#include, #define) carry file/flag identity
    // and hurt normalisation — drop the whole line.
    if (char === '#') {
      while (index < stripped.length && stripped[index] !== '\n') index += 1;
      continue;
    }

    tokens.push(char);
    index += 1;
  }

  return tokens.join(' ');
};

/** Length (in tokens) of the shingles compared between two sources. */
const SHINGLE_SIZE = 8;

/** Build the set of k-token shingles for a normalised source. */
export const buildShingles = (normalized: string, k = SHINGLE_SIZE): Set<string> => {
  const tokens = normalized.split(' ');
  const shingles = new Set<string>();
  for (let i = 0; i + k <= tokens.length; i++) {
    shingles.add(tokens.slice(i, i + k).join(' '));
  }
  return shingles;
};

/** True when a source is too short to produce a meaningful comparison. */
export const isTooShortForComparison = (normalized: string): boolean =>
  normalized.split(' ').length <= SHINGLE_SIZE;

/**
 * Jaccard similarity of the two sources' shingle sets, in [0, 1].
 * Returns 0 when either side is too short to compare.
 */
export const similarity = (codeA: string, codeB: string): number => {
  const normA = normalizeSource(codeA);
  const normB = normalizeSource(codeB);
  if (isTooShortForComparison(normA) || isTooShortForComparison(normB)) {
    return 0;
  }

  const shinglesA = buildShingles(normA);
  const shinglesB = buildShingles(normB);

  let intersection = 0;
  for (const shingle of shinglesA) {
    if (shinglesB.has(shingle)) intersection += 1;
  }
  const union = shinglesA.size + shinglesB.size - intersection;
  return union === 0 ? 0 : intersection / union;
};
