import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Problems from '../../pages/problem/Problems';
import problemService from '../../services/problemService';
import { PHONE_TABLE_QUERY } from '../../components/ui/DataTable';
import { installMockIntersectionObserver, restoreMockIntersectionObserver, triggerIntersectionObservers } from '../utils/mockIntersectionObserver';

jest.mock('../../services/problemService');

// Mutable viewer: the status segment is for signed-in users only.
let mockViewer: { id: number; username: string; role: 'user' } | null = { id: 1, username: 'u1', role: 'user' };
jest.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ user: mockViewer, isLoading: false }),
}));

// Mock ThemeContext to prevent useTheme errors from LoadingPage
jest.mock('../../context/ThemeContext', () => ({
    useTheme: jest.fn(() => ({ theme: 'light' })),
}));

// Mock LoadingPage to control the loading text
jest.mock('../../components/shared/LoadingPage', () => () => <div>Loading Problems...</div>);

const problem = (id: string, title = `Title ${id}`, categories: string[] = []) => ({
    id, title, author: null, categories, best_score: null,
});

/** First page of categorized problems used across the category-filter tests. */
const firstPage = {
    problems: [
        problem('dp-1', 'Knapsack', ['Dynamic Programming']),
        problem('dp-2', 'LIS', ['Dynamic Programming', 'Data Structures']),
        problem('gr-1', 'Greedy Slots', ['Greedy']),
        problem('pl-1', 'Plain Problem', []),
    ],
    nextCursor: null,
    hasMore: false,
};

const categoryCounts = {
    categories: [
        { name: 'Dynamic Programming', count: 2 },
        { name: 'Data Structures', count: 1 },
        { name: 'Greedy', count: 1 },
    ],
    uncategorized: 1,
    total: 4,
};

const renderProblems = () => render(<BrowserRouter><Problems /></BrowserRouter>);
/** Picks an option from a desktop filter chip (Base UI menu); Category is a checkbox menu, closed afterwards. */
const chooseChip = async (chip: string, option: string) => {
    fireEvent.click(screen.getByRole('button', { name: `Add filter: ${chip}` }));
    if (chip === 'Category') {
        fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: option }));
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
        return;
    }
    fireEvent.click(await screen.findByRole('menuitem', { name: option }));
};
const LocationProbe = () => <output data-testid="location">{useLocation().search}</output>;
const DetailWithBack = () => {
    const navigate = useNavigate();
    return <button onClick={() => navigate(-1)}>Back to problems</button>;
};
const SameRouteNavigation = () => {
    const navigate = useNavigate();
    return <>
        <button onClick={() => navigate('/problems?keep=yes&search=updated&category=Greedy&difficultyMin=1200&difficultyMax=2200&sort=difficulty-desc&author=Alice&collection=7')}>Open filtered URL</button>
        <button onClick={() => navigate(-1)}>Back to prior URL</button>
    </>;
};

