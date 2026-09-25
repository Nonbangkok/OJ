import type { AxiosDefaults } from 'axios';
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
        const mockData = [{ id: 'P1', title: 'A problem', author: null, time_limit_ms: 1000, memory_limit_mb: 256, best_score: 100 }];
        jest.mocked(api.get).mockResolvedValueOnce({ data: { problems: mockData, nextCursor: null, hasMore: false } });

        const result = await problemService.getAllWithStats();

        expect(api.get).toHaveBeenCalledWith('/problems-with-stats', { params: { limit: 100, cursor: null } });
        expect(result).toEqual(mockData);
    });

    it('getAllWithStats stitches multiple pages into one list', async () => {
        const firstPage = [{ id: 'P1' }];
        const secondPage = [{ id: 'P2' }];
        jest.mocked(api.get)
            .mockResolvedValueOnce({ data: { problems: firstPage, nextCursor: 'cur-1', hasMore: true } })
            .mockResolvedValueOnce({ data: { problems: secondPage, nextCursor: null, hasMore: false } });

        const result = await problemService.getAllWithStats();

        expect(api.get).toHaveBeenCalledTimes(2);
        expect(api.get).toHaveBeenLastCalledWith('/problems-with-stats', {
            params: { limit: 100, cursor: 'cur-1' },
        });
        expect(result).toEqual([...firstPage, ...secondPage]);
    });

    it('getAllWithStats passes difficulty filter and sort params through', async () => {
        const mockData = [{ id: 'P1', title: 'A problem', author: null, difficulty: 1200 }];
        jest.mocked(api.get).mockResolvedValueOnce({ data: { problems: mockData, nextCursor: null, hasMore: false } });

        const result = await problemService.getAllWithStats({
            difficultyMin: 1000,
            difficultyMax: 2000,
            sort: 'difficulty',
            order: 'desc',
        });

        expect(api.get).toHaveBeenCalledWith('/problems-with-stats', {
            params: { difficultyMin: 1000, difficultyMax: 2000, sort: 'difficulty', order: 'desc', limit: 100, cursor: null },
        });
        expect(result).toEqual(mockData);
    });

    it('getAllWithStats stops stitching at the safety cap if the server never ends paging', async () => {
        // Every response claims another page: the loop must give up rather
        // than spin forever.
        jest.mocked(api.get).mockImplementation(async () => ({
            data: { problems: [{ id: 'P1' }], nextCursor: 'forever', hasMore: true },
        }));

        const result = await problemService.getAllWithStats();

        expect(api.get).toHaveBeenCalledTimes(100);
        expect(result).toHaveLength(100);
    });

    it('getProblemsPage sends the full query surface and returns the envelope', async () => {
        const envelope = { problems: [{ id: 'P1' }], nextCursor: 'next', hasMore: true };
        jest.mocked(api.get).mockResolvedValueOnce({ data: envelope });

        const result = await problemService.getProblemsPage({
            search: 'knapsack',
            category: 'Graph',
            difficultyMin: 1000,
            sort: 'difficulty',
            order: 'asc',
            limit: 20,
            cursor: 'cur',
        });

        expect(api.get).toHaveBeenCalledWith('/problems-with-stats', {
            params: {
                search: 'knapsack',
                category: 'Graph',
                difficultyMin: 1000,
                sort: 'difficulty',
                order: 'asc',
                limit: 20,
                cursor: 'cur',
            },
        });
        expect(result).toEqual(envelope);
    });

    it('getCategoryCounts fetches the global category tab counts', async () => {
        const counts = { categories: [{ name: 'Graph', count: 2 }], uncategorized: 1, total: 3 };
        jest.mocked(api.get).mockResolvedValueOnce({ data: counts });

        const result = await problemService.getCategoryCounts();

        expect(api.get).toHaveBeenCalledWith('/problems/categories');
        expect(result).toEqual(counts);
    });

    it('getDetails fetches a single problem', async () => {
        const mockData = { id: 'P1', title: 'A problem', author: null, time_limit_ms: 1000, memory_limit_mb: 256 };
        jest.mocked(api.get).mockResolvedValueOnce({ data: mockData });

        const result = await problemService.getDetails('1');

        expect(api.get).toHaveBeenCalledWith('/problems/1');
        expect(result).toEqual(mockData);
    });

    it('getContestProblemDetails fetches contest problem', async () => {
        const mockData = { id: 'P1', title: 'Contest Problem', author: null, time_limit_ms: 1000, memory_limit_mb: 256 };
        jest.mocked(api.get).mockResolvedValueOnce({ data: mockData });

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

    it('getPdfUrl uses empty base URL fallback when API baseURL is missing', () => {
        (api.defaults as AxiosDefaults).baseURL = undefined;

        const url = problemService.getPdfUrl('P1');

        expect(url).toBe('/problems/P1/pdf');
    });
});
