import { compileStatementSource, renderStatementMath, StatementError } from '@oj/statement-renderer';

test('shared renderer compiles GFM, safe raw HTML, math, and declared assets', () => {
  const html = compileStatementSource(
    '# Heading\n\nValue: $x^2$\n\n<image src="{{ASSET_BASE}}/diagram.png">',
    ['diagram.png'],
  );

  expect(html).toContain('<h1>Heading</h1>');
  expect(renderStatementMath(html)).toContain('katex');
  expect(html).toContain('<img src="{{ASSET_BASE}}/diagram.png">');
});

test('shared renderer rejects unsafe HTML and undeclared image sources', () => {
  expect(() => compileStatementSource('<script>alert(1)</script>', [])).toThrow(StatementError);
  expect(() => compileStatementSource('![bad](https://example.com/a.png)', [])).toThrow(StatementError);
  expect(() => compileStatementSource('![bad]({{ASSET_BASE}}/missing.png)', [])).toThrow(StatementError);
});

// A9-10: KaTeX before 0.16.10 let \edef expand past maxExpand
// (GHSA-64fm-8hw2-v72w): 2^12 copies rendered despite the limit of 1000, and a
// few more doublings blocked the preview worker for seconds.
test('shared renderer enforces the math expansion limit through \\edef', () => {
  const tex = String.raw`\def\a{x}` + String.raw`\edef\a{\a\a}`.repeat(12) + String.raw`\a`;
  expect(() => renderStatementMath(`<p>$${tex}$</p>`)).toThrow(StatementError);
});
