import { readFileSync } from 'fs';
import { join } from 'path';

const navbarCss = readFileSync(
  join(__dirname, '../../layouts/admin/AdminNavbar.module.css'),
  'utf8'
);

test('desktop Admin navbar side tracks can shrink before overflowing the document', () => {
  const desktopNavbarRule = navbarCss.match(
    /@media\s*\(min-width:\s*901px\)\s*\{\s*\.navbar-container\s*\{([\s\S]*?)\}/
  )?.[1];

  expect(desktopNavbarRule).toContain('grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);');
  expect(desktopNavbarRule).not.toContain('max-content');
});
