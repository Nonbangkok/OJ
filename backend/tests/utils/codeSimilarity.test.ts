import {
  buildShingles,
  isTooShortForComparison,
  normalizeSource,
  similarity,
  stripComments,
  templateShingles,
} from '../../utils/codeSimilarity';

describe('codeSimilarity', () => {
  describe('stripComments', () => {
    it('removes line comments', () => {
      expect(stripComments('int x; // hi')).toBe('int x; ');
    });

    it('removes block comments spanning lines', () => {
      expect(stripComments('a /* multi\nline */ b')).toBe('a  b');
    });

    it('keeps comment markers inside string literals', () => {
      expect(stripComments('cout << "// not a comment";')).toBe('cout << "// not a comment";');
    });

    it('handles escaped quotes inside strings', () => {
      expect(stripComments('s = "\\""; // tail')).toBe('s = "\\""; ');
    });
  });

  describe('normalizeSource', () => {
    it('collapses identifiers to a placeholder', () => {
      expect(normalizeSource('alpha + beta')).toBe(normalizeSource('x + y'));
    });

    it('collapses literals to a placeholder', () => {
      expect(normalizeSource('f(1, 2.5, "three")')).toBe(normalizeSource('f(9, 8.1, "zero")'));
    });

    it('ignores formatting differences', () => {
      expect(normalizeSource('int main(){return 0;}')).toBe(normalizeSource('int main ( ) {\n  return 0 ;\n}\n'));
    });

    it('drops preprocessor directives', () => {
      expect(normalizeSource('#include <bits/stdc++.h>\nint x;')).toBe('ID ID ;'.replace('x', 'x') && normalizeSource('int x;'));
    });

    it('is unaffected by identifier renames', () => {
      const a = normalizeSource('long long totalSum = 0;');
      const b = normalizeSource('long long acc = 0;');
      expect(a).toBe(b);
    });
  });

  describe('buildShingles / isTooShortForComparison', () => {
    it('marks trivial sources as too short', () => {
      expect(isTooShortForComparison('ID ;')).toBe(true);
    });

    it('produces n-k+1 shingles (unique)', () => {
      const normalized = 'ID ID ; ID ID ; ID ID ; ID';
      // 11 tokens -> 4 windows; one repeats (the tail of one window equals
      // the head of another is impossible here), so 3 unique shingles.
      expect(buildShingles(normalized).size).toBe(3);
    });
  });

  describe('similarity', () => {
    it('returns 1 for identical sources', () => {
      const code = 'int main() { int value = compute(1, 2); return value; }';
      expect(similarity(code, code)).toBe(1);
    });

    it('returns ~1 for renamed + reformatted copies', () => {
      const original = `
        #include <iostream>
        int main() {
          long long total = 0;
          for (int i = 1; i <= 100; i++) { total += i * i; }
          std::cout << total << std::endl;
          return 0;
        }
      `;
      const plagiarised = `
        #include <iostream>
        int main () {
          long long acc = 0;   // renamed
          for (int k = 1; k <= 100; k++) { acc += k * k; }
          std::cout << acc << std::endl;
          return 0;
        }
      `;
      expect(similarity(original, plagiarised)).toBeGreaterThan(0.7);
    });

    it('returns low similarity for genuinely different programs', () => {
      const sorting = `
        int main() {
          int a[100], n;
          for (int i = 0; i < n; i++)
            for (int j = i + 1; j < n; j++)
              if (a[j] < a[i]) { int t = a[i]; a[i] = a[j]; a[j] = t; }
          return 0;
        }
      `;
      const geometry = `
        int main() {
          double x1, y1, x2, y2, x3, y3;
          double area = (x1*(y2-y3) + x2*(y3-y1) + x3*(y1-y2)) / 2.0;
          printf("%.2f", area);
          return 0;
        }
      `;
      expect(similarity(sorting, geometry)).toBeLessThan(0.3);
    });

    it('returns 0 when either source is too short', () => {
      expect(similarity('int x;', 'int main() { return 0; }')).toBe(0);
    });
  });

  describe('similarity against a shared template (A5-05)', () => {
    const template = `
      struct Pair { int first, second; bool less(const Pair &o) const; void keepMin(const Pair &o); };
      bool Pair::less(const Pair &o) const {
        // Your code here
        return false;
      }
      void Pair::keepMin(const Pair &o) { if (o.less(*this)) { first = o.first; second = o.second; } }
    `;
    const fill = (body: string) => template.replace('return false;', body);
    const stepwise = fill('if (first < o.first) return true; if (o.first < first) return false; return second < o.second;');
    const oneLine = fill('return first < o.first || (!(o.first < first) && second < o.second);');

    it('compares only what each source adds to the template', () => {
      // Most of two independent fills' score is the template they share...
      expect(similarity(stepwise, oneLine)).toBeGreaterThan(0.5);
      // ...and nothing of it is left once the template's shingles are set aside.
      expect(similarity(stepwise, oneLine, templateShingles([template]))).toBeLessThan(0.3);
    });

    it('still scores a copied fill as identical', () => {
      const copied = fill('if (first < o.first)\n return true;\n if (o.first < first) return false; /* same */ return second<o.second;');
      expect(similarity(stepwise, copied, templateShingles([template]))).toBe(1);
    });

    it('scores 0 when a source adds nothing to the template', () => {
      expect(similarity(template, template, templateShingles([template]))).toBe(0);
      expect(similarity(template, stepwise, templateShingles([template]))).toBe(0);
    });

    it('collects the shingles of every template file', () => {
      const other = 'int main() { Pair a{1, 2}, b{1, 3}; return a.less(b) ? 0 : 1; }';
      const shingles = templateShingles([template, other]);
      for (const shingle of buildShingles(normalizeSource(other))) expect(shingles.has(shingle)).toBe(true);
      expect(shingles.size).toBeGreaterThan(buildShingles(normalizeSource(template)).size);
    });
  });
});
