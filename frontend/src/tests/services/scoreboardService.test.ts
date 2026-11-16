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

});
