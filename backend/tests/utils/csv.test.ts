import { buildCsvFileName, escapeCsvField, toCsv, toCsvCell } from '../../utils/csv';

describe('csv utils', () => {
  describe('escapeCsvField', () => {
    it('leaves plain values untouched', () => {
      expect(escapeCsvField('Accepted')).toBe('Accepted');
    });

    it('quotes fields containing commas', () => {
      expect(escapeCsvField('a,b')).toBe('"a,b"');
    });

    it('quotes and doubles embedded quotes', () => {
      expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    });

    it('quotes fields with newlines', () => {
      expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
    });

    it('quotes fields with carriage returns', () => {
      expect(escapeCsvField('a\r\nb')).toBe('"a\r\nb"');
    });
  });

  describe('toCsv', () => {
    it('serialises headers and rows with CRLF endings', () => {
      const csv = toCsv(['id', 'name'], [[1, 'alice'], [2, 'bob']]);

      expect(csv).toBe('id,name\r\n1,alice\r\n2,bob\r\n');
    });

    it('renders null and undefined as empty cells', () => {
      const csv = toCsv(['a', 'b'], [[null, undefined]]);

      expect(csv).toBe('a,b\r\n,\r\n');
    });

    it('serialises dates as ISO strings', () => {
      const csv = toCsv(['when'], [[new Date('2026-09-20T00:00:00Z')]]);

      expect(csv).toBe('when\r\n2026-09-20T00:00:00.000Z\r\n');
    });

    it('escapes malicious cell content', () => {
      const csv = toCsv(['formula'], [['=SUM(A1:A2)\",evil']]);

      // ANALYSIS-006: formula-prefixed cells are also neutralized with a
      // leading quote so Excel cannot execute them.
      expect(csv).toBe('formula\r\n"\'=SUM(A1:A2)"",evil"\r\n');
    });

    it('handles an empty rows array', () => {
      expect(toCsv(['id'], [])).toBe('id\r\n');
    });
  });

  describe('formula injection guard (ANALYSIS-006)', () => {
    it('prefixes cells that start with a formula trigger character', () => {
      expect(toCsvCell('=1+1')).toBe("'=1+1");
      expect(toCsvCell('+cmd|/C calc')).toBe("'+cmd|/C calc");
      expect(toCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
      expect(toCsvCell('-2+3|!A0')).toBe("'-2+3|!A0");
      expect(toCsvCell('\tINJECT')).toBe("'\tINJECT");
      // CR is also a quoting trigger, so the guard lands inside the quotes.
      expect(toCsvCell('\rINJECT')).toBe('"\'\rINJECT"');
    });

    it('prefixes before quoting, so quoted payloads stay neutralized', () => {
      expect(toCsvCell('=SUM(A1),"evil"')).toBe('"\'=SUM(A1),""evil"""');
    });

    it('leaves ordinary values and negative numbers untouched', () => {
      expect(toCsvCell('alice')).toBe('alice');
      expect(toCsvCell('Accepted')).toBe('Accepted');
      expect(toCsvCell(-5)).toBe('-5');
      expect(toCsvCell('-0.5')).toBe("'-0.5"); // string '-0.5' still guarded
      expect(toCsvCell(0)).toBe('0');
    });
  });

  describe('buildCsvFileName', () => {
    it('embeds the kind and the current date', () => {
      const name = buildCsvFileName('users');
      expect(name).toMatch(/^analytics-users-\d{4}-\d{2}-\d{2}\.csv$/);
    });
  });
});
