import { compileStatementSource, renderStatementMath } from '@oj/statement-renderer';

export interface PreviewAsset {
  filename: string;
  url: string;
}

const ASSET_SOURCE = /src="\{\{ASSET_BASE\}\}\/([A-Za-z0-9][A-Za-z0-9._-]*)"/g;
const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** Runs the same Markdown, asset, and math rules used by the backend compiler. */
export function renderStatementPreview(source: string, assets: PreviewAsset[]): string {
  const byFilename = new Map(assets.map(asset => [asset.filename, asset.url]));
  const compiled = compileStatementSource(source, [...byFilename.keys()]);
  const rendered = renderStatementMath(compiled);
  return rendered.replace(ASSET_SOURCE, (_match, filename: string) => {
    const url = byFilename.get(filename);
    if (!url || !url.startsWith('/') || url.startsWith('//')) {
      throw new Error('Statement asset is unavailable');
    }
    return `src="${escapeAttribute(url)}"`;
  });
}
