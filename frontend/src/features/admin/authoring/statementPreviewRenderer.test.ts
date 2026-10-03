import { renderStatementPreview } from './statementPreviewRenderer';

test('renders markdown and math, and resolves only declared assets', () => {
  const html = renderStatementPreview(
    '# Hello\n\n![diagram]({{ASSET_BASE}}/chart.png)\n\n$1+1$',
    [{ filename: 'chart.png', url: '/admin/authoring/drafts/d1/assets/a1' }]
  );
  expect(html).toContain('<h1>Hello</h1>');
  expect(html).toContain('src="/admin/authoring/drafts/d1/assets/a1"');
  expect(html).toContain('class="katex"');
});

test('rejects missing asset metadata instead of exposing an arbitrary image URL', () => {
  expect(() => renderStatementPreview('![bad]({{ASSET_BASE}}/secret.png)', [])).toThrow();
  expect(() => renderStatementPreview('![bad](https://example.com/x.png)', [])).toThrow();
});
