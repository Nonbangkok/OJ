import { readFileSync } from 'fs';
import { join } from 'path';

type Rgb = { red: number; green: number; blue: number };

const themeCss = readFileSync(join(__dirname, '../../index.css'), 'utf8');

function themeTokens(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = themeCss.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? '';

  return Object.fromEntries(
    Array.from(block.matchAll(/(--[\w-]+):\s*([^;]+);/g), match => [match[1], match[2].trim()]),
  );
}

function resolveToken(tokens: Record<string, string>, name: string): string {
  const value = tokens[`--${name}`];
  if (!value) {
    throw new Error(`Missing token: --${name}`);
  }
  const referenced = value.match(/^var\((--[\w-]+)\)$/)?.[1];
  return referenced ? resolveToken(tokens, referenced.slice(2)) : value;
}

function parseHex(value: string): Rgb {
  const hex = value.replace('#', '');
  return {
    red: Number.parseInt(hex.slice(0, 2), 16),
    green: Number.parseInt(hex.slice(2, 4), 16),
    blue: Number.parseInt(hex.slice(4, 6), 16),
  };
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

const light = themeTokens(':root');
const dark = themeTokens("[data-theme='dark']");

describe('difficulty band tokens', () => {
  it('defines all five bands in both themes', () => {
    for (const tokens of [light, dark]) {
      for (const band of [1, 2, 3, 4, 5]) {
        expect(resolveToken(tokens, `difficulty-band-${band}`)).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it.each([
    ['light', light],
    ['dark', dark],
  ])('keeps every %s difficulty band chip at AA contrast on the problem card', (_theme, tokens) => {
    const background = parseHex(resolveToken(tokens, 'background-secondary'));
    for (const band of [1, 2, 3, 4, 5]) {
      const chipColor = parseHex(resolveToken(tokens, `difficulty-band-${band}`));
      // The chip shows the number in white text on the band color.
      expect(contrastRatio(parseHex('#ffffff'), chipColor)).toBeGreaterThanOrEqual(4.5);
      // The chip itself stays distinct from the card surface.
      expect(contrastRatio(chipColor, background)).toBeGreaterThanOrEqual(1.5);
    }
  });
});
