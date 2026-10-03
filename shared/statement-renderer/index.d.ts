export class StatementError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
}

export function sanitizeStatement(html: string, assetNames: readonly string[]): string;
export function compileStatementSource(source: string, assetNames: readonly string[]): string;
export type MathRenderer = (tex: string, display: boolean, timeoutMs: number) => string;
export function renderStatementMath(html: string, renderMath?: MathRenderer): string;
