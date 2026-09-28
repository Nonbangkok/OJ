import { renderHook, waitFor, act } from '@testing-library/react';
import useProblemManagement from '../../../hooks/admin/useProblemManagement';
import adminService from '../../../services/adminService';

jest.mock('../../../services/adminService');

describe('useProblemManagement', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockProblems = [
        { id: 'PROB1', title: 'Problem 1', author: 'admin', is_visible: true },
        { id: 'PROB2', title: 'Problem 2', author: 'user1', is_visible: false }
    ];
    const mockPage = {
        problems: mockProblems,
        nextCursor: null,
        hasMore: false,
        authors: [{ name: 'admin' }, { name: 'user1' }],
        hasUnauthoredProblems: false,
    };

    it('fetches problems correctly', async () => {
        (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValueOnce(mockPage);

        const { result } = renderHook(() => useProblemManagement({}));

        expect(result.current.loading).toBe(true);

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.problems).toEqual(mockProblems);
        expect(adminService.getProblems).toHaveBeenCalledTimes(1);
    });

    it('handles problem deletion', async () => {
        (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValueOnce(mockPage);
        (jest.mocked(adminService.deleteProblem) as jest.Mock).mockResolvedValueOnce({});

        const { result } = renderHook(() => useProblemManagement({}));

        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.handleDeleteClick('PROB1');
        });

        await act(async () => {
            await result.current.handleConfirmDelete();
        });

        expect(adminService.deleteProblem).toHaveBeenCalledWith('PROB1');
        // Should re-fetch
        expect(adminService.getProblems).toHaveBeenCalledTimes(2);
    });

    it('handles visibility toggle', async () => {
        (jest.mocked(adminService.getProblems) as jest.Mock).mockResolvedValueOnce(mockPage);
        (jest.mocked(adminService.updateProblemVisibility) as jest.Mock).mockResolvedValueOnce({});

        const { result } = renderHook(() => useProblemManagement({}));

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.handleToggleVisibility('PROB1', true);
        });

        expect(adminService.updateProblemVisibility).toHaveBeenCalledWith('PROB1', false);
        expect(adminService.getProblems).toHaveBeenCalledTimes(2);
    });
});
