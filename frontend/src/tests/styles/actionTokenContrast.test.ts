import { readFileSync } from 'fs';
import { join } from 'path';

type Rgba = { red: number; green: number; blue: number; alpha: number };

const css = readFileSync(join(__dirname, '../../index.css'), 'utf8');

function themeTokens(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = css.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? '';

  return Object.fromEntries(
    Array.from(block.matchAll(/(--[\w-]+):\s*([^;]+);/g), match => [match[1], match[2].trim()]),
  );
}

function resolveToken(tokens: Record<string, string>, name: string): string {
  const value = tokens[`--${name}`];
  const referencedToken = value?.match(/^var\((--[\w-]+)\)$/)?.[1];

  if (!value) {
    throw new Error(`Missing token: --${name}`);
  }

  return referencedToken ? resolveToken(tokens, referencedToken.slice(2)) : value;
}

function parseColor(value: string): Rgba {
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    const expanded = hex.length === 3 ? hex.split('').map(character => character.repeat(2)).join('') : hex;

    return {
      red: Number.parseInt(expanded.slice(0, 2), 16),
      green: Number.parseInt(expanded.slice(2, 4), 16),
      blue: Number.parseInt(expanded.slice(4, 6), 16),
      alpha: 1,
    };
  }

  const components = value.match(/^rgba?\(([^)]+)\)$/)?.[1].split(',').map(component => Number(component.trim()));
  if (!components || components.length < 3) {
    throw new Error(`Unsupported color: ${value}`);
  }

  return {
    red: components[0],
    green: components[1],
    blue: components[2],
    alpha: components[3] ?? 1,
  };
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  return {
    red: foreground.red * foreground.alpha + background.red * (1 - foreground.alpha),
    green: foreground.green * foreground.alpha + background.green * (1 - foreground.alpha),
    blue: foreground.blue * foreground.alpha + background.blue * (1 - foreground.alpha),
    alpha: 1,
  };
}

function relativeLuminance({ red, green, blue }: Rgba): number {
  const linear = [red, green, blue].map(component => {
    const normalized = component / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: string, background: string): number {
  const backgroundColor = parseColor(background);
  const foregroundColor = composite(parseColor(foreground), backgroundColor);
  const [lighter, darker] = [relativeLuminance(foregroundColor), relativeLuminance(backgroundColor)].sort((a, b) => b - a);

  return (lighter + 0.05) / (darker + 0.05);
}

const light = themeTokens(':root');
const dark = themeTokens("[data-theme='dark']");

describe('action theme contrast', () => {
  it('keeps light primary button text at AA contrast', () => {
    expect(contrastRatio(
      resolveToken(light, 'action-primary-foreground'),
      resolveToken(light, 'action-primary-background'),
    )).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the light focus indicator distinct from its primary surface', () => {
    expect(contrastRatio(
      resolveToken(light, 'action-focus-ring'),
      resolveToken(light, 'background-primary'),
    )).toBeGreaterThanOrEqual(3);
  });

  it.each(['background-primary', 'surface-elevated'])('keeps the dark focus indicator distinct from %s', surface => {
    expect(contrastRatio(
      resolveToken(dark, 'action-focus-ring'),
      resolveToken(dark, surface),
    )).toBeGreaterThanOrEqual(3);
  });

  it.each([
    ['text-muted', 'background-primary'],
    ['text-muted', 'surface-elevated'],
    ['status-danger', 'background-primary'],
    ['status-danger', 'surface-elevated'],
  ])('keeps dark %s text at AA contrast on %s', (textToken, surface) => {
    expect(contrastRatio(
      resolveToken(dark, textToken),
      resolveToken(dark, surface),
    )).toBeGreaterThanOrEqual(4.5);
  });
});
