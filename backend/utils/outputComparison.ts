/**
 * Shared exact-output comparator normalization for the judge pipeline.
 *
 * Semantics (deliberately strict — do NOT loosen):
 * - The OUTER edges of the whole output are trimmed (preserves the judge's
 *   historical outer `.trim()` behavior, e.g. `"hello\n"` matches `"hello"`).
 * - CRLF / CR line endings are normalized to LF.
 * - Trailing whitespace (spaces AND tabs) at the end of each line is ignored,
 *   so `"2 3 4 \n1 5 6 \n"` matches `"2 3 4\n1 5 6\n"` (real case: a correct
 *   submission got WA because of trailing spaces before newlines).
 * - Leading whitespace per line is SIGNIFICANT (`"a\n b"` !== `"a\nb"`) —
 *   only `trimEnd()`, never `trim()`, is applied per line.
 * - Internal whitespace is SIGNIFICANT (`"1  2"` !== `"1 2"`) — no collapsing,
 *   no token splitting.
 */
export const normalizeOutput = (value: string): string =>
  value
    .trim()                       // outer semantics only (unchanged from before)
    .split(/\r?\n/)               // normalize CRLF / lone CR to LF
    .map((line) => line.trimEnd()) // trailing spaces/tabs per line are ignored
    .join('\n');

/** Exact-output comparison after normalization. */
export const outputsMatch = (actual: string, expected: string): boolean =>
  normalizeOutput(actual) === normalizeOutput(expected);
