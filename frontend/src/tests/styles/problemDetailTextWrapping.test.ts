import { readFileSync } from 'fs';
import { join } from 'path';

const problemDetailCss = readFileSync(
  join(__dirname, '../../pages/problem/ProblemDetail.module.css'),
  'utf8'
);

test('long problem titles and IDs can wrap within the detail sidebar', () => {
  const infoRule = problemDetailCss.match(/\.problem-info\s*\{([^}]*)\}/)?.[1];
  const titleAndIdRule = problemDetailCss.match(
    /\.problem-info\s+h2\s*,\s*\.problem-info\s+\.problem-id\s*\{([^}]*)\}/
  )?.[1];

  expect(infoRule).toBeDefined();
  expect(infoRule ?? '').toContain('min-width: 0;');
  expect(titleAndIdRule).toBeDefined();
  expect(titleAndIdRule ?? '').toContain('overflow-wrap: anywhere;');
});
