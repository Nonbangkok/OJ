import { compileStatementSource } from '../../authoring/statementCompiler';
import { StatementError } from '../../authoring/statementSanitizer';

describe('task-pdf-writer compatible statement compilation', () => {
  it('compiles mixed Markdown, raw HTML, LaTeX and legacy image elements', () => {
    const source = String.raw`# Red Gate

โจทย์นี้มี <b>ข้อความสำคัญ</b> และค่า $D_w$

<image src="{{ASSET_BASE}}/diagram.png" style="width:80%">

## Input

| Input | Output |
| --- | --- |
| 1 | 2 |`;

    const html = compileStatementSource(source, ['diagram.png']);

    expect(html).toContain('<h1>Red Gate</h1>');
    expect(html).toContain('<p>โจทย์นี้มี <b>ข้อความสำคัญ</b> และค่า $D_w$</p>');
    expect(html).toContain('<img src="{{ASSET_BASE}}/diagram.png" style="width: 80%">');
    expect(html).toContain('<h2>Input</h2>');
    expect(html).toContain('<table>');
  });

  it('keeps task-pdf-writer backslash LaTeX delimiters for KaTeX and leaves code literal', () => {
    const html = compileStatementSource(String.raw`Value: \(x^2\)

~~~cpp
$not_math$ <image src="not-an-asset.png">
~~~`, []);

    expect(html).toContain(String.raw`<p>Value: \(x^2\)</p>`);
    expect(html).toContain('&lt;image src="not-an-asset.png"&gt;');
  });

  it('preserves ordinary backslashes in fenced code and legacy preformatted HTML', () => {
    const html = compileStatementSource(String.raw`~~~cpp
std::cout << "\n";
~~~

<pre>std::cout &lt;&lt; "\n";</pre>

<p title="C:\temp">C:\temp</p>`, []);

    expect(html).toContain(String.raw`std::cout &lt;&lt; "\n";`);
    expect(html).not.toContain(String.raw`std::cout &lt;&lt; "\\n";`);
    expect(html).toContain(String.raw`<p title="C:\temp">C:\temp</p>`);
  });

  it('supports the Markdown constructs exposed by the task-pdf-writer editor', () => {
    const source = `> **Important** and *emphasized* and ~~removed~~\n\n`
      + `[Reference](https://example.com/task)\n\n`
      + `![diagram]({{ASSET_BASE}}/diagram.png)`;

    const html = compileStatementSource(source, ['diagram.png']);

    expect(html).toContain('<blockquote>');
    expect(html).toContain('<strong>Important</strong>');
    expect(html).toContain('<em>emphasized</em>');
    expect(html).toContain('<del>removed</del>');
    expect(html).toContain('<a href="https://example.com/task">Reference</a>');
    expect(html).toContain('<img alt="diagram" src="{{ASSET_BASE}}/diagram.png">');
  });

  it('accepts the bounded legacy table and page-break markup used by existing task-pdf-writer statements', () => {
    const source = `<div style="page-break-after: always;"></div>
<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
<tr align="center"><th style="padding: 5px;">Input</th></tr>
<tr><td width="50%" style="vertical-align:top; padding: 1; margin: 0;">
<pre style="background-color: transparent; border: 0; margin: 0; padding: 0;">1  2</pre>
</td></tr></table>`;

    const html = compileStatementSource(source, []);

    expect(html).toContain('<div style="page-break-after: always"></div>');
    expect(html).toContain('<table cellpadding="0" cellspacing="0" style="border-collapse: collapse" width="100%">');
    expect(html).toContain('<tr align="center">');
    expect(html).toContain('<td style="margin: 0; padding: 1; vertical-align: top" width="50%">');
    expect(html).toContain('<pre style="background-color: transparent; border: 0; margin: 0; padding: 0">1  2</pre>');
  });

  it('still rejects unsafe raw HTML and undeclared legacy images after Markdown parsing', () => {
    expect(() => compileStatementSource('# Safe\n\n<script>alert(1)</script>', []))
      .toThrow(StatementError);
    expect(() => compileStatementSource('<image src="{{ASSET_BASE}}/missing.png">', []))
      .toThrow(StatementError);
    expect(() => compileStatementSource('[bad](javascript:alert(1))', []))
      .toThrow(StatementError);
  });

  it('bounds math placeholders before Markdown parsing', () => {
    expect(() => compileStatementSource('$x$ '.repeat(1001), [])).toThrow(StatementError);
  });

  it('handles long placeholder-like input within a bounded amount of work', () => {
    const source = `OJMATHTOKEN${'X'.repeat(120_000)} $x$`;
    const started = Date.now();
    expect(compileStatementSource(source, [])).toContain('$x$');
    expect(Date.now() - started).toBeLessThan(750);
  });
});