describe('Problems Page', () => {
    afterEach(() => restoreMockIntersectionObserver());

    beforeEach(() => {
        jest.clearAllMocks();
        window.history.replaceState({}, '', '/problems');
        window.sessionStorage.clear();
        (jest.mocked(problemService.getCategoryCounts) as jest.Mock).mockResolvedValue(categoryCounts);
        (jest.mocked(problemService.getFilterOptions) as jest.Mock).mockResolvedValue({
            collections: [{ id: 7, name: 'Practice' }], hasUncollected: true, authors: ['Alice', 'Kru Somchai'],
        });
        (jest.mocked(problemService.getStatusCounts) as jest.Mock).mockResolvedValue({ all: 4, unsolved: 2, attempted: 1, solved: 1 });
        mockViewer = { id: 1, username: 'u1', role: 'user' };
    });

    it('renders loading state initially', () => {
        (jest.mocked(problemService.getProblemsPage) as jest.Mock).mockReturnValueOnce(new Promise(() => { }));
        renderProblems();
        expect(screen.getByText(/loading problems\.\.\.$/i)).toBeInTheDocument();
    });

    it('displays the first server-side batch after fetching', async () => {
        (jest.mocked(problemService.getProblemsPage) as jest.Mock).mockResolvedValueOnce(firstPage);

        renderProblems();

        await waitFor(() => {
            expect(screen.getByText('Knapsack')).toBeInTheDocument();
        });
        // The initial request asks for one batch in the default difficulty order.
        expect(problemService.getProblemsPage).toHaveBeenLastCalledWith({ sort: 'difficulty', order: 'asc', limit: 20 });
    });

    it('requests the initial public list ordered by difficulty ascending', async () => {
        (jest.mocked(problemService.getProblemsPage) as jest.Mock).mockResolvedValueOnce(firstPage);

        renderProblems();

        await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());

        expect(problemService.getProblemsPage).toHaveBeenLastCalledWith({
            sort: 'difficulty',
            order: 'asc',
            limit: 20,
        });
        expect(screen.getByRole('columnheader', { name: /Difficulty/ })).toHaveAttribute('aria-sort', 'ascending');
    });

    it('displays error if the first fetch fails', async () => {
        (jest.mocked(problemService.getProblemsPage) as jest.Mock).mockRejectedValueOnce(new Error('Fetch failed'));

        renderProblems();

        await waitFor(() => {
            expect(screen.getByText(/failed to fetch problems/i)).toBeInTheDocument();
        });
        // Before any page has loaded, the error replaces the whole page.
        expect(screen.queryByLabelText('Search problems')).not.toBeInTheDocument();
    });

    it('after a first load, later refreshes and failures stay in the result area', async () => {
        const mock = jest.mocked(problemService.getProblemsPage) as jest.Mock;
        let rejectRefresh: (reason: Error) => void = () => { };
        mock
            .mockResolvedValueOnce(firstPage)
            .mockReturnValueOnce(new Promise((_, reject) => { rejectRefresh = reject; }));

        renderProblems();
        await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());
        const input = screen.getByLabelText('Search problems');
        await chooseChip('Category', 'Greedy');

        // The refresh is in flight: no full-page loader, controls and the
        // previous batch stay mounted.
        await waitFor(() => expect(mock).toHaveBeenCalledTimes(2));
        expect(screen.queryByText('Loading Problems...')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Search problems')).toBe(input);
        expect(screen.getByText('Knapsack')).toBeInTheDocument();

        await act(async () => { rejectRefresh(new Error('Fetch failed')); });

        // The failure is an inline alert; the controls are never replaced.
        expect(screen.getByRole('alert')).toHaveTextContent(/failed to fetch problems/i);
        expect(screen.getByLabelText('Search problems')).toBe(input);
        expect(mock).toHaveBeenCalledTimes(2);
    });

    describe('redesigned toolbar (status segments and filter chips)', () => {
        beforeEach(() => {
            (jest.mocked(problemService.getProblemsPage) as jest.Mock).mockResolvedValue(firstPage);
        });

        it('status segment sends status and resets pages', async () => {
            window.history.replaceState({}, '', '/problems?pages=3');
            renderProblems();
            await screen.findByText('Knapsack');
            fireEvent.click(screen.getByRole('button', { name: /^Solved/ }));
            await waitFor(() => expect(problemService.getProblemsPage).toHaveBeenLastCalledWith(
                expect.objectContaining({ status: 'solved' }),
            ));
            expect(window.location.search).toContain('status=solved');
            expect(window.location.search).not.toContain('pages=');
            expect(screen.getByRole('button', { name: /^Solved/ })).toHaveAttribute('aria-pressed', 'true');
        });

        it('segment counts come from status-counts with the same filters (an old ...1599 link is read as 1500)', async () => {
            // Ratings are multiples of 100 and the API only accepts such bounds; an old band URL must not fail.
            window.history.replaceState({}, '', '/problems?collection=7&difficultyMin=1200&difficultyMax=1599');
            renderProblems();
            await screen.findByText('Knapsack');
            await waitFor(() => expect(problemService.getStatusCounts).toHaveBeenCalledWith(
                { collection: 7, difficultyMin: 1200, difficultyMax: 1500 },
            ));
            expect(problemService.getProblemsPage).toHaveBeenCalledWith(expect.objectContaining({ difficultyMin: 1200, difficultyMax: 1500 }));
            expect(problemService.getStatusCounts).toHaveBeenCalledWith({});
            expect(await screen.findByRole('button', { name: 'Unsolved 2' })).toBeInTheDocument();
            expect(screen.getByText('4 problems · 1 solved')).toBeInTheDocument();
        });

        it('guests see no status segment and send no status', async () => {
            mockViewer = null;
            window.history.replaceState({}, '', '/problems?status=solved');
            renderProblems();
            await screen.findByText('Knapsack');
            expect(screen.queryByRole('button', { name: /^Solved/ })).toBeNull();
            expect(problemService.getProblemsPage).toHaveBeenCalledWith(expect.not.objectContaining({ status: expect.anything() }));
            expect(await screen.findByText('4 problems')).toBeInTheDocument();
        });

        it('difficulty chip sets the min/max range', async () => {
            renderProblems();
            await screen.findByText('Knapsack');
            await chooseChip('Difficulty', '1200–1500');
            await waitFor(() => expect(window.location.search).toContain('difficultyMin=1200'));
            // Bounds are multiples of 100 — what the API accepts (ratings step by 100, so this is the whole band).
            expect(window.location.search).toContain('difficultyMax=1500');
            expect(await screen.findByRole('button', { name: 'Remove filter Difficulty: 1200–1500' })).toBeInTheDocument();
        });

        it('category and collection chips set their params', async () => {
            renderProblems();
            await screen.findByText('Knapsack');
            fireEvent.click(screen.getByRole('button', { name: 'Add filter: Category' }));
            fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Greedy' }));
            await waitFor(() => expect(window.location.search).toContain('category=Greedy'));
            fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
            await chooseChip('Collection', 'Practice');
            await waitFor(() => expect(window.location.search).toContain('collection=7'));
        });

        it('several categories can be picked at once and stay in the URL', async () => {
            renderProblems();
            await screen.findByText('Knapsack');
            fireEvent.click(screen.getByRole('button', { name: 'Add filter: Category' }));
            fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Greedy' }));
            fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Dynamic Programming' }));
            await waitFor(() => expect(problemService.getProblemsPage).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'Greedy,Dynamic Programming' })));
            expect(new URLSearchParams(window.location.search).get('category')).toBe('Greedy,Dynamic Programming');
        });

        it('the Type chip lists standard and header problems', async () => {
            renderProblems();
            await screen.findByText('Knapsack');
            await chooseChip('Type', 'Header');
            await waitFor(() => expect(problemService.getProblemsPage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'header' })));
            expect(window.location.search).toContain('type=header');
            expect(problemService.getStatusCounts).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'header' }));
            expect(screen.getByRole('button', { name: 'Remove filter Type: Header' })).toBeInTheDocument();
        });

        it('a multi-category URL shows the category chip as set', async () => {
            window.history.replaceState({}, '', '/problems?category=Greedy,Dynamic%20Programming');
            renderProblems();
            await screen.findByText('Knapsack');
            expect(screen.getByRole('button', { name: 'Remove filter Category: Dynamic Programming, Greedy' })).toBeInTheDocument();
            expect(problemService.getProblemsPage).toHaveBeenCalledWith(expect.objectContaining({ category: 'Greedy,Dynamic Programming' }));
        });

        it('the Author chip lists every author and filters by the one picked', async () => {
            renderProblems();
            await screen.findByText('Knapsack');
            await chooseChip('Author', 'Kru Somchai');
            await waitFor(() => expect(problemService.getProblemsPage).toHaveBeenLastCalledWith(expect.objectContaining({ author: 'Kru Somchai' })));
            expect(screen.getByRole('button', { name: 'Remove filter Author: Kru Somchai' })).toBeInTheDocument();
        });

        it('difficulty shows as a coloured badge, unrated as a dash', async () => {
            (jest.mocked(problemService.getProblemsPage) as jest.Mock).mockResolvedValue({
                ...firstPage,
                problems: [{ ...firstPage.problems[0], difficulty: 1900 }, ...firstPage.problems.slice(1)],
            });
            renderProblems();
            await screen.findByText('Knapsack');
            expect(screen.getByText('1900')).toHaveAttribute('data-band', '3');
            expect(screen.getAllByText('—').length).toBeGreaterThan(0);
        });

        it('each row reveals its own categories', async () => {
            renderProblems();
            await screen.findByText('Knapsack');
            const row = screen.getByRole('link', { name: 'Knapsack' }).closest('tr') as HTMLElement;
            expect(within(row).queryByText('Dynamic Programming')).toBeNull();
            fireEvent.click(within(row).getByRole('button', { name: 'Show categories' }));
            expect(within(row).getByText('Dynamic Programming')).toBeInTheDocument();
            expect(within(row).getByRole('button', { name: 'Hide categories' })).toHaveAttribute('aria-expanded', 'true');
            // Only that row opened; there is no page-wide toggle any more.
            expect(screen.getAllByRole('button', { name: 'Show categories' }).length).toBeGreaterThan(0);
            expect(screen.queryByRole('button', { name: 'Show categories', pressed: true })).toBeNull();
        });

        it('rows link to the problem and show the best strip and score', async () => {
            (jest.mocked(problemService.getProblemsPage) as jest.Mock).mockResolvedValue({
                problems: [{ ...problem('vec', 'vector::erase'), best_score: 60, submission_count: '3',
                    best_submission_status: 'Wrong Answer', latest_submission_at: new Date().toISOString(),
                    best_submission_results: [{ status: 'Accepted' }, { status: 'Wrong Answer' }] }],
                nextCursor: null, hasMore: false,
            });
            renderProblems();
            expect(await screen.findByRole('link', { name: 'vector::erase' })).toHaveAttribute('href', '/problems/vec');
            expect(screen.getByRole('img', { name: '1 of 2 test cases passed' })).toBeInTheDocument();
            expect(screen.getByText('60')).toBeInTheDocument();
        });

        it('a header problem carries a Header badge next to its title, on desktop and on phones', async () => {
            (jest.mocked(problemService.getProblemsPage) as jest.Mock).mockResolvedValue({
                problems: [{ ...problem('q', 'Queue rotate'), problem_type: 'header' }, { ...problem('s', 'Two sum'), problem_type: 'standard' }],
                nextCursor: null, hasMore: false,
            });
            const desktop = renderProblems();
            const headerRow = await screen.findByRole('link', { name: 'Queue rotate Header' });
            expect(headerRow.closest('tr')).not.toBeNull();
            expect(within(headerRow).getByText('Header')).toBeInTheDocument();
            expect(within(screen.getByRole('link', { name: 'Two sum' })).queryByText('Header')).toBeNull();
            desktop.unmount();

            const original = window.matchMedia;
            window.matchMedia = jest.fn().mockImplementation((query: string) => ({
                matches: query === PHONE_TABLE_QUERY, media: query, addEventListener: jest.fn(), removeEventListener: jest.fn(),
            })) as unknown as typeof window.matchMedia;
            try {
                renderProblems();
                const headerItem = await screen.findByRole('link', { name: 'Queue rotate Header' });
                expect(headerItem.closest('li')).not.toBeNull();
                expect(within(headerItem).getByText('Header')).toBeInTheDocument();
                expect(within(screen.getByRole('link', { name: 'Two sum' })).queryByText('Header')).toBeNull();
            } finally {
                window.matchMedia = original;
            }
        });
    });

    describe('Show More (incremental loading)', () => {
        it('automatically loads the next batch when the Show More control enters the near-viewport', async () => {
            const restoreObserver = installMockIntersectionObserver();
            (jest.mocked(problemService.getProblemsPage) as jest.Mock)
                .mockResolvedValueOnce({ problems: [problem('a')], nextCursor: 'cur-1', hasMore: true })
                .mockResolvedValueOnce({ problems: [problem('b')], nextCursor: null, hasMore: false });

            renderProblems();
            await screen.findByText('Title a');
            await waitFor(() => expect(problemService.getProblemsPage).toHaveBeenCalledTimes(1));

            act(() => triggerIntersectionObservers());

            expect(await screen.findByText('Title b')).toBeInTheDocument();
            expect(problemService.getProblemsPage).toHaveBeenLastCalledWith({
                sort: 'difficulty', order: 'asc', limit: 20, cursor: 'cur-1',
            });
            restoreObserver();
        });

        it('appends the next batch when Show More is clicked', async () => {
            (jest.mocked(problemService.getProblemsPage) as jest.Mock)
                .mockResolvedValueOnce({ problems: [problem('a'), problem('b')], nextCursor: 'cur-1', hasMore: true })
                .mockResolvedValueOnce({ problems: [problem('c')], nextCursor: null, hasMore: false });

            renderProblems();
            await waitFor(() => expect(screen.getByText('Title a')).toBeInTheDocument());
            expect(screen.getByRole('button', { name: 'Show More' })).toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: 'Show More' }));

            await waitFor(() => expect(screen.getByText('Title c')).toBeInTheDocument());
            expect(problemService.getProblemsPage).toHaveBeenLastCalledWith({ sort: 'difficulty', order: 'asc', limit: 20, cursor: 'cur-1' });
            // Appended, never replaced.
            expect(screen.getByText('Title a')).toBeInTheDocument();
            expect(screen.getByText('Title b')).toBeInTheDocument();
        });

        it('removes the button after the final batch (no cursor, no button)', async () => {
            (jest.mocked(problemService.getProblemsPage) as jest.Mock)
                .mockResolvedValueOnce({ problems: [problem('a'), problem('b')], nextCursor: 'cur-1', hasMore: true })
                .mockResolvedValueOnce({ problems: [problem('c')], nextCursor: null, hasMore: false });

            renderProblems();
            await waitFor(() => expect(screen.getByText('Title a')).toBeInTheDocument());

            fireEvent.click(screen.getByRole('button', { name: 'Show More' }));

            await waitFor(() => expect(screen.queryByRole('button', { name: 'Show More' })).not.toBeInTheDocument());
        });

        it('shows no Show More button on a single-batch list', async () => {
            (jest.mocked(problemService.getProblemsPage) as jest.Mock).mockResolvedValueOnce(firstPage);

            renderProblems();
            await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());

            expect(screen.queryByRole('button', { name: 'Show More' })).not.toBeInTheDocument();
        });

        it('shows no Show More button on an empty first page', async () => {
            (jest.mocked(problemService.getProblemsPage) as jest.Mock)
                .mockResolvedValueOnce({ problems: [], nextCursor: null, hasMore: false });

            renderProblems();
            await waitFor(() => expect(screen.getByText('Problem not available.')).toBeInTheDocument());

            expect(screen.queryByRole('button', { name: 'Show More' })).not.toBeInTheDocument();
        });

        it('keeps the loaded list and offers Retry when loading more fails', async () => {
            (jest.mocked(problemService.getProblemsPage) as jest.Mock)
                .mockResolvedValueOnce({ problems: [problem('a')], nextCursor: 'cur-1', hasMore: true })
                .mockRejectedValueOnce(new Error('network down'))
                .mockResolvedValueOnce({ problems: [problem('b')], nextCursor: null, hasMore: false });

            renderProblems();
            await waitFor(() => expect(screen.getByText('Title a')).toBeInTheDocument());

            fireEvent.click(screen.getByRole('button', { name: 'Show More' }));

            await waitFor(() => expect(screen.getByText(/failed to load more problems/i)).toBeInTheDocument());
            // The loaded problem is still visible.
            expect(screen.getByText('Title a')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

            await waitFor(() => {
                expect(screen.getByText('Title b')).toBeInTheDocument();
            });
            expect(screen.queryByText(/failed to load more problems/i)).not.toBeInTheDocument();
        });
    });



    describe('URL-held filters', () => {
        it('syncs controls and results after same-route URL navigation and Back', async () => {
            const mock = jest.mocked(problemService.getProblemsPage) as jest.Mock;
            mock.mockImplementation(async (query) => query.search === 'updated'
                ? { problems: [problem('new', 'Updated Result')], nextCursor: null, hasMore: false }
                : firstPage);
            render(
                <MemoryRouter initialEntries={['/problems?keep=yes']}>
                    <LocationProbe /><SameRouteNavigation /><Problems />
                </MemoryRouter>,
            );
            await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());
            fireEvent.click(screen.getByRole('button', { name: 'Open filtered URL' }));
            await waitFor(() => expect(screen.getByText('Updated Result')).toBeInTheDocument());
            expect(screen.getByLabelText('Search problems')).toHaveValue('updated');
            expect(screen.getByRole('button', { name: 'Remove filter Category: Greedy' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Remove filter Difficulty: 1200–2200' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Remove filter Author: Alice' })).toBeInTheDocument();
            expect(await screen.findByRole('button', { name: 'Remove filter Collection: Practice' })).toBeInTheDocument();
            expect(screen.getByRole('columnheader', { name: /Difficulty/ })).toHaveAttribute('aria-sort', 'descending');
            expect(mock).toHaveBeenLastCalledWith({
                search: 'updated', category: 'Greedy', difficultyMin: 1200, difficultyMax: 2200,
                sort: 'difficulty', order: 'desc', author: 'Alice', collection: 7, limit: 20,
            });
            fireEvent.click(screen.getByRole('button', { name: 'Back to prior URL' }));
            await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());
            expect(screen.getByLabelText('Search problems')).toHaveValue('');
            expect(screen.queryByRole('button', { name: /Remove filter Author/ })).toBeNull();
            expect(screen.getByTestId('location').textContent).toBe('?keep=yes');
        });

        it('removing one chip keeps every other filter and unrelated param', async () => {
            (jest.mocked(problemService.getProblemsPage) as jest.Mock).mockResolvedValue(firstPage);
            render(
                <MemoryRouter initialEntries={['/problems?keep=yes&search=knapsack&sort=difficulty-desc&category=Greedy&difficultyMin=1000&author=Alice&collection=7']}>
                    <LocationProbe /><Problems />
                </MemoryRouter>,
            );
            await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());
            fireEvent.click(screen.getByRole('button', { name: 'Remove filter Category: Greedy' }));
            const params = new URLSearchParams(screen.getByTestId('location').textContent || '');
            expect(params.has('category')).toBe(false);
            expect(params.get('difficultyMin')).toBe('1000');
            expect(params.get('author')).toBe('Alice');
            expect(params.get('keep')).toBe('yes');
            expect(params.get('search')).toBe('knapsack');
            expect(params.get('sort')).toBe('difficulty-desc');
        });

        it('restores every filter from the URL after navigating to a detail and back', async () => {
            (jest.mocked(problemService.getProblemsPage) as jest.Mock).mockResolvedValue(firstPage);
            render(
                <MemoryRouter initialEntries={['/problems?keep=yes&search=knapsack&category=Greedy&difficultyMin=1200&difficultyMax=1599&sort=difficulty-desc&author=Alice&collection=7']}>
                    <LocationProbe />
                    <Routes>
                        <Route path="/problems" element={<Problems />} />
                        <Route path="/problems/:problemId" element={<DetailWithBack />} />
                    </Routes>
                </MemoryRouter>,
            );
            await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());
            expect(screen.getByLabelText('Search problems')).toHaveValue('knapsack');
            expect(screen.getByRole('button', { name: 'Remove filter Difficulty: 1200–1500' })).toBeInTheDocument();
            expect(problemService.getProblemsPage).toHaveBeenCalledWith(expect.objectContaining({
                search: 'knapsack', category: 'Greedy', difficultyMin: 1200, difficultyMax: 1500,
                sort: 'difficulty', order: 'desc', author: 'Alice', collection: 7, limit: 20,
            }));
            fireEvent.click(screen.getByRole('link', { name: /^Knapsack/ }));
            fireEvent.click(screen.getByRole('button', { name: 'Back to problems' }));
            expect(await screen.findByRole('button', { name: 'Remove filter Author: Alice' })).toBeInTheDocument();
            expect(screen.getByTestId('location').textContent).toContain('keep=yes');
        });

        it('hydrates all rows already loaded for the current list history entry before scroll restoration', async () => {
            const restoredProblems = Array.from({ length: 40 }, (_, index) =>
                problem(`restore-${index}`, `Restore ${index}`));
            const query = { search: 'restore', sort: 'difficulty' as const, order: 'desc' as const };
            window.history.replaceState({}, '', '/problems?search=restore&sort=difficulty-desc&pages=2');

            render(<BrowserRouter><Problems initialPageSpan={{
                queryKey: JSON.stringify(query),
                problems: restoredProblems,
                nextCursor: 'cursor-3',
                hasMore: true,
            }} /></BrowserRouter>);

            expect(screen.getByText('Restore 39')).toBeInTheDocument();
            expect(screen.getByLabelText('Search problems')).toHaveValue('restore');
            expect(problemService.getProblemsPage).not.toHaveBeenCalled();
            (jest.mocked(problemService.getProblemsPage) as jest.Mock).mockResolvedValueOnce({
                problems: [problem('restore-40', 'Restore 40')], nextCursor: null, hasMore: false,
            });
            fireEvent.click(screen.getByRole('button', { name: 'Show More' }));
            await waitFor(() => expect(problemService.getProblemsPage).toHaveBeenCalledWith({
                search: 'restore', sort: 'difficulty', order: 'desc', limit: 20, cursor: 'cursor-3',
            }));
            await waitFor(() => expect(new URLSearchParams(window.location.search).get('pages')).toBe('3'));
        });

        it('replaces the current URL on filter edits while retaining unrelated params', async () => {
            (jest.mocked(problemService.getProblemsPage) as jest.Mock).mockResolvedValue(firstPage);
            render(
                <MemoryRouter initialEntries={['/landing', '/problems?keep=yes']} initialIndex={1}>
                    <LocationProbe />
                    <Routes>
                        <Route path="/landing" element={<p>Landing page</p>} />
                        <Route path="/problems" element={<><Problems /><DetailWithBack /></>} />
                        <Route path="/problems/:problemId" element={<DetailWithBack />} />
                    </Routes>
                </MemoryRouter>,
            );
            await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());
            await chooseChip('Collection', 'Practice');
            await chooseChip('Difficulty', '1200–1500');
            await chooseChip('Category', 'Greedy');
            // Sorting is the Difficulty header now (ascending → descending).
            fireEvent.click(within(screen.getByRole('columnheader', { name: /Difficulty/ })).getByRole('button'));
            fireEvent.change(screen.getByLabelText('Search problems'), { target: { value: 'knapsack' } });
            await waitFor(() => {
                const params = new URLSearchParams(screen.getByTestId('location').textContent || '');
                expect(params.get('keep')).toBe('yes');
                expect(params.get('collection')).toBe('7');
                expect(params.get('difficultyMin')).toBe('1200');
                expect(params.get('difficultyMax')).toBe('1500');
                expect(params.get('sort')).toBe('difficulty-desc');
                expect(params.get('category')).toBe('Greedy');
                expect(params.get('search')).toBe('knapsack');
            });
            fireEvent.click(screen.getAllByRole('button', { name: 'Back to problems' })[0]);
            // A history Back from the filtered list should reach the landing entry,
            // not a trail of intermediate filter edits.
            await waitFor(() => expect(screen.getByText('Landing page')).toBeInTheDocument());
        });
    });

    describe('search', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('debounces the search box before querying the server', async () => {
            const mock = (jest.mocked(problemService.getProblemsPage) as jest.Mock);
            mock.mockResolvedValue(firstPage);
            renderProblems();

            // Initial load completes.
            await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());
            mock.mockClear();

            // Typing three characters must not fire a request per keystroke…
            fireEvent.change(screen.getByLabelText('Search problems'), { target: { value: 'k' } });
            fireEvent.change(screen.getByLabelText('Search problems'), { target: { value: 'kn' } });
            fireEvent.change(screen.getByLabelText('Search problems'), { target: { value: 'kna' } });
            expect(mock).not.toHaveBeenCalled();

            // …only after the debounce window settles.
            jest.advanceTimersByTime(300);
            await waitFor(() => {
                expect(mock).toHaveBeenLastCalledWith({ search: 'kna', sort: 'difficulty', order: 'asc', limit: 20 });
            });
        });
    });

    describe('empty state', () => {
        it('blames the filters when a filtered query returns nothing', async () => {
            const mock = (jest.mocked(problemService.getProblemsPage) as jest.Mock);
            mock.mockResolvedValueOnce(firstPage);
            renderProblems();
            await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());

            // Apply a category filter whose (mocked) result is empty.
            mock.mockResolvedValueOnce({ problems: [], nextCursor: null, hasMore: false });
            await chooseChip('Category', 'Greedy');

            await waitFor(() => expect(screen.getByText('Problem not available.')).toBeInTheDocument());
            expect(screen.getByText(/no problems match the current filter/i)).toBeInTheDocument();
        });

        it('suggests checking back later when an unfiltered query returns nothing', async () => {
            (jest.mocked(problemService.getProblemsPage) as jest.Mock)
                .mockResolvedValueOnce({ problems: [], nextCursor: null, hasMore: false });

            renderProblems();
            await waitFor(() => expect(screen.getByText('Problem not available.')).toBeInTheDocument());

            expect(screen.getByText(/check back later or try refreshing the page/i)).toBeInTheDocument();
        });
    });

    // ------------------------------------------------------------------
    // Search focus stability: the controls must never remount while the
    // user interacts with them — only the result area may change.
    // ------------------------------------------------------------------
    describe('search focus stability (no remount during search)', () => {
        const type = (text: string) =>
            fireEvent.change(screen.getByLabelText('Search problems'), { target: { value: text } });

        it('keeps focus in the search input through debounce, request, and results update', async () => {
            jest.useFakeTimers();
            try {
                const mock = (jest.mocked(problemService.getProblemsPage) as jest.Mock);
                mock.mockResolvedValueOnce(firstPage);
                // A pending promise: the results arrive only when we let them.
                let resolveSearch: (value: unknown) => void = () => { };
                mock.mockReturnValueOnce(new Promise(resolve => { resolveSearch = resolve; }));
                mock.mockResolvedValue({ problems: [], nextCursor: null, hasMore: false });

                renderProblems();
                await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());
                const input = screen.getByLabelText('Search problems');
                input.focus();
                expect(document.activeElement).toBe(input);

                // Type through the debounce window.
                act(() => {
                    type('kna');
                    jest.advanceTimersByTime(300);
                });

                // The debounced request is in flight. The page has NOT been
                // replaced by a loading screen — the input is still the same
                // focused DOM node, and the previous results stay visible.
                expect(document.activeElement).toBe(input);
                expect(document.body.contains(input)).toBe(true);
                expect(screen.getByText('Knapsack')).toBeInTheDocument();

                // The response lands; the results swap in. Focus must survive.
                await act(async () => {
                    resolveSearch({ problems: [problem('k1', 'Knapsack Fresh')], nextCursor: null, hasMore: false });
                });
                await waitFor(() => expect(screen.getByText('Knapsack Fresh')).toBeInTheDocument());
                expect(document.activeElement).toBe(input);

                // And the user can keep typing without clicking again.
                act(() => {
                    fireEvent.change(input, { target: { value: 'knaps' } });
                    jest.advanceTimersByTime(300);
                });
                // Let the mocked request resolve (already settled promises).
                await act(async () => { await Promise.resolve(); });
                expect(document.activeElement).toBe(input);
            } finally {
                jest.useRealTimers();
            }
        });

        it('continues typing mid-flight: a newer keystroke supersedes the pending request', async () => {
            jest.useFakeTimers();
            try {
                const mock = (jest.mocked(problemService.getProblemsPage) as jest.Mock);
                mock.mockResolvedValueOnce(firstPage);
                let resolveOld: (value: unknown) => void = () => { };
                let resolveNew: (value: unknown) => void = () => { };
                mock.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
                mock.mockReturnValueOnce(new Promise(resolve => { resolveNew = resolve; }));

                renderProblems();
                await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());
                const input = screen.getByLabelText('Search problems');
                input.focus();

                // "dp" settles and fires a request…
                act(() => {
                    type('dp');
                    jest.advanceTimersByTime(300);
                });
                // …but the user keeps typing before it returns, so a newer
                // request for "dp t" is now in flight too.
                act(() => {
                    fireEvent.change(input, { target: { value: 'dp t' } });
                    jest.advanceTimersByTime(300);
                });
                expect(mock).toHaveBeenCalledTimes(3);

                // The newer response lands first with fresh data.
                await act(async () => {
                    resolveNew({ problems: [problem('fresh', 'Fresh Result')], nextCursor: null, hasMore: false });
                });
                await waitFor(() => expect(screen.getByText('Fresh Result')).toBeInTheDocument());

                // Now the older "dp" response finally arrives — it must not
                // overwrite the newer query's results. The hook's monotonic
                // request id discards it.
                await act(async () => {
                    resolveOld({ problems: [problem('stale', 'Stale Result')], nextCursor: null, hasMore: false });
                    await Promise.resolve();
                });

                expect(screen.queryByText('Stale Result')).not.toBeInTheDocument();
                expect(screen.getByText('Fresh Result')).toBeInTheDocument();
                expect(document.activeElement).toBe(input);
            } finally {
                jest.useRealTimers();
            }
        });

        it('a filter change resets the list (page 1) without remounting the search box', async () => {
            const mock = (jest.mocked(problemService.getProblemsPage) as jest.Mock);
            // Call order is deterministic: initial load, search, search+category.
            mock
                .mockResolvedValueOnce(firstPage)
                .mockResolvedValueOnce(firstPage)
                .mockResolvedValueOnce({ problems: [problem('g1', 'Greedy One')], nextCursor: null, hasMore: false });

            renderProblems();
            await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());
            const input = screen.getByLabelText('Search problems');
            input.focus();
            fireEvent.change(input, { target: { value: 'knapsack' } });

            await waitFor(() => {
                expect(mock).toHaveBeenLastCalledWith({ search: 'knapsack', sort: 'difficulty', order: 'asc', limit: 20 });
            }, { timeout: 2000 });

            // A category change while a search is active: the list resets to
            // page 1 of the new query. The input node is never recreated.
            await chooseChip('Category', 'Greedy');

            await waitFor(() => {
                expect(mock).toHaveBeenLastCalledWith({ search: 'knapsack', category: 'Greedy', sort: 'difficulty', order: 'asc', limit: 20 });
            }, { timeout: 2000 });
            await waitFor(() => expect(screen.getByText('Greedy One')).toBeInTheDocument());
            expect(screen.queryByText('LIS')).not.toBeInTheDocument();
            // Picking from the chip's menu returns focus to the chip (menu
            // behaviour); the search box itself is the same node, unchanged.
            expect(screen.getByLabelText('Search problems')).toBe(input);
            expect((input as HTMLInputElement).value).toBe('knapsack');
        });

        it('Show More appends after a search, and the search box stays interactive while loading', async () => {
            jest.useFakeTimers();
            try {
                const mock = (jest.mocked(problemService.getProblemsPage) as jest.Mock);
                mock.mockResolvedValueOnce(firstPage);
                // The search query returns a list with more pages.
                mock.mockResolvedValueOnce({
                    problems: [problem('s1', 'Searchable One')],
                    nextCursor: 's-cur',
                    hasMore: true,
                });
                mock.mockResolvedValueOnce({
                    problems: [problem('s2', 'Searchable Two')],
                    nextCursor: null,
                    hasMore: false,
                });

                renderProblems();
                await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());

                act(() => {
                    type('searchable');
                    jest.advanceTimersByTime(300);
                });
                await waitFor(() => expect(mock).toHaveBeenLastCalledWith({ search: 'searchable', sort: 'difficulty', order: 'asc', limit: 20 }));
                await waitFor(() => expect(screen.getByText('Searchable One')).toBeInTheDocument());
                expect(screen.queryByText('Knapsack')).not.toBeInTheDocument(); // reset, not appended

                // Show More appends within the same search.
                fireEvent.click(screen.getByRole('button', { name: 'Show More' }));
                await waitFor(() => expect(mock).toHaveBeenLastCalledWith({ search: 'searchable', sort: 'difficulty', order: 'asc', limit: 20, cursor: 's-cur' }));
                await waitFor(() => expect(screen.getByText('Searchable Two')).toBeInTheDocument());
                expect(screen.getByText('Searchable One')).toBeInTheDocument();

                // The search box is still editable while a load is in flight.
                const input = screen.getByLabelText('Search problems');
                fireEvent.change(input, { target: { value: 'searchable two' } });
                expect((input as HTMLInputElement).value).toBe('searchable two');
                input.focus();
                expect(document.activeElement).toBe(input);
            } finally {
                jest.useRealTimers();
            }
        });
    });
});
