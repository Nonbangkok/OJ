import api from '../../services/api';
import contestService from '../../services/contestService';

jest.mock('../../services/api');

describe('Contest Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('getAll fetches contests', async () => {
        const mockData = [{ id: 1, title: 'A contest' }];
        api.get.mockResolvedValueOnce({ data: mockData });

        const result = await contestService.getAll();

        expect(api.get).toHaveBeenCalledWith('/contests');
        expect(result).toEqual(mockData);
    });

    it('getById fetches a single contest', async () => {
        const mockData = { id: 1, title: 'Test Contest', status: 'running' };
        api.get.mockResolvedValueOnce({ data: mockData });

        const result = await contestService.getById('1');

        expect(api.get).toHaveBeenCalledWith('/contests/1');
        expect(result).toEqual(mockData);
    });

    it('join posts join request', async () => {
        const mockData = { success: true };
        api.post.mockResolvedValueOnce({ data: mockData });

        const result = await contestService.join('1');

        expect(api.post).toHaveBeenCalledWith('/contests/1/join');
        expect(result).toEqual(mockData);
    });

    it('getProblems fetches contest problems', async () => {
        const mockData = [{ id: 'P1', title: 'Problem 1' }];
        api.get.mockResolvedValueOnce({ data: mockData });

        const result = await contestService.getProblems('contest-1');

        expect(api.get).toHaveBeenCalledWith('/contests/contest-1/problems');
        expect(result).toEqual(mockData);
    });

    it('getScoreboard fetches contest scoreboard', async () => {
        const mockData = [{ username: 'user1', total_score: 100 }];
        api.get.mockResolvedValueOnce({ data: mockData });

        const result = await contestService.getScoreboard('contest-1');

        expect(api.get).toHaveBeenCalledWith('/contests/contest-1/scoreboard');
        expect(result).toEqual(mockData);
    });
});
