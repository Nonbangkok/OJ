export default function createStatementPreviewWorker(): Worker {
  return new Worker(new URL('./statementPreview.worker.ts', import.meta.url));
}
