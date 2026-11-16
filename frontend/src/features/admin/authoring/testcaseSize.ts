/** Human-readable byte sizes for the testcase table: MB as requested, KB for
 *  anything smaller than 0.1 MB so small cases never render as "0.0 MB". */
export function formatByteSize(bytes: number): string {
  const MB = 1024 * 1024;
  const KB = 1024;
  if (bytes >= 0.1 * MB) {
    const mb = bytes / MB;
    // Two decimals while small enough to matter, one past 100 MB.
    return `${mb >= 100 ? mb.toFixed(1) : mb.toFixed(2)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / KB)).toLocaleString()} KB`;
}

/** Decimal sizes used across the redesign: "15 B", "84 kB", "2.4 MB". */
export function formatDecimalSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const kb = bytes / 1000;
  // Round first, so 999,999 B reads "1.0 MB" rather than "1000 kB".
  if (kb < 9.95) return `${kb.toFixed(1)} kB`;
  if (Math.round(kb) < 1000) return `${Math.round(kb)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
