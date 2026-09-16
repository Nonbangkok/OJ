import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const sourceRoot = join(__dirname, '../..');
const htmlElements = new Set([
  'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio', 'b', 'base', 'bdi', 'bdo',
  'blockquote', 'body', 'br', 'button', 'canvas', 'caption', 'cite', 'code', 'col',
  'colgroup', 'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl',
  'dt', 'em', 'embed', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'i', 'iframe', 'img',
  'input', 'ins', 'kbd', 'label', 'legend', 'li', 'link', 'main', 'map', 'mark', 'menu',
  'meta', 'meter', 'nav', 'noscript', 'object', 'ol', 'optgroup', 'option', 'output', 'p',
  'picture', 'pre', 'progress', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'script', 'search',
  'section', 'select', 'slot', 'small', 'source', 'span', 'strong', 'style', 'sub', 'summary',
  'sup', 'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time',
  'title', 'tr', 'track', 'u', 'ul', 'var', 'video', 'wbr'
]);

function startsWithBareHtmlElement(selector: string): boolean {
  const [element] = selector.match(/^([a-z][a-z0-9-]*)(?=[:.#\[\s>+~]|$)/i) ?? [];
  return element !== undefined && htmlElements.has(element.toLowerCase());
}

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
      .filter(startsWithBareHtmlElement)
      .map(selector => `${path.replace(sourceRoot, 'src')}: ${selector}`);
  });

  expect(offenders).toEqual([]);
});
