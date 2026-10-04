/// <reference lib="webworker" />
import { renderStatementPreview, type PreviewAsset } from './statementPreviewRenderer';

type Request =
  | { type: 'initialize'; assets: PreviewAsset[] }
  | { type: 'render'; generation: number; source: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let assets: PreviewAsset[] = [];

scope.onmessage = (event: MessageEvent<Request>) => {
  const message = event.data;
  if (message.type === 'initialize') {
    assets = message.assets;
    return;
  }
  try {
    const statement = renderStatementPreview(message.source, assets);
    scope.postMessage({
      type: 'rendered', generation: message.generation,
      html: statement,
    });
  } catch (error) {
    scope.postMessage({
      type: 'error', generation: message.generation,
      error: error instanceof Error ? error.message : 'Statement preview failed',
    });
  }
};
