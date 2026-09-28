import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
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

/** Page envelope the paged admin list endpoint returns. */
const makePage = (problems, extra = {}) => ({
    problems,
    nextCursor: null,
    hasMore: false,
    authors: [],
    hasUnauthoredProblems: false,
    ...extra,
});

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
        (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValue(makePage(mockProblems));
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
        expect(screen.getByText(/are you sure you want to hide all 3 loaded problems/i)).toBeInTheDocument();
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

        const searchPage = (problems) => ({
            problems,
            nextCursor: null,
            hasMore: false,
            authors: [],
            hasUnauthoredProblems: false,
        });
        const matching = searchMockProblems.filter(p => p.id.startsWith('01_e'));

        const renderWithSearchProblems = async () => {
            // Initial load: the full 20-problem page. The search box re-queries
            // the server (debounced), so filtered queries return the 6 matches.
            (jest.mocked(adminService.getProblems) as jest.Mock).mockImplementation(
                (query) => {
                    const term = query && query.search;
                    // 'zzz-no-match' is the suite's designated no-match term; any
                    // other non-empty term matches the 01_e fixtures.
                    const rows = term
                        ? (term === 'zzz-no-match' ? [] : matching)
                        : searchMockProblems;
                    return Promise.resolve(searchPage(rows));
                },
            );
            renderProblemManagement();
            await waitFor(() => screen.getByText('Echo 1'));
        };

        /** Types into the server-queried, debounced search box and waits for the
         *  refetched page to render. An empty value restores the full page. */
        const searchFor = async (value) => {
            jest.useFakeTimers();
            try {
                fireEvent.change(screen.getByLabelText('Search problems'), { target: { value } });
                await act(async () => { jest.advanceTimersByTime(300); });
            } finally {
                jest.useRealTimers();
            }
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

            await searchFor('01_e');
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

            await searchFor('01_e');
            fireEvent.click(headerCheckbox());
            expect(screen.getByText('6 selected')).toBeInTheDocument();

            await searchFor('');

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

            await searchFor('01_e');
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
            jest.useFakeTimers();
            try {
                // 'zzz-no-match' is a truthy search: the mocked server returns
                // the empty match page after the debounced re-query.
                fireEvent.change(screen.getByLabelText('Search problems'), { target: { value: 'zzz-no-match' } });
                await act(async () => { jest.advanceTimersByTime(300); });
                await waitFor(
                    () => expect(jest.mocked(adminService.getProblems)).toHaveBeenLastCalledWith(
                        expect.objectContaining({ search: 'zzz-no-match' }),
                    ),
                    { timeout: 3000 },
                );
                await act(async () => { jest.runOnlyPendingTimers(); });
            } finally {
                jest.useRealTimers();
            }
            await waitFor(
                () => expect(screen.getAllByRole('row')).toHaveLength(1),
                { timeout: 3000 },
            );
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

    describe('author filter (server-driven options)', () => {
        // Authors come from the server's whole-pool aggregate, not the
        // loaded rows; changing the filter re-queries the server.
        const authorMockPage = makePage(
            [{ id: 'A1', title: 'Alpha', author: 'Zed', is_visible: true, contest_id: null, contest_status: null }],
            { authors: [{ name: 'Alice' }, { name: 'Zed' }], hasUnauthoredProblems: true },
        );

        const renderWithAuthors = async () => {
            (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValueOnce(authorMockPage);
            renderProblemManagement();
            await waitFor(() => screen.getByText('Alpha'));
        };

        it('renders server-provided author options and groups unauthored rows', async () => {
            await renderWithAuthors();

            const select = screen.getByLabelText('Filter problems by author');
            const options = within(select).getAllByRole('option').map(o => o.textContent);
            // Server-provided list plus "No author" when unauthored rows exist.
            expect(options).toEqual(['All Authors', 'Alice', 'Zed', 'No author']);
        });

        it('omits the No author option when the server reports no unauthored problems', async () => {
            (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValueOnce(
                makePage([], { authors: [{ name: 'Alice' }], hasUnauthoredProblems: false }),
            );
            renderProblemManagement();
            await waitFor(() => screen.getByText('Problem Management'));

            const select = screen.getByLabelText('Filter problems by author');
            expect(within(select).queryByRole('option', { name: 'No author' })).not.toBeInTheDocument();
        });

        it('re-queries the server with the author filter when one is chosen', async () => {
            await renderWithAuthors();
            (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValueOnce(
                makePage([{ id: 'A3', title: 'Gamma', author: 'Alice', is_visible: true, contest_id: null, contest_status: null }]),
            );

            fireEvent.change(screen.getByLabelText('Filter problems by author'), { target: { value: 'Alice' } });

            await waitFor(() => expect(adminService.getProblems).toHaveBeenLastCalledWith(
                expect.objectContaining({ author: 'Alice', limit: 25 }),
            ));
            expect(await screen.findByText('Gamma')).toBeInTheDocument();
            expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
        });

        it('falls back to All Authors when the selected author disappears from the options', async () => {
            await renderWithAuthors();
            // Server now reports only Alice — Zed's row was deleted.
            (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValue(
                makePage([], { authors: [{ name: 'Alice' }], hasUnauthoredProblems: false }),
            );

            fireEvent.change(screen.getByLabelText('Filter problems by author'), { target: { value: 'Zed' } });
            // The phantom selection falls back to 'all' on the next render...
            await waitFor(() => expect((screen.getByLabelText('Filter problems by author') as HTMLSelectElement).value).toBe('all'));
            // ...and no author param is sent for the fallback query.
            await waitFor(() => expect(adminService.getProblems).toHaveBeenLastCalledWith(
                expect.not.objectContaining({ author: expect.anything() }),
            ));
        });

        it('composes with the visibility filter in one server query', async () => {
            await renderWithAuthors();
            (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValueOnce(makePage([]));

            fireEvent.change(screen.getByLabelText('Filter problems by author'), { target: { value: 'Alice' } });
            await waitFor(() => expect(adminService.getProblems).toHaveBeenLastCalledWith(
                expect.objectContaining({ author: 'Alice' }),
            ));

            fireEvent.change(screen.getByLabelText('Filter problems by visibility'), { target: { value: 'hidden' } });
            await waitFor(() => expect(adminService.getProblems).toHaveBeenLastCalledWith(
                expect.objectContaining({ author: 'Alice', visibility: 'hidden', limit: 25 }),
            ));
        });
    });

    describe('Show More pagination (server-side)', () => {
        it('renders only the first batch and a Show More button when more pages exist', async () => {
            (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValueOnce(
                makePage(mockProblems, { hasMore: true, nextCursor: 'cursor-1' }),
            );
            renderProblemManagement();

            await waitFor(() => screen.getByText('Problem 1'));
            expect(screen.getByRole('button', { name: /show more/i })).toBeInTheDocument();
        });

        it('appends the next batch on Show More without losing existing rows', async () => {
            (jest.mocked(adminService.getProblems) as jest.Mock)
                .mockResolvedValueOnce(makePage(mockProblems.slice(0, 2), { hasMore: true, nextCursor: 'cursor-1' }))
                .mockResolvedValueOnce(makePage([mockProblems[2]], { hasMore: false, nextCursor: null }));
            renderProblemManagement();

            await waitFor(() => screen.getByText('Problem 2'));
            fireEvent.click(screen.getByRole('button', { name: /show more/i }));

            expect(await screen.findByText('Problem 3')).toBeInTheDocument();
            // Existing rows stay (no reset-to-top behavior).
            expect(screen.getByText('Problem 1')).toBeInTheDocument();
            expect(screen.getByText('Problem 2')).toBeInTheDocument();
            // Last batch: the button disappears.
            expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument();
        });

        it('follows the cursor for the next batch request', async () => {
            (jest.mocked(adminService.getProblems) as jest.Mock)
                .mockResolvedValueOnce(makePage(mockProblems.slice(0, 2), { hasMore: true, nextCursor: 'cursor-1' }))
                .mockResolvedValueOnce(makePage([mockProblems[2]]));
            renderProblemManagement();

            await waitFor(() => screen.getByText('Problem 2'));
            fireEvent.click(screen.getByRole('button', { name: /show more/i }));

            await waitFor(() => expect(adminService.getProblems).toHaveBeenLastCalledWith(
                expect.objectContaining({ cursor: 'cursor-1', limit: 25 }),
            ));
        });

        it('keeps loaded rows and offers Retry when the next batch fails', async () => {
            (jest.mocked(adminService.getProblems) as jest.Mock)
                .mockResolvedValueOnce(makePage(mockProblems.slice(0, 2), { hasMore: true, nextCursor: 'cursor-1' }))
                .mockRejectedValueOnce(new Error('network down'))
                .mockResolvedValueOnce(makePage([mockProblems[2]]));
            renderProblemManagement();

            await waitFor(() => screen.getByText('Problem 2'));
            fireEvent.click(screen.getByRole('button', { name: /show more/i }));

            // Failure keeps the loaded rows and turns the button into Retry.
            expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
            expect(screen.getByText('Problem 1')).toBeInTheDocument();
            expect(screen.getByText('Problem 2')).toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: /retry/i }));
            expect(await screen.findByText('Problem 3')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
        });

        it('a filter change resets the list to the new query\'s first batch', async () => {
            (jest.mocked(adminService.getProblems) as jest.Mock)
                .mockResolvedValueOnce(makePage(mockProblems, { hasMore: true, nextCursor: 'cursor-1' }))
                .mockResolvedValueOnce(makePage([mockProblems[1]], { hasMore: false, nextCursor: null }));
            renderProblemManagement();

            await waitFor(() => screen.getByText('Problem 3'));
            expect(screen.getByRole('button', { name: /show more/i })).toBeInTheDocument();

            // Changing the visibility filter restarts from the new query's
            // first batch — never appends across filter states.
            fireEvent.change(screen.getByLabelText('Filter problems by visibility'), { target: { value: 'hidden' } });

            expect(await screen.findByText('Problem 2')).toBeInTheDocument();
            expect(screen.queryByText('Problem 1')).not.toBeInTheDocument();
            expect(screen.queryByText('Problem 3')).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument();
            expect(adminService.getProblems).toHaveBeenLastCalledWith(
                expect.objectContaining({ visibility: 'hidden', limit: 25 }),
            );
        });

        it('debounces the search box before re-querying the server', async () => {
            jest.useFakeTimers();
            (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValue(makePage(mockProblems));
            try {
                renderProblemManagement();
                // Flush the initial load through the fake timer queue.
                await act(async () => { jest.runOnlyPendingTimers(); });
                await waitFor(() => screen.getByText('Problem 1'), { timeout: 3000 });
                expect(adminService.getProblems).toHaveBeenCalledTimes(1);

                const search = screen.getByLabelText('Search problems');
                fireEvent.change(search, { target: { value: 'g' } });
                fireEvent.change(search, { target: { value: 'gr' } });
                fireEvent.change(search, { target: { value: 'graph' } });
                await act(async () => { jest.advanceTimersByTime(300); });

                await waitFor(() => expect(adminService.getProblems).toHaveBeenCalledTimes(2), { timeout: 3000 });
                expect(adminService.getProblems).toHaveBeenLastCalledWith(
                    expect.objectContaining({ search: 'graph', limit: 25 }),
                );
            } finally {
                jest.useRealTimers();
            }
        });
    });
});
