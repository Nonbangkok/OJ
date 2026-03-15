import api from '../../services/api';
import problemService from '../../services/problemService';

jest.mock('../../services/api', () => ({
    get: jest.fn(),
    defaults: {
        baseURL: 'http://localhost:5000/api'
    }
}));

describe('Problem Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('getAllWithStats fetches problems with stats', async () => {
        const mockData = [{ id: 1, title: 'A problem', best_score: 100 }];
        api.get.mockResolvedValueOnce({ data: mockData });

        const result = await problemService.getAllWithStats();

        expect(api.get).toHaveBeenCalledWith('/problems-with-stats');
        expect(result).toEqual(mockData);
    });

    it('getDetails fetches a single problem', async () => {
        const mockData = { id: 1, title: 'A problem', time_limit_ms: 1000 };
        api.get.mockResolvedValueOnce({ data: mockData });

        const result = await problemService.getDetails('1');

        expect(api.get).toHaveBeenCalledWith('/problems/1');
        expect(result).toEqual(mockData);
    });

    it('getContestProblemDetails fetches contest problem', async () => {
        const mockData = { id: 'P1', title: 'Contest Problem' };
        api.get.mockResolvedValueOnce({ data: mockData });

        const result = await problemService.getContestProblemDetails('contest-1', 'P1');

        expect(api.get).toHaveBeenCalledWith('/contests/contest-1/problems/P1');
        expect(result).toEqual(mockData);
    });

    it('getPdfUrl returns global problem PDF URL when no contestId', () => {
        const url = problemService.getPdfUrl('P1');

        expect(url).toBe('http://localhost:5000/api/problems/P1/pdf');
    });

    it('getPdfUrl returns contest problem PDF URL when contestId provided', () => {
        const url = problemService.getPdfUrl('P1', 'contest-1');

        expect(url).toBe('http://localhost:5000/api/contests/contest-1/problems/P1/pdf');
    });
});
