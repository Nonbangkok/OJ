/// <reference lib="webworker" />
import { renderStatementPreview, type PreviewAsset } from './statementPreviewRenderer';

type Request =
  | { type: 'initialize'; shell: string; assets: PreviewAsset[] }
  | { type: 'render'; generation: number; source: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let shell = '';
let assets: PreviewAsset[] = [];
const STATEMENT_MARKER = '<article id="statement" class="statement"></article>';

scope.onmessage = (event: MessageEvent<Request>) => {
  const message = event.data;
  if (message.type === 'initialize') {
    shell = message.shell;
    assets = message.assets;
    return;
  }
  try {
    if (!shell.includes(STATEMENT_MARKER)) throw new Error('Preview template is invalid');
    const statement = renderStatementPreview(message.source, assets);
    scope.postMessage({
      type: 'rendered', generation: message.generation,
      html: shell.replace(STATEMENT_MARKER, `<article id="statement" class="statement">${statement}</article>`),
    });
  } catch (error) {
    scope.postMessage({
      type: 'error', generation: message.generation,
      error: error instanceof Error ? error.message : 'Statement preview failed',
    });
  }
};
