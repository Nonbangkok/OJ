/** Spreadsheets run a cell starting with one of these as a formula (CSV injection, OWASP). */
const FORMULA_START = /^[=+\-@\t\r]/;

const cell = (raw: string): string => {
  const value = FORMULA_START.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
};

/** RFC 4180-style CSV: quotes cells holding a comma, quote or newline; formula-like cells are prefixed with '. */
export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(cell).join(',')).join('\n');
}

/** Spreadsheet apps (Excel) read a CSV as UTF-8 only when it starts with a byte-order mark; without it Thai text turns to mojibake. */
const UTF8_BOM = '\uFEFF';

/** Hands the rows to the browser as a CSV file download. */
export function downloadCsv(filename: string, rows: string[][]): void {
  const url = URL.createObjectURL(new Blob([UTF8_BOM + toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  // Safari ignores a click on a detached link and can drop a download whose URL is revoked in the same task.
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 0);
}
