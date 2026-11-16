import { readFileSync } from 'fs';
import { join } from 'path';

const read = (path: string) => readFileSync(join(__dirname, '../..', path), 'utf8');
const rule = (css: string, selector: string) =>
  css.match(new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

test('long problem titles and IDs can wrap within the problem header', () => {
  const header = read('components/ui/PageHeader.module.css');
  expect(rule(header, '.text')).toContain('min-width: 0;');
  expect(rule(header, '.title')).toContain('overflow-wrap: anywhere;');
  const detail = read('pages/problem/ProblemDetail.module.css');
  expect(rule(detail, '.mono')).toContain('overflow-wrap: anywhere;');
});
