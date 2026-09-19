import api from '../../services/api';
import {
    fetchOverview,
    fetchAnalyticsUsers,
    fetchUserAnalytics,
    fetchProblemAnalytics,
    fetchContestAnalytics,
    exportAnalyticsCsv,
} from '../../services/analyticsService';

jest.mock('../../services/api');

describe('Analytics Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('fetchOverview requests the overview endpoint with days', async () => {
        const mockData = { kpis: {}, dailySeries: [] };
        jest.mocked(api.get).mockResolvedValueOnce({ data: mockData });

        const result = await fetchOverview(7);

        expect(api.get).toHaveBeenCalledWith('/analytics/overview', { params: { days: 7 } });
        expect(result).toEqual(mockData);
    });

    it('fetchOverview defaults to 30 days', async () => {
        jest.mocked(api.get).mockResolvedValueOnce({ data: {} });

        await fetchOverview();

        expect(api.get).toHaveBeenCalledWith('/analytics/overview', { params: { days: 30 } });
    });

    it('fetchAnalyticsUsers passes search/limit/offset params', async () => {
        const mockData = { users: [] };
        jest.mocked(api.get).mockResolvedValueOnce({ data: mockData });

        const result = await fetchAnalyticsUsers({ search: 'bo', limit: 25, offset: 50 });

        expect(api.get).toHaveBeenCalledWith('/analytics/users', { params: { search: 'bo', limit: 25, offset: 50 } });
        expect(result).toEqual(mockData);
    });

    it('fetchAnalyticsUsers omits undefined params', async () => {
        jest.mocked(api.get).mockResolvedValueOnce({ data: { users: [] } });

        await fetchAnalyticsUsers({});

        expect(api.get).toHaveBeenCalledWith('/analytics/users', { params: {} });
    });

    it('fetchUserAnalytics requests by userId', async () => {
        const mockData = { user: { id: 2 } };
        jest.mocked(api.get).mockResolvedValueOnce({ data: mockData });

        const result = await fetchUserAnalytics(2);

        expect(api.get).toHaveBeenCalledWith('/analytics/users/2');
        expect(result).toEqual(mockData);
    });

    it('fetchProblemAnalytics requests by problemId', async () => {
        const mockData = { problem: { id: 'aplusb' } };
        jest.mocked(api.get).mockResolvedValueOnce({ data: mockData });

        const result = await fetchProblemAnalytics('aplusb');

        expect(api.get).toHaveBeenCalledWith('/analytics/problems/aplusb');
        expect(result).toEqual(mockData);
    });

    it('fetchContestAnalytics requests by contestId', async () => {
        const mockData = { contest: { contestId: 1 } };
        jest.mocked(api.get).mockResolvedValueOnce({ data: mockData });

        const result = await fetchContestAnalytics(1);

        expect(api.get).toHaveBeenCalledWith('/analytics/contests/1');
        expect(result).toEqual(mockData);
    });

    describe('exportAnalyticsCsv', () => {
        const createObjectUrlSpy = jest.fn(() => 'blob:mock-url');
        const revokeObjectUrlSpy = jest.fn();

        beforeAll(() => {
            Object.defineProperty(window.URL, 'createObjectURL', { value: createObjectUrlSpy, writable: true });
            Object.defineProperty(window.URL, 'revokeObjectURL', { value: revokeObjectUrlSpy, writable: true });
        });

        beforeEach(() => {
            createObjectUrlSpy.mockClear();
            revokeObjectUrlSpy.mockClear();
        });

        it('requests the export endpoint as a blob with the type and filters', async () => {
            const clickSpy = jest.fn();
            jest.mocked(api.get).mockResolvedValueOnce({
                data: new Blob(['csv']),
                headers: { 'content-disposition': 'attachment; filename="analytics-users-2026-09-20.csv"' },
            });
            jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(clickSpy);

            await exportAnalyticsCsv('users', { search: 'al', sortBy: 'solved' });

            expect(api.get).toHaveBeenCalledWith('/analytics/export', {
                params: { type: 'users', search: 'al', sortBy: 'solved' },
                responseType: 'blob',
            });
            expect(clickSpy).toHaveBeenCalled();
        });

        it('falls back to a generic filename when the header is missing', async () => {
            jest.mocked(api.get).mockResolvedValueOnce({ data: new Blob(['csv']), headers: {} });
            const clickSpy = jest.fn();
            jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(clickSpy);

            await exportAnalyticsCsv('submissions');

            expect(api.get).toHaveBeenCalledWith('/analytics/export', {
                params: { type: 'submissions' },
                responseType: 'blob',
            });
            expect(clickSpy).toHaveBeenCalled();
        });
    });
});
