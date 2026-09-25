import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
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

describe('Problems Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (jest.mocked(problemService.getCategoryCounts) as jest.Mock).mockResolvedValue(categoryCounts);
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
        // The initial request asks for exactly one batch.
        expect(problemService.getProblemsPage).toHaveBeenLastCalledWith({ limit: 20 });
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
            expect(problemService.getProblemsPage).toHaveBeenLastCalledWith({ limit: 20, cursor: 'cur-1' });
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
                expect(problemService.getProblemsPage).toHaveBeenLastCalledWith({ category: 'Greedy', limit: 20 });
            });
        });

        it('the Uncategorized tab filters with the Uncategorized sentinel', async () => {
            (jest.mocked(problemService.getProblemsPage) as jest.Mock).mockResolvedValue(firstPage);

            renderProblems();
            await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());

            fireEvent.click(screen.getByRole('tab', { name: /^Uncategorized/ }));

            await waitFor(() => {
                expect(problemService.getProblemsPage).toHaveBeenLastCalledWith({ category: 'Uncategorized', limit: 20 });
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
            // The default request carries only the batch size.
            expect(mock).toHaveBeenLastCalledWith({ limit: 20 });
        });

        it('sends difficulty min and max as server-side params', async () => {
            const mock = (jest.mocked(problemService.getProblemsPage) as jest.Mock);
            mock.mockResolvedValue(firstPage);
            renderProblems();
            await waitFor(() => expect(screen.getByText('Knapsack')).toBeInTheDocument());

            fireEvent.change(screen.getByLabelText('Difficulty minimum'), { target: { value: '1000' } });

            await waitFor(() => {
                expect(mock).toHaveBeenLastCalledWith({ difficultyMin: 1000, limit: 20 });
            });

            fireEvent.change(screen.getByLabelText('Difficulty maximum'), { target: { value: '2000' } });

            await waitFor(() => {
                expect(mock).toHaveBeenLastCalledWith({ difficultyMin: 1000, difficultyMax: 2000, limit: 20 });
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
                expect(mock).toHaveBeenLastCalledWith({ search: 'kna', limit: 20 });
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
});
