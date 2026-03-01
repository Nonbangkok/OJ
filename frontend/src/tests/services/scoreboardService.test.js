import api from '../../services/api';
import scoreboardService from '../../services/scoreboardService';

jest.mock('../../services/api');

describe('Scoreboard Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('getGlobal fetches global scoreboard', async () => {
        const mockData = [
            { username: 'user1', total_score: 100, problems_solved: 5 },
            { username: 'user2', total_score: 80, problems_solved: 4 }
        ];
        api.get.mockResolvedValueOnce({ data: mockData });

        const result = await scoreboardService.getGlobal();

        expect(api.get).toHaveBeenCalledWith('/scoreboard');
        expect(result).toEqual(mockData);
    });
});
