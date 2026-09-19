import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import UsersTab from '../features/admin/analysis/UsersTab';
import UserDetail from '../features/admin/analysis/UserDetail';
import * as analyticsService from '../services/analyticsService';

jest.mock('../services/analyticsService');
jest.mock('recharts', () => ({
    ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => children ?? null,
    LineChart: () => null,
    BarChart: () => null,
    PieChart: () => null,
    Line: () => null,
    Bar: () => null,
    Pie: () => null,
    Cell: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Legend: () => null,
    CartesianGrid: () => null,
}));

const mockFetchUsers = analyticsService.fetchAnalyticsUsers as jest.MockedFunction<typeof analyticsService.fetchAnalyticsUsers>;
const mockFetchUserAnalytics = analyticsService.fetchUserAnalytics as jest.MockedFunction<typeof analyticsService.fetchUserAnalytics>;

const mockUsers = [
    {
        userId: 2,
        username: 'bob',
        role: 'user',
        submissions: 20,
        solved: 4,
        acRate: 0.5,
        lastActive: '2026-09-19T10:00:00Z',
    },
];

const mockUserAnalytics = {
    user: { id: 2, username: 'bob', role: 'user', createdAt: '2026-01-01T00:00:00Z' },
    kpis: { submissions: 20, solved: 4, attempted: 10, acRate: 0.2, totalScore: 400 },
    dailySeries: [{ day: '2026-09-19', count: 3 }],
    hourHistogram: [{ hour: 14, count: 5 }],
    verdictBreakdown: [{ verdict: 'Accepted', count: 4 }],
    languageBreakdown: [{ language: 'cpp', count: 20 }],
    cumulativeSolved: [{ day: '2026-09-19', solved: 4 }],
    solvedByCategory: [{ category: 'math', solved: 3, attempted: 5 }],
};

describe('UsersTab', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders the user table from the service', async () => {
        mockFetchUsers.mockResolvedValueOnce({ users: mockUsers });

        render(
            <BrowserRouter>
                <UsersTab onSelectUser={jest.fn()} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText('bob')).toBeInTheDocument());
        expect(screen.getByText('50%')).toBeInTheDocument();
        expect(mockFetchUsers).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, offset: 0 }));
    });

    it('triggers a search fetch with the typed term', async () => {
        mockFetchUsers.mockResolvedValue({ users: mockUsers });

        render(
            <BrowserRouter>
                <UsersTab onSelectUser={jest.fn()} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText('bob')).toBeInTheDocument());

        fireEvent.change(screen.getByRole('textbox', { name: /search/i }), { target: { value: 'bo' } });

        await waitFor(() => expect(mockFetchUsers).toHaveBeenCalledWith(expect.objectContaining({ search: 'bo' })));
    });

    it('calls onSelectUser when a row is clicked', async () => {
        mockFetchUsers.mockResolvedValueOnce({ users: mockUsers });
        const onSelectUser = jest.fn();

        render(
            <BrowserRouter>
                <UsersTab onSelectUser={onSelectUser} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText('bob')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /view.*bob/i }));

        expect(onSelectUser).toHaveBeenCalledWith(2);
    });

    it('paginates with Next and Prev', async () => {
        // A full page of users keeps the Next button enabled.
        const fullPage = Array.from({ length: 50 }, (_, i) => ({
            ...mockUsers[0],
            userId: i + 1,
            username: `user${i}`,
        }));
        mockFetchUsers.mockResolvedValue({ users: fullPage });

        render(
            <BrowserRouter>
                <UsersTab onSelectUser={jest.fn()} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText('user0')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /next/i }));
        await waitFor(() => expect(mockFetchUsers).toHaveBeenCalledWith(expect.objectContaining({ offset: 50 })));

        fireEvent.click(screen.getByRole('button', { name: /prev/i }));
        await waitFor(() => expect(mockFetchUsers).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 })));
    });
});

describe('UserDetail', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders the user analytics payload with a back button', async () => {
        mockFetchUserAnalytics.mockResolvedValueOnce(mockUserAnalytics);

        render(
            <BrowserRouter>
                <UserDetail userId={2} onBack={jest.fn()} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText('bob')).toBeInTheDocument());
        expect(screen.getByText('400')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
    });

    it('renders an error when the fetch fails', async () => {
        mockFetchUserAnalytics.mockRejectedValueOnce(new Error('boom'));

        render(
            <BrowserRouter>
                <UserDetail userId={2} onBack={jest.fn()} />
            </BrowserRouter>
        );

        await waitFor(() => expect(screen.getByText(/failed to load/i)).toBeInTheDocument());
    });
});
