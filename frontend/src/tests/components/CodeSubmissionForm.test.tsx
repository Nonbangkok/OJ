import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

import CodeSubmissionForm from '../../features/problem/submission/CodeSubmissionForm';
import submissionService from '../../services/submissionService';

jest.mock('../../services/submissionService');
jest.mock('react-simple-code-editor', () => ({
  __esModule: true,
  default: ({ onValueChange }: { onValueChange: (value: string) => void }) => (
    <textarea
      aria-label="code editor"
      onChange={(e) => onValueChange(e.target.value)}
    />
  ),
}));

describe('CodeSubmissionForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the submit header and C++ language button', () => {
    render(
      <BrowserRouter>
        <CodeSubmissionForm problemId="aplusb" contestId={undefined} />
      </BrowserRouter>
    );

    expect(screen.getByRole('heading', { name: /submit solution/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'C++' })).toBeInTheDocument();
  });

  it('disables the submit button while submitting', async () => {
    let resolveSubmit: (value: unknown) => void = () => undefined;
    jest.mocked(submissionService.submit).mockReturnValueOnce(
      new Promise((resolve) => { resolveSubmit = resolve; })
    );

    render(
      <BrowserRouter>
        <CodeSubmissionForm problemId="aplusb" contestId={undefined} />
      </BrowserRouter>
    );

    fireEvent.change(screen.getByLabelText('code editor'), {
      target: { value: '#include <iostream>' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /submitting/i })).toBeDisabled();
    });
    resolveSubmit({ data: { submissionId: 1 } });
  });

  it('shows an error message when the submission fails', async () => {
    jest.mocked(submissionService.submit).mockRejectedValueOnce({
      response: { data: { message: 'Submission rejected' } },
    });

    render(
      <BrowserRouter>
        <CodeSubmissionForm problemId="aplusb" contestId={undefined} />
      </BrowserRouter>
    );

    fireEvent.change(screen.getByLabelText('code editor'), {
      target: { value: 'int main(){}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(screen.getByText(/submission rejected/i)).toBeInTheDocument();
    });
  });
});
