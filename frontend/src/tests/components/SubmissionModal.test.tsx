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

  it('uses the Phosphor clipboard icon for the copy-code action', () => {
    render(<SubmissionModal submission={sampleSubmission} onClose={jest.fn()} />);

    const copyButton = screen.getByRole('button', { name: 'Copy code' });
    expect(copyButton.querySelector('svg')).toBeInTheDocument();
    expect(copyButton).not.toHaveTextContent('📋');
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

  describe('compiler output', () => {
    const compilerMessage =
      "submission.cpp:2:12: error: 'uint64_t' was not declared in this scope\n" +
      "submission.cpp:1:1: note: 'uint64_t' is defined in header '<cstdint>'; " +
      "this is probably fixable by adding '#include <cstdint>'";

    const compileErrorSubmission: SubmissionDetail = {
      ...sampleSubmission,
      overall_status: 'Compilation Error',
      score: 0,
      results: [{ status: 'Compilation Error', output: compilerMessage }],
    };

    it('shows the compiler message for a Compilation Error instead of the testcase table', () => {
      render(<SubmissionModal submission={compileErrorSubmission} onClose={jest.fn()} />);

      const region = screen.getByRole('region', { name: 'Compiler output' });
      const block = region.querySelector('pre');
      expect(block).not.toBeNull();
      expect(block).toHaveTextContent("this is probably fixable by adding '#include <cstdint>'");
      // Exact text, newlines preserved.
      expect(block?.textContent).toBe(compilerMessage);
      expect(screen.queryByRole('columnheader', { name: /status/i })).not.toBeInTheDocument();
    });

    it('parses a JSON-string results payload too', () => {
      render(
        <SubmissionModal
          submission={{ ...compileErrorSubmission, results: JSON.stringify(compileErrorSubmission.results) }}
          onClose={jest.fn()}
        />
      );

      expect(screen.getByRole('region', { name: 'Compiler output' }).querySelector('pre')?.textContent)
        .toBe(compilerMessage);
    });

    it('renders markup in the message as literal text, never as HTML', () => {
      const hostile = '<img src=x onerror="alert(1)"><b>bold</b>';
      render(
        <SubmissionModal
          submission={{ ...compileErrorSubmission, results: [{ status: 'Compilation Error', output: hostile }] }}
          onClose={jest.fn()}
        />
      );

      const block = screen.getByRole('region', { name: 'Compiler output' }).querySelector('pre');
      expect(block?.textContent).toBe(hostile);
      expect(block?.querySelector('img')).toBeNull();
      expect(block?.querySelector('b')).toBeNull();
    });

    it('falls back to a friendly message when no compiler output was recorded', () => {
      render(
        <SubmissionModal
          submission={{ ...compileErrorSubmission, results: [{ status: 'Compilation Error' }] }}
          onClose={jest.fn()}
        />
      );

      expect(screen.getByText(/no compiler output was recorded/i)).toBeInTheDocument();
    });

    it('does not show a compiler output block for other verdicts', () => {
      render(<SubmissionModal submission={sampleSubmission} onClose={jest.fn()} />);

      expect(screen.queryByRole('region', { name: 'Compiler output' })).not.toBeInTheDocument();
    });
  });
});
