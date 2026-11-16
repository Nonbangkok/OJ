/**
 * Test helpers for the design-guard suite: read source files, parse the
 * theme token blocks in index.css, resolve var() chains and measure WCAG
 * contrast. Test-only; not imported by application code.
 */
import fs from 'fs';
import path from 'path';

const SRC_ROOT = path.resolve(__dirname, '../..');

export function readSource(relPath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), 'utf8');
}

/** All files under src/ with the given extensions, excluding tests. Paths are relative to src/. */
export function listSourceFiles(exts: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (full === path.join(SRC_ROOT, 'tests')) continue;
        walk(full);
      } else if (exts.some((ext) => entry.name.endsWith(ext)) && !/\.(test|spec)\.[jt]sx?$/.test(entry.name)) {
        out.push(path.relative(SRC_ROOT, full));
      }
    }
  };
  walk(SRC_ROOT);
  return out.sort();
}

export type TokenSelector = ':root' | "[data-theme='dark']";

/** First block for `selector` in `css`, as `--name → raw value`. */
export function parseTokenBlock(css: string, selector: TokenSelector): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No ${selector} block`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('\n}', open);
  const body = css.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens: Record<string, string> = {};
  for (const decl of body.split(';')) {
    const match = decl.match(/(--[\w-]+)\s*:\s*([\s\S]+)/);
    if (match) tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

function themeTokens(theme: 'light' | 'dark'): Record<string, string> {
  const css = readSource('index.css');
  const light = parseTokenBlock(css, ':root');
  return theme === 'light' ? light : { ...light, ...parseTokenBlock(css, "[data-theme='dark']") };
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** Resolved value of a token in a theme (var() chains followed), or null when it is not a colour. */
export function resolveRaw(name: string, theme: 'light' | 'dark', seen: string[] = []): string | null {
  const tokens = themeTokens(theme);
  const raw = tokens[name];
  if (raw === undefined) throw new Error(`Unknown token ${name}`);
  if (seen.includes(name)) throw new Error(`Cycle at ${name}`);
  const ref = raw.match(/^var\((--[\w-]+)\)$/);
  if (ref) return resolveRaw(ref[1], theme, [...seen, name]);
  return raw;
}

export function isColor(value: string | null): boolean {
  return !!value && (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value) || /^rgba?\(/i.test(value));
}

/** Token as #rrggbb; rgba() is composited over --background-primary of the same theme. */
export function resolveColor(name: string, theme: 'light' | 'dark'): string {
  const value = resolveRaw(name, theme);
  if (!value || !isColor(value)) throw new Error(`${name} (${theme}) is not a colour: ${value}`);
  if (value.startsWith('#')) return toHex(hexToRgb(value));
  const parts = value.replace(/rgba?\(|\)/g, '').split(',').map((p) => parseFloat(p));
  const [r, g, b, a = 1] = parts;
  const bg = hexToRgb(resolveColor('--background-primary', theme));
  return toHex([r, g, b].map((c, i) => c * a + bg[i] * (1 - a)));
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

export { themeTokens };
