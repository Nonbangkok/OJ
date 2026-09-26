import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ProblemManagement from '../../../features/admin/problems/ProblemManagement';
import adminService from '../../../services/adminService';
import { BrowserRouter } from 'react-router-dom';

// Mock services
jest.mock('../../../services/adminService');

// Mock ThemeContext to prevent useTheme errors from LoadingPage
jest.mock('../../../context/ThemeContext', () => ({
    useTheme: jest.fn(() => ({ theme: 'light' })),
}));

// Mock LoadingPage to control the loading text
jest.mock('../../../components/shared/LoadingPage', () => () => <div>Loading Problems...</div>);

// Mock URL and Blob for export tests
window.URL.createObjectURL = jest.fn();
window.URL.revokeObjectURL = jest.fn();

const mockProblems = [
    { id: 'P1', title: 'Problem 1', author: 'admin', is_visible: true, contest_id: null, contest_status: null },
    { id: 'P2', title: 'Problem 2', author: 'admin', is_visible: false, contest_id: null, contest_status: null },
    { id: 'P3', title: 'Problem 3', author: 'admin', is_visible: true, contest_id: 1, contest_status: 'running' },
];

const mockCurrentUser = { id: 1, username: 'admin', role: 'admin' };

const renderProblemManagement = () => {
    return render(
        <BrowserRouter>
            <ProblemManagement currentUser={mockCurrentUser} />
        </BrowserRouter>
    );
};

