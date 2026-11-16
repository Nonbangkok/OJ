import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import UserProfile from '../../pages/user/UserProfile';
import userService from '../../services/userService';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';

jest.mock('../../services/userService');
jest.mock('../../context/AuthContext');
jest.mock('../../context/SettingsContext');

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
    categoryStats: [
        { category: 'Dynamic Programming', solved: 4, total: 6, percentage: 66.7 },
        { category: 'Math', solved: 4, total: 4, percentage: 100 },
        { category: 'Binary Search', solved: 2, total: 3, percentage: 66.7 },
        { category: 'Graph', solved: 0, total: 5, percentage: 0 },
        { category: 'Uncategorized', solved: 1, total: 2, percentage: 50 },
    ],
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
    progression: {
        totalXp: 2840,
        level: 6,
        tier: 'Apprentice',
        levelProgress: { current: 340, required: 500, remaining: 160, percentage: 68 },
        globalRank: 3,
    },
    recentRewards: [
        {
            problemId: 'bs-on-ans',
            problemTitle: 'Binary Search on Ans',
            xpAwarded: 46,
            difficultySnapshot: 1400,
            awardedAt: '2026-09-20T10:00:00.000Z',
        },
        {
            problemId: 'stock-span',
            problemTitle: 'Stock Span',
            xpAwarded: 37,
            difficultySnapshot: 1200,
            awardedAt: '2026-09-19T09:00:00.000Z',
        },
    ],
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
            refreshUser: jest.fn(),
        });
        jest.mocked(useSettings).mockReturnValue({
            registrationEnabled: true,
            accessMode: 'public',
            passwordChangeEnabled: true,
            isPrivateMode: false,
            isLoading: false,
            refreshSettings: jest.fn(),
        });
    });

    it('renders loading state initially', () => {
        jest.mocked(userService.getProfile).mockReturnValue(new Promise(() => { }));
        renderPage();
        expect(screen.getByText(/loading profile\.\.\.$/i)).toBeInTheDocument();
    });

    it('shows the loading state again and fetches once when navigating to another profile', async () => {
        const GoToOther = () => {
            const navigate = useNavigate();
            return <button type="button" onClick={() => navigate('/profile/other')}>go-other</button>;
        };
        let resolveOther: (value: typeof profileData) => void = () => {};
        jest.mocked(userService.getProfile)
            .mockResolvedValueOnce(profileData)
            .mockReturnValueOnce(new Promise((resolve) => { resolveOther = resolve; }));

        render(
            <MemoryRouter initialEntries={['/profile/tester']}>
                <GoToOther />
                <Routes>
                    <Route path="/profile/:username" element={<UserProfile />} />
                </Routes>
            </MemoryRouter>,
        );
        // Two full profile renders: allow for a slow, loaded CI worker.
        expect(await screen.findByRole('heading', { name: 'tester' }, { timeout: 10000 })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'go-other' }));
        expect(screen.getByText(/loading profile\.\.\.$/i)).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'tester' })).not.toBeInTheDocument();

        resolveOther({ ...profileData, username: 'other' });
        expect(await screen.findByRole('heading', { name: 'other' }, { timeout: 10000 })).toBeInTheDocument();
        expect(jest.mocked(userService.getProfile).mock.calls.map((call) => call[0])).toEqual(['tester', 'other']);
    }, 30000);

    it('stat row shows solved, attempted, submissions, current and best run', async () => {
        jest.mocked(userService.getProfile).mockResolvedValueOnce(profileData);

        renderPage();

        const stats = await screen.findByRole('list', { name: 'Stats' });
        const value = (label: string) => within(stats).getByText(label).closest('li')?.querySelector('b')?.textContent;
        expect(value('Solved')).toBe('2');
        expect(value('Attempted')).toBe('4');
        expect(value('Submissions')).toBe('9');
        expect(value('Current run')).toBe('4 days');
        expect(value('Best run')).toBe('11 days');
        expect(within(stats).queryByText(/Total score|Solve rate/)).toBeNull();
        expect(userService.getProfile).toHaveBeenCalledWith('tester');
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

    it('shows the avatar change control only on your own profile', async () => {
        jest.mocked(userService.getProfile).mockResolvedValue(profileData);

        jest.mocked(useAuth).mockReturnValue({
            user: { id: 7, username: 'someoneelse', role: 'user', hasAvatar: false },
            isLoading: false,
            login: jest.fn(),
            logout: jest.fn(),
            refreshUser: jest.fn(),
        });
        renderPage();
        await waitFor(() => expect(screen.getByRole('heading', { name: /tester/ })).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: /change avatar/i })).not.toBeInTheDocument();

        jest.mocked(useAuth).mockReturnValue({
            user: { id: 3, username: 'tester', role: 'user', hasAvatar: false },
            isLoading: false,
            login: jest.fn(),
            logout: jest.fn(),
            refreshUser: jest.fn(),
        });
        renderPage();
        await waitFor(() => expect(screen.getByRole('button', { name: /change avatar/i })).toBeInTheDocument());
        const avatarButton = screen.getByRole('button', { name: /change avatar/i });

        // The button hosts the avatar (letter fallback here) and the hover overlay.
        expect(avatarButton.querySelector('span[class*="profile-avatar"]')).toBeInTheDocument();
        expect(avatarButton.querySelector('span[class*="avatar-overlay"]')).toBeInTheDocument();
    });

    it('opens the file picker when the avatar button is clicked', async () => {
        jest.mocked(userService.getProfile).mockResolvedValue(profileData);
        jest.mocked(useAuth).mockReturnValue({
            user: { id: 3, username: 'tester', role: 'user', hasAvatar: false },
            isLoading: false,
            login: jest.fn(),
            logout: jest.fn(),
            refreshUser: jest.fn(),
        });
        renderPage();

        const avatarButton = await screen.findByRole('button', { name: /change avatar/i });
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        expect(fileInput).toBeInTheDocument();

        // jsdom's HTMLInputElement has no .click(); stand in for it.
        const clickSpy = jest.spyOn(fileInput, 'click').mockImplementation(() => { });
        fireEvent.click(avatarButton);
        expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it('does not render a Change Password section on the profile (moved to the navbar menu)', async () => {
        jest.mocked(userService.getProfile).mockResolvedValue(profileData);
        jest.mocked(useAuth).mockReturnValue({
            user: { id: 3, username: 'tester', role: 'admin', hasAvatar: false },
            isLoading: false,
            login: jest.fn(),
            logout: jest.fn(),
            refreshUser: jest.fn(),
        });

        renderPage();
        await waitFor(() => expect(screen.getByRole('heading', { name: 'tester' })).toBeInTheDocument());

        // The profile page no longer owns password changing — regardless of
        // role or the password-change setting, nothing password-related
        // renders here (the navbar user menu is the single entry point).
        expect(screen.queryByRole('button', { name: /change password/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Account' })).not.toBeInTheDocument();
    });

    it('shows an error message when the profile cannot be loaded', async () => {
        jest.mocked(userService.getProfile).mockRejectedValueOnce(new Error('Not found'));

        renderPage();

        await waitFor(() => {
            expect(screen.getByText(/failed to load profile/i)).toBeInTheDocument();
        });
    });


    it('achievements show the next three locked by progress then unlocked', async () => {
        jest.mocked(userService.getProfile).mockResolvedValueOnce(profileData);

        renderPage();

        const section = await screen.findByRole('region', { name: 'Achievements' });
        const items = within(section).getAllByRole('listitem');
        const locked = items.filter((li) => li.getAttribute('data-state') === 'locked');
        const unlocked = items.filter((li) => li.getAttribute('data-state') === 'unlocked');
        expect(locked).toHaveLength(3);
        expect(unlocked.map((li) => li.querySelector('b')?.textContent)).toEqual(['First Solve']);
        const fractions = locked.map((li) => Number(li.getAttribute('data-progress')));
        expect([...fractions].sort((a, b) => b - a)).toEqual(fractions);
        expect(within(section).getByText('1 of 8 unlocked')).toBeInTheDocument();

        fireEvent.click(within(section).getByRole('button', { name: 'Show all' }));
        expect(within(section).getAllByRole('listitem')).toHaveLength(8);
    });

    it('renders the XP progression block in the identity card', async () => {
        jest.mocked(userService.getProfile).mockResolvedValueOnce(profileData);

        renderPage();

        await waitFor(() => {
            expect(screen.getByText('Apprentice · Lv 6')).toBeInTheDocument();
        });
        expect(screen.getByText('340 / 500 XP')).toBeInTheDocument();
        expect(screen.getByText('160 XP to Lv 7')).toBeInTheDocument();
        expect(screen.getByText('#3')).toBeInTheDocument();

        const bar = screen.getByRole('progressbar', { name: /XP to next level/ });
        expect(bar).toHaveAttribute('aria-valuenow', '340');
        expect(bar).toHaveAttribute('aria-valuemax', '500');
    });

    it('renders the Recently Solved list from reward history', async () => {
        jest.mocked(userService.getProfile).mockResolvedValueOnce(profileData);

        renderPage();

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Recently Solved' })).toBeInTheDocument();
        });

        // The title block links to the problem page.
        const titleLink = screen.getByRole('link', { name: /binary search on ans/i });
        expect(titleLink).toHaveAttribute('href', '/problems/bs-on-ans');
        expect(screen.getByText('Binary Search on Ans')).toBeInTheDocument();
        // Muted problem ID as the secondary line under the title.
        expect(screen.getByText('bs-on-ans')).toBeInTheDocument();

        // Difficulty chip: 1400 maps to band 2 and uses the band's chip style.
        const chip = screen.getByText('1400');
        expect(chip.className).toContain('difficulty-chip-2');

        expect(screen.getByText('+46 XP')).toBeInTheDocument();
        expect(screen.getByText('Stock Span')).toBeInTheDocument();
        expect(screen.getByText('+37 XP')).toBeInTheDocument();

        // Solved date, computed the same way the page formats it.
        const expectedDate = new Date('2026-09-20T10:00:00.000Z')
            .toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        expect(screen.getByText(expectedDate)).toBeInTheDocument();
    });

    it('hides the rank badge when the user has no rewards', async () => {
        jest.mocked(userService.getProfile).mockResolvedValueOnce({
            ...profileData,
            // Coherent empty account: no solves anywhere, so no rewards, no
            // rank, and no Recently Solved section either.
            problemsAttempted: 0,
            problemsSolved: 0,
            totalScore: 0,
            submissionCount: 0,
            verdictCounts: {},
            languageCounts: {},
            dailyActivity: [],
            currentStreak: 0,
            longestStreak: 0,
            lastAcDate: null,
            categoryStats: [],
            achievements: {
                unlocked: [],
                stats: {
                    problemsSolved: 0,
                    currentStreak: 0,
                    longestStreak: 0,
                    languagesSolvedIn: {},
                    contestsJoined: 0,
                },
            },
            progression: {
                totalXp: 0,
                level: 1,
                tier: 'Novice',
                levelProgress: { current: 0, required: 100, remaining: 100, percentage: 0 },
                globalRank: null,
            },
            recentRewards: [],
        });

        renderPage();

        await waitFor(() => {
            expect(screen.getByText(/^Novice · Lv/)).toBeInTheDocument();
        });
        expect(screen.queryByText('Global rank')).toBeNull();
        expect(screen.queryByText('Recently Solved')).toBeNull();
    });
});
