import StatementPreviewWorker from './statementPreview.worker?worker';

export default function createStatementPreviewWorker(): Worker {
  return new StatementPreviewWorker();
}
