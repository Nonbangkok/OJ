import api from '../../services/api';
import scoreboardService from '../../services/scoreboardService';

jest.mock('../../services/api');

describe('Scoreboard Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('getRanking fetches one page of the XP ranking for a window', async () => {
        const ranking = { rows: [], total: 0, page: 2, pageSize: 50, window: 'week', viewer: null };
        jest.mocked(api.get).mockResolvedValueOnce({ data: ranking });

        await expect(scoreboardService.getRanking('week', 2)).resolves.toEqual(ranking);
        expect(api.get).toHaveBeenCalledWith('/scoreboard', { params: { window: 'week', page: 2 } });
    });

    it('getGlobal adapts the first all-time ranking page to the legacy entries', async () => {
        jest.mocked(api.get).mockResolvedValueOnce({ data: {
            rows: [{ rank: 1, username: 'user1', hasAvatar: true, xp: 340, solved: 5, level: 2, tier: 'Novice' }],
            total: 1, page: 1, pageSize: 50, window: 'all', viewer: null,
        } });

        const result = await scoreboardService.getGlobal();

        expect(api.get).toHaveBeenCalledWith('/scoreboard', { params: { window: 'all', page: 1 } });
        expect(result).toEqual([{ username: 'user1', has_avatar: true, total_score: 340, problems_solved: 5 }]);
    });
});
