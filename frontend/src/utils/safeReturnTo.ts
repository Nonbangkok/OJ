/**
 * A post-login destination, kept only when it is a path on this site.
 * Browsers treat `\` like `/` and drop tabs and newlines in URLs, so `/\evil.example`
 * or `/<tab>/evil.example` would leave the site; those, `//host` and absolute URLs fall back to `/`.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\s]/.test(value)) return '/';
  try {
    const resolved = new URL(value, window.location.origin);
    return resolved.origin === window.location.origin ? value : '/';
  } catch {
    return '/';
  }
}
