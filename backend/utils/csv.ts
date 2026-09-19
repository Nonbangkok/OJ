/**
 * Minimal RFC 4180 CSV serialisation for the analytics export endpoints.
 * Quotes a field when it contains a comma, quote, newline, or carriage
 * return; doubles embedded quotes. Always emits CRLF row endings per the
 * RFC so Excel opens the file cleanly on every platform.
 */

const needsQuoting = (value: string): boolean => /[",\r\n]/.test(value);

export const escapeCsvField = (value: string): string =>
  needsQuoting(value) ? `"${value.replace(/"/g, '""')}"` : value;

/** Serialise a value the way it should appear in a CSV cell. */
export const toCsvCell = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return escapeCsvField(String(value));
};

export const toCsv = (headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<unknown>>): string => {
  const lines = [headers.map(toCsvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(toCsvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
};

/** Builds a safe, descriptive download filename for an export. */
export const buildCsvFileName = (kind: string): string => {
  const date = new Date().toISOString().slice(0, 10);
  return `analytics-${kind}-${date}.csv`;
};
