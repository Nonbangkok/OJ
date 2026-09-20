import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import UserProfile from '../../pages/user/UserProfile';
import userService from '../../services/userService';
import { useAuth } from '../../context/AuthContext';

jest.mock('../../services/userService');
jest.mock('../../context/AuthContext');

// Mock LoadingPage to control the loading text
jest.mock('../../components/shared/LoadingPage', () => () => <div>Loading Profile...</div>);

const profileData = {
    id: 3,
    username: 'tester',
    role: 'user' as const,
    hasAvatar: false,
    avatarUpdatedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    problemsAttempted: 4,
    problemsSolved: 2,
    totalScore: 250,
    submissionCount: 9,
    verdictCounts: { Accepted: 3, 'Wrong Answer': 5 },
    languageCounts: { cpp: 9 },
    dailyActivity: [{ day: '2026-09-18', count: 2 }],
    currentStreak: 4,
    longestStreak: 11,
    lastAcDate: '2026-09-21',
    achievements: {
        unlocked: [
            { id: 'first_solve', name: 'First Solve', description: 'Solve your first problem' },
        ],
        stats: {
            problemsSolved: 2,
            currentStreak: 4,
            longestStreak: 11,
            languagesSolvedIn: { cpp: 3 },
            contestsJoined: 0,
        },
    },
};

const renderPage = () =>
    render(
        <MemoryRouter initialEntries={['/profile/tester']}>
            <Routes>
                <Route path="/profile/:username" element={<UserProfile />} />
            </Routes>
        </MemoryRouter>,
    );

describe('User Profile Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(useAuth).mockReturnValue({
            user: null,
            isLoading: false,
            login: jest.fn(),
            logout: jest.fn(),
        });
    });

    it('renders loading state initially', () => {
        jest.mocked(userService.getProfile).mockReturnValue(new Promise(() => { }));
        renderPage();
        expect(screen.getByText(/loading profile\.\.\.$/i)).toBeInTheDocument();
    });

    it('displays profile stats on success', async () => {
        jest.mocked(userService.getProfile).mockResolvedValueOnce(profileData);

        renderPage();

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'tester' })).toBeInTheDocument();
            expect(screen.getByText((content, element) =>
                element?.className.includes('stat-value') === true && content === '2')).toBeInTheDocument(); // solved
            expect(screen.getByText((content, element) =>
                element?.className.includes('stat-value') === true && content === '4')).toBeInTheDocument(); // attempted
            expect(screen.getByText((content, element) =>
                element?.className.includes('stat-value') === true && content === '250')).toBeInTheDocument(); // total score
        });
        expect(userService.getProfile).toHaveBeenCalledWith('tester');
        expect(jest.mocked(userService.getProfile).mock.calls[0][0]).toBe('tester');
    });

    it('renders one heatmap cell per day of the activity window', async () => {
        jest.mocked(userService.getProfile).mockResolvedValueOnce(profileData);

        renderPage();

        await waitFor(() => {
            // Cells for days that have already happened carry a title; the window
            // ends on the current week's Saturday, so a few trailing future cells
            // are intentionally title-less. Count by how many days remain today.
            const cells = screen.getAllByTitle(/20\d\d-\d\d-\d\d/);
            const today = new Date();
            const end = new Date(today);
            end.setDate(end.getDate() + (6 - end.getDay()));
            const futureDays = Math.max(0, Math.ceil((end.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)));
            expect(cells.length).toBe(365 - futureDays);
            const active = screen.getByTitle('2026-09-18: 2 submissions');
            expect(active).toBeInTheDocument();
        });
    });

    it('shows the avatar upload button only on your own profile', async () => {
        jest.mocked(userService.getProfile).mockResolvedValue(profileData);

        jest.mocked(useAuth).mockReturnValue({
            user: { id: 7, username: 'someoneelse', role: 'user', hasAvatar: false },
            isLoading: false,
            login: jest.fn(),
            logout: jest.fn(),
        });
        renderPage();
        await waitFor(() => expect(screen.getByRole('heading', { name: /tester/ })).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: /change avatar/i })).not.toBeInTheDocument();

        jest.mocked(useAuth).mockReturnValue({
            user: { id: 3, username: 'tester', role: 'user', hasAvatar: false },
            isLoading: false,
            login: jest.fn(),
            logout: jest.fn(),
        });
        renderPage();
        await waitFor(() => expect(screen.getByRole('button', { name: /change avatar/i })).toBeInTheDocument());
    });

    it('shows an error message when the profile cannot be loaded', async () => {
        jest.mocked(userService.getProfile).mockRejectedValueOnce(new Error('Not found'));

        renderPage();

        await waitFor(() => {
            expect(screen.getByText(/failed to load profile/i)).toBeInTheDocument();
        });
    });

    it('renders the streak panel with current and longest streak', async () => {
        jest.mocked(userService.getProfile).mockResolvedValueOnce(profileData);

        renderPage();

        await waitFor(() => {
            const streakPanel = document.querySelector('div[class*="streak-panel"]');
            expect(streakPanel).toBeTruthy();
            expect(within(streakPanel as HTMLElement).getByText('4')).toBeInTheDocument();
        });
        expect(screen.getByText(/day streak/i)).toBeInTheDocument();
        expect(screen.getByText(/longest streak/i)).toBeInTheDocument();
        const longest = document.querySelector('span[class*="streak-longest"]');
        expect(within(longest as HTMLElement).getByText('11')).toBeInTheDocument();
    });

    it('renders every achievement with locked and unlocked states', async () => {
        jest.mocked(userService.getProfile).mockResolvedValueOnce(profileData);

        renderPage();

        await waitFor(() => {
            expect(screen.getByText('First Solve')).toBeInTheDocument();
        });

        // Unlocked card: name and description, no progress label.
        expect(screen.getByText('Solve your first problem')).toBeInTheDocument();

        // Locked cards carry the locked state and a progress label.
        const centuryCard = screen.getByText('Century').closest('div[class*="achievement-card"]');
        expect(centuryCard).toBeTruthy();
        expect(centuryCard?.className).toContain('locked');
        expect(within(centuryCard as HTMLElement).getByText('2/100 problems')).toBeInTheDocument();
        expect(within(centuryCard as HTMLElement).getByText('locked', { exact: false })).toBeInTheDocument();

        // The unlocked card is not marked locked (locked is its own token).
        const firstSolveCard = screen.getByText('First Solve').closest('div[class*="achievement-card"]');
        expect(firstSolveCard?.className).not.toMatch(/\blocked\b/);

        // All eight catalog entries render.
        for (const name of ['Getting Started', 'Problem Grinder', 'Century', 'On Fire', 'Unstoppable', 'Polyglot', 'Contester']) {
            expect(screen.getByText(name)).toBeInTheDocument();
        }
    });
});
