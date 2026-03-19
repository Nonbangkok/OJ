import { renderHook, waitFor } from '@testing-library/react';
import { useProblemDetail } from '../../hooks/useProblemDetail';
import problemService from '../../services/problemService';
import contestService from '../../services/contestService';
import { useParams } from 'react-router-dom';

// Mock dependencies
jest.mock('react-router-dom', () => ({
    useParams: jest.fn()
}));

jest.mock('../../services/problemService');
jest.mock('../../services/contestService');

describe('useProblemDetail Hook', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('fetches problem detail successfully without contestId', async () => {
        useParams.mockReturnValue({ problemId: '1' });
        const mockDetails = { id: '1', title: 'Problem 1' };
        const mockStats = [{ id: '1', accepted: 10, total: 20 }];

        problemService.getDetails.mockResolvedValueOnce(mockDetails);
        problemService.getAllWithStats.mockResolvedValueOnce(mockStats);

        const { result } = renderHook(() => useProblemDetail());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.problem).toEqual({ ...mockDetails, ...mockStats[0] });
        expect(result.current.error).toBe('');
    });

    it('fetches problem detail successfully with contestId', async () => {
        useParams.mockReturnValue({ problemId: '1', contestId: 'contest-123' });
        const mockProblem = { id: '1', title: 'Contest Problem' };
        const mockContest = { id: 'contest-123', title: 'Contest' };

        problemService.getContestProblemDetails.mockResolvedValueOnce(mockProblem);
        contestService.getById.mockResolvedValueOnce(mockContest);

        const { result } = renderHook(() => useProblemDetail());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
            expect(result.current.contest).toEqual(mockContest);
        });

        expect(result.current.problem).toEqual(mockProblem);
    });

    it('handles hidden problem (403)', async () => {
        useParams.mockReturnValue({ problemId: '1' });
        const error = new Error('Forbidden');
        error.response = {
            status: 403,
            data: {
                message: 'Problem is hidden',
                problemId: '1',
                title: 'Hidden',
                detail: 'Detailed info'
            }
        };
        problemService.getDetails.mockRejectedValueOnce(error);

        const { result } = renderHook(() => useProblemDetail());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.hiddenProblemInfo).toEqual({
            problemId: '1',
            title: 'Hidden',
            detail: 'Detailed info'
        });
    });

    it('handles problem not found (404)', async () => {
        useParams.mockReturnValue({ problemId: '999' });
        const error = new Error('Not Found');
        error.response = { status: 404 };
        problemService.getDetails.mockRejectedValueOnce(error);

        const { result } = renderHook(() => useProblemDetail());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.error).toBe('Problem 999 not found.');
    });

    it('handles general fetch error', async () => {
        useParams.mockReturnValue({ problemId: '1' });
        const error = new Error('Server Error');
        error.response = { data: { message: 'Something went wrong' } };
        problemService.getDetails.mockRejectedValueOnce(error);

        const { result } = renderHook(() => useProblemDetail());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.error).toBe('Something went wrong');
    });
});
