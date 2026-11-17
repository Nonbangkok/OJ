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
      '--statement-separator', '--statement-empty', '--statement-continued',
      '--action-destructive-foreground', '--on-fill',
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

describe('theme-safe text', () => {
  it('no literal white text except on the fixed difficulty bands', () => {
    // Surfaces such as --accent-primary and --editor-bg flip between light and
    // dark, so text on them must use a token (--action-primary-foreground,
    // --editor-text). Difficulty chips sit on constant band colours and keep white.
    const hits = listSourceFiles(['.css']).flatMap((file) =>
      [...readSource(file).matchAll(/([^{}]+)\{([^}]*)\}/g)]
        .filter(([, selector, body]) =>
          !/difficulty(-chip-|-preview-|Chip)/.test(selector) &&
          /(^|[^-])(color|caret-color)\s*:\s*(white|#fff\b|#ffffff)/.test(body))
        .map(([, selector]) => `${file}: ${selector.trim().split('\n').pop()}`),
    );
    expect(hits).toEqual([]);
  });
});

describe('rule contrast', () => {
  // Every CSS rule that sets both a text colour and a solid background must stay
  // readable in both themes. Values are resolved through the theme tokens.
  const valueOf = (raw: string, theme: 'light' | 'dark'): string | null => {
    const v = raw.replace(/!important/, '').trim();
    const ref = v.match(/^var\((--[\w-]+)\)$/);
    if (ref) {
      try { return resolveColor(ref[1], theme); } catch { return null; }
    }
    if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) return v;
    if (/^(white)$/i.test(v)) return '#ffffff';
    return null;
  };

  const rules = listSourceFiles(['.css']).flatMap((file) =>
    [...readSource(file).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].flatMap(([, selector, body]) => {
      const color = body.match(/(?:^|;)\s*color\s*:\s*([^;]+)/)?.[1];
      const bg = body.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/)?.[1];
      // Disabled controls are exempt from contrast (WCAG 1.4.3 inactive UI).
      if (/:disabled|\[disabled\]/.test(selector)) return [];
      return color && bg ? [{ where: `${file}: ${selector.trim().split('\n').pop()}`, color, bg }] : [];
    }),
  );

  it.each(THEMES)('text on its own background is ≥ 4.5:1 in %s', (theme) => {
    const failures = rules.flatMap(({ where, color, bg }) => {
      const fg = valueOf(color, theme);
      const back = valueOf(bg, theme);
      if (!fg || !back) return [];
      const ratio = contrast(fg, back);
      return ratio < 4.5 ? [`${where} (${ratio.toFixed(2)})`] : [];
    });
    expect(failures).toEqual([]);
  });
});

describe('review fixes (phase 1 final review)', () => {
  /** Declarations of the rule whose selector list contains `selector` exactly. */
  const decl = (file: string, selector: string, prop: string): string => {
    const css = readSource(file).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (sel.split(',').map((s) => s.trim()).includes(selector)) {
        const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
        if (m) return m[1].trim();
      }
    }
    throw new Error(`${file}: no ${prop} on ${selector}`);
  };
  const color = (raw: string, theme: 'light' | 'dark') => {
    const ref = raw.match(/^var\((--[\w-]+)\)$/);
    return ref ? resolveColor(ref[1], theme) : raw;
  };

  describe.each(THEMES)('%s theme', (theme) => {
    it.each(['.problem-action-btn.new', '.problem-action-btn.new:hover', '.problem-action-btn.new:active'])(
      'problem list action text is AA on %s', (sel) => {
        const fg = color(decl('features/problem/ProblemCard.module.css', '.problem-action-btn', 'color'), theme);
        const bg = color(decl('features/problem/ProblemCard.module.css', sel, 'background-color'), theme);
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
      });

    it.each(['full', 'partial'])('score bar number is AA on the %s fill', (kind) => {
      const fg = color(decl('features/problem/ProblemCard.module.css', `.score-bar.${kind} span`, 'color'), theme);
      const bg = color(decl('features/problem/ProblemCard.module.css', `.score-bar.${kind}`, 'background-color'), theme);
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });

    it('upload percentage sits on its own readable surface', () => {
      const file = 'features/admin/shared/Management.module.css';
      const fg = color(decl(file, '.progressPercentage', 'color'), theme);
      const bg = color(decl(file, '.progressPercentage', 'background-color'), theme);
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });

    it('settings toggle knob stands out from the checked track', () => {
      const file = 'features/admin/settings/Settings.module.css';
      const knob = color(decl(file, '.toggleTrack::before', 'background-color'), theme);
      const track = color(decl(file, '.toggleSwitch input:checked + .toggleTrack', 'background-color'), theme);
      expect(contrast(knob, track)).toBeGreaterThanOrEqual(3);
    });
  });

  it('sidebar marks the current page in text, not only with a surface', () => {
    const css = readSource('components/shell/Sidebar.module.css');
    expect(css).toMatch(/\.item\[aria-current='page'\]\s*\{[^}]*color:\s*var\(--text-primary\)[^}]*font-weight:\s*500/);
  });

  it.each([
    ['components/ui/Dialog.module.css'], ['components/ui/ActionMenu.module.css'], ['components/ui/Drawer.module.css'],
    ['components/shell/AccountMenu.module.css'], ['components/user/XpToast.module.css'],
  ])('%s floats with the floating-layer shadow', (file) => {
    const shadows = [...readSource(file).matchAll(/box-shadow\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(shadows).toContain('var(--box-shadow-lg)');
  });

  it('contest sidebar marks the current page in text', () => {
    const css = readSource('components/shell/ContestShell.module.css');
    expect(css).toMatch(/\.link\[aria-current='page'\]\s*\{[^}]*color:\s*var\(--text-primary\)/);
    expect(css).toMatch(/\.problem\[aria-current='page'\]\s*\{[^}]*color:\s*var\(--text-primary\)/);
  });

  it('form controls inherit the UI font', () => {
    expect(readSource('index.css')).toMatch(/button,\s*input,\s*select,\s*textarea\s*\{[^}]*font-family:\s*inherit/);
  });

  it('accepted verdict dot uses the verdict colour', () => {
    expect(decl('pages/user/UserProfile.module.css', '.verdict-dot-accepted', 'background-color')).toBe('var(--verdict-accepted)');
  });
});

