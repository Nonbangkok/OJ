import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Problems from '../../pages/problem/Problems';
import problemService from '../../services/problemService';

jest.mock('../../services/problemService');

// Mock ThemeContext to prevent useTheme errors from LoadingPage
jest.mock('../../context/ThemeContext', () => ({
    useTheme: jest.fn(() => ({ theme: 'light' })),
}));

// Mock LoadingPage to control the loading text
jest.mock('../../components/shared/LoadingPage', () => () => <div>Loading Problems...</div>);

const problem = (id: string, title = `Title ${id}`, categories: string[] = []) => ({
    id, title, author: null, categories, best_score: null,
});

/** First page of categorized problems used across the tab tests. */
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
    beforeEach(() => {
        jest.clearAllMocks();
        window.history.replaceState({}, '', '/problems');
        (jest.mocked(problemService.getCategoryCounts) as jest.Mock).mockResolvedValue(categoryCounts);
        (jest.mocked(problemService.getFilterOptions) as jest.Mock).mockResolvedValue({
            collections: [{ id: 7, name: 'Practice' }], hasUncollected: true,
        });
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
        expect(screen.getByLabelText('Sort problems')).toHaveValue('difficulty-asc');
    });

    it('displays error if the first fetch fails', async () => {
        (jest.mocked(problemService.getProblemsPage) as jest.Mock).mockRejectedValueOnce(new Error('Fetch failed'));

        renderProblems();

        await waitFor(() => {
            expect(screen.getByText(/failed to fetch problems/i)).toBeInTheDocument();
        });
    });

    describe('Show More (incremental loading)', () => {
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

    describe('category tabs (global counts, server-side filter)', () => {
        it('renders one tab per category with global counts plus All and Uncategorized', async () => {
            (jest.mocked(problemService.getProblemsPage) as jest.Mock).mockResolvedValueOnce(firstPage);

            renderProblems();

            await waitFor(() => {
                expect(screen.getByRole('tab', { name: /All 4/ })).toBeInTheDocument();
            });
            expect(screen.getByRole('tab', { name: /Dynamic Programming 2/ })).toBeInTheDocument();
            expect(screen.getByRole('tab', { name: /Data Structures 1/ })).toBeInTheDocument();
            expect(screen.getByRole('tab', { name: /Greedy 1/ })).toBeInTheDocument();
            expect(screen.getByRole('tab', { name: /Uncategorized 1/ })).toBeInTheDocument();
        });

        it('selecting a category refetches the first page with the category filter', async () => {
            (jest.mocked(problemService.getProblemsPage) as jest.Mock).mockResolvedValue(firstPage);

            renderProblems();
            await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());

            fireEvent.click(screen.getByRole('tab', { name: /Greedy/ }));

            await waitFor(() => {
                expect(problemService.getProblemsPage).toHaveBeenLastCalledWith({ category: 'Greedy', sort: 'difficulty', order: 'asc', limit: 20 });
            });
        });

        it('the Uncategorized tab filters with the Uncategorized sentinel', async () => {
            (jest.mocked(problemService.getProblemsPage) as jest.Mock).mockResolvedValue(firstPage);

            renderProblems();
            await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());

            fireEvent.click(screen.getByRole('tab', { name: /^Uncategorized/ }));

            await waitFor(() => {
                expect(problemService.getProblemsPage).toHaveBeenLastCalledWith({ category: 'Uncategorized', sort: 'difficulty', order: 'asc', limit: 20 });
            });
        });

        it('hides category badges by default and shows only the selected one when filtered', async () => {
            (jest.mocked(problemService.getProblemsPage) as jest.Mock).mockResolvedValue(firstPage);

            renderProblems();
            await waitFor(() => {
                expect(screen.getByText('Knapsack')).toBeInTheDocument();
            });

            // Default "All" view: no badge text anywhere on the cards —
            // categories can reveal problem content, so they stay hidden.
            expect(screen.queryByText('Dynamic Programming', { selector: 'span' })).not.toBeInTheDocument();
            expect(screen.queryByText('Greedy', { selector: 'span' })).not.toBeInTheDocument();

            // Selecting a category reveals ONLY that category's badge.
            fireEvent.click(screen.getByRole('tab', { name: /^Dynamic Programming/ }));
            await waitFor(() => {
                // Knapsack (single category) and LIS (two categories) both
                // show the selected one; LIS's other category stays hidden.
                expect(screen.getAllByText('Dynamic Programming', { selector: 'span' })).toHaveLength(2);
            });
            expect(screen.queryByText('Data Structures', { selector: 'span' })).not.toBeInTheDocument();

            // Switching to the Greedy tab swaps which badge shows.
            fireEvent.click(screen.getByRole('tab', { name: /^Greedy/ }));
            await waitFor(() => {
                expect(screen.getByText('Greedy', { selector: 'span' })).toBeInTheDocument();
            });
            expect(screen.queryByText('Dynamic Programming', { selector: 'span' })).not.toBeInTheDocument();
        });

        it('reveals all categories per card through the show-categories toggle', async () => {
            (jest.mocked(problemService.getProblemsPage) as jest.Mock).mockResolvedValue(firstPage);

            renderProblems();
            await waitFor(() => {
                expect(screen.getByText('LIS')).toBeInTheDocument();
            });

            // Default view: every categorized card offers "Show categories";
            // the uncategorized card (Plain Problem) offers nothing.
            const toggles = screen.getAllByRole('button', { name: 'Show categories' });
            expect(toggles).toHaveLength(3); // Knapsack, LIS, Greedy Slots

            // Reveal LIS's categories: find its toggle via the card heading's DOM.
            const lisHeading = screen.getByText('LIS');
            const lisToggle = lisHeading.closest('div')?.querySelector('button') as HTMLElement;
            expect(lisToggle).toBeTruthy();
            fireEvent.click(lisToggle);
            expect(screen.getAllByText('Dynamic Programming', { selector: 'span' }).length).toBeGreaterThanOrEqual(1);
            expect(screen.getByText('Data Structures', { selector: 'span' })).toBeInTheDocument();

            // Toggling again hides them.
            fireEvent.click(screen.getAllByRole('button', { name: 'Hide categories' })[0]);
            expect(screen.queryByText('Data Structures', { selector: 'span' })).not.toBeInTheDocument();
        });

        it('offers "Show all categories" for a multi-category problem under a filter', async () => {
            (jest.mocked(problemService.getProblemsPage) as jest.Mock).mockResolvedValue(firstPage);

            renderProblems();
            await waitFor(() => {
                expect(screen.getByText('LIS')).toBeInTheDocument();
            });

            // Filter to Dynamic Programming: LIS shows that badge and — because
            // it carries a second category — also a "Show all categories" toggle.
            fireEvent.click(screen.getByRole('tab', { name: /^Dynamic Programming/ }));
            const showAll = await screen.findAllByRole('button', { name: 'Show all categories' });
            expect(showAll).toHaveLength(1); // only LIS (Knapsack has a single category)

            fireEvent.click(showAll[0]);
            // Both of LIS's categories are now visible together.
            expect(screen.getAllByText('Dynamic Programming', { selector: 'span' }).length).toBeGreaterThanOrEqual(1);
            expect(screen.getByText('Data Structures', { selector: 'span' })).toBeInTheDocument();
        });
    });

    describe('difficulty filter & sort', () => {
        // The difficulty controls only build the server query — the backend
        // semantics (Unrated exclusion, NULLS LAST) are covered by backend
        // integration tests. Here we assert the emitted query params.
        it('shows every problem including Unrated when no difficulty filter is set', async () => {
            const mock = (jest.mocked(problemService.getProblemsPage) as jest.Mock);
            mock.mockResolvedValue(firstPage);
            renderProblems();

            await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());
            // The default request carries the difficulty ordering and batch size.
            expect(mock).toHaveBeenLastCalledWith({ sort: 'difficulty', order: 'asc', limit: 20 });
        });

        it('sends difficulty min and max as server-side params', async () => {
            const mock = (jest.mocked(problemService.getProblemsPage) as jest.Mock);
            mock.mockResolvedValue(firstPage);
            renderProblems();
            await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());

            fireEvent.change(screen.getByLabelText('Difficulty minimum'), { target: { value: '1000' } });

            await waitFor(() => {
                expect(mock).toHaveBeenLastCalledWith({ difficultyMin: 1000, sort: 'difficulty', order: 'asc', limit: 20 });
            });

            fireEvent.change(screen.getByLabelText('Difficulty maximum'), { target: { value: '2000' } });

            await waitFor(() => {
                expect(mock).toHaveBeenLastCalledWith({ difficultyMin: 1000, difficultyMax: 2000, sort: 'difficulty', order: 'asc', limit: 20 });
            });
        });

        it('sends the difficulty sort params and clears back to the default view', async () => {
            const mock = (jest.mocked(problemService.getProblemsPage) as jest.Mock);
            mock.mockResolvedValue(firstPage);
            renderProblems();
            await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());

            fireEvent.change(screen.getByLabelText('Sort problems'), { target: { value: 'difficulty-asc' } });
            await waitFor(() => {
                expect(mock).toHaveBeenLastCalledWith({ sort: 'difficulty', order: 'asc', limit: 20 });
            });

            fireEvent.change(screen.getByLabelText('Sort problems'), { target: { value: 'difficulty-desc' } });
            await waitFor(() => {
                expect(mock).toHaveBeenLastCalledWith({ sort: 'difficulty', order: 'desc', limit: 20 });
            });

            fireEvent.change(screen.getByLabelText('Sort problems'), { target: { value: '' } });
            await waitFor(() => {
                expect(mock).toHaveBeenLastCalledWith({ limit: 20 });
            });
        });
    });

    describe('public author and collection filters', () => {
        it('accepts arbitrary author text, saves it immediately, and debounces the request', async () => {
            const mock = jest.mocked(problemService.getProblemsPage) as jest.Mock;
            mock.mockResolvedValue(firstPage);
            render(
                <MemoryRouter initialEntries={['/problems?keep=yes']}>
                    <LocationProbe /><Problems />
                </MemoryRouter>,
            );
            await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());
            mock.mockClear();
            fireEvent.change(screen.getByLabelText('Author'), { target: { value: '  nOnE  ' } });
            expect(screen.getByLabelText('Author')).toHaveValue('  nOnE  ');
            expect(mock).not.toHaveBeenCalled();
            const params = new URLSearchParams(screen.getByTestId('location').textContent || '');
            expect(params.get('author')).toBe('  nOnE  ');
            expect(params.get('keep')).toBe('yes');
            await waitFor(() => expect(mock).toHaveBeenLastCalledWith({ author: 'nOnE', sort: 'difficulty', order: 'asc', limit: 20 }));
        });

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
            expect(screen.getByRole('tab', { name: /^Greedy/ })).toHaveAttribute('aria-selected', 'true');
            expect(screen.getByLabelText('Difficulty minimum')).toHaveValue('1200');
            expect(screen.getByLabelText('Difficulty maximum')).toHaveValue('2200');
            expect(screen.getByLabelText('Sort problems')).toHaveValue('difficulty-desc');
            expect(screen.getByLabelText('Author')).toHaveValue('Alice');
            expect(screen.getByLabelText('Collection')).toHaveValue('7');
            expect(mock).toHaveBeenLastCalledWith({
                search: 'updated', category: 'Greedy', difficultyMin: 1200, difficultyMax: 2200,
                sort: 'difficulty', order: 'desc', author: 'Alice', collection: 7, limit: 20,
            });
            fireEvent.click(screen.getByRole('button', { name: 'Back to prior URL' }));
            await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());
            expect(screen.getByLabelText('Search problems')).toHaveValue('');
            expect(screen.getByLabelText('Author')).toHaveValue('');
            expect(screen.getByTestId('location').textContent).toBe('?keep=yes');
        });
        it('offers canonical collection choices and composes them with free-text author search', async () => {
            const mock = jest.mocked(problemService.getProblemsPage) as jest.Mock;
            mock.mockResolvedValue({ ...firstPage, nextCursor: 'next', hasMore: true });
            renderProblems();
            await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());
            expect(screen.getByRole('option', { name: 'Practice' })).toBeInTheDocument();

            fireEvent.change(screen.getByLabelText('Collection'), { target: { value: '7' } });
            await waitFor(() => expect(mock).toHaveBeenLastCalledWith({ collection: 7, sort: 'difficulty', order: 'asc', limit: 20 }));
            fireEvent.change(screen.getByLabelText('Author'), { target: { value: 'Accountless Author' } });
            await waitFor(() => expect(mock).toHaveBeenLastCalledWith({ author: 'Accountless Author', collection: 7, sort: 'difficulty', order: 'asc', limit: 20 }));
            expect(mock.mock.calls.at(-1)?.[0].cursor).toBeUndefined();

            fireEvent.change(screen.getByLabelText('Author'), { target: { value: '' } });
            fireEvent.change(screen.getByLabelText('Collection'), { target: { value: 'none' } });
            await waitFor(() => expect(mock).toHaveBeenLastCalledWith({ collection: 'none', sort: 'difficulty', order: 'asc', limit: 20 }));
        });

        it('restores every filter from the URL after navigating to a detail and back', async () => {
            (jest.mocked(problemService.getProblemsPage) as jest.Mock).mockResolvedValue(firstPage);
            render(
                <MemoryRouter initialEntries={['/problems?keep=yes&search=knapsack&category=Graph&difficultyMin=1000&difficultyMax=2000&sort=difficulty-desc&author=Alice&collection=7']}>
                    <LocationProbe />
                    <Routes>
                        <Route path="/problems" element={<Problems />} />
                        <Route path="/problems/:problemId" element={<DetailWithBack />} />
                    </Routes>
                </MemoryRouter>,
            );
            await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());
            expect(screen.getByLabelText('Search problems')).toHaveValue('knapsack');
            expect(screen.getByLabelText('Difficulty minimum')).toHaveValue('1000');
            expect(screen.getByLabelText('Difficulty maximum')).toHaveValue('2000');
            expect(screen.getByLabelText('Sort problems')).toHaveValue('difficulty-desc');
            expect(screen.getByLabelText('Author')).toHaveValue('Alice');
            expect(screen.getByLabelText('Collection')).toHaveValue('7');
            expect(problemService.getProblemsPage).toHaveBeenCalledWith(expect.objectContaining({
                search: 'knapsack', category: 'Graph', difficultyMin: 1000, difficultyMax: 2000,
                sort: 'difficulty', order: 'desc', author: 'Alice', collection: 7, limit: 20,
            }));
            fireEvent.click(screen.getAllByRole('link', { name: 'New' })[0]);
            fireEvent.click(screen.getByRole('button', { name: 'Back to problems' }));
            await waitFor(() => expect(screen.getByLabelText('Author')).toHaveValue('Alice'));
            expect(screen.getByTestId('location').textContent).toContain('keep=yes');
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
            fireEvent.change(screen.getByLabelText('Author'), { target: { value: 'Bob' } });
            fireEvent.change(screen.getByLabelText('Collection'), { target: { value: '7' } });
            fireEvent.change(screen.getByLabelText('Difficulty minimum'), { target: { value: '1000' } });
            fireEvent.change(screen.getByLabelText('Difficulty maximum'), { target: { value: '2000' } });
            fireEvent.change(screen.getByLabelText('Sort problems'), { target: { value: 'difficulty-desc' } });
            fireEvent.click(screen.getByRole('tab', { name: /^Greedy/ }));
            fireEvent.change(screen.getByLabelText('Search problems'), { target: { value: 'knapsack' } });
            await waitFor(() => {
                const params = new URLSearchParams(screen.getByTestId('location').textContent || '');
                expect(params.get('keep')).toBe('yes');
                expect(params.get('author')).toBe('Bob');
                expect(params.get('collection')).toBe('7');
                expect(params.get('difficultyMin')).toBe('1000');
                expect(params.get('difficultyMax')).toBe('2000');
                expect(params.get('sort')).toBe('difficulty-desc');
                expect(params.get('category')).toBe('Greedy');
                expect(params.get('search')).toBe('knapsack');
            });
            fireEvent.click(screen.getAllByRole('link', { name: 'New' })[0]);
            fireEvent.click(screen.getByRole('button', { name: 'Back to problems' }));
            await waitFor(() => expect(screen.getByLabelText('Author')).toHaveValue('Bob'));
            expect(screen.getByLabelText('Collection')).toHaveValue('7');
            expect(screen.getByLabelText('Difficulty minimum')).toHaveValue('1000');
            expect(screen.getByLabelText('Difficulty maximum')).toHaveValue('2000');
            expect(screen.getByLabelText('Sort problems')).toHaveValue('difficulty-desc');
            expect(screen.getByRole('tab', { name: /^Greedy/ })).toHaveAttribute('aria-selected', 'true');
            expect(screen.getByLabelText('Search problems')).toHaveValue('knapsack');
            fireEvent.click(screen.getByRole('button', { name: 'Back to problems' }));
            // A history Back from the filtered list should reach the landing entry,
            // not a trail of intermediate filter edits.
            await waitFor(() => expect(screen.getByText('Landing page')).toBeInTheDocument());
        });

        it('keeps text typed just before navigation without sending an early search request', async () => {
            const mock = jest.mocked(problemService.getProblemsPage) as jest.Mock;
            mock.mockResolvedValue(firstPage);
            render(
                <MemoryRouter initialEntries={['/problems?keep=yes']}>
                    <LocationProbe />
                    <Routes>
                        <Route path="/problems" element={<Problems />} />
                        <Route path="/problems/:problemId" element={<DetailWithBack />} />
                    </Routes>
                </MemoryRouter>,
            );
            await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());
            mock.mockClear();
            fireEvent.change(screen.getByLabelText('Search problems'), { target: { value: 'very quick' } });
            fireEvent.change(screen.getByLabelText('Author'), { target: { value: 'Writer Without Account' } });
            expect(mock).not.toHaveBeenCalled();
            fireEvent.click(screen.getAllByRole('link', { name: 'New' })[0]);
            fireEvent.click(screen.getByRole('button', { name: 'Back to problems' }));
            await waitFor(() => expect(screen.getByLabelText('Search problems')).toHaveValue('very quick'));
            expect(screen.getByLabelText('Author')).toHaveValue('Writer Without Account');
            expect(screen.getByTestId('location').textContent).toContain('search=very+quick');
            expect(screen.getByTestId('location').textContent).toContain('author=Writer+Without+Account');
            expect(screen.getByTestId('location').textContent).toContain('keep=yes');
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
            fireEvent.click(screen.getByRole('tab', { name: /^Greedy/ }));

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
            fireEvent.click(screen.getByRole('tab', { name: /^Greedy/ }));

            await waitFor(() => {
                expect(mock).toHaveBeenLastCalledWith({ search: 'knapsack', category: 'Greedy', sort: 'difficulty', order: 'asc', limit: 20 });
            }, { timeout: 2000 });
            await waitFor(() => expect(screen.getByText('Greedy One')).toBeInTheDocument());
            expect(screen.queryByText('LIS')).not.toBeInTheDocument();
            expect(document.activeElement).toBe(input);
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
