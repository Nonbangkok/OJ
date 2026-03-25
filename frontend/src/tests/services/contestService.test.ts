import api from '../../services/api';
import contestService from '../../services/contestService';

jest.mock('../../services/api');

describe('Contest Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('getAll fetches contests', async () => {
        const mockData = [{
            id: 1,
            title: 'A contest',
            description: null,
            start_time: '2026-01-01T00:00:00.000Z',
            end_time: '2026-01-01T01:00:00.000Z',
            status: 'scheduled' as const
        }];
        jest.mocked(api.get).mockResolvedValueOnce({ data: mockData });

        const result = await contestService.getAll();

        expect(api.get).toHaveBeenCalledWith('/contests');
        expect(result).toEqual(mockData);
    });

    it('getById fetches a single contest', async () => {
        const mockData = {
            id: 1,
            title: 'Test Contest',
            description: null,
            start_time: '2026-01-01T00:00:00.000Z',
            end_time: '2026-01-01T01:00:00.000Z',
            status: 'running' as const
        };
        jest.mocked(api.get).mockResolvedValueOnce({ data: mockData });

        const result = await contestService.getById('1');

        expect(api.get).toHaveBeenCalledWith('/contests/1');
        expect(result).toEqual(mockData);
    });

    it('join posts join request', async () => {
        const mockData = { message: 'Joined' };
        jest.mocked(api.post).mockResolvedValueOnce({ data: mockData });

        const result = await contestService.join('1');

        expect(api.post).toHaveBeenCalledWith('/contests/1/join');
        expect(result).toEqual(mockData);
    });

    it('getProblems fetches contest problems', async () => {
        const mockData = [{ id: 'P1', title: 'Problem 1', author: null }];
        jest.mocked(api.get).mockResolvedValueOnce({ data: mockData });

        const result = await contestService.getProblems('contest-1');

        expect(api.get).toHaveBeenCalledWith('/contests/contest-1/problems');
        expect(result).toEqual(mockData);
    });

    it('getScoreboard fetches contest scoreboard', async () => {
        const mockData = {
            scoreboard: [{
                user_id: 1,
                username: 'user1',
                total_score: 100,
                detailed_scores: {},
                last_score_improvement_time: null
            }],
            problems: [{ id: 'P1', title: 'Problem 1', author: null, problem_id: 'P1' }],
        };
        jest.mocked(api.get).mockResolvedValueOnce({ data: mockData });

        const result = await contestService.getScoreboard('contest-1');

        expect(api.get).toHaveBeenCalledWith('/contests/contest-1/scoreboard');
        expect(result).toEqual(mockData);
    });
});
