/** Rejects literal absolute/traversing includes; filesystem isolation remains the security boundary. */
export function findForbiddenInclude(code: string): string | null {
  const includeRe = /^\s*#\s*include\s*[<"]\s*([^>"]*?)\s*[>"]/;
  for (const line of code.split('\n')) {
    const match = line.match(includeRe);
    if (match && (match[1].startsWith('/') || match[1].includes('..'))) return match[1];
  }
  return null;
}
