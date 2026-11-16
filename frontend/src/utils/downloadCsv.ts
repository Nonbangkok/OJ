const cell = (value: string): string => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** RFC 4180-style CSV: quotes cells holding a comma, quote or newline. */
export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(cell).join(',')).join('\n');
}

/** Hands the rows to the browser as a CSV file download. */
export function downloadCsv(filename: string, rows: string[][]): void {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
