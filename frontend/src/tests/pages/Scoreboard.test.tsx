import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Scoreboard from '../../pages/scoreboard/Scoreboard';
import scoreboardService from '../../services/scoreboardService';
import type { GlobalRanking, RankingRow } from '../../types';

jest.mock('../../services/scoreboardService');

const row = (rank: number, username: string, xp: number): RankingRow =>
    ({ rank, username, hasAvatar: false, xp, solved: Math.round(xp / 100), level: 5, tier: 'Apprentice' });
const ranking = (over: Partial<GlobalRanking> = {}): GlobalRanking => ({
    rows: [row(1, 'khaopan', 44980), row(2, 'ploy.s', 40310), row(2, 'tonkla', 40310), row(4, 'mintra', 26140)],
    total: 4, page: 1, pageSize: 50, window: 'all', viewer: null, ...over,
});
const renderAt = (url = '/scoreboard') => render(<MemoryRouter initialEntries={[url]}><Scoreboard /></MemoryRouter>);

describe('Ranking page', () => {
    beforeEach(() => {
        jest.mocked(scoreboardService.getRanking).mockResolvedValue(ranking());
    });

    it('shows competition ranks from the server', async () => {
        renderAt();
        const table = await screen.findByRole('table', { name: 'Ranking' });
        await screen.findByRole('link', { name: 'khaopan' });
        const ranks = within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent);
        expect(ranks).toEqual(['1', '2', '2', '4']);
        expect(screen.getByText('Ranked by total XP · 4 students')).toBeInTheDocument();
        expect(scoreboardService.getRanking).toHaveBeenCalledWith('all', 1);
    });

    it('says "1 student" for a single ranked student', async () => {
        jest.mocked(scoreboardService.getRanking).mockResolvedValue(ranking({ total: 1 }));
        renderAt();
        expect(await screen.findByText('Ranked by total XP · 1 student')).toBeInTheDocument();
    });

    it('This week switches the window param', async () => {
        renderAt();
        await screen.findByRole('link', { name: 'khaopan' });
        fireEvent.click(screen.getByRole('button', { name: 'This week' }));
        await waitFor(() => expect(scoreboardService.getRanking).toHaveBeenLastCalledWith('week', 1));
        expect(screen.getByRole('button', { name: 'This week' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('pins the viewer row when it is not on the page', async () => {
        jest.mocked(scoreboardService.getRanking).mockResolvedValue(ranking({ viewer: row(214, 'nattapat', 1940), total: 1912 }));
        renderAt();
        const pinned = await screen.findByRole('region', { name: 'Your rank' });
        expect(within(pinned).getByText('#214')).toBeInTheDocument();
        expect(within(pinned).getByText('nattapat')).toBeInTheDocument();
    });

    it('highlights the viewer on the page instead of pinning', async () => {
        jest.mocked(scoreboardService.getRanking).mockResolvedValue(ranking({ viewer: row(4, 'mintra', 26140) }));
        renderAt();
        await screen.findByRole('link', { name: 'mintra' });
        expect(screen.queryByRole('region', { name: 'Your rank' })).toBeNull();
    });

    it('no pinned row for guests and no medal icons', async () => {
        renderAt();
        await screen.findByRole('link', { name: 'khaopan' });
        expect(screen.queryByRole('region', { name: 'Your rank' })).toBeNull();
        expect(document.querySelector('[data-medal]')).toBeNull();
        expect(screen.queryByLabelText(/medal/i)).toBeNull();
    });

    it('pages through 50 at a time', async () => {
        jest.mocked(scoreboardService.getRanking).mockResolvedValue(ranking({ total: 120 }));
        renderAt('/scoreboard?page=2');
        await screen.findByRole('link', { name: 'khaopan' });
        expect(scoreboardService.getRanking).toHaveBeenCalledWith('all', 2);
        expect(screen.getByText('51–100 of 120')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        await waitFor(() => expect(scoreboardService.getRanking).toHaveBeenLastCalledWith('all', 3));
    });

    it('shows an error with retry', async () => {
        jest.mocked(scoreboardService.getRanking).mockRejectedValueOnce(new Error('down'));
        renderAt();
        expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the ranking.");
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(await screen.findByRole('link', { name: 'khaopan' })).toBeInTheDocument();
    });
});
