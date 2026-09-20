import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

import CodeSubmissionForm from '../../features/problem/submission/CodeSubmissionForm';
import submissionService from '../../services/submissionService';
import { SUPPORTED_LANGUAGES, getLanguageDisplayName } from '../../utils/constants';

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

  it('renders a language button for every supported language', () => {
    render(
      <BrowserRouter>
        <CodeSubmissionForm problemId="aplusb" contestId={undefined} />
      </BrowserRouter>
    );

    for (const language of SUPPORTED_LANGUAGES) {
      expect(
        screen.getByRole('button', { name: getLanguageDisplayName(language) })
      ).toBeInTheDocument();
    }
  });

  it('switches the active language when a language button is clicked', () => {
    render(
      <BrowserRouter>
        <CodeSubmissionForm problemId="aplusb" contestId={undefined} />
      </BrowserRouter>
    );

    const cppButton = screen.getByRole('button', { name: 'C++' });
    const pythonButton = screen.getByRole('button', { name: 'Python' });

    // C++ is selected by default.
    expect(cppButton.className).toContain('active');
    expect(pythonButton.className).not.toContain('active');

    fireEvent.click(pythonButton);

    expect(cppButton.className).not.toContain('active');
    expect(pythonButton.className).toContain('active');
  });

  it('disables the language buttons while submitting', async () => {
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
      target: { value: 'print(1)' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Python' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'C++' })).toBeDisabled();
    });
    resolveSubmit({ data: { submissionId: 1 } });
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
