import { renderHook, act, waitFor } from '@testing-library/react';
import { useSubmissions } from '../../hooks/useSubmissions';
import submissionService from '../../services/submissionService';
import authService from '../../services/authService';

jest.mock('../../services/submissionService');
jest.mock('../../services/authService');

describe('useSubmissions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        authService.checkLogin.mockResolvedValue({ isAuthenticated: false });
        submissionService.searchProblems.mockResolvedValue([]);
        submissionService.searchUsers.mockResolvedValue([]);
    });

    it('fetches and returns submissions on mount', async () => {
        const mockSubmissions = [{ id: 1, overall_status: 'Accepted' }];
        submissionService.getAll.mockResolvedValue(mockSubmissions);

        const { result } = renderHook(() => useSubmissions());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.submissions).toEqual(mockSubmissions);
        expect(result.current.error).toBe('');
        expect(submissionService.getAll).toHaveBeenCalled();
    });

    it('handles errors when fetching submissions', async () => {
        submissionService.getAll.mockRejectedValue(new Error('Network error'));

        const { result } = renderHook(() => useSubmissions());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.submissions).toEqual([]);
        expect(result.current.error).toBe('Failed to fetch submissions.');
    });

    it('passes problemId and filter when problemId is provided', async () => {
        const mockSubmissions = [{ id: 1, problemId: 5 }];
        submissionService.getAll.mockResolvedValue(mockSubmissions);

        const { result } = renderHook(() => useSubmissions(5));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(submissionService.getAll).toHaveBeenCalledWith(
            expect.objectContaining({
                filter: 'mine',
                problemId: 5,
            })
        );
    });

    it('passes contestId when contestId is provided', async () => {
        const mockSubmissions = [];
        submissionService.getAll.mockResolvedValue(mockSubmissions);

        const { result } = renderHook(() => useSubmissions(null, 'contest-123'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(submissionService.getAll).toHaveBeenCalledWith(
            expect.objectContaining({ contestId: 'contest-123' })
        );
    });

    it('refreshes submissions when refresh is called', async () => {
        const mockSubmissions = [{ id: 1 }];
        submissionService.getAll.mockResolvedValue(mockSubmissions);

        const { result } = renderHook(() => useSubmissions());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const callCount = submissionService.getAll.mock.calls.length;

        await act(async () => {
            result.current.refresh();
        });

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(submissionService.getAll.mock.calls.length).toBeGreaterThan(callCount);
    });

    it('opens modal and fetches submission details when handleViewCode is called', async () => {
        const mockSubmissions = [];
        const mockSubmissionDetail = { id: 1, code: 'print("hello")' };
        submissionService.getAll.mockResolvedValue(mockSubmissions);
        submissionService.getById.mockResolvedValue(mockSubmissionDetail);

        const { result } = renderHook(() => useSubmissions());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        await act(async () => {
            result.current.handleViewCode(1);
        });

        expect(submissionService.getById).toHaveBeenCalledWith(1, undefined);
        expect(result.current.selectedSubmission).toEqual(mockSubmissionDetail);
        expect(result.current.isModalOpen).toBe(true);
    });

    it('closes modal when handleCloseModal is called', async () => {
        const mockSubmissions = [];
        const mockSubmissionDetail = { id: 1 };
        submissionService.getAll.mockResolvedValue(mockSubmissions);
        submissionService.getById.mockResolvedValue(mockSubmissionDetail);

        const { result } = renderHook(() => useSubmissions());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        await act(async () => {
            result.current.handleViewCode(1);
        });
        expect(result.current.isModalOpen).toBe(true);

        act(() => {
            result.current.handleCloseModal();
        });
        expect(result.current.isModalOpen).toBe(false);
        expect(result.current.selectedSubmission).toBe(null);
    });

    it('updates filter when setFilter is called', async () => {
        submissionService.getAll.mockResolvedValue([]);

        const { result } = renderHook(() => useSubmissions());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.filter).toBe('all');

        act(() => {
            result.current.setFilter('mine');
        });
        expect(result.current.filter).toBe('mine');
    });

    it('returns initial state values', async () => {
        submissionService.getAll.mockResolvedValue([]);

        const { result } = renderHook(() => useSubmissions());

        expect(result.current.submissions).toEqual([]);
        expect(result.current.loading).toBe(true);
        expect(result.current.filter).toBe('all');
        expect(result.current.isModalOpen).toBe(false);
        expect(result.current.selectedSubmission).toBe(null);
    });
});
