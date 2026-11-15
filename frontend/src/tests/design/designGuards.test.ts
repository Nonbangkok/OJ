/**
 * Design guards for the UI redesign (docs/superpowers/specs/2026-11-15-ui-redesign-design.md).
 * They read source files and fail when the neutral visual system regresses.
 */
import { contrast, isColor, listSourceFiles, parseTokenBlock, readSource, resolveColor, resolveRaw } from './tokenUtils';

const THEMES = ['light', 'dark'] as const;

describe('tokens', () => {
  const pairs: Array<[string, string, number]> = [
    ['--text-primary', '--background-primary', 4.5],
    ['--text-primary', '--background-secondary', 4.5],
    ['--text-muted', '--background-primary', 4.5],
    ['--text-muted', '--background-secondary', 4.5],
    ['--action-primary-foreground', '--action-primary-background', 4.5],
    ['--action-destructive-foreground', '--action-destructive-background', 4.5],
    ['--verdict-accepted', '--background-primary', 4.5],
    ['--verdict-wrong', '--background-primary', 4.5],
    ['--verdict-time', '--background-primary', 4.5],
    ['--status-success', '--background-primary', 4.5],
    ['--status-danger', '--background-primary', 4.5],
    ['--action-focus-ring', '--background-primary', 3],
  ];

  describe.each(THEMES)('%s theme', (theme) => {
    it.each(pairs)('%s on %s ≥ %s', (fg, bg, min) => {
      expect(contrast(resolveColor(fg, theme), resolveColor(bg, theme))).toBeGreaterThanOrEqual(min);
    });
  });

  it('every themed token has a dark value', () => {
    const THEME_CONSTANT = [
      '--statement-paper', '--statement-stripe-a', '--statement-stripe-b', '--statement-page-number',
      '--statement-separator', '--statement-empty', '--statement-continued', '--action-button-foreground',
      '--contest-action-foreground', '--text-on-primary', '--action-primary-foreground',
      '--action-destructive-foreground',
    ];
    const css = readSource('index.css');
    const light = parseTokenBlock(css, ':root');
    const dark = parseTokenBlock(css, "[data-theme='dark']");
    const overridden = (name: string, seen: string[] = []): boolean => {
      if (name in dark) return true;
      const ref = light[name]?.match(/^var\((--[\w-]+)\)$/);
      return !!ref && !seen.includes(ref[1]) && overridden(ref[1], [...seen, name]);
    };
    const missing = Object.keys(light).filter(
      (name) => !THEME_CONSTANT.includes(name) && isColor(resolveRaw(name, 'light')) && !overridden(name),
    );
    expect(missing).toEqual([]);
  });

  it('no Bootstrap palette in source (Bootstrap guard)', () => {
    const banned = [
      '#007bff', '#0056b3', '#0069d9', '#0d6efd', '#0b5ed7', '#3d8bfd', '#6ea8fe', '#005fcc', '#17a2b8',
      '#138496', '#28a745', '#218838', '#6c757d', '#545b62', '#495057', '#212529', '#f8f9fa', '#e9ecef',
      '#dee2e6',
    ];
    const hits = listSourceFiles(['.css', '.ts', '.tsx']).flatMap((file) => {
      const text = readSource(file).toLowerCase();
      return banned.filter((hex) => new RegExp(`${hex}(?![0-9a-f])`).test(text)).map((hex) => `${file}: ${hex}`);
    });
    expect(hits).toEqual([]);
  });
});

