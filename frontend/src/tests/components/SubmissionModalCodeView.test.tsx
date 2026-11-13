import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SubmissionModal from '../../features/problem/submission/SubmissionModal';
import type { SubmissionDetail } from '../../types';

// Uses the real react-simple-code-editor (SubmissionModal.test.tsx mocks it).
jest.mock('highlight.js/styles/atom-one-dark.css', () => ({}));

class ResizeObserverMock {
  observe(): void { /* noop */ }
  unobserve(): void { /* noop */ }
  disconnect(): void { /* noop */ }
}
global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

const code = Array.from({ length: 80 }, (_, i) => `// line ${i + 1}`).join('\n');
const submission: SubmissionDetail = {
  id: 7, username: 'alice', problem_id: 'p', problem_name: 'P', overall_status: 'Accepted',
  score: 100, language: 'cpp', submitted_at: '2026-09-19T10:00:00Z', code,
  max_time_ms: 1, max_memory_kb: 1, results: [],
};

describe('SubmissionModal code view', () => {
  it('is a read-only, focusable textarea (not disabled), so Gecko lets the user scroll and select it', () => {
    render(<SubmissionModal submission={submission} onClose={jest.fn()} />);
    const textarea = document.getElementById('code') as HTMLTextAreaElement;

    // Gecko does not let users interact with a disabled textarea (scrollbar,
    // focus, keyboard scrolling, selection); a read-only one behaves like
    // any scrollable text.
    expect(textarea).not.toBeDisabled();
    expect(textarea).toHaveAttribute('readonly');
    textarea.focus();
    expect(textarea).toHaveFocus();
  });

  it('ignores editing keys, so the shown code can never change', async () => {
    render(<SubmissionModal submission={submission} onClose={jest.fn()} />);
    const textarea = document.getElementById('code') as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(0, 0);

    // The editor library applies Enter/Backspace/undo itself unless the key
    // is prevented first.
    fireEvent.keyDown(textarea, { key: 'Enter' });
    fireEvent.keyDown(textarea, { key: '(' });
    fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true });
    expect(textarea.value).toBe(code);
  });

  it('lets Tab move focus out of the code instead of indenting', async () => {
    render(<SubmissionModal submission={submission} onClose={jest.fn()} />);
    const textarea = document.getElementById('code') as HTMLTextAreaElement;
    textarea.focus();

    await userEvent.tab();

    expect(textarea).not.toHaveFocus();
    expect(textarea.value).toBe(code);
  });
});