describe('shell tokens', () => {
  const css = readSource('index.css');
  const root = parseTokenBlock(css, ':root');

  it('defines the layout tokens', () => {
    expect(root['--sidebar-width']).toBe('220px');
    expect(root['--content-max-width']).toBe('1360px');
    expect(root['--page-gutter']).toBe('28px');
    expect(root['--tabbar-height']).toBe('56px');
    expect(root['--topbar-height']).toBe('52px');
  });

  it('narrows the page gutter on phones', () => {
    expect(css).toMatch(/@media \(max-width: 767px\)\s*\{\s*:root\s*\{[^}]*--page-gutter:\s*16px/);
  });

  it('the page container uses the shared width and gutter', () => {
    expect(css).toMatch(/\.container\s*\{[^}]*max-width:\s*var\(--content-max-width\)[^}]*padding:\s*24px var\(--page-gutter\)/);
  });

  it('pins cmdk exactly', () => {
    const pkg = JSON.parse(readSource('../package.json'));
    expect(pkg.dependencies.cmdk).toBe('1.1.1');
  });
});

describe('shell layout', () => {
  it('the main column can shrink so wide tables scroll inside it', () => {
    expect(readSource('components/shell/AppShell.module.css')).toMatch(/\.main\s*\{[^}]*min-width:\s*0/);
  });
});

describe('page headers', () => {
  const PAGES = [
    'pages/problem/Problems.tsx', 'features/submission/SubmissionsView.tsx', 'pages/scoreboard/Scoreboard.tsx',
    'pages/contest/Contests.tsx', 'pages/contest/ContestProblems.tsx', 'pages/contest/ContestScoreboard.tsx',
    'features/admin/users/UserManagement.tsx', 'features/admin/problems/ProblemManagement.tsx',
    'features/admin/contests/ContestManagement.tsx', 'features/admin/analysis/AnalysisPage.tsx',
    'features/admin/problems/ProblemEditPage.tsx', 'features/admin/contests/ContestEditPage.tsx',
    'features/admin/settings/Settings.tsx', 'features/admin/authoring/AuthoringHub.tsx', 'features/admin/authoring/AiDocs.tsx',
    'pages/submission/SubmissionDetailPage.tsx', 'pages/problem/ProblemDetail.tsx',
    'features/contest/ContestLobby.tsx', 'features/contest/ContestJoinGate.tsx', 'features/contest/ContestRecap.tsx',
    // UserProfile is exempt: its identity header (avatar, name, level, rank — §7.6) is the page title.
  ];
  it.each(PAGES)('%s uses PageHeader and no page-level heading of its own', (file) => {
    const src = readSource(file);
    expect(src).toMatch(/import\s*\{[^}]*\bPageHeader\b[^}]*\}\s*from/);
    expect(src).not.toMatch(/<h1[\s>]/);
  });

  // Page containers only: inner content measures (a form, a guest landing column) may keep a max-width.
  const PAGE_CONTAINERS: Array<[string, string]> = [
    ['pages/home/Home.module.css', '.home-container'],
    ['pages/user/UserProfile.module.css', '.profile-container'],
    ['pages/problem/Problems.module.css', '.problems-page-container'],
    ['pages/contest/Contests.module.css', '.container'],
  ];
  it.each(PAGE_CONTAINERS)('%s %s leaves the page width to the shell', (file, selector) => {
    const css = readSource(file).replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(([, sel]) => sel.trim() === selector);
    expect(rule).toBeDefined();
    expect(rule?.[2]).not.toMatch(/max-width/);
  });
});

describe('old navbars', () => {
  it('nothing imports the removed navbars', () => {
    const hits = listSourceFiles(['.ts', '.tsx']).filter((file) =>
      /components\/navbar\/|layouts\/contest\/ContestNavbar|AdminNavbar/.test(readSource(file)));
    expect(hits).toEqual([]);
  });
});

describe('shell focus', () => {
  it.each([
    ['components/shell/Sidebar.module.css', ['.item', '.search', '.iconButton', '.brandLink']],
    ['components/shell/AppShell.module.css', ['.iconButton', '.brand']],
    ['components/shell/MobileTabBar.module.css', ['.tab', '.sheetItem']],
    ['components/shell/ContestShell.module.css', ['.leave', '.title', '.problem', '.link', '.back', '.tab']],
    ['components/shell/AuthShell.module.css', ['.brand']],
  ])('%s gives every control a visible keyboard focus ring', (file, selectors) => {
    const css = readSource(file);
    for (const sel of selectors) {
      expect(css).toMatch(new RegExp(`\\${sel}:focus-visible[^{]*\\{[^}]*outline:\\s*2px solid var\\(--action-focus-ring\\)`));
    }
  });
});

describe('libraries', () => {
  it('pins Base UI exactly', () => {
    const pkg = JSON.parse(readSource('../package.json'));
    expect(pkg.dependencies['@base-ui/react']).toBe('1.9.0');
  });
});
