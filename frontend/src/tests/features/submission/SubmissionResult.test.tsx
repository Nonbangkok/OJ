import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SubmissionResult from '../../../features/submission/SubmissionResult';
import type { SubmissionDetail } from '../../../types';

const base: SubmissionDetail = {
  id: 48213,
  username: 'nattapat',
  problem_id: 'vec',
  problem_title: 'vector::erase',
  overall_status: 'Wrong Answer',
  score: 60,
  language: 'cpp',
  submitted_at: new Date().toISOString(),
  code: 'int main(){}',
  max_time_ms: 410,
  max_memory_kb: 12595,
  results: [
    ...Array.from({ length: 6 }, (_, i) => ({ testCase: i + 1, status: 'Accepted', timeMs: 30 + i * 50, memoryKb: 3900 })),
    { testCase: 7, status: 'Wrong Answer', timeMs: 410, memoryKb: 12595 },
    { testCase: 8, status: 'Skipped' }, { testCase: 9, status: 'Skipped' }, { testCase: 10, status: 'Skipped' },
  ],
};
const limits = { timeMs: 1000, memoryMb: 256 };
const renderResult = (submission: SubmissionDetail) =>
  render(<MemoryRouter><SubmissionResult submission={submission} limits={limits} /></MemoryRouter>);

describe('SubmissionResult', () => {
  it('highlights the first failing case and marks later cases NOT RUN', () => {
    renderResult(base);
    expect(screen.getByText('WRONG ANSWER')).toBeInTheDocument();
    expect(screen.getByText('6/10 · 60 pts')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '6 of 10 test cases passed' })).toBeInTheDocument();
    expect(screen.getByText('Stopped at case 7. Cases 8–10 were not run.')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Test cases' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(10);
    expect(rows[6].className).toMatch(/highlight/);
    expect(within(rows[7]).getByText('NOT RUN')).toBeInTheDocument();
  });

  it('shows the compiler log for a compilation error', () => {
    renderResult({ ...base, overall_status: 'Compilation Error', score: 0, results: 'main.cpp:3:1: error: expected ;' });
    expect(screen.getByText('COMPILATION ERROR')).toBeInTheDocument();
    expect(screen.getByText('main.cpp:3:1: error: expected ;')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('announces judging while pending', () => {
    renderResult({ ...base, overall_status: 'Running', score: 0, results: null });
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Judging…');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('bars scale against the limits', () => {
    renderResult(base);
    const bar = screen.getByRole('progressbar', { name: 'Case 7 time: 410 ms of 1000 ms' });
    expect(bar).toHaveAttribute('aria-valuenow', '410');
    expect(bar.firstElementChild).toHaveStyle({ width: '41%' });
    expect(screen.getByRole('progressbar', { name: /Case 7 memory: 12\.3 MB of 256 MB/ })).toBeInTheDocument();
  });
});
