import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const sourceRoot = join(__dirname, '../..');

function cssModules(directory: string): string[] {
  return readdirSync(directory).flatMap(entry => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? cssModules(path)
      : path.endsWith('.module.css')
        ? [path]
        : [];
  });
}

test('CSS modules do not publish bare element selectors globally', () => {
  const offenders = cssModules(sourceRoot).flatMap(path => {
    const css = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    return Array.from(css.matchAll(/(?:^|})\s*([^@][^{]+)\{/g))
      .flatMap(match => match[1].split(','))
      .map(selector => selector.trim())
      .filter(selector => /^(?:button|input|select|textarea|fieldset|table|th|td|label|form)(?:\b|:)/.test(selector))
      .map(selector => `${path.replace(sourceRoot, 'src')}: ${selector}`);
  });

  expect(offenders).toEqual([]);
});
