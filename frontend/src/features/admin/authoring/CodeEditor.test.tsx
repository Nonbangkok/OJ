import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import api from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import ProblemAuthoring from './ProblemAuthoring';
import { DraftSolution } from './DraftWorkspace';

jest.mock('../../../services/api');
jest.mock('../../../context/AuthContext', () => ({ useAuth: jest.fn() }));

const draft = {
  id: 'd1', problemId: 'sum', title: 'Sum', authorProfileId: null,
  authorAkaName: 'AKA', authorRealName: 'Author', language: 'Thai', countryCode: 'THA',
  timeLimitMs: 1000, memoryLimitMb: 256,
  statementHtml: '<p>Sum</p>',
  solutionCpp: '#include <iostream>\nint main() { return 0; }\n',
  generatorCpp: null, templateVersion: 'red-gate-v1',
  revision: 3, verifiedRevision: 3, hasLatestPdf: true, latestPdfRevision: 3,
  status: 'draft', publishedAt: null, testcaseStats: { total: 1, withOutput: 1 },
};

describe('CodeEditor typing stability', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (useAuth as jest.Mock).mockReturnValue({ user: { role: 'admin' }, isLoading: false });
    jest.mocked(api.get).mockImplementation(async (url) => ({
      data: url.endsWith('/d1') ? draft
        : url.endsWith('/jobs') ? []
        : url.endsWith('/testcases') ? { revision: 3, testcases: [] }
        : [],
    }));
    jest.mocked(api.patch).mockResolvedValue({ data: draft });
  });

  it('typing in the solution editor does not enter an update loop', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <MemoryRouter initialEntries={['/admin/authoring/d1/solution']}>
        <Routes>
          <Route path="/admin/authoring/:draftId" element={<ProblemAuthoring />}>
            <Route path="solution" element={<DraftSolution />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    const textarea = await screen.findByRole('textbox');
    // Type several characters — an update loop throws error #185.
    fireEvent.change(textarea, { target: { value: draft.solutionCpp + '\nint extra = 42;' } });

    await waitFor(() => {
      expect(textarea).toHaveValue(draft.solutionCpp + '\nint extra = 42;');
    });
    await new Promise((resolve) => setTimeout(resolve, 2500)); // let autosave fire

    const loopErrors = consoleError.mock.calls.filter(
      (call) => String(call[0]).includes('Maximum update depth')
    );
    expect(loopErrors).toHaveLength(0);
    consoleError.mockRestore();
  });
});
