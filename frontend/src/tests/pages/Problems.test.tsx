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

const categorizedProblems = [
    { id: 'dp-1', title: 'Knapsack', author: null, categories: ['Dynamic Programming'], best_score: 100 },
    { id: 'dp-2', title: 'LIS', author: null, categories: ['Dynamic Programming', 'Data Structures'], best_score: 50 },
    { id: 'gr-1', title: 'Greedy Slots', author: null, categories: ['Greedy'], best_score: null },
    { id: 'pl-1', title: 'Plain Problem', author: null, categories: [], best_score: null },
];

describe('Problems Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders loading state initially', () => {
        (jest.mocked(problemService.getAllWithStats) as jest.Mock).mockReturnValueOnce(new Promise(() => { }));
        render(<BrowserRouter><Problems /></BrowserRouter>);
        expect(screen.getByText(/loading problems\.\.\.$/i)).toBeInTheDocument();
    });

    it('displays problems after fetching', async () => {
        const mockProblems = [
            { id: '1', title: 'Problem 1', author: null, difficulty: 'easy', time_limit_ms: 1000, memory_limit_mb: 256, best_score: 100 }
        ];
        (jest.mocked(problemService.getAllWithStats) as jest.Mock).mockResolvedValueOnce(mockProblems);

        render(<BrowserRouter><Problems /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText('Problem 1')).toBeInTheDocument();
        });
    });

    it('displays error if fetch fails', async () => {
        (jest.mocked(problemService.getAllWithStats) as jest.Mock).mockRejectedValueOnce(new Error('Fetch failed'));

        render(<BrowserRouter><Problems /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText(/failed to fetch problems/i)).toBeInTheDocument();
        });
    });

    it('shows a category tab per category with counts and an Uncategorized bucket', async () => {
        (jest.mocked(problemService.getAllWithStats) as jest.Mock).mockResolvedValueOnce(categorizedProblems);

        render(<BrowserRouter><Problems /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByRole('tab', { name: /All 4/ })).toBeInTheDocument();
        });
        expect(screen.getByRole('tab', { name: /Dynamic Programming 2/ })).toBeInTheDocument();
        // A problem carrying two categories counts toward both tabs.
        expect(screen.getByRole('tab', { name: /Data Structures 1/ })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Greedy 1/ })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Uncategorized 1/ })).toBeInTheDocument();
    });

    it('filters the list to the selected category', async () => {
        (jest.mocked(problemService.getAllWithStats) as jest.Mock).mockResolvedValueOnce(categorizedProblems);

        render(<BrowserRouter><Problems /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText('Knapsack')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('tab', { name: /Greedy/ }));

        expect(screen.queryByText('Knapsack')).not.toBeInTheDocument();
        expect(screen.getByText('Greedy Slots')).toBeInTheDocument();
    });

    it('shows a problem in every one of its category tabs', async () => {
        (jest.mocked(problemService.getAllWithStats) as jest.Mock).mockResolvedValueOnce(categorizedProblems);

        render(<BrowserRouter><Problems /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText('LIS')).toBeInTheDocument();
        });

        // LIS carries both categories, so both tabs include it.
        fireEvent.click(screen.getByRole('tab', { name: /^Dynamic Programming/ }));
        expect(screen.getByText('LIS')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', { name: /^Data Structures/ }));
        expect(screen.getByText('LIS')).toBeInTheDocument();
    });

    it('hides category badges by default (spoiler-free) and shows only the selected one when filtered', async () => {
        (jest.mocked(problemService.getAllWithStats) as jest.Mock).mockResolvedValueOnce(categorizedProblems);

        render(<BrowserRouter><Problems /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText('Knapsack')).toBeInTheDocument();
        });

        // Default "All" view: no badge text anywhere on the cards —
        // categories can reveal problem content, so they stay hidden.
        expect(screen.queryByText('Dynamic Programming', { selector: 'span' })).not.toBeInTheDocument();
        expect(screen.queryByText('Greedy', { selector: 'span' })).not.toBeInTheDocument();

        // Selecting a category reveals ONLY that category's badge.
        fireEvent.click(screen.getByRole('tab', { name: /^Dynamic Programming/ }));
        // Knapsack (single category) and LIS (two categories) both show the
        // selected one; LIS's other category stays hidden.
        const badges = screen.getAllByText('Dynamic Programming', { selector: 'span' });
        expect(badges).toHaveLength(2);
        expect(screen.queryByText('Data Structures', { selector: 'span' })).not.toBeInTheDocument();

        // Switching to the Greedy tab swaps which badge shows.
        fireEvent.click(screen.getByRole('tab', { name: /^Greedy/ }));
        expect(screen.getByText('Greedy', { selector: 'span' })).toBeInTheDocument();
        expect(screen.queryByText('Dynamic Programming', { selector: 'span' })).not.toBeInTheDocument();
    });

    it('filters the list by search text across title and id', async () => {
        (jest.mocked(problemService.getAllWithStats) as jest.Mock).mockResolvedValueOnce(categorizedProblems);

        render(<BrowserRouter><Problems /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByText('Knapsack')).toBeInTheDocument();
        });

        fireEvent.change(screen.getByLabelText('Search problems'), { target: { value: 'lis' } });

        expect(screen.queryByText('Knapsack')).not.toBeInTheDocument();
        expect(screen.getByText('LIS')).toBeInTheDocument();
    });

    describe('difficulty filter & sort', () => {
        const ratedProblems = [
            { id: 'a-easy', title: 'Easy One', author: null, categories: [], difficulty: 800 },
            { id: 'b-mid', title: 'Middle One', author: null, categories: [], difficulty: 1500 },
            { id: 'c-hard', title: 'Hard One', author: null, categories: [], difficulty: 2500 },
            { id: 'd-unrated', title: 'Unrated One', author: null, categories: [], difficulty: null },
        ];

        /** Emulates the backend: no filter -> Unrated included, ordered by id;
         *  min/max filter -> Unrated excluded; difficulty sort -> NULLS LAST. */
        const emulateBackend = (query: Record<string, unknown> = {}) => {
            let rows = [...ratedProblems];
            const q = query as { difficultyMin?: number; difficultyMax?: number; sort?: string; order?: string };
            if (q.difficultyMin !== undefined) {
                rows = rows.filter(p => p.difficulty !== null && p.difficulty >= (q.difficultyMin as number));
            }
            if (q.difficultyMax !== undefined) {
                rows = rows.filter(p => p.difficulty !== null && p.difficulty <= (q.difficultyMax as number));
            }
            if (q.sort === 'difficulty') {
                const rated = rows
                    .filter(p => p.difficulty !== null)
                    .sort((a, b) => q.order === 'desc' ? (b.difficulty as number) - (a.difficulty as number) : (a.difficulty as number) - (b.difficulty as number));
                const unrated = rows.filter(p => p.difficulty === null);
                rows = [...rated, ...unrated];
            }
            return rows;
        };

        // The implementation is set inside each test, not in beforeEach: the
        // shared suite's earlier tests leave once-queued values behind, and a
        // per-test implementation is immune to that leftover state.
        const useBackend = () => {
            const mock = jest.mocked(problemService.getAllWithStats) as jest.Mock;
            mock.mockImplementation(((query: Record<string, unknown> = {}) =>
                Promise.resolve(emulateBackend(query))) as never);
            return mock;
        };

        it('shows every problem including Unrated when no difficulty filter is set', async () => {
            const mock = useBackend();
            render(<BrowserRouter><Problems /></BrowserRouter>);

            await waitFor(() => {
                expect(screen.getByText('Easy One')).toBeInTheDocument();
            });
            expect(screen.getByText('Unrated One')).toBeInTheDocument();
            expect(screen.getAllByRole('heading', { level: 3 }).length).toBe(4);
            // The default request carries no difficulty params at all.
            expect(mock).toHaveBeenLastCalledWith({});
        });

        it('filters by difficulty min and max, excluding Unrated', async () => {
            const mock = useBackend();
            render(<BrowserRouter><Problems /></BrowserRouter>);

            await waitFor(() => {
                expect(screen.getByText('Easy One')).toBeInTheDocument();
            });

            fireEvent.change(screen.getByLabelText('Difficulty minimum'), { target: { value: '1000' } });

            await waitFor(() => {
                expect(screen.getByText('Middle One')).toBeInTheDocument();
            });
            expect(screen.getByText('Hard One')).toBeInTheDocument();
            expect(screen.queryByText('Easy One')).not.toBeInTheDocument();
            expect(screen.queryByText('Unrated One')).not.toBeInTheDocument();
            expect(mock).toHaveBeenLastCalledWith({ difficultyMin: 1000 });

            fireEvent.change(screen.getByLabelText('Difficulty maximum'), { target: { value: '2000' } });

            await waitFor(() => {
                expect(screen.queryByText('Hard One')).not.toBeInTheDocument();
            });
            expect(screen.getByText('Middle One')).toBeInTheDocument();
            expect(mock).toHaveBeenLastCalledWith({ difficultyMin: 1000, difficultyMax: 2000 });
        });

        it('sorts by difficulty, requesting NULLS LAST in both directions', async () => {
            const mock = useBackend();
            render(<BrowserRouter><Problems /></BrowserRouter>);

            await waitFor(() => {
                expect(screen.getByText('Easy One')).toBeInTheDocument();
            });

            fireEvent.change(screen.getByLabelText('Sort problems'), { target: { value: 'difficulty-asc' } });
            await waitFor(() => {
                expect(mock).toHaveBeenLastCalledWith({ sort: 'difficulty', order: 'asc' });
            });

            fireEvent.change(screen.getByLabelText('Sort problems'), { target: { value: 'difficulty-desc' } });
            await waitFor(() => {
                expect(mock).toHaveBeenLastCalledWith({ sort: 'difficulty', order: 'desc' });
            });
        });

        it('clearing the difficulty filter restores the default view', async () => {
            const mock = useBackend();
            render(<BrowserRouter><Problems /></BrowserRouter>);

            await waitFor(() => {
                expect(screen.getByText('Easy One')).toBeInTheDocument();
            });

            fireEvent.change(screen.getByLabelText('Difficulty minimum'), { target: { value: '1000' } });
            await waitFor(() => {
                expect(screen.queryByText('Easy One')).not.toBeInTheDocument();
            });

            fireEvent.change(screen.getByLabelText('Difficulty minimum'), { target: { value: '' } });
            await waitFor(() => {
                expect(screen.getByText('Easy One')).toBeInTheDocument();
            });
            expect(screen.getByText('Unrated One')).toBeInTheDocument();
            expect(mock).toHaveBeenLastCalledWith({});
        });
    });
});
