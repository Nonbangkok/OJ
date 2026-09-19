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
