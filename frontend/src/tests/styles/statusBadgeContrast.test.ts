import { readFileSync } from 'fs';
import { join } from 'path';

type Rgb = { red: number; green: number; blue: number };

const themeCss = readFileSync(join(__dirname, '../../index.css'), 'utf8');
const badgeCss = readFileSync(join(__dirname, '../../components/ui/StatusBadge.module.css'), 'utf8');

function themeTokens(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = themeCss.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? '';

  return Object.fromEntries(
    Array.from(block.matchAll(/(--[\w-]+):\s*([^;]+);/g), match => [match[1], match[2].trim()]),
  );
}

function toneRule(tone: string) {
  return badgeCss.match(new RegExp(`\\.${tone}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? '';
}

function declaration(rule: string, property: string) {
  const value = rule.match(new RegExp(`^\\s*${property}:\\s*([^;]+);`, 'm'))?.[1]?.trim();
  if (!value) {
    throw new Error(`Missing ${property} declaration`);
  }

  return value;
}

function resolveToken(tokens: Record<string, string>, reference: string): string {
  const name = reference.match(/^var\((--[\w-]+)\)$/)?.[1];
  if (!name) {
    return reference;
  }

  const value = tokens[name];
  if (!value) {
    throw new Error(`Missing token: ${name}`);
  }

  return resolveToken(tokens, value);
}

function parseHex(value: string): Rgb {
  const hex = value.replace('#', '');
  const expanded = hex.length === 3 ? hex.split('').map(component => component.repeat(2)).join('') : hex;

  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function composite(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  return {
    red: foreground.red * alpha + background.red * (1 - alpha),
    green: foreground.green * alpha + background.green * (1 - alpha),
    blue: foreground.blue * alpha + background.blue * (1 - alpha),
  };
}

function resolveBackground(tokens: Record<string, string>, value: string): Rgb {
  const mix = value.match(/^color-mix\(in srgb, var\((--[\w-]+)\) (\d+)%, transparent\)$/);
  if (mix) {
    return composite(parseHex(resolveToken(tokens, `var(${mix[1]})`)), parseHex(resolveToken(tokens, 'var(--background-primary)')), Number(mix[2]) / 100);
  }

  return parseHex(resolveToken(tokens, value));
}

function relativeLuminance({ red, green, blue }: Rgb): number {
  const linear = [red, green, blue].map(component => {
    const normalized = component / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: Rgb, background: Rgb): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('StatusBadge tone contrast', () => {
  it.each([
    ['light', themeTokens(':root')],
    ['dark', themeTokens("[data-theme='dark']")],
  ])('keeps every %s tone at AA contrast on its rendered background', (_theme, tokens) => {
    for (const tone of ['neutral', 'info', 'success', 'warning', 'danger']) {
      const rule = toneRule(tone);
      const foreground = parseHex(resolveToken(tokens, declaration(rule, 'color')));
      const background = resolveBackground(tokens, declaration(rule, 'background'));

      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
