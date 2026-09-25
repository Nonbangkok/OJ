/**
 * Rejects literal absolute/traversing includes and the macro/continuation
 * forms that could smuggle them past the literal check (RUNNER-001). The
 * unprivileged compile (uid drop in submissionService) is the real security
 * boundary — this guard is the first line of defence, not the last.
 */
export function findForbiddenInclude(code: string): string | null {
  // Preprocessor directives are logically line-based even when a trailing
  // backslash continues them onto the next physical line, and `/* */`
  // comments can splice directives apart. Join continuations and drop
  // comments before matching so those forms cannot hide an include.
  const logical = code
    .replace(/\\\r?\n/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  const includeRe = /^\s*#\s*include\s*[<"]\s*([^>"]*?)\s*[>"]/;
  // A macro include (`#include E` where E was #defined elsewhere) — the
  // include token is an identifier, not a quoted path. We cannot resolve
  // macros without a preprocessor, so conservatively reject any non-literal
  // include whose macro name is #defined in this file to something that is
  // not a plain standard-library header. Additionally, any `#define` whose
  // body looks like an absolute/traversing path is rejected outright: that
  // covers `#define E "/proc/self/environ"` + `#include E` and the
  // computed-include variants built from such macros.
  const defineRe = /^\s*#\s*define\s+([A-Za-z_]\w*)\s+(.+)$/;
  for (const line of logical.split('\n')) {
    const defineMatch = line.match(defineRe);
    if (defineMatch) {
      const body = defineMatch[2].trim();
      // Check every string literal in the body, plus the concatenation of
      // adjacent literals ("/proc/" "self" is one path once the preprocessor
      // glues them). Absolute or traversing anywhere in a define is rejected.
      const literals = body.match(/"([^"]*)"/g)?.map((s) => s.slice(1, -1)) ?? [];
      const glued = literals.join('');
      const candidates = [glued, ...literals];
      for (const candidate of candidates) {
        if (candidate.startsWith('/') || candidate.includes('..')) {
          return candidate;
        }
      }
    }
    const match = line.match(includeRe);
    if (match && (match[1].startsWith('/') || match[1].includes('..'))) return match[1];
    // Macro includes: `#include E` / `#include HEADER(x)` — no quotes at all.
    const macroMatch = line.match(/^\s*#\s*include\s+([^<"\s].*)$/);
    if (macroMatch) {
      const token = macroMatch[1].trim();
      // A bare identifier whose #define body contains a path-like string was
      // already caught above; any OTHER macro include is allowed through
      // (e.g. `#include BOOST_PP_STRINGIZE(x)`-style patterns are not paths,
      // and the unprivileged compile bounds what macros can reach anyway).
      const macroName = token.replace(/\(.*$/, '').trim();
      if (macroName && !/^[A-Za-z_]\w*$/.test(macroName)) {
        // Not a plain identifier (operator junk, path fragments, etc.) —
        // reject rather than guess.
        return token;
      }
    }
  }
  return null;
}
