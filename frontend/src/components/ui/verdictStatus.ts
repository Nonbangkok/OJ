import type { TestCaseResult } from '../../types';

export type VerdictTone = 'pass' | 'fail' | 'limit' | 'pending' | 'none';

export function verdictTone(status: string | null | undefined): VerdictTone {
  switch (status) {
    case 'Accepted': return 'pass';
    case 'Wrong Answer':
    case 'Runtime Error':
    case 'Compilation Error': return 'fail';
    case 'Time Limit Exceeded':
    case 'Memory Limit Exceeded': return 'limit';
    case 'Pending':
    case 'Compiling':
    case 'Running': return 'pending';
    default: return 'none';
  }
}

const SHORT: Record<string, string> = {
  Accepted: 'ACCEPTED',
  'Wrong Answer': 'WRONG',
  'Time Limit Exceeded': 'TIME LIMIT',
  'Memory Limit Exceeded': 'MEMORY LIMIT',
  'Runtime Error': 'RUNTIME ERROR',
  'Compilation Error': 'COMPILATION ERROR',
  Pending: 'PENDING',
  Compiling: 'COMPILING',
  Running: 'RUNNING',
  Skipped: 'NOT RUN',
};

/** Cases that verdicts count with n/N (a compile error has no per-case results). */
const COUNTED = new Set(['Wrong Answer', 'Time Limit Exceeded', 'Memory Limit Exceeded', 'Runtime Error']);

export const passedCount = (results: TestCaseResult[]): number => results.filter((r) => r.status === 'Accepted').length;

/** Mono verdict label: `ACCEPTED`, `WRONG 6/10`, `NOT RUN`… */
export function verdictLabel(status: string | null | undefined, results?: TestCaseResult[] | null): string {
  if (!status) return '';
  const base = SHORT[status] ?? status.toUpperCase();
  if (results && results.length > 0 && COUNTED.has(status)) {
    return `${base} ${passedCount(results)}/${results.length}`;
  }
  return base;
}
