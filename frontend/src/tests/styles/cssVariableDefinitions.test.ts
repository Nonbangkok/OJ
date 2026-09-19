import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const sourceRoot = join(__dirname, '../..');

function cssFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(entry => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? cssFiles(path)
      : path.endsWith('.css')
        ? [path]
        : [];
  });
}

/** Collects every `--name:` custom property definition in the stylesheet. */
function definedVariables(css: string): Set<string> {
  return new Set(Array.from(css.matchAll(/(^|[\s{;])(--[A-Za-z0-9_-]+)\s*:/g), match => match[2]));
}

/**
 * Collects every `var(--name)` reference, recording whether the call carries
 * its own fallback (`var(--name, <fallback>)`) — those are self-sufficient.
 */
function variableReferences(css: string): Array<{ name: string; hasFallback: boolean }> {
  return Array.from(css.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*(,)?/g), match => ({
    name: match[1],
    hasFallback: match[2] === ',',
  }));
}

test('every var(--x) reference resolves to a defined custom property', () => {
  const files = cssFiles(sourceRoot);
  const defined = new Set<string>();
  const usages: Array<{ file: string; name: string }> = [];

  for (const path of files) {
    const css = readFileSync(path, 'utf8');
    definedVariables(css).forEach(name => defined.add(name));
    for (const reference of variableReferences(css)) {
      if (!reference.hasFallback) {
        usages.push({ file: path.replace(sourceRoot, 'src'), name: reference.name });
      }
    }
  }

  const undefinedVars = usages.filter(usage => !defined.has(usage.name));
  const summary = undefinedVars
    .map(usage => `${usage.file}: var(${usage.name})`)
    .sort();
  const unique = Array.from(new Set(summary));

  expect(
    `${unique.length} undefined variable reference(s):\n${unique.join('\n')}`,
  ).toBe(`${0} undefined variable reference(s):\n`);
});
