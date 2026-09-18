import { sanitizeStatement, StatementError } from '../../authoring/statementSanitizer';

describe('statement HTML sanitization', () => {
  it('preserves statement math, sample whitespace, tables, breaks and referenced images', () => {
    const html = '<h2>โจทย์</h2><p>Find $a &lt; b$ and \\(x^2\\).</p>'
      + '<table class="sample-table"><thead><tr><th>Input</th><th>Output</th></tr></thead>'
      + '<tbody><tr><td><pre>2  3\n 4\n</pre></td><td><code>9</code></td></tr></tbody></table>'
      + '<div class="forced-page-break"></div><img src="{{ASSET_BASE}}/diagram.png" style="width: 80%">';
    expect(sanitizeStatement(html, ['diagram.png'])).toBe(html);
  });

  it('normalizes tag case, attribute order, entities and safe styles without changing text', () => {
    expect(sanitizeStatement('<P TITLE="a &quot; b">A & B &lt; C</P>'
      + '<IMG width="120" alt="a &amp; b" SRC="{{ASSET_BASE}}/a.png">'
      + '<td style="vertical-align: TOP; text-align:center" colspan="2">x</td>', ['a.png']))
      .toBe('<p title="a &quot; b">A &amp; B &lt; C</p>'
        + '<img alt="a &amp; b" src="{{ASSET_BASE}}/a.png" width="120">'
        + '<td colspan="2" style="text-align: center; vertical-align: top">x</td>');
  });

  it('canonicalizes unclosed safe markup and removes comments', () => {
    expect(sanitizeStatement('<p>first<p>second<!-- hidden --><b>last', []))
      .toBe('<p>first</p><p>second<b>last</b></p>');
    expect(sanitizeStatement('2 < 3 and &lt;script&gt;literal&lt;/script&gt;', []))
      .toBe('2 &lt; 3 and &lt;script&gt;literal&lt;/script&gt;');
  });

  it.each(['script', 'iframe', 'object', 'embed', 'style', 'link', 'meta', 'base',
    'svg', 'math', 'form', 'input', 'button', 'textarea', 'select', 'video', 'audio', 'template'])
  ('rejects forbidden <%s> elements', (tag) => {
    expect(() => sanitizeStatement(`<${tag}>bad</${tag}>`, [])).toThrow(StatementError);
  });

  it.each([
    '<img src="{{ASSET_BASE}}/a.png" onerror="alert(1)">',
    '<p ONCLICK="alert(1)">bad</p>',
    '<img src="{{ASSET_BASE}}/a.png" srcset="https://evil.test/a.png 2x">',
    '<p id="statement-header">bad</p>', '<div class="statement-header">bad</div>',
    '<div class="sample-table evil">bad</div>', '<p data-x="x">bad</p>',
    '<p xmlns="http://www.w3.org/1999/xhtml">bad</p>',
    '<div background="file:///etc/passwd">bad</div>',
    '<p title="safe" title="duplicate">bad</p>',
    '<img src="{{ASSET_BASE}}/a.png" src="https://evil.test/a.png">',
    '<p style="width: 80%">bad</p>', '<img src="{{ASSET_BASE}}/a.png" width="999999999">',
    '<td colspan="0">bad</td>', '<td rowspan="2evil">bad</td>',
  ])('rejects unsafe or unsupported attributes: %s', (html) => {
    expect(() => sanitizeStatement(html, ['a.png'])).toThrow(StatementError);
  });

  it('allows web links and rejects active, local or credential-bearing link targets', () => {
    expect(sanitizeStatement('<a href="https://example.com/task?q=1">task</a>', []))
      .toBe('<a href="https://example.com/task?q=1">task</a>');
    for (const href of ['javascript:alert(1)', 'file:///etc/passwd', '/relative', '#fragment',
      'https://user:secret@example.com/task']) {
      expect(() => sanitizeStatement(`<a href="${href}">bad</a>`, [])).toThrow(StatementError);
    }
  });

  it.each(['https://evil.test/x.png', '//evil.test/x.png', 'data:image/png;base64,AAAA',
    'file:///etc/passwd', 'javascript:alert(1)', 'java&#x73;cript:alert(1)',
    '{{ASSET_BASE}}/../a.png', '{{ASSET_BASE}}/a..png', '{{ASSET_BASE}}/nested/a.png',
    '{{ASSET_BASE}}/a.png?x=1', '{{ASSET_BASE}}/a.png#x', '{{ASSET_BASE}}/a%2epng',
    '{{ASSET_BASE}}\\a.png', ' {{ASSET_BASE}}/a.png', '{{ASSET_BASE}}/missing.png',
    '{{ASSET_BASE}}/.a.png', '{{ASSET_BASE}}/ภาษา.png', '{{ASSET_BASE}}/' + 'a'.repeat(256)])
  ('rejects image sources outside the declared asset namespace: %s', (src) => {
    expect(() => sanitizeStatement(`<img src="${src}">`, ['a.png'])).toThrow(StatementError);
  });

  it('requires every image to identify an asset', () => {
    expect(() => sanitizeStatement('<img alt="missing source">', [])).toThrow(StatementError);
    expect(sanitizeStatement('<img src="{{ASSET_BASE}}/a.png">', ['unused.png', 'a.png']))
      .toBe('<img src="{{ASSET_BASE}}/a.png">');
  });

  it.each(['background:url(https://evil.test/x)', 'width:expression(alert(1))',
    'width:80%;position:fixed', 'display:none', 'font-family:evil',
    'width:80% !important', 'width:80%;width:90%', 'w\\69dth:80%',
    'width:calc(100% - 1px)', 'width:80%/*x*/', 'width:&#117;rl(file:///etc/passwd)',
    'text-align:left;@import "https://evil.test/x"', 'white-space:invalid',
    'height:-1px', 'width:10001px'])
  ('rejects unsafe CSS: %s', (style) => {
    expect(() => sanitizeStatement(`<img src="{{ASSET_BASE}}/a.png" style='${style}'>`, ['a.png']))
      .toThrow(StatementError);
  });

  it.each(['<!DOCTYPE html>', '<?xml version="1.0"?>',
    '<svg><p><style><img src=x onerror=alert(1)>',
    '<p><scrIPt/x>alert(1)</scrIPt>', '<img/src="{{ASSET_BASE}}/a.png"/onerror=alert(1)>',
    '<div\u0000>bad</div>', '<p title="x\u0000y">bad</p>'])
  ('rejects declarations and malformed unsafe markup: %s', (html) => {
    expect(() => sanitizeStatement(html, ['a.png'])).toThrow(StatementError);
  });

  it('is idempotent after canonicalization', () => {
    const html = sanitizeStatement('<P>x & y<b>z</P><br/><img SRC="{{ASSET_BASE}}/a.png">', ['a.png']);
    expect(sanitizeStatement(html, ['a.png'])).toBe(html);
  });

  it('bounds UTF-8 input bytes and escaped output bytes', () => {
    expect(() => sanitizeStatement('ก'.repeat(699051), [])).toThrow(StatementError);
    expect(() => sanitizeStatement('&'.repeat(500000), [])).toThrow(StatementError);
    expect(sanitizeStatement('x'.repeat(2 * 1024 * 1024), [])).toHaveLength(2 * 1024 * 1024);
  });

  it('bounds nesting before building a large tree and bounds the node count', () => {
    expect(() => sanitizeStatement('<div>'.repeat(129), [])).toThrow(StatementError);
    expect(() => sanitizeStatement('<br>'.repeat(100001), [])).toThrow(StatementError);
    expect(sanitizeStatement('<div>'.repeat(128), [])).toBe('<div>'.repeat(128) + '</div>'.repeat(128));
  });

  it('exposes a stable machine-readable validation code', () => {
    try {
      sanitizeStatement('<script>bad</script>', []);
      throw new Error('Unsafe HTML unexpectedly accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(StatementError);
      expect((error as StatementError).code).toBe('UNSAFE_STATEMENT');
    }
  });
});
