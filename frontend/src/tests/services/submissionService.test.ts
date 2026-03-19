import api from '../../services/api';
import submissionService from '../../services/submissionService';

jest.mock('../../services/api');

describe('Submission Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('submit posts submission data', async () => {
        const submitData = { problemId: 'P1', code: 'print(1)', language: 'python' };
        const mockData = { id: 1, status: 'Pending' };
        api.post.mockResolvedValueOnce({ data: mockData });

        const result = await submissionService.submit(submitData);

        expect(api.post).toHaveBeenCalledWith('/submit', submitData);
        expect(result).toEqual(mockData);
    });

    it('getAll fetches submissions with params', async () => {
        const mockData = [{ id: 1, problem_id: 'P1', overall_status: 'Accepted' }];
        api.get.mockResolvedValueOnce({ data: mockData });

        const result = await submissionService.getAll({ filter: 'mine' });

        expect(api.get).toHaveBeenCalledWith('/submissions', { params: { filter: 'mine' } });
        expect(result).toEqual(mockData);
    });

    it('getAll fetches submissions without params', async () => {
        const mockData = [];
        api.get.mockResolvedValueOnce({ data: mockData });

        const result = await submissionService.getAll();

        expect(api.get).toHaveBeenCalledWith('/submissions', { params: undefined });
        expect(result).toEqual(mockData);
    });

    it('getById fetches submission without contestId', async () => {
        const mockData = { id: 1, code: 'print(1)' };
        api.get.mockResolvedValueOnce({ data: mockData });

        const result = await submissionService.getById(1);

        expect(api.get).toHaveBeenCalledWith('/submissions/1', { params: {} });
        expect(result).toEqual(mockData);
    });

    it('getById fetches submission with contestId', async () => {
        const mockData = { id: 1, code: 'print(1)' };
        api.get.mockResolvedValueOnce({ data: mockData });

        const result = await submissionService.getById(1, 'contest-1');

        expect(api.get).toHaveBeenCalledWith('/submissions/1', { params: { contestId: 'contest-1' } });
        expect(result).toEqual(mockData);
    });

    it('searchProblems fetches problem suggestions', async () => {
        const mockData = [{ id: 'P1', title: 'Problem 1' }];
        api.get.mockResolvedValueOnce({ data: mockData });

        const result = await submissionService.searchProblems('prob');

        expect(api.get).toHaveBeenCalledWith('/search/problems?q=prob');
        expect(result).toEqual(mockData);
    });

    it('searchUsers fetches user suggestions', async () => {
        const mockData = [{ username: 'user1' }];
        api.get.mockResolvedValueOnce({ data: mockData });

        const result = await submissionService.searchUsers('user');

        expect(api.get).toHaveBeenCalledWith('/search/users?q=user');
        expect(result).toEqual(mockData);
    });
});
