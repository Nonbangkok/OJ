import { render, screen } from '@testing-library/react';

import SubmissionModal from '../../features/problem/submission/SubmissionModal';
import type { SubmissionDetail } from '../../types';

jest.mock('react-simple-code-editor', () => ({
  __esModule: true,
  default: () => <textarea aria-label="code view" readOnly />,
}));

jest.mock('highlight.js/styles/atom-one-dark.css', () => ({}));

// jsdom has no ResizeObserver; the modal's scrollbar sync uses one.
class ResizeObserverMock {
  observe(): void { /* noop */ }
  unobserve(): void { /* noop */ }
  disconnect(): void { /* noop */ }
}
global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

const sampleSubmission: SubmissionDetail = {
  id: 1,
  username: 'alice',
  problem_id: 'aplusb',
  problem_name: 'A Plus B',
  overall_status: 'Accepted',
  score: 100,
  language: 'cpp',
  submitted_at: '2026-09-19T10:00:00Z',
  code: '#include <iostream>\nint main() { return 0; }',
  max_time_ms: 12,
  max_memory_kb: 2048,
  results: [
    { testCase: 1, status: 'Accepted', timeMs: 12, memoryKb: 2048 },
    { testCase: 2, status: 'Accepted', timeMs: 10, memoryKb: 2048 },
  ],
};

describe('SubmissionModal', () => {
  it('renders nothing when no submission is given', () => {
    const { container } = render(<SubmissionModal submission={null} onClose={jest.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the submission metadata in the dialog', () => {
    render(<SubmissionModal submission={sampleSubmission} onClose={jest.fn()} />);

    expect(screen.getByText('A Plus B')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getAllByText('Accepted').length).toBeGreaterThan(0);
  });

  it('renders the testcase results table', () => {
    render(<SubmissionModal submission={sampleSubmission} onClose={jest.fn()} />);

    expect(screen.getByRole('columnheader', { name: /status/i })).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('shows a friendly message when there are no results', () => {
    render(
      <SubmissionModal
        submission={{ ...sampleSubmission, results: null }}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByText(/no test results available/i)).toBeInTheDocument();
  });

  it('renders as an accessible dialog with a close affordance', () => {
    render(<SubmissionModal submission={sampleSubmission} onClose={jest.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Submission Detail' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeInTheDocument();
  });
});
