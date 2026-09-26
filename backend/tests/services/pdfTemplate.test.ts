import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { buildPdfHtml, PDF_TEMPLATE_DIRECTORY, PdfDocument, taskCodeFromDraft } from '../../authoring/pdfTemplate';

const document: PdfDocument = {
  templateVersion: 'red-gate-v1', title: 'Current <task>', taskCode: 'sum&go',
  akaName: 'Current "author"', realName: 'New Author', language: 'English', countryCode: 'GBR',
  statementHtml: '<h1>Current task</h1><p>$a+b$</p><img src="{{ASSET_BASE}}/diagram.png" alt="diagram">',
};
const options = { templateBaseUrl: 'file:///opt/templates/red-gate-v1', assetBaseUrl: 'file:///job/assets', avatarUrl: 'file:///job/avatar.png' };

function executeReadiness(mathFailure?: Error) {
  const html = buildPdfHtml(document, options);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  const attributes: Record<string, string> = {};
  const timers: Array<() => void> = [];
  const errors: string[] = [];
  const window = { status: '', setTimeout: (callback: () => void) => timers.push(callback), onerror: undefined };
  let mathOptions: any;
  runInNewContext(script, {
    window, console: { error: (message: string) => errors.push(message) },
    document: { getElementById: () => ({ setAttribute: (k: string, v: string) => { attributes[k] = v; } }), documentElement: { setAttribute: (k: string, v: string) => { attributes[k] = v; } } },
    require: () => (_element: unknown, suppliedOptions: any) => {
      mathOptions = suppliedOptions;
      if (mathFailure) suppliedOptions.errorCallback('bad math', mathFailure);
    },
  });
  timers.forEach(callback => callback());
  return { window, errors, attributes, mathOptions };
}

describe('taskCodeFromDraft', () => {
  it('strips a leading CSP_ prefix from the title for the printed header code', () => {
    expect(taskCodeFromDraft('csp_twosum', 'CSP_Two Sum')).toBe('Two Sum');
    expect(taskCodeFromDraft('csp_ncr', 'CSP_nCr')).toBe('nCr');
  });

  it('falls back to the problem id for titles without the prefix', () => {
    expect(taskCodeFromDraft('aplusb', 'A + B')).toBe('aplusb');
    expect(taskCodeFromDraft('redgate', 'Red Gate')).toBe('redgate');
  });
});

describe('versioned PDF template', () => {
  it('uses current metadata and explicit avatar with escaped text', () => {
    const html = buildPdfHtml(document, options);
    expect(html).toContain('<title>Current &lt;task&gt;</title>');
    expect(html).toContain('sum&amp;go');
    expect(html).toContain('Current &quot;author&quot;');
    expect(html).toContain('Author : New Author');
    expect(html).toContain('English (GBR)');
    expect(html).toContain('src="file:///job/avatar.png"');
    expect(html).not.toContain('Nonbangkok');
    expect(html).not.toContain('<title>Red Gate</title>');
    expect(buildPdfHtml(document, { ...options, avatarUrl: undefined })).not.toContain('avatar.png');
  });

  it('keeps sanitized statement markup intact while resolving packet assets', () => {
    const html = buildPdfHtml(document, options);
    expect(html).toContain(document.statementHtml.replace('{{ASSET_BASE}}', 'file:///job/assets'));
    expect(html).toContain('href="file:///opt/templates/red-gate-v1/vendor/katex.css"');
    expect(html).toContain('src="file:///opt/templates/red-gate-v1/vendor/bundle.js"');
    expect(html).not.toContain('{{ASSET_BASE}}');
  });

  it('rejects unsupported versions and nonlocal renderer URLs', () => {
    expect(() => buildPdfHtml({ ...document, templateVersion: 'future-v2' }, options)).toThrow(/template/i);
    for (const field of ['templateBaseUrl', 'assetBaseUrl', 'avatarUrl']) {
      expect(() => buildPdfHtml(document, { ...options, [field]: 'https://attacker.example/x' })).toThrow(/URL/i);
      expect(() => buildPdfHtml(document, { ...options, [field]: "file:///job/x');alert(1);//" })).toThrow(/URL/i);
    }
  });

  it('announces readiness only after successful math rendering with restricted commands', () => {
    const result = executeReadiness();
    expect(result.window.status).toBe('ready-to-print');
    expect(result.attributes['data-ready']).toBe('true');
    expect(result.mathOptions).toMatchObject({ trust: false, strict: 'error', throwOnError: true, maxExpand: 1000 });
  });

  it('announces failure and never readiness for rejected math', () => {
    const result = executeReadiness(new Error('Unsafe math command'));
    expect(result.window.status).toBe('pdf-render-error');
    expect(result.attributes['data-ready']).toBeUndefined();
    expect(result.errors.join(' ')).toContain('Unsafe math command');
  });

  it('ships all fonts referenced by the approved stylesheet and baseline fixture', () => {
    const html = buildPdfHtml(document, options);
    for (const match of html.matchAll(/url\('file:\/\/\/opt\/templates\/red-gate-v1\/([^']+)'\)/g)) {
      expect(existsSync(path.join(PDF_TEMPLATE_DIRECTORY, match[1]))).toBe(true);
    }
    const css = readFileSync(path.join(PDF_TEMPLATE_DIRECTORY, 'vendor/katex.css'), 'utf8');
    for (const match of css.matchAll(/url\((?:["']?)(fonts\/[^)'"\s]+)(?:["']?)\)/g)) {
      expect(existsSync(path.join(PDF_TEMPLATE_DIRECTORY, 'vendor', match[1]))).toBe(true);
    }
    expect(existsSync(path.join(PDF_TEMPLATE_DIRECTORY, 'vendor/fonts/fonts'))).toBe(false);
    const fixture = path.join(__dirname, '../fixtures/pdf');
    expect(readFileSync(path.join(fixture, 'red-gate-demo.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
    const baseline = readFileSync(path.join(fixture, 'red-gate-statement.html'), 'utf8');
    expect(buildPdfHtml({ ...document, statementHtml: baseline }, options)).toContain('class="geometry-data"');
  });
});