describe('fonts', () => {
  const css = readSource('index.css');
  const tokens = parseTokenBlock(css, ':root');

  it('imports IBM Plex Sans Thai 400/500/600 and JetBrains Mono 400/500 in one Google Fonts URL', () => {
    const imports = css.match(/@import url\('https:\/\/fonts\.googleapis\.com[^']+'\)/g) ?? [];
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain('family=IBM+Plex+Sans+Thai:wght@400;500;600');
    expect(imports[0]).toContain('family=JetBrains+Mono:wght@400;500');
    expect(css).not.toMatch(/Inter|Inconsolata/);
  });

  it('sans stack falls back to Thai-capable system fonts', () => {
    const stack = tokens['--font-family-sans-serif'];
    expect(stack.startsWith("'IBM Plex Sans Thai'")).toBe(true);
    const generic = stack.lastIndexOf('sans-serif');
    expect(stack.indexOf("'Noto Sans Thai'")).toBeGreaterThan(-1);
    expect(stack.indexOf("'Noto Sans Thai'")).toBeLessThan(generic);
    expect(stack.indexOf('Tahoma')).toBeGreaterThan(-1);
    expect(stack.indexOf('Tahoma')).toBeLessThan(generic);
  });

  it('defines one mono stack', () => {
    const stack = tokens['--font-family-mono'];
    expect(stack.startsWith("'JetBrains Mono'")).toBe(true);
    expect(stack.trim().endsWith('monospace')).toBe(true);
  });

  it('every CSS font-family goes through a token', () => {
    const hits = listSourceFiles(['.css']).flatMap((file) =>
      [...readSource(file).matchAll(/font-family\s*:\s*([^;]+);/g)]
        .map((m) => m[1].trim())
        .filter((value) => value !== 'inherit' && !value.startsWith('var(--font-family-'))
        .map((value) => `${file}: ${value}`),
    );
    expect(hits).toEqual([]);
  });

  it('no legacy font names in source', () => {
    const hits = listSourceFiles(['.ts', '.tsx', '.css']).filter((file) =>
      /Fira|Inconsolata|source-code-pro/.test(readSource(file)),
    );
    expect(hits).toEqual([]);
  });
});

describe('code colours', () => {
  const CODE_TOKENS = [
    '--code-text', '--code-comment', '--code-keyword', '--code-string',
    '--code-number', '--code-title', '--code-type', '--code-meta',
  ];

  describe.each(THEMES)('%s theme', (theme) => {
    it.each(CODE_TOKENS)('%s on --editor-bg ≥ 4.5', (token) => {
      expect(contrast(resolveColor(token, theme), resolveColor('--editor-bg', theme))).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('no highlight.js stock theme imports', () => {
    const hits = listSourceFiles(['.ts', '.tsx']).filter((file) => readSource(file).includes('highlight.js/styles/'));
    expect(hits).toEqual([]);
  });

  it('codeHighlight.css colours hljs tokens only through --code-* variables', () => {
    const css = readSource('styles/codeHighlight.css');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    for (const cls of ['comment', 'keyword', 'string', 'number', 'title', 'type', 'meta', 'built_in', 'literal']) {
      expect(css).toMatch(new RegExp(`\\.hljs-${cls}\\b[^{]*\\{[^}]*var\\(--code-`));
    }
  });

  it('the app entry loads codeHighlight.css', () => {
    expect(readSource('index.tsx')).toContain("import './styles/codeHighlight.css';");
  });
});

describe('logo', () => {
  it('no source file imports the PNG logos', () => {
    const hits = listSourceFiles(['.ts', '.tsx']).filter((file) => readSource(file).includes('assets/logo512'));
    expect(hits).toEqual([]);
  });
});

describe('decoration', () => {
  it('no emoji in source', () => {
    // U+FE0F (emoji presentation selector) is matched on its own: inside a
    // character class it would combine with the previous code point.
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2705}\u{274C}]|\u{FE0F}/u;
    const hits = listSourceFiles(['.ts', '.tsx', '.css']).filter((file) => emoji.test(readSource(file)));
    expect(hits).toEqual([]);
  });

  it('no gradients in source', () => {
    const hits = listSourceFiles(['.ts', '.tsx', '.css']).filter((file) => readSource(file).includes('gradient('));
    expect(hits).toEqual([]);
  });
});

describe('primitives', () => {
  it('Button has no resting shadow and uses the 6px radius', () => {
    const css = readSource('components/ui/Button.module.css');
    expect(css).not.toMatch(/box-shadow\s*:\s*var\(--(surface-elevation|box-shadow)\)/);
    expect(css).toMatch(/\.button\s*\{[^}]*border-radius:\s*var\(--radius-md\)/);
    expect(css).toMatch(/\.button:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--action-focus-ring\)/);
  });

  it('StatusBadge tones use the shared tint triplets', () => {
    const css = readSource('components/ui/StatusBadge.module.css');
    for (const [tone, tint] of [['neutral', 'neutral'], ['info', 'neutral'], ['success', 'success'], ['warning', 'warning'], ['danger', 'danger']]) {
      expect(css).toMatch(new RegExp(`\\.${tone}\\s*\\{[^}]*background:\\s*var\\(--tint-${tint}-bg\\)[^}]*color:\\s*var\\(--tint-${tint}-fg\\)`));
    }
  });
});