describe('ProblemManagement Component', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValue(mockProblems);
        // Auto-mocks reset between tests (react-scripts sets resetMocks), so
        // the collections fetch the page performs on mount must be re-stubbed
        // every time — it defaults to an empty list.
        (jest.mocked(adminService.getCollections) as jest.Mock).mockResolvedValue([]);
    });

    it('renders loading state initially', () => {
        (jest.mocked(adminService.getProblems) as jest.Mock).mockReturnValue(new Promise(() => { }));
        renderProblemManagement();
        expect(screen.getByText(/loading problems\.\.\.$/i)).toBeInTheDocument();
    });

    it('renders problem list correctly', async () => {
        renderProblemManagement();

        await waitFor(() => {
            expect(screen.getByText('Problem Management')).toBeInTheDocument();
            expect(screen.getByText('Problem 1')).toBeInTheDocument();
            expect(screen.getByText('Problem 2')).toBeInTheDocument();
        });
    });

    it('handles visibility toggle', async () => {
        (jest.mocked(adminService.updateProblemVisibility) as jest.Mock).mockResolvedValue({ message: 'Updated' });
        renderProblemManagement();

        await waitFor(() => screen.getByText('Problem 2'));

        const hiddenBtn = screen.getByRole('button', { name: /hidden/i });
        fireEvent.click(hiddenBtn);

        expect(adminService.updateProblemVisibility).toHaveBeenCalledWith('P2', true);
    });

    it('disables visibility toggle for problems in active contests', async () => {
        renderProblemManagement();

        await waitFor(() => screen.getByText('Problem 3'));

        expect(screen.getByText(/in running contest/i)).toBeInTheDocument();
        const p3Row = screen.getAllByRole('row').find(r => r.textContent.includes('Problem 3'));
        const toggleBtn = within(p3Row).queryByRole('button', { name: /visible|hidden/i });
        expect(toggleBtn).not.toBeInTheDocument();
    });

    it('handles bulk actions (Hide All)', async () => {
        (jest.mocked(adminService.updateProblemVisibility) as jest.Mock).mockResolvedValue({ message: 'Updated' });
        renderProblemManagement();

        // Global visibility actions live behind the More menu now.
        await waitFor(() => screen.getByRole('button', { name: /more global actions/i }));
        fireEvent.click(screen.getByRole('button', { name: /more global actions/i }));
        fireEvent.click(screen.getByRole('menuitem', { name: /hide all problems/i }));

        // Check confirmation modal
        expect(screen.getByText(/are you sure you want to hide all problems/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

        await waitFor(() => {
            // Should be called for P1 (P3 is in contest, P2 is already hidden)
            expect(adminService.updateProblemVisibility).toHaveBeenCalledWith('P1', false);
            expect(adminService.updateProblemVisibility).not.toHaveBeenCalledWith('P3', false);
        });
    });

    it('handles individual problem deletion', async () => {
        (jest.mocked(adminService.deleteProblem) as jest.Mock).mockResolvedValue({ message: 'Deleted' });
        renderProblemManagement();

        await waitFor(() => screen.getByText('Problem 1'));

        const p1Row = screen.getAllByRole('row').find(r => r.textContent.includes('Problem 1'));
        fireEvent.click(within(p1Row).getByRole('button', { name: /row actions for P1/i }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

        expect(screen.getByText(/confirm deletion/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

        await waitFor(() => {
            expect(adminService.deleteProblem).toHaveBeenCalledWith('P1');
        });
    });

    it('handles problem export', async () => {
        (jest.mocked(adminService.exportProblems) as jest.Mock).mockResolvedValue({
            data: new Blob(),
            headers: { 'content-type': 'application/zip' },
            status: 200,
            statusText: 'OK',
            config: { headers: {} },
        });
        renderProblemManagement();

        await waitFor(() => screen.getByText('Problem 1'));

        // Select a problem
        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[1]); // First problem checkbox (index 0 is Select All)

        fireEvent.click(screen.getByRole('button', { name: /export selected \(1\)/i }));

        await waitFor(() => {
            expect(adminService.exportProblems).toHaveBeenCalledWith(['P1']);
        });
    });

    it('opens the rejudge confirm dialog and reports queued/skipped counts', async () => {
        (jest.mocked(adminService.rejudgeProblem) as jest.Mock).mockResolvedValueOnce({ queued: 4, skipped: 1 });
        renderProblemManagement();

        await waitFor(() => screen.getByText('Problem 1'));
        const p1Row = screen.getAllByRole('row').find(r => r.textContent.includes('Problem 1'));
        fireEvent.click(within(p1Row).getByRole('button', { name: /row actions for P1/i }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Rejudge' }));

        // Confirm dialog explains the consequences in plain language.
        expect(screen.getByText(/re-runs every submission for problem "problem 1"/i)).toBeInTheDocument();
        expect(screen.getByText(/scores may change/i)).toBeInTheDocument();
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /rejudge/i }));

        await waitFor(() => {
            expect(adminService.rejudgeProblem).toHaveBeenCalledWith('P1');
        });
        expect(await screen.findByText(/rejudge queued for 4 submissions \(1 skipped — no stored code\)/i)).toBeInTheDocument();
    });

    it('shows an error message when rejudge fails', async () => {
        (jest.mocked(adminService.rejudgeProblem) as jest.Mock).mockRejectedValueOnce({
            response: { status: 500, data: { message: 'Rejudge failed on the server.' } },
        });
        renderProblemManagement();

        await waitFor(() => screen.getByText('Problem 2'));
        const p2Row = screen.getAllByRole('row').find(r => r.textContent.includes('Problem 2'));
        fireEvent.click(within(p2Row).getByRole('button', { name: /row actions for P2/i }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Rejudge' }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /rejudge/i }));

        await waitFor(() => {
            expect(adminService.rejudgeProblem).toHaveBeenCalledWith('P2');
        });
        expect(await screen.findByText(/rejudge failed on the server/i)).toBeInTheDocument();
    });

    it('opens the testcases dialog from a row action and expands a case', async () => {
        (jest.mocked(adminService.getProblemTestcases) as jest.Mock).mockResolvedValueOnce({
            testcases: [{ case_number: 1, input_bytes: 10, output_bytes: 20 }],
            total: 1,
        });
        (jest.mocked(adminService.getProblemTestcase) as jest.Mock).mockResolvedValueOnce({
            caseNumber: 1,
            input: { bytes: 10, truncated: false, content: '1 2' },
            output: { bytes: 20, truncated: false, content: '3' },
        });
        renderProblemManagement();

        await waitFor(() => screen.getByText('Problem 1'));
        const p1Row = screen.getAllByRole('row').find(r => r.textContent.includes('Problem 1'));
        fireEvent.click(within(p1Row).getByRole('button', { name: /row actions for P1/i }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'View Testcases' }));

        expect(await screen.findByText('Testcases: P1')).toBeInTheDocument();
        expect(screen.getByText('1 testcase')).toBeInTheDocument();

        fireEvent.click(await screen.findByRole('button', { name: /#1/i }));
        expect(await screen.findByText('1 2')).toBeInTheDocument();
        expect(adminService.getProblemTestcase).toHaveBeenCalledWith('P1', 1);
    });

    describe('bulk selection', () => {
        /** 20 problems: 6 with "01_e" in the id, 14 without. Used by the
         *  filter-scoped selection tests. */
        const searchMockProblems = [
            ...Array.from({ length: 6 }, (_, i) => ({
                id: `01_e${i + 1}`, title: `Echo ${i + 1}`, author: 'admin',
                is_visible: true, contest_id: null, contest_status: null,
            })),
            ...Array.from({ length: 14 }, (_, i) => ({
                id: `02_a${i + 1}`, title: `Alpha ${i + 1}`, author: 'admin',
                is_visible: true, contest_id: null, contest_status: null,
            })),
        ];

        const renderWithSearchProblems = async () => {
            (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValue(searchMockProblems);
            renderProblemManagement();
            await waitFor(() => screen.getByText('Echo 1'));
        };

        const getRow = (idOrTitle: string) =>
            screen.getAllByRole('row').find(r => r.textContent.includes(idOrTitle));

        const getRowCheckbox = (idOrTitle: string) =>
            within(getRow(idOrTitle)).getByRole('checkbox') as HTMLInputElement;

        const headerCheckbox = () =>
            screen.getByRole('checkbox', { name: /select all currently displayed problems/i }) as HTMLInputElement;

        it('header select-all selects only the DISPLAYED rows when a search filter is active', async () => {
            await renderWithSearchProblems();

            fireEvent.change(screen.getByLabelText('Search problems'), { target: { value: '01_e' } });
            expect(screen.getAllByRole('row')).toHaveLength(7); // header + 6 matches

            fireEvent.click(headerCheckbox());

            const checked = screen.getAllByRole('checkbox')
                .filter(c => (c as HTMLInputElement).checked);
            expect(checked).toHaveLength(7); // header + exactly the 6 displayed rows

            // Selection bar reports exactly 6 — never the 20 in the system.
            expect(screen.getByText('6 selected')).toBeInTheDocument();
        });

        it('clearing the search filter clears the selection (no invisible selected rows)', async () => {
            await renderWithSearchProblems();

            fireEvent.change(screen.getByLabelText('Search problems'), { target: { value: '01_e' } });
            fireEvent.click(headerCheckbox());
            expect(screen.getByText('6 selected')).toBeInTheDocument();

            fireEvent.change(screen.getByLabelText('Search problems'), { target: { value: '' } });

            // All 20 rows are displayed again — none may be selected.
            expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
            const checked = screen.getAllByRole('checkbox')
                .filter(c => (c as HTMLInputElement).checked);
            expect(checked).toHaveLength(0);
        });

        it('bulk export uses exactly the selected (displayed) ids', async () => {
            (jest.mocked(adminService.exportProblems) as jest.Mock).mockResolvedValue({
                data: new Blob(),
                headers: { 'content-type': 'application/zip' },
                status: 200,
                statusText: 'OK',
                config: { headers: {} },
            });
            await renderWithSearchProblems();

            fireEvent.change(screen.getByLabelText('Search problems'), { target: { value: '01_e' } });
            fireEvent.click(headerCheckbox());
            fireEvent.click(screen.getByRole('button', { name: /export selected \(6\)/i }));

            await waitFor(() => {
                expect(adminService.exportProblems).toHaveBeenCalledTimes(1);
                const exportedIds = (jest.mocked(adminService.exportProblems) as jest.Mock).mock.calls[0][0];
                expect(exportedIds).toHaveLength(6);
                expect(exportedIds.every((id: string) => id.startsWith('01_e'))).toBe(true);
            });
        });

        it('changing the visibility filter clears the selection', async () => {
            await renderWithSearchProblems();
            fireEvent.click(getRowCheckbox('Echo 1'));
            expect(screen.getByText('1 selected')).toBeInTheDocument();

            fireEvent.change(screen.getByLabelText('Filter problems by visibility'), { target: { value: 'hidden' } });
            expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
        });

        it('changing the author filter clears the selection', async () => {
            await renderWithSearchProblems();
            fireEvent.click(getRowCheckbox('Echo 1'));
            expect(screen.getByText('1 selected')).toBeInTheDocument();

            fireEvent.change(screen.getByLabelText('Filter problems by author'), { target: { value: 'admin' } });
            expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
        });

        it('header checkbox shows the indeterminate state when some displayed rows are selected', async () => {
            await renderWithSearchProblems();

            fireEvent.click(getRowCheckbox('Echo 1'));
            const header = headerCheckbox();
            expect(header.checked).toBe(false);
            expect(header.indeterminate).toBe(true);

            // Complete the selection: header becomes fully checked.
            fireEvent.click(getRowCheckbox('Echo 2'));
            fireEvent.click(getRowCheckbox('Echo 3'));
            fireEvent.click(getRowCheckbox('Echo 4'));
            fireEvent.click(getRowCheckbox('Echo 5'));
            fireEvent.click(getRowCheckbox('Echo 6'));
            fireEvent.click(getRowCheckbox('Alpha 1'));
            // 7 of 20 selected — still indeterminate.
            expect(headerCheckbox().indeterminate).toBe(true);

            fireEvent.click(headerCheckbox());
            expect(headerCheckbox().checked).toBe(true);
            expect(headerCheckbox().indeterminate).toBe(false);
            expect(screen.getByText('20 selected')).toBeInTheDocument();
        });

        it('header checkbox is disabled when no rows are displayed', async () => {
            await renderWithSearchProblems();
            fireEvent.change(screen.getByLabelText('Search problems'), { target: { value: 'zzz-no-match' } });

            expect(headerCheckbox()).toBeDisabled();
        });

        it('clicking the fully-checked header deselects every displayed row', async () => {
            await renderWithSearchProblems();
            fireEvent.click(headerCheckbox());
            expect(screen.getByText('20 selected')).toBeInTheDocument();

            fireEvent.click(headerCheckbox());
            expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
        });

        it('plain clicks toggle individual rows and the selection bar count follows', async () => {
            await renderWithSearchProblems();

            fireEvent.click(getRowCheckbox('Alpha 1'));
            fireEvent.click(getRowCheckbox('Alpha 2'));
            expect(screen.getByText('2 selected')).toBeInTheDocument();

            fireEvent.click(getRowCheckbox('Alpha 1'));
            expect(screen.getByText('1 selected')).toBeInTheDocument();
        });

        it('Clear button empties the selection', async () => {
            await renderWithSearchProblems();
            fireEvent.click(getRowCheckbox('Echo 1'));
            fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
            expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
        });

        it('row click interactions (Edit, row menu) do not start a selection', async () => {
            await renderWithSearchProblems();

            // Opening the row action menu must not select anything.
            fireEvent.click(within(getRow('Echo 1')).getByRole('button', { name: /row actions for 01_e1/i }));
            expect(screen.getByRole('menu')).toBeInTheDocument();
            fireEvent.keyDown(document, { key: 'Escape' });

            expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
        });
    });

    describe('author filter', () => {
        const authorMockProblems = [
            { id: 'A1', title: 'Alpha', author: 'Zed', is_visible: true, contest_id: null, contest_status: null },
            { id: 'A2', title: 'Beta', author: 'Alice', is_visible: false, contest_id: null, contest_status: null },
            { id: 'A3', title: 'Gamma', author: 'Alice', is_visible: true, contest_id: null, contest_status: null },
            { id: 'A4', title: 'Delta', author: null, is_visible: true, contest_id: null, contest_status: null },
            { id: 'A5', title: 'Epsilon', author: '   ', is_visible: true, contest_id: null, contest_status: null },
        ];

        const renderWithAuthors = async () => {
            (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValueOnce(authorMockProblems);
            renderProblemManagement();
            await waitFor(() => screen.getByText('Alpha'));
        };

        it('derives sorted distinct author options and groups empty authors', async () => {
            await renderWithAuthors();

            const select = screen.getByLabelText('Filter problems by author');
            const options = within(select).getAllByRole('option').map(o => o.textContent);
            // Alphabetical, distinct, plus "No author" for null/blank rows.
            expect(options).toEqual(['All Authors', 'Alice', 'Zed', 'No author']);
        });

        it('omits the No author option when every problem has an author', async () => {
            (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValueOnce(
                authorMockProblems.filter(p => p.author?.trim()),
            );
            renderProblemManagement();
            await waitFor(() => screen.getByText('Alpha'));

            const select = screen.getByLabelText('Filter problems by author');
            expect(within(select).queryByRole('option', { name: 'No author' })).not.toBeInTheDocument();
        });

        it('filters the table by the chosen author', async () => {
            await renderWithAuthors();

            fireEvent.change(screen.getByLabelText('Filter problems by author'), { target: { value: 'Alice' } });

            expect(screen.getByText('Beta')).toBeInTheDocument();
            expect(screen.getByText('Gamma')).toBeInTheDocument();
            expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
            expect(screen.queryByText('Delta')).not.toBeInTheDocument();
        });

        it('groups null and blank authors under No author', async () => {
            await renderWithAuthors();

            fireEvent.change(screen.getByLabelText('Filter problems by author'), { target: { value: '__none__' } });

            expect(screen.getByText('Delta')).toBeInTheDocument();
            expect(screen.getByText('Epsilon')).toBeInTheDocument();
            expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
        });

        it('composes with the visibility and search filters', async () => {
            await renderWithAuthors();

            fireEvent.change(screen.getByLabelText('Filter problems by author'), { target: { value: 'Alice' } });
            fireEvent.change(screen.getByLabelText('Filter problems by visibility'), { target: { value: 'visible' } });

            // A2 (Beta) is Alice's hidden problem, so only Gamma remains.
            expect(screen.getByText('Gamma')).toBeInTheDocument();
            expect(screen.queryByText('Beta')).not.toBeInTheDocument();

            // Narrow further by search — Gamma's title no longer matches.
            fireEvent.change(screen.getByLabelText('Search problems'), { target: { value: 'beta' } });
            expect(screen.queryByText('Gamma')).not.toBeInTheDocument();
            expect(screen.queryByText('Beta')).not.toBeInTheDocument();
        });
    });
});
